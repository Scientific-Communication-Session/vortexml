"""
Account data tests for VortexML: the "download my data" export and account
deletion.

Deleting an account has to take everything with it — the rows, the weight files
on disk, the knowledge-base index, queued and running jobs — and nothing that
belongs to anyone else. Runs offline against a throwaway SQLite database.

Run from the backend dir:   python test_account.py
"""

import io
import json
import os
import sys
import tempfile
import time

_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_TMPDB.close()
os.environ["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + _TMPDB.name
os.environ.setdefault("VORTEX_USE_SQLITE", "1")

from app import app, db, socketio, limiter, _jobs, _queues, _states, _recent_runs   # noqa: E402
from models import (User, Project, Device, KnowledgeBase, Document,                 # noqa: E402
                    Conversation, ChatMessage, SalesInquiry)
from training_engine import WEIGHTS_DIR                                             # noqa: E402
import rag                                                                          # noqa: E402

PASS, FAIL = "[ PASS ]", "[ FAIL ]"
_failures = 0
PASSWORD = "test1234"


def expect(cond, label):
    global _failures
    ok = bool(cond)
    if not ok:
        _failures += 1
    print(f"  {PASS if ok else FAIL} {label}")
    return ok


def _signup(email):
    c = app.test_client()
    r = c.post("/api/auth/signup", json={
        "email": email, "username": email.split("@")[0], "password": PASSWORD})
    assert r.status_code == 201, f"signup failed: {r.status_code} {r.get_data(as_text=True)}"
    return c


def _wait(predicate, timeout=120.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        socketio.sleep(0.05)
    return False


def _train(client, name, epochs=6):
    """Train a small real model through the HTTP API and wait for it."""
    cfg = client.post("/api/demo/load", json={"key": "iris"}).get_json()["config"]
    client.post("/api/model/configure", json={**cfg, "epochs": epochs, "project_name": name})
    r = client.post("/api/training/start", json={"device_id": None})
    assert r.status_code == 200 and r.get_json().get("job_id"), r.get_data(as_text=True)
    return r.get_json()["job_id"]


def _populate(client, tag):
    """Give an account one of everything."""
    _train(client, f"{tag}-model")
    assert _wait(lambda: not client.get("/api/training/active").get_json()["jobs"]), "run did not finish"
    client.post("/api/devices", json={"nickname": f"{tag}-box"})
    kb = client.post("/api/rag/kb", json={"name": f"{tag}-notes"}).get_json()
    kb_id = (kb.get("knowledge_base") or kb.get("kb") or kb)["id"]
    client.post(f"/api/rag/kb/{kb_id}/documents", data={
        "file": (io.BytesIO(b"Iris setosa has short petals. Iris virginica has long petals."), "iris.txt")},
        content_type="multipart/form-data")
    client.post("/api/sales/contact", json={
        "name": tag, "email": f"{tag}@example.com", "interest": "other",
        "message": "A question about dedicated capacity for our lab."})
    return kb_id


def _counts(user_id):
    return {
        "projects": Project.query.filter_by(user_id=user_id).count(),
        "devices": Device.query.filter_by(user_id=user_id).count(),
        "kbs": KnowledgeBase.query.filter_by(user_id=user_id).count(),
        "conversations": Conversation.query.filter_by(user_id=user_id).count(),
    }


def main():
    limiter.enabled = False
    with app.app_context():
        db.create_all()

    print("\nSetting up two accounts with data")
    ana = _signup("ana@example.com")
    bob = _signup("bob@example.com")
    ana_kb = _populate(ana, "ana")
    bob_kb = _populate(bob, "bob")
    with app.app_context():
        ana_id = User.query.filter_by(email="ana@example.com").first().id
        bob_id = User.query.filter_by(email="bob@example.com").first().id
        # A conversation with a message, written directly (the chat itself needs an LLM).
        for uid in (ana_id, bob_id):
            conv = Conversation(user_id=uid, title="About petals")
            db.session.add(conv)
            db.session.flush()
            db.session.add(ChatMessage(conversation_id=conv.id, role="user", content="Why petals?"))
        db.session.commit()
        ana_weights = [p.weight_filename for p in Project.query.filter_by(user_id=ana_id)]
        bob_weights = [p.weight_filename for p in Project.query.filter_by(user_id=bob_id)]
        expect(_counts(ana_id) == {"projects": 1, "devices": 1, "kbs": 1, "conversations": 1},
               "ana has a project, a device, a knowledge base and a conversation")
    expect(all(os.path.exists(os.path.join(WEIGHTS_DIR, f)) for f in ana_weights + bob_weights),
           "both accounts' weight files are on disk")
    ana_kb_dir = rag.KBStore(ana_kb).dir if hasattr(rag.KBStore(ana_kb), "dir") else None

    print("\nExport")
    r = app.test_client().get("/api/auth/export")
    expect(r.status_code == 401, "export needs a signed-in user")
    r = ana.get("/api/auth/export")
    expect(r.status_code == 200 and "attachment" in r.headers.get("Content-Disposition", ""),
           "export is offered as a file download")
    data = json.loads(r.get_data(as_text=True))
    expect(data["account"] == {"email": "ana@example.com", "username": "ana", "mode": None},
           "export has the account details (and no password hash)")
    expect("password" not in r.get_data(as_text=True).lower(), "the word 'password' appears nowhere in the export")
    expect(len(data["projects"]) == 1 and data["projects"][0]["name"] == "ana-model"
           and len(data["projects"][0]["history"]) > 0, "export has the project with its training history")
    expect(len(data["devices"]) == 1 and "token" not in data["devices"][0],
           "export lists the device without its pairing token")
    expect(data["knowledge_bases"][0]["name"] == "ana-notes"
           and data["knowledge_bases"][0]["documents"][0]["filename"] == "iris.txt",
           "export lists the knowledge base and its document")
    expect(data["conversations"][0]["messages"][0]["content"] == "Why petals?",
           "export has the conversation's messages")
    expect(len(data["enquiries"]) == 1 and data["enquiries"][0]["email"] == "ana@example.com",
           "export has the enquiry ana sent")
    expect("bob" not in r.get_data(as_text=True), "nothing of bob's is in ana's export")

    print("\nDeleting needs the password")
    r = app.test_client().delete("/api/auth/account", json={"password": PASSWORD})
    expect(r.status_code == 401, "deletion needs a signed-in user")
    r = ana.delete("/api/auth/account", json={"password": "wrong-password"})
    expect(r.status_code == 403, "a wrong password is refused")
    r = ana.delete("/api/auth/account", json={})
    expect(r.status_code == 403, "a missing password is refused")
    with app.app_context():
        expect(User.query.get(ana_id) is not None and _counts(ana_id)["projects"] == 1,
               "nothing was deleted by the refused attempts")

    print("\nDeleting with work in flight")
    # ana has one run training and one waiting behind it when she deletes her account.
    running = _train(ana, "ana-long", epochs=4000)
    expect(_wait(lambda: any(j["job_id"] == running and j.get("epoch", 0) > 1 for j in _jobs.values()), 60),
           "a long run of ana's is training")
    queued = _train(ana, "ana-queued", epochs=5)
    expect(any(j["job_id"] == queued for q in _queues.values() for j in q), "a second run of hers is queued")
    r = ana.delete("/api/auth/account", json={"password": PASSWORD})
    expect(r.status_code == 200 and r.get_json()["status"] == "deleted", "the account is deleted with the right password")
    expect(not any(j["job_id"] == queued for q in _queues.values() for j in q), "her queued run left the queue")
    expect(_wait(lambda: running not in _jobs, 60), "her running job stopped")
    socketio.sleep(0.5)

    print("\nEverything of hers is gone")
    with app.app_context():
        expect(User.query.get(ana_id) is None, "the user row is gone")
        expect(_counts(ana_id) == {"projects": 0, "devices": 0, "kbs": 0, "conversations": 0},
               "her projects, devices, knowledge bases and conversations are gone")
        expect(Document.query.filter_by(kb_id=ana_kb).count() == 0, "her documents are gone")
        expect(ChatMessage.query.join(Conversation).filter(Conversation.user_id == ana_id).count() == 0
               and ChatMessage.query.count() == 1, "her chat messages are gone, bob's remain")
        expect(SalesInquiry.query.filter_by(email="ana@example.com").count() == 0, "her enquiry is gone")
        expect(Project.query.filter(Project.name.in_(["ana-long", "ana-queued"])).count() == 0,
               "the runs that were in flight did not come back as projects")
    expect(not any(os.path.exists(os.path.join(WEIGHTS_DIR, f)) for f in ana_weights),
           "her weight files are removed from disk")
    if ana_kb_dir:
        expect(not os.path.exists(ana_kb_dir), "her knowledge-base index is removed from disk")
    expect(_wait(lambda: f"user:{ana_id}" not in _states and f"user:{ana_id}" not in _recent_runs, 15),
           "her working state and last-run summary are gone, also after the stopped run wound down")
    expect(ana.get("/api/auth/me").get_json()["user"] is None, "her browser is signed out")
    expect(ana.get("/api/auth/export").status_code == 401, "and can no longer reach account pages")
    r = app.test_client().post("/api/auth/signin", json={"email": "ana@example.com", "password": PASSWORD})
    expect(r.status_code == 401, "she can no longer sign in")

    print("\nNothing of anyone else's was touched")
    with app.app_context():
        expect(_counts(bob_id) == {"projects": 1, "devices": 1, "kbs": 1, "conversations": 1},
               "bob still has his project, device, knowledge base and conversation")
        expect(SalesInquiry.query.filter_by(email="bob@example.com").count() == 1, "bob's enquiry is still there")
    expect(all(os.path.exists(os.path.join(WEIGHTS_DIR, f)) for f in bob_weights), "bob's weight files are still on disk")
    expect(bob.get("/api/auth/me").status_code == 200, "bob is still signed in")
    r = _signup("ana@example.com")
    expect(r.get("/api/auth/export").get_json()["projects"] == [],
           "the email can be used for a fresh, empty account")

    print("\nA reused account id inherits nothing")
    # SQLite gives the next sign-up the id of the newest account if that one was
    # deleted. Whatever the deleted account had loaded must not be waiting there.
    eve = _signup("eve@example.com")
    eve.post("/api/demo/load", json={"key": "iris"})
    with app.app_context():
        eve_id = User.query.filter_by(email="eve@example.com").first().id
    expect(_states.get(f"user:{eve_id}", {}).get("dataset_info"), "eve has a dataset loaded")
    eve.delete("/api/auth/account", json={"password": PASSWORD})
    dan = _signup("dan@example.com")
    with app.app_context():
        dan_id = User.query.filter_by(email="dan@example.com").first().id
    expect(dan_id == eve_id, "the next sign-up got the deleted account's id")
    expect(not dan.get("/api/state").get_json().get("dataset_info"), "and starts with no dataset loaded")

    # tidy up bob's and the new account's files
    for c in (bob, r, dan):
        c.delete("/api/auth/account", json={"password": PASSWORD})
    os.unlink(_TMPDB.name)
    print(f"\n{'All checks passed' if not _failures else f'{_failures} check(s) FAILED'}")
    sys.exit(1 if _failures else 0)


if __name__ == "__main__":
    main()
