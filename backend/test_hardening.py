"""
Hardening tests for VortexML: things one caller must not be able to do to
another, or to the server.

Each block is a defect that was once reproduced against a running instance —
a kept cookie signing in as the next account, a browser posing as a node
agent, two uploads sharing a file name — and now has to stay fixed. Runs
offline against a throwaway SQLite database.

Run from the backend dir:   python test_hardening.py
"""

import hashlib
import io
import json
import os
import sys
import tempfile
import time
from datetime import datetime

_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_TMPDB.close()
os.environ["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + _TMPDB.name
os.environ.setdefault("VORTEX_USE_SQLITE", "1")

from app import app, socketio, limiter, _jobs, _device_busy, _states, UPLOAD_DIR   # noqa: E402
import claude_models                                                                 # noqa: E402
import rag                                                                           # noqa: E402
from models import User, Project, SalesInquiry                                       # noqa: E402
from training_engine import WEIGHTS_DIR                                              # noqa: E402

PASS, FAIL = "[ PASS ]", "[ FAIL ]"
_failures = 0
PASSWORD = "test1234"
_ip = 0


def expect(cond, label):
    global _failures
    ok = bool(cond)
    if not ok:
        _failures += 1
    print(f"  {PASS if ok else FAIL} {label}")
    return ok


def _visitor():
    """A browser with an address of its own, as Cloudflare would report it."""
    global _ip
    _ip += 1
    c = app.test_client()
    c.environ_base["HTTP_CF_CONNECTING_IP"] = f"203.0.113.{_ip}"
    return c


def _signup(email, client=None):
    c = client or _visitor()
    r = c.post("/api/auth/signup", json={
        "email": email, "username": email.split("@")[0], "password": PASSWORD})
    assert r.status_code == 201, f"signup failed: {r.status_code} {r.get_data(as_text=True)}"
    return c


def _signin(email):
    c = _visitor()
    r = c.post("/api/auth/signin", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, r.get_data(as_text=True)
    return c


def _wait(predicate, timeout=120.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        socketio.sleep(0.05)
    return False


def _idle(client):
    return _wait(lambda: not client.get("/api/training/active").get_json()["jobs"])


def _start(client, name="Run", key="iris", **overrides):
    cfg = client.post("/api/demo/load", json={"key": key}).get_json()["config"]
    r = client.post("/api/model/configure", json={**cfg, "project_name": name, **overrides})
    assert r.status_code == 200, r.get_data(as_text=True)
    return client.post("/api/training/start", json={"device_id": None})


def _sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def _strict_json(text):
    """Parse as a browser would: NaN and Infinity are not JSON."""
    def refuse(token):
        raise ValueError(f"not JSON: {token}")
    return json.loads(text, parse_constant=refuse)


def main():
    print("\nA cookie from a deleted account is not a login for the next one")
    carol = _signup("carol@example.com")
    carol_other_browser = _signin("carol@example.com")
    with app.app_context():
        carol_id = User.query.filter_by(email="carol@example.com").first().id
    carol.delete("/api/auth/account", json={"password": PASSWORD})
    dave = _signup("dave@example.com")
    with app.app_context():
        dave_id = User.query.filter_by(email="dave@example.com").first().id
    expect(dave_id == carol_id, "the next sign-up got the deleted account's id")
    expect(carol_other_browser.get("/api/auth/me").get_json()["user"] is None,
           "the deleted account's other browser is signed out")
    expect(carol_other_browser.get("/api/auth/export").status_code == 401,
           "and cannot read the new account's data")
    expect(dave.get("/api/auth/me").get_json()["user"]["email"] == "dave@example.com",
           "the new account's own browser is signed in")

    print("\nSigned out is an answer, not an error")
    anon = _visitor()
    me = anon.get("/api/auth/me")
    expect(me.status_code == 200 and me.get_json() == {"user": None}, "/api/auth/me -> 200, no user")
    st = anon.get("/api/auto-config/status")
    expect(st.status_code == 200 and st.get_json()["available"] is False,
           "/api/auto-config/status -> 200, not available")

    print("\nWrongly typed input is refused, not a server error")
    v = _visitor()
    expect(v.post("/api/auth/signup", json={"email": {"a": 1}, "username": "x", "password": PASSWORD}).status_code == 400,
           "sign-up with an object for an email -> 400")
    expect(v.post("/api/auth/signup", json={"email": "not-an-email", "username": "x", "password": PASSWORD}).status_code == 400,
           "sign-up with a malformed email -> 400")
    expect(v.post("/api/auth/signup", json={"email": "short@example.com", "username": "x", "password": "1"}).status_code == 400,
           "sign-up with a one-character password -> 400")
    expect(v.post("/api/auth/signin", json={"email": "dave@example.com", "password": 123}).status_code == 401,
           "sign-in with a number for a password -> 401")
    expect(v.post("/api/auth/signin", json=["a", "list"]).status_code == 401, "sign-in with a list for a body -> 401")
    expect(v.post("/api/training/stop", json={"job_id": ["a"]}).status_code == 200, "stop with a list for a job id -> no crash")
    expect(v.post("/api/sales/contact", json={"name": 5, "email": [], "message": {}}).status_code == 400,
           "enquiry with wrong types -> 400")
    expect(dave.delete("/api/auth/account", json={"password": 123}).status_code == 403,
           "account deletion with a number for a password -> 403")
    r = v.post("/api/model/configure", json={"arch_type": "mlp", "project_name": "x" * 300})
    expect(r.status_code == 400, "a 300-character project name -> 400")
    r = v.post("/api/model/configure", json={"arch_type": "mlp", "project_name": None})
    expect(r.status_code == 200 and r.get_json()["config"]["project_name"] == "VortexProject",
           "a null project name falls back to the default")
    r = v.post("/api/model/configure", json={"arch_type": "mlp", "layer_sizes": [8192] * 16})
    expect(r.status_code == 400, "sixteen layers of 8192 -> 400 (too large)")

    print("\nRate limits count the visitor, not the proxy")
    limiter.reset()
    flood = _visitor()
    codes = [flood.post("/api/auth/signin", json={"email": "dave@example.com", "password": "wrong-one"}).status_code
             for _ in range(11)]
    expect(codes[:10] == [401] * 10 and codes[10] == 429, "one address is limited after ten wrong passwords")
    r = _visitor().post("/api/auth/signin", json={"email": "dave@example.com", "password": PASSWORD})
    expect(r.status_code == 200, "someone else can still sign in")

    print("\nAn enquiry is not handed to whoever registers its address")
    _visitor().post("/api/sales/contact", json={
        "name": "Victor", "email": "victor@bigcorp.example", "company": "BigCorp",
        "message": "Confidential: we are evaluating vendors."})
    mallory = _signup("victor@bigcorp.example")
    expect(mallory.get("/api/auth/export").get_json()["enquiries"] == [],
           "an account with the same email does not see it in its export")
    mallory.delete("/api/auth/account", json={"password": PASSWORD})
    with app.app_context():
        expect(SalesInquiry.query.filter_by(email="victor@bigcorp.example").count() == 1,
               "and deleting that account does not delete it")

    print("\nUploads do not share file names")
    alice, bob = _signup("alice@example.com"), _signup("bob@example.com")
    alice.post("/api/upload", data={"file": (io.BytesIO(b"a,label\n1,0\n2,1\n3,0\n"), "data.csv")},
               content_type="multipart/form-data")
    alice_path = _states[f"user:{_uid('alice@example.com')}"]["dataset_path"]
    before = _sha(alice_path)
    up = bob.post("/api/upload", data={"file": (io.BytesIO(b"x,y\n9,9\n8,8\n7,7\n"), "data.csv")},
                  content_type="multipart/form-data")
    bob_path = _states[f"user:{_uid('bob@example.com')}"]["dataset_path"]
    expect(up.get_json()["filename"] == "data.csv", "the name shown is the one the person chose")
    expect(bob_path != alice_path and _sha(alice_path) == before, "the second data.csv did not replace the first")
    expect("label" in json.dumps(alice.get("/api/dataset/analyze").get_json()), "the first person still sees their columns")
    alice.post("/api/upload", data={"file": (io.BytesIO(b"p,q\n1,2\n3,4\n5,6\n"), "next.csv")},
               content_type="multipart/form-data")
    expect(not os.path.exists(alice_path), "replacing a dataset deletes the old file")
    bob.post("/api/state/reset", json={"scope": "dataset"})
    expect(not os.path.exists(bob_path), "resetting the dataset deletes the file")
    alice.post("/api/state/reset", json={})

    print("\nA finished model cannot be overwritten or mixed up")
    _start(alice, "Mine", epochs=3)
    _idle(alice)
    with app.app_context():
        alice_weights = Project.query.filter_by(user_id=_uid("alice@example.com")).first().weight_filename
    path = os.path.join(WEIGHTS_DIR, alice_weights)
    before = _sha(path)
    r = _visitor().post("/api/weights/upload", data={"file": (io.BytesIO(b"not a model"), alice_weights)},
                        content_type="multipart/form-data")
    stored = r.get_json().get("filename")
    expect(r.status_code == 200 and stored != alice_weights, "an upload under an existing name is stored under another")
    expect(_sha(path) == before, "the existing weights are untouched")
    r = _visitor().post("/api/weights/upload", data={"file": (io.BytesIO(b"x"), "bad.pt")},
                        content_type="multipart/form-data")
    expect(r.status_code == 400 and not os.path.exists(os.path.join(WEIGHTS_DIR, "bad.pt")),
           "a weights file with an unreadable name is refused and not kept")
    if stored and stored != alice_weights:
        os.remove(os.path.join(WEIGHTS_DIR, stored))
    _start(bob, "Same", epochs=2)
    _idle(bob)
    _start(alice, "Same", epochs=2)
    _idle(alice)
    with app.app_context():
        names = [p.weight_filename for p in Project.query.filter_by(name="Same").all()]
    expect(len(names) == 2 and len(set(names)) == 2, "two runs with the same name and settings get two files")

    print("\nA browser cannot speak for a node agent")
    job_id = _start(alice, "Long", epochs=100000).get_json()["job_id"]
    _wait(lambda: _jobs.get(job_id, {}).get("epoch", 0) > 0)
    shared = _jobs[job_id]["device_id"]
    intruder = socketio.test_client(app, flask_test_client=_visitor())
    intruder.emit("node_error", {"job_id": job_id, "error": "forged"})
    intruder.emit("node_stopped", {"job_id": job_id})
    intruder.emit("node_complete", {"job_id": job_id, "weights_b64": "QUJD",
                                    "meta": {"weight_filename": alice_weights}})
    socketio.sleep(0.3)
    expect(job_id in _jobs and _device_busy.get(shared) == job_id, "forged node events do not end someone's run")
    expect(_sha(path) == before, "or write over their weights")
    intruder.disconnect()

    print("\nOne caller cannot take the whole queue; a stranger does not learn a run's name")
    extra = [_start(alice, f"Q{i}", epochs=2).status_code for i in range(3)]
    expect(extra == [200, 200, 429], "a fourth run is refused while three are training or waiting")
    dev = _visitor().get("/api/devices").get_json()["devices"][0]
    expect(dev["status"] == "busy" and dev["job"]["project_name"] is None, "others see the device busy, not what the run is called")
    own = alice.get("/api/devices").get_json()["devices"][0]
    expect(own["job"]["project_name"] == "Long", "the owner sees the name")
    alice.post("/api/training/stop", json={"job_id": job_id})
    _idle(alice)

    print("\nA run that diverges ends with a reason, and never stores NaN")
    _start(bob, "Diverge", key="diabetes", lr=10, optimizer="sgd", epochs=30)
    _idle(bob)
    try:
        active = _strict_json(bob.get("/api/training/active").get_data(as_text=True))
        _strict_json(bob.get("/api/projects").get_data(as_text=True))
        ok = True
    except ValueError:
        active, ok = {}, False
    expect(ok, "the run's status and the project list are valid JSON")
    last = active.get("last_run") or {}
    expect(last.get("status") in ("error", "complete"), f"the run ended ({last.get('status')})")
    if last.get("status") == "error":
        expect("diverged" in json.dumps(last).lower(), "with a message that says it diverged")

    for c in (alice, bob, dave):
        c.delete("/api/auth/account", json={"password": PASSWORD})

    _claude_model_checks()
    for name in os.listdir(UPLOAD_DIR):
        expect(False, f"left behind in uploads/: {name}") if name.endswith("data.csv") else None
    os.unlink(_TMPDB.name)
    print(f"\n{'All checks passed' if not _failures else f'{_failures} check(s) FAILED'}")
    sys.exit(1 if _failures else 0)


class _FakeClaude:
    """Stands in for the API client: a model list, and models that reject requests."""

    def __init__(self, listed, rejects=()):
        self.calls = []
        outer = self

        class _Messages:
            def __init__(self, with_fallback):
                self.with_fallback = with_fallback

            def create(self, model, **request):
                outer.calls.append((model, self.with_fallback))
                if not request.get("messages") or (model, self.with_fallback) in rejects or model in rejects:
                    raise LookupError(model)
                return type("Reply", (), {"model": model, "stop_reason": "end_turn", "content": []})()

        self.messages = _Messages(False)
        self.beta = type("Beta", (), {"messages": _Messages(True)})()
        self.models = type("Models", (), {"list": staticmethod(lambda: [
            type("Model", (), {"id": i, "display_name": i.title(), "created_at": datetime(2026, 1, n + 1)})()
            for n, i in enumerate(listed)])})()


def _claude_model_checks():
    print("\nThe AI features follow the newest Opus and Sonnet")
    saved = claude_models._client, claude_models.REJECTED, dict(claude_models._latest)
    claude_models.REJECTED = (LookupError,)
    ask = {"max_tokens": 8, "messages": [{"role": "user", "content": "hi"}]}
    try:
        # Listed oldest first: a snapshot of an old version is the most recent release here.
        claude_models._client = _FakeClaude([
            "claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-6", "claude-sonnet-6-1",
            "claude-sonnet-6-2-preview", "claude-haiku-9", "claude-opus-4-5-20270101"])
        claude_models.refresh()
        expect(claude_models.resolve("opus") == "claude-opus-6" and claude_models.resolve("sonnet") == "claude-sonnet-6-1",
               "the newest version of each family is chosen (not previews, not a late snapshot of an old version)")
        expect(claude_models.resolve("claude-opus-4-8") == "claude-opus-6",
               "a conversation saved under an older Opus continues on the current one")
        expect(claude_models.resolve("claude-haiku-4-5") == "claude-haiku-4-5", "other models are left as they are")
        cloud = next(b for b in rag.list_backends()["backends"] if b["key"] == "cloud")
        expect(cloud["default_model"] == "claude-opus-6" and cloud["models"][:2] == ["claude-opus-6", "claude-sonnet-6-1"],
               "the model picker lists them")

        expect(claude_models.create("sonnet", **ask).model == "claude-sonnet-6-1", "requests go to the newest model")

        fake = _FakeClaude(["claude-opus-6", "claude-sonnet-6-1"], rejects={"claude-sonnet-6-1"})
        claude_models._client = fake
        claude_models.refresh()
        expect(claude_models.create("sonnet", **ask).model == "claude-sonnet-5-5",
               "if the newest model rejects the request, the pinned one answers")
        fake.calls.clear()
        claude_models.create("sonnet", **ask)
        expect(fake.calls == [("claude-sonnet-5-5", True)], "and the rejected model is not tried again")

        fake = _FakeClaude(["claude-opus-6"])
        claude_models._client = fake
        claude_models.refresh()
        try:
            claude_models.create("opus", max_tokens=8, messages=[])
            raised = False
        except LookupError:
            raised = True
        fake.calls.clear()
        claude_models.create("opus", **ask)
        expect(raised and fake.calls == [("claude-opus-6", True)],
               "a request that is wrong for every model is an error, and blames no model")
    finally:
        claude_models._client, claude_models.REJECTED = saved[0], saved[1]
        claude_models._latest.clear()
        claude_models._latest.update(saved[2])
        claude_models._unusable.clear()


def _uid(email):
    with app.app_context():
        return User.query.filter_by(email=email).first().id


if __name__ == "__main__":
    main()
