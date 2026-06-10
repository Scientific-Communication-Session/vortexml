"""
Cross-user authorization tests for VortexML.

Verifies that one signed-in user can never read, mutate, or delete another
user's resources (projects, weights, knowledge bases, conversations, devices),
and that protected endpoints reject anonymous callers. Runs entirely offline
against a throwaway SQLite database via the Flask test client — no network, no
API key, no model downloads.

Run from the backend dir:   python test_authz.py
"""

import io
import os
import sys
import tempfile
import time

# Isolated SQLite DB so the test never touches a real database. Must be set
# before importing app (which reads the DB config at import time).
_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_TMPDB.close()
os.environ["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + _TMPDB.name
os.environ.setdefault("VORTEX_USE_SQLITE", "1")

from app import app, db, _json                      # noqa: E402
from models import Project, User                    # noqa: E402
from data_processor import prepare_dataset, save_preprocess  # noqa: E402
from training_engine import create_model, train_model, WEIGHTS_DIR  # noqa: E402

PASS, FAIL = "[ PASS ]", "[ FAIL ]"
_failures = 0
_artifacts = []


def expect(cond, label):
    global _failures
    ok = bool(cond)
    if not ok:
        _failures += 1
    print(f"  {PASS if ok else FAIL} {label}")
    return ok


class _Stub:
    def emit(self, *a, **k): pass
    def sleep(self, *a, **k): pass


def _signup(email):
    """Return a test client logged in as a freshly-created user."""
    c = app.test_client()
    r = c.post("/api/auth/signup", json={
        "email": email, "username": email.split("@")[0], "password": "test1234"})
    assert r.status_code == 201, f"signup failed: {r.status_code} {r.get_data(as_text=True)}"
    return c


def _make_project(email):
    """Train a real tiny model and insert a Project owned by `email`'s user.

    Returns (project_id, weight_filename). Mirrors the production persistence so
    the project is fully usable (weights + preprocessing sidecar on disk).
    """
    import numpy as np, pandas as pd
    rng = np.random.default_rng(0); n = 200
    df = pd.DataFrame({"f1": rng.random(n), "f2": rng.random(n), "f3": rng.random(n)})
    df["label"] = ((df.f1 + df.f2) > 1.0).astype(int)
    tmp = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False)
    df.to_csv(tmp.name, index=False); tmp.close()
    data = prepare_dataset(tmp.name, ["f1", "f2", "f3"], "label", batch_size=32)
    cfg = {"arch_type": "mlp", "layer_sizes": [16, 8], "epochs": 3}
    model = create_model("mlp", [16, 8], data["input_dim"], data["output_dim"])
    res = train_model(model, data["train_loader"], data["val_loader"], data["task_type"],
                      {**cfg, "lr": 0.01, "batch_size": 32, "optimizer": "adam",
                       "activation": "relu", "project_name": "AuthZ", "early_stopping": {}},
                      _Stub(), input_dim=data["input_dim"], output_dim=data["output_dim"],
                      device=None)
    wf = res["weight_filename"]
    save_preprocess(os.path.join(WEIGHTS_DIR, wf), data["preprocess"])
    _artifacts.extend([os.path.join(WEIGHTS_DIR, wf),
                       os.path.join(WEIGHTS_DIR, wf[:-3] + ".preprocess.json"), tmp.name])
    with app.app_context():
        u = User.query.filter_by(email=email).first()
        p = Project(user_id=u.id, name="AuthZ", arch_type="mlp",
                    layer_sizes=_json.dumps([16, 8]), epochs=3, lr=0.01, batch_size=32,
                    optimizer="adam", activation="relu", early_stopping=_json.dumps({}),
                    task_type="classification", input_dim=data["input_dim"],
                    output_dim=data["output_dim"], final_train_loss=res["final_train_loss"],
                    final_val_loss=res["final_val_loss"], final_val_acc=res.get("final_val_acc"),
                    early_stopped=False, history=_json.dumps(res["history"]), weight_filename=wf)
        db.session.add(p); db.session.commit()
        return p.id, wf


