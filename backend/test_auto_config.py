"""
End-to-end test for the AI Auto-Configure feature.

Drives the new /api/auto-config/* endpoints via Flask's test client
(no HTTP server needed). Uploads sample-data/student_performance.csv,
runs one questioner turn, then calls the picker and asserts the
returned configuration is sensible for an ~800-row binary tabular
classification problem.

Run from the backend dir:
    python test_auto_config.py
"""

import io
import json
import os
import sys
import time

# Load .env so ANTHROPIC_API_KEY is set when we import app.
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_ENV_PATH = os.path.join(_REPO_ROOT, ".env")
if os.path.exists(_ENV_PATH):
    with open(_ENV_PATH, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            os.environ.setdefault(k, v)

# Force SQLite so the test never touches PostgreSQL.
os.environ.setdefault("VORTEX_USE_SQLITE", "1")

# Import after env is set so app initialises correctly.
from app import app  # noqa: E402

ALLOWED_ARCHS = {
    "mlp", "dnn", "cnn1d", "rnn", "lstm", "gru",
    "autoencoder", "resnet", "transformer", "wide_deep",
}
ALLOWED_OPTIMIZERS = {"adam", "adamw", "sgd", "rmsprop"}
ALLOWED_ACTIVATIONS = {"relu", "leaky_relu", "elu", "selu", "gelu", "tanh", "sigmoid"}
ALLOWED_BATCH = {16, 32, 64, 128, 256}

SAMPLE_CSV = os.path.join(_REPO_ROOT, "sample-data", "student_performance.csv")


# Lightweight test runner so we don't pull in pytest just for this.
PASS = "[ PASS ]"
FAIL = "[ FAIL ]"


def expect(condition, label):
    print(f"  {PASS if condition else FAIL} {label}")
    return bool(condition)


def main():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY not set — aborting.")
        sys.exit(1)
    if not os.path.exists(SAMPLE_CSV):
        print(f"Sample CSV missing at {SAMPLE_CSV}")
        sys.exit(1)

    client = app.test_client()
    failures = 0

    # --- 1. Sign up a fresh user (signup auto-logs in) --------
    print("\n-- 1. Signup ---------------------------------------")
    email = f"autoconfig-test-{int(time.time())}@local.test"
    res = client.post(
        "/api/auth/signup",
        json={"email": email, "username": email.split("@")[0], "password": "test1234"},
    )
    if not expect(res.status_code == 201, f"signup -> 201 (got {res.status_code})"):
        print("Aborting: cannot continue without a logged-in session.")
        sys.exit(1)

    # --- 2. Status without dataset: should still be available -
    print("\n-- 2. Status probe ---------------------------------")
    res = client.get("/api/auto-config/status")
    failures += not expect(res.status_code == 200, f"status -> 200 (got {res.status_code})")
    body = res.get_json() or {}
    failures += not expect(body.get("available") is True, f"available=True (got {body.get('available')})")

    # --- 3. Decide without dataset -> 400 ----------------------
    print("\n-- 3. Decide w/o dataset ---------------------------")
    res = client.post("/api/auto-config/decide", json={"messages": []})
    failures += not expect(res.status_code == 400, f"decide -> 400 (got {res.status_code})")
    err = (res.get_json() or {}).get("error", "")
    failures += not expect("dataset" in err.lower(), f"error mentions dataset (got: {err!r})")

    # --- 4. Upload sample CSV -----------------------------------
    print("\n-- 4. Upload sample CSV ----------------------------")
    with open(SAMPLE_CSV, "rb") as fh:
        data = {"file": (io.BytesIO(fh.read()), "student_performance.csv")}
    res = client.post("/api/upload", data=data, content_type="multipart/form-data")
    failures += not expect(res.status_code == 200, f"upload -> 200 (got {res.status_code})")
    upload_info = (res.get_json() or {}).get("info") or {}
    failures += not expect(upload_info.get("rows", 0) > 700, f"rows ~ 800 (got {upload_info.get('rows')})")
    cols = [c.get("name") for c in upload_info.get("columns", [])]
    failures += not expect("passed" in cols, f"'passed' column present (got {cols})")

    # --- 5. Configure features + target ----------------------
    print("\n-- 5. Configure features + target ------------------")
    feat = [c for c in cols if c != "passed"]
    res = client.post(
        "/api/dataset/configure",
        json={"feature_cols": feat, "target_col": "passed"},
    )
    failures += not expect(res.status_code == 200, f"configure -> 200 (got {res.status_code})")

    # --- 6. Questioner turn ----------------------------------
    print("\n-- 6. Questioner turn ------------------------------")
    res = client.post(
        "/api/auto-config/chat",
        json={
            "messages": [
                {
                    "role": "user",
                    "content": (
                        "I want to predict whether a student will pass based on their "
                        "study habits. This is a small dataset and I'd like a simple "
                        "model that won't overfit."
                    ),
                }
            ]
        },
    )
    failures += not expect(res.status_code == 200, f"chat -> 200 (got {res.status_code})")
    chat_body = res.get_json() or {}
    reply = chat_body.get("content") or ""
    failures += not expect(bool(reply.strip()), "questioner replied with text")
    print(f"     questioner says: {reply[:200]!r}")
    # The questioner must NOT propose a config or list architectures (that's the picker's job).
    forbidden = ["mlp", "dnn", "transformer", "lstm", "resnet"]
    leaked = [w for w in forbidden if w.lower() in reply.lower()]
    failures += not expect(not leaked, f"questioner does not name architectures (leaked: {leaked})")

    # --- 7. Picker (decide) ---------------------------------
    print("\n-- 7. Picker (decide) ------------------------------")
    transcript = [
        {
            "role": "user",
            "content": (
                "I want to predict whether a student will pass (binary outcome) "
                "from study habits like hours_studied, attendance_rate, sleep_hours, "
                "assignments_done and a previous_score. Small dataset, ~800 rows. "
                "Prioritise robustness over peak accuracy — don't overfit."
            ),
        },
        {"role": "assistant", "content": reply},
        {
            "role": "user",
            "content": "Yes — go ahead and pick the configuration.",
        },
    ]
    res = client.post("/api/auto-config/decide", json={"messages": transcript})
    body = res.get_json() or {}
    if res.status_code != 200:
        print(f"     raw response body: {json.dumps(body, indent=2)[:800]}")
    failures += not expect(res.status_code == 200, f"decide -> 200 (got {res.status_code})")
    cfg = body.get("config") or {}
    print(f"     config returned:\n     {json.dumps(cfg, indent=2)}")

    # --- 8. Validate the proposed configuration -------------
    print("\n-- 8. Validate proposed config ---------------------")
    failures += not expect(cfg.get("arch_type") in ALLOWED_ARCHS, f"arch_type valid (got {cfg.get('arch_type')})")
    failures += not expect(
        isinstance(cfg.get("layer_sizes"), list) and 1 <= len(cfg["layer_sizes"]) <= 8,
        f"layer_sizes shape (got {cfg.get('layer_sizes')})",
    )
    layers = cfg.get("layer_sizes") or []
    failures += not expect(
        all(isinstance(x, int) and 1 <= x <= 2048 for x in layers),
        "layer_sizes are ints in [1, 2048]",
    )
    failures += not expect(
        isinstance(cfg.get("epochs"), int) and 1 <= cfg["epochs"] <= 1000,
        f"epochs in [1, 1000] (got {cfg.get('epochs')})",
    )
    failures += not expect(
        isinstance(cfg.get("lr"), (int, float)) and 1e-6 <= cfg["lr"] <= 1.0,
        f"lr in [1e-6, 1] (got {cfg.get('lr')})",
    )
    failures += not expect(
        cfg.get("batch_size") in ALLOWED_BATCH,
        f"batch_size in {sorted(ALLOWED_BATCH)} (got {cfg.get('batch_size')})",
    )
    failures += not expect(
        cfg.get("optimizer") in ALLOWED_OPTIMIZERS,
        f"optimizer valid (got {cfg.get('optimizer')})",
    )
    failures += not expect(
        cfg.get("activation") in ALLOWED_ACTIVATIONS,
        f"activation valid (got {cfg.get('activation')})",
    )
    es = cfg.get("early_stopping") or {}
    failures += not expect(isinstance(es, dict) and "enabled" in es, "early_stopping has 'enabled' field")
    just = (cfg.get("justification") or "").lower()
    failures += not expect(
        len(just) >= 50,
        f"justification non-trivial (len={len(just)})",
    )

    # --- 9. Soft-quality checks: small-data heuristics -----
    # These reflect the PROMPT's stated rules; they are warnings, not failures,
    # since the model has discretion. We print them as info.
    print("\n-- 9. Soft-quality heuristics (warnings only) ------")

    def soft(condition, label):
        marker = "[  OK  ]" if condition else "[ WARN ]"
        print(f"  {marker} {label}")

    soft(cfg.get("arch_type") in {"mlp", "dnn"}, f"arch is feedforward family for tabular data (got {cfg.get('arch_type')})")
    soft(bool(layers) and max(layers) <= 128, f"layer widths modest for ~800 rows (max={max(layers) if layers else None})")
    soft(es.get("enabled") is True, f"early_stopping enabled on small data (got {es.get('enabled')})")
    cited = any(
        kw in just for kw in ["800", "~800", "binary", "passed", "tabular", "small"]
    )
    soft(cited, f"justification cites concrete dataset facts (sample: {just[:160]!r})")

    print("\n----------------------------------------------------")
    if failures == 0:
        print(f"All hard assertions passed.")
        sys.exit(0)
    else:
        print(f"{failures} hard assertion(s) failed.")
        sys.exit(1)


if __name__ == "__main__":
    main()
