"""
Offline smoke test for VortexML's HTTP surface.

Exercises the deterministic, non-LLM paths end to end via the Flask test client
on a throwaway SQLite database — no network, no API key, no model downloads.
Covers auth, dataset upload/health/config, training validation, a real
(tiny) trained Project + inference/evaluation/export/leaderboard, RAG knowledge
bases + retrieval (TF-IDF), conversation CRUD, and the upload/download security
fixes. Generation-dependent endpoints (chat/RAG query/explain/auto-config) need
a live model and are covered by the live tests instead.

Run from the backend dir:   python test_smoke.py
"""

import io
import os
import sys
import tempfile
import time

# Isolated SQLite DB so the smoke test never touches a real database.
_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_TMPDB.close()
os.environ["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + _TMPDB.name
os.environ.setdefault("VORTEX_USE_SQLITE", "1")

from app import app, db, _json                      # noqa: E402
from models import Project, User                    # noqa: E402
from data_processor import prepare_dataset, save_preprocess, safe_filename  # noqa: E402
from training_engine import create_model, train_model, WEIGHTS_DIR          # noqa: E402

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


def _train_tiny_project(client, email):
    """Train a real tiny model and insert a Project for the signed-in user."""
    import numpy as np, pandas as pd
    rng = np.random.default_rng(0); n = 200
    df = pd.DataFrame({"f1": rng.random(n), "f2": rng.random(n), "f3": rng.random(n)})
    df["label"] = ((df.f1 + df.f2) > 1.0).astype(int)
    tmp = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False); df.to_csv(tmp.name, index=False); tmp.close()
    data = prepare_dataset(tmp.name, ["f1", "f2", "f3"], "label", batch_size=32)
    cfg = {"arch_type": "mlp", "layer_sizes": [16, 8], "epochs": 4, "lr": 0.01, "batch_size": 32,
           "optimizer": "adam", "activation": "relu", "project_name": "Smoke", "early_stopping": {}}
    model = create_model("mlp", [16, 8], data["input_dim"], data["output_dim"])
    res = train_model(model, data["train_loader"], data["val_loader"], data["task_type"], cfg, _Stub(),
                      input_dim=data["input_dim"], output_dim=data["output_dim"], device=None)
    wf = res["weight_filename"]
    save_preprocess(os.path.join(WEIGHTS_DIR, wf), data["preprocess"])
    _artifacts.extend([os.path.join(WEIGHTS_DIR, wf),
                       os.path.join(WEIGHTS_DIR, wf[:-3] + ".preprocess.json"), tmp.name])
    with app.app_context():
        u = User.query.filter_by(email=email).first()
        p = Project(user_id=u.id, name="Smoke", arch_type="mlp", layer_sizes=_json.dumps([16, 8]),
                    epochs=4, lr=0.01, batch_size=32, optimizer="adam", activation="relu",
                    early_stopping=_json.dumps({}), task_type="classification",
                    input_dim=data["input_dim"], output_dim=data["output_dim"],
                    final_train_loss=res["final_train_loss"], final_val_loss=res["final_val_loss"],
                    final_val_acc=res.get("final_val_acc"), early_stopped=False,
                    history=_json.dumps(res["history"]), weight_filename=wf)
        db.session.add(p); db.session.commit()
        return p.id, wf