def main():
    print("\n-- Setup: two users + anonymous client ------------")
    stamp = int(time.time())
    alice_email = f"alice-{stamp}@local.test"
    bob_email = f"bob-{stamp}@local.test"
    alice = _signup(alice_email)
    bob = _signup(bob_email)
    anon = app.test_client()
    expect(alice.get("/api/auth/me").status_code == 200, "alice authenticated")
    expect(bob.get("/api/auth/me").status_code == 200, "bob authenticated")
    expect(anon.get("/api/auth/me").status_code == 401, "anon /me -> 401")

    # Alice owns a project (with weights), a KB, a conversation, and a device.
    pid, wf = _make_project(alice_email)
    akb = alice.post("/api/rag/kb", json={"name": "AliceKB", "embedder": "tfidf"}).get_json()["knowledge_base"]
    alice.post(f"/api/rag/kb/{akb['id']}/documents",
               data={"file": (io.BytesIO(b"Alice private notes about MLX on M4."), "a.txt")},
               content_type="multipart/form-data")
    aconv = alice.post("/api/conversations", json={"backend": "cloud"}).get_json()["conversation"]
    adev = alice.post("/api/devices", json={"nickname": "AliceBox"}).get_json()["device"]

    print("\n-- Projects: Bob cannot touch Alice's project -----")
    expect(len(bob.get("/api/projects").get_json()["projects"]) == 0, "bob's project list is empty")
    expect(bob.get(f"/api/projects/{pid}").status_code == 404, "bob GET alice project -> 404")
    expect(bob.get(f"/api/projects/{pid}/inference").status_code == 404, "bob inference schema -> 404")
    expect(bob.post(f"/api/projects/{pid}/predict",
                    json={"rows": [{"f1": 0.5, "f2": 0.5, "f3": 0.5}]}).status_code == 404,
           "bob predict on alice project -> 404")
    expect(bob.get(f"/api/projects/{pid}/export?format=onnx").status_code == 404, "bob export -> 404")
    expect(bob.post(f"/api/projects/{pid}/load").status_code == 404, "bob load -> 404")
    expect(bob.post("/api/projects/compare", json={"ids": [pid]}).get_json()["projects"] == [],
           "bob compare excludes alice project")
    expect(bob.delete(f"/api/projects/{pid}").status_code == 404, "bob DELETE alice project -> 404")
    # Alice's project survived Bob's delete attempt.
    expect(alice.get(f"/api/projects/{pid}").status_code == 200, "alice project intact")

    print("\n-- Weights: Bob cannot download Alice's weights ---")
    expect(alice.get(f"/api/weights/file/{wf}").status_code == 200, "alice downloads own weights -> 200")
    expect(bob.get(f"/api/weights/file/{wf}").status_code == 404, "bob downloads alice weights -> 404")
    expect(anon.get(f"/api/weights/file/{wf}").status_code == 404, "anon downloads weights -> 404")

    print("\n-- Knowledge bases: Bob cannot touch Alice's KB ---")
    expect(len(bob.get("/api/rag/kb").get_json()["knowledge_bases"]) == 0, "bob's KB list empty")
    expect(bob.get(f"/api/rag/kb/{akb['id']}").status_code == 404, "bob GET alice KB -> 404")
    expect(bob.post(f"/api/rag/kb/{akb['id']}/documents",
                    data={"file": (io.BytesIO(b"x"), "x.txt")},
                    content_type="multipart/form-data").status_code == 404, "bob add docs -> 404")
    expect(bob.post(f"/api/rag/kb/{akb['id']}/query", json={"query": "hi"}).status_code == 404,
           "bob query alice KB -> 404")
    expect(bob.delete(f"/api/rag/kb/{akb['id']}").status_code == 404, "bob DELETE alice KB -> 404")
    expect(alice.get(f"/api/rag/kb/{akb['id']}").status_code == 200, "alice KB intact")

    print("\n-- Conversations: Bob cannot touch Alice's chat ---")
    expect(len(bob.get("/api/conversations").get_json()["conversations"]) == 0, "bob's chat list empty")
    expect(bob.get(f"/api/conversations/{aconv['id']}").status_code == 404, "bob GET alice conv -> 404")
    expect(bob.patch(f"/api/conversations/{aconv['id']}", json={"title": "hax"}).status_code == 404,
           "bob PATCH alice conv -> 404")
    expect(bob.post(f"/api/conversations/{aconv['id']}/message", json={"content": "hi"}).status_code == 404,
           "bob message alice conv -> 404")
    expect(bob.post(f"/api/conversations/{aconv['id']}/regenerate").status_code == 404,
           "bob regenerate alice conv -> 404")
    expect(bob.delete(f"/api/conversations/{aconv['id']}").status_code == 404, "bob DELETE alice conv -> 404")
    expect(alice.get(f"/api/conversations/{aconv['id']}").status_code == 200, "alice conv intact")

    print("\n-- Devices: Bob cannot touch Alice's device -------")
    bob_devs = [d for d in bob.get("/api/devices").get_json()["devices"] if not d["is_shared"]]
    expect(bob_devs == [], "bob sees none of alice's personal devices")
    expect(bob.get(f"/api/devices/{adev['id']}/agent.zip").status_code == 404, "bob download alice agent.zip -> 404")
    expect(bob.patch(f"/api/devices/{adev['id']}", json={"nickname": "hax"}).status_code == 404,
           "bob rename alice device -> 404")
    expect(bob.delete(f"/api/devices/{adev['id']}").status_code == 404, "bob DELETE alice device -> 404")

    print("\n-- Training: Bob cannot train on Alice's device ---")
    # Give Bob a full local setup so the request reaches the device-ownership check.
    csv = b"f1,f2,f3,label\n" + b"\n".join(b"%f,%f,%f,%d" % (i / 9, (9 - i) / 9, i / 5, i % 2)
                                           for i in range(40))
    bob.post("/api/upload", data={"file": (io.BytesIO(csv), "bob.csv")},
             content_type="multipart/form-data")
    bob.post("/api/dataset/configure", json={"feature_cols": ["f1", "f2", "f3"], "target_col": "label"})
    bob.post("/api/model/configure", json={"arch_type": "mlp", "layer_sizes": [8], "epochs": 1,
             "lr": 0.01, "batch_size": 8, "optimizer": "adam", "activation": "relu"})
    r = bob.post("/api/training/start", json={"device_id": adev["id"]})
    expect(r.status_code == 403, f"bob trains on alice device -> 403 (got {r.status_code})")

    print("\n-- Anonymous: protected endpoints reject ----------")
    expect(anon.get("/api/projects").status_code == 401, "anon projects -> 401")
    expect(anon.get("/api/rag/kb").status_code == 401, "anon KB list -> 401")
    expect(anon.get("/api/conversations").status_code == 401, "anon conversations -> 401")
    expect(anon.post("/api/devices", json={"nickname": "x"}).status_code == 401, "anon create device -> 401")

    print("\n----------------------------------------------------")
    for f in _artifacts:
        try:
            os.path.exists(f) and os.remove(f)
        except OSError:
            pass
    try:
        os.remove(_TMPDB.name)
    except OSError:
        pass

    if _failures:
        print(f"{_failures} authorization assertion(s) FAILED.")
        sys.exit(1)
    print("All authorization assertions passed.")


if __name__ == "__main__":
    main()