def main():
    c = app.test_client()
    email = f"smoke-{int(time.time())}@local.test"

    print("\n-- Auth --------------------------------------------")
    expect(c.post("/api/auth/signup", json={"email": email, "username": email.split("@")[0],
                                            "password": "test1234"}).status_code == 201, "signup -> 201")
    expect(c.post("/api/auth/signup", json={"email": email, "username": "other",
                                            "password": "x"}).status_code == 409, "duplicate email -> 409")
    expect(c.get("/api/auth/me").status_code == 200, "me -> 200")

    print("\n-- Dataset (incl. path-traversal sanitisation) -----")
    csv = b"f1,f2,f3,label\n" + b"\n".join(b"%f,%f,%f,%d" % (i / 9, (9 - i) / 9, i / 5, i % 2) for i in range(40))
    up = c.post("/api/upload", data={"file": (io.BytesIO(csv), "../escaped.csv")},
                content_type="multipart/form-data")
    fn = (up.get_json() or {}).get("filename")
    expect(up.status_code == 200 and fn and "/" not in fn and ".." not in fn, f"upload sanitised name -> {fn}")
    expect(not os.path.exists(os.path.join(os.path.dirname(WEIGHTS_DIR), "..", "escaped.csv").replace("/uploads", "")), "no traversal escape")
    expect(safe_filename("../../app.py") == "app.py", "safe_filename strips path")
    expect(c.post("/api/dataset/configure", json={"feature_cols": ["f1", "f2", "f3"],
                                                  "target_col": "label"}).status_code == 200, "configure -> 200")
    h = c.post("/api/dataset/health", json={"feature_cols": ["f1", "f2", "f3"], "target_col": "label"})
    expect(h.status_code == 200 and "warnings" in h.get_json(), "dataset health -> warnings list")

    print("\n-- Training validation -----------------------------")
    expect(c.post("/api/model/configure", json={"arch_type": "mlp", "layer_sizes": [16, 8], "epochs": 3,
            "lr": 0.01, "batch_size": 32, "optimizer": "adam", "activation": "relu"}).status_code == 200, "model configure -> 200")
    expect(c.post("/api/model/configure", json={"arch_type": "nope"}).status_code == 400, "bad arch -> 400")

    print("\n-- Project + inference + export + leaderboard ------")
    pid, wf = _train_tiny_project(c, email)
    expect(len(c.get("/api/projects").get_json()["projects"]) == 1, "projects list has 1")
    schema = c.get(f"/api/projects/{pid}/inference").get_json()
    expect(schema.get("ready") and len(schema.get("fields", [])) == 3, "inference schema ready (3 fields)")
    pr = c.post(f"/api/projects/{pid}/predict", json={"rows": [
        {"f1": 0.9, "f2": 0.9, "f3": 0.2, "label": 1}, {"f1": 0.1, "f2": 0.1, "f3": 0.5, "label": 0}]}).get_json()
    expect(len(pr["predictions"]) == 2 and pr.get("evaluation") and "confusion_matrix" in pr["evaluation"],
           "predict + evaluation (confusion matrix)")
    expect(pr.get("device") and pr.get("resource") and pr["resource"].get("inference_ms") is not None,
           "predict reports device + resource consumption")
    # Targeting an offline/unknown node for inference returns a clear 409/404.
    off = c.post(f"/api/projects/{pid}/predict", json={"rows": [{"f1": 0.5, "f2": 0.5, "f3": 0.5}], "device_id": 999999})
    expect(off.status_code in (404, 409), "predict on missing device -> 404/409")
    expect(c.get(f"/api/projects/{pid}/export?format=onnx").status_code == 200, "export onnx -> 200")
    expect(c.get(f"/api/projects/{pid}/export?format=torchscript").status_code == 200, "export torchscript -> 200")
    expect(c.get(f"/api/projects/{pid}/export?format=bogus").status_code == 400, "export bad format -> 400")
    cmp = c.post("/api/projects/compare", json={"ids": [pid]}).get_json()
    expect(len(cmp["projects"]) == 1 and cmp["projects"][0].get("history"), "leaderboard compare has history")

    print("\n-- Weights download authorization ------------------")
    expect(c.get(f"/api/weights/file/{wf}").status_code == 200, "own project weights -> 200")
    # Foreign file on disk must NOT be downloadable.
    victim = os.path.join(WEIGHTS_DIR, "Foreign_mlp_32-16_40e_0.001lr_32bs_adam_relu_20200101T000000.pt")
    open(victim, "wb").write(b"secret"); _artifacts.append(victim)
    expect(c.get(f"/api/weights/file/{os.path.basename(victim)}").status_code == 404, "foreign weights -> 404")

    print("\n-- RAG knowledge base + retrieval (no LLM) ---------")
    bl = c.get("/api/rag/backends").get_json()
    expect("backends" in bl and "recommended" in bl, "rag backends listed")
    kb = c.post("/api/rag/kb", json={"name": "K", "embedder": "tfidf", "chunk_size": 300, "overlap": 50}).get_json()["knowledge_base"]
    ing = c.post(f"/api/rag/kb/{kb['id']}/documents",
                 data={"file": (io.BytesIO(b"VortexML runs Gemma 4B via MLX on an Apple M4 Mac Mini."), "d.txt")},
                 content_type="multipart/form-data").get_json()
    expect(ing["knowledge_base"]["n_chunks"] >= 1, "document ingested")
    import rag
    # TF-IDF is lexical, so the query must share terms with the document.
    hits = rag.KBStore(kb["id"]).search("Which Apple Mac Mini runs MLX Gemma?", k=2)
    expect(len(hits) >= 1 and hits[0]["score"] > 0, "TF-IDF retrieval returns a hit")
    expect(c.get(f"/api/rag/devices/{[d for d in c.get('/api/rag/devices').get_json()['devices'] if d['is_shared']][0]['id']}/models").get_json().get("online"),
           "device model catalog online")
    expect(c.delete(f"/api/rag/kb/{kb['id']}").status_code == 200, "kb delete -> 200")

    print("\n-- Conversations CRUD ------------------------------")
    conv = c.post("/api/conversations", json={"backend": "cloud"}).get_json()["conversation"]
    expect(conv["title"] == "New chat", "conversation created")
    expect(len(c.get("/api/conversations").get_json()["conversations"]) == 1, "conversation listed")
    expect(c.patch(f"/api/conversations/{conv['id']}", json={"title": "Renamed"}).get_json()["conversation"]["title"] == "Renamed", "rename via PATCH")
    expect(c.post(f"/api/conversations/{conv['id']}/message", json={"content": "  "}).status_code == 400, "empty message -> 400")
    expect(c.delete(f"/api/conversations/{conv['id']}").status_code == 200, "conversation delete -> 200")

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
    if _failures == 0:
        print("All smoke assertions passed.")
        sys.exit(0)
    print(f"{_failures} assertion(s) failed.")
    sys.exit(1)


if __name__ == "__main__":
    main()
