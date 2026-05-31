# VortexML — Autonomous Debug Session Report

**Date:** 2026-05-31  
**Branch:** `glowup`  
**Scope:** Autonomously exercise the running app (backend `:5050`, frontend `:5173`), find issues, repair them, and verify each fix.  
**Method:** Ran the existing test suites for a baseline, drove every major feature against the **live** server (auth → dataset → training → inference → RAG → chat → auto-config → explain → devices), built/typechecked/linted the frontend, ran code audits, and — critically — **verified every candidate finding by testing before applying any repair, and re-verified each fix live afterward.** Coverage was then deepened to all 10 architectures, both task types, per-architecture export, data-processor edge cases, access control, malformed input, and the remote node agent.

---

## TL;DR — 7 bugs fixed, all verified

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | Unvalidated model hyperparameters crash training (`epochs≤0`, negative layer widths, `lr<0`, `batch_size≤0`) | **High** | ✅ Fixed |
| 2 | Remote `node_complete` saves a Project even when weights fail to save → DB row points at a missing file | **Medium** | ✅ Fixed |
| 3 | **Transformer → TorchScript export 500s** (`TracingCheckError` false-positive from the encoder fast path) | **Medium** | ✅ Fixed |
| 4 | **BatchNorm models (DNN/ResNet) crash training when the train split's last batch is a single sample** | **Medium-High** | ✅ Fixed |
| 5 | **Non-UTF-8 CSV upload → 500** (Excel/Latin-1 exports are common) | **Medium** | ✅ Fixed |
| 6 | Empty/unparseable file upload → 500 (raw stack trace) | Low-Med | ✅ Fixed |
| 7 | `/api/dataset/configure` accepts non-existent columns → crashes later at training time | Medium | ✅ Fixed |

**Documented, not auto-applied (with rationale):** `debug=True` in the deployed service, orphaned Vite process, hardcoded `SECRET_KEY`, an ESLint warning that must stay, a RAG partial-write edge case, and two silent-coercion behaviors in `/predict`. See [§ Documented](#issues-documented-not-auto-applied--rationale-given).

**Disproven by testing (NOT bugs):** the `Content-Length`-int claim, the `claude-opus-4-7` model-id claim, the `deleteModel('transformers')` claim, "dataset wiped after training", "duplicate backend processes", and several "404" red herrings. See [§ Disproven](#disproven-candidate-findings-verified-not-bugs).

**Verified secure:** full IDOR sweep across projects / conversations / KBs / weights (all 404 cross-user); `torch.load(weights_only=True)` (no pickle RCE); upload path-traversal sanitisation.

Everything else **works**: all 3 test suites pass, the frontend builds & typechecks clean, and every major feature was verified end-to-end live (incl. the LLM-backed chat / RAG / auto-config / explain paths and **all 10 architectures × both task types × ONNX+TorchScript export**).

---

## Bugs found & fixed

### 1. Unvalidated model hyperparameters crash the training run — **HIGH** ✅

**Where:** `POST /api/model/configure` (`backend/app.py`), consumed by `training_engine.train_model`.

**Root cause:** `configure_model` validated only `arch_type`; every numeric/structural field was stored verbatim and fed into the training loop.

| Input | Result before fix (reproduced in isolation) |
|-------|---------------------------------------------|
| `epochs ≤ 0` | `UnboundLocalError: 'train_loss'` — `for epoch in range(1, epochs+1)` never runs, so per-epoch locals stay unbound |
| `layer_sizes` with a non-positive entry | `RuntimeError: Trying to create tensor with negative dimension` |
| `lr < 0` | `ValueError: Invalid learning rate` |
| `batch_size ≤ 0` | `ValueError` in the DataLoader |

**User reachability:** the Architect UI's **Epochs** / **Learning Rate** fields are free number inputs with no `min`, and the handler was `parseInt(e.target.value) || 50` — so a typed `-3` passes straight through (`-3` is truthy) and crashes the background training thread with no clear reason.

**Fix (3 layers):** server-side validation in `configure_model` (clean `400`s with specific messages; reuses `VALID_OPTIMIZERS`/`VALID_ACTIVATIONS`); a fail-fast `epochs < 1` guard in `train_model`; and `min`/clamping on the Architect Epochs & LR inputs.

**Verified:** full matrix via test client (all bad inputs → 400, valid incl. deep resnet → 200); live server `epochs=-3/0 → 400`; no regression in any suite.

### 2. Remote `node_complete` persists a Project even when weights fail to save — **MEDIUM** ✅

**Where:** `backend/app.py`, `on_node_complete` (remote-node training path).

**Root cause:** if the node's weights payload failed to decode/write (or was missing), the error was only `print`-logged and execution fell through to `_persist_project`, creating a `Project` row whose `weight_filename` points at a non-existent file — so every later inference/export/download would 404.

**Fix:** track save success; if the weights weren't saved, emit `training_error`, free the device, clean up, and **skip** persisting. Happy path unchanged.

**Verified:** simulated `node_complete` with no weights → 0 projects persisted, job removed, device freed. Happy path exercised by the live local-training E2E.

### 3. Transformer → TorchScript export returns 500 — **MEDIUM** ✅

**Where:** `training_engine.export_model` (`fmt="torchscript"`), surfaced via `GET /api/projects/<id>/export?format=torchscript`.

**Root cause:** `torch.jit.trace` runs a built-in sanity re-check; `nn.TransformerEncoder`'s eval-mode fast path makes the *traced* graph use a different (numerically identical) kernel than eager, so the check reports a **false-positive** `TracingCheckError` and the export 500s. Every other architecture traces cleanly.

**Evidence it's a false positive:** the model is deterministic in eval (two eager runs differ by 0.0), and a `check_trace=False` trace produces **output identical to eager on both the original and a fresh `(4,6)` input** (diff 0.0, correct shape) — i.e. the trace is correct.

**Fix:** try the strict trace first (keeps the safety net for every other arch, which would still catch a real divergence); on `TracingCheckError` specifically, retrace with `check_trace=False`.

**Verified:** isolated matrix — transformer TorchScript now exports (150 KB) for both classification & regression; mlp/lstm controls unaffected. **Live:** trained a Transformer end-to-end and exported `?format=torchscript` → **200, 154 KB** (previously 500).

### 4. BatchNorm architectures crash training on a single-sample final batch — **MEDIUM-HIGH** ✅

**Where:** `data_processor.prepare_dataset` (train `DataLoader`) + any `BatchNorm1d` model (`DNNModel`, `ResNetModel`).

**Root cause:** with `drop_last=False`, if the training split's size `% batch_size == 1`, exactly one batch per epoch has a single sample. `BatchNorm1d` in **training** mode then raises `ValueError: Expected more than 1 value per channel`. (Validation/test run under `model.eval()`, where BatchNorm is fine, so only the train loader is affected.)

**Reproduced:** `n=113` rows, `batch_size=16` → train split = 81 = 16×5+1 → DNN **and** ResNet both crash. DNN/ResNet are common picks (auto-config selects ResNet for large data, DNN for medium), so this is realistically reachable.

**Fix:** set `drop_last=True` on the **train** loader only when `len(train) % batch_size == 1` **and** there's more than one batch — drops exactly the single straggler, never empties the loader, and leaves normally-divisible datasets untouched.

**Verified:** `n=113` now trains DNN/ResNet/MLP/Transformer (batches `[16×5]`, uses 80/81 samples); `n=200` unchanged (uses all 144). No regression.

### 5. Non-UTF-8 CSV upload returns 500 — **MEDIUM** ✅

**Where:** `data_processor` (`pd.read_csv`) via `POST /api/upload`.

**Root cause:** a strict UTF-8 `read_csv` raises `UnicodeDecodeError` on the first non-UTF-8 byte; the upload handler caught it only with a generic `except → 500`. Excel/Windows exports are frequently Windows-1252/Latin-1, so this is a common, reachable failure.

**Fix:** a shared `_read_csv()` helper used by **all three** read sites (upload-analyze, health, training) — tries UTF-8, falls back to Latin-1 (maps all 256 byte values, never fails to decode), and wraps `EmptyDataError`/`ParserError` as a friendly `ValueError`. The upload handler now maps parse errors to `400`.

**Verified live:** a Latin-1 CSV (`café`, `sizeÿ` headers) uploads **200** (was 500); a `\xff`-containing CSV uploads **200**; consistency means training reads it too.

### 6. Empty / unparseable file upload returns 500 — **LOW-MEDIUM** ✅

**Where:** same path as #5.

**Root cause:** an empty file raised `EmptyDataError` → generic `except → 500` with a raw trace.

**Fix:** covered by the `_read_csv` + upload-handler change above.

**Verified live:** empty file → **400** `"Could not read this file as a CSV: No columns to parse from file"` (was 500).

### 7. `/api/dataset/configure` accepts columns that don't exist — **MEDIUM** ✅

**Where:** `configure_dataset` (`backend/app.py`).

**Root cause:** the endpoint stored `feature_cols`/`target_col` without checking they exist in the uploaded dataset. A bad selection was accepted (200) and only blew up later inside the training thread when `prepare_dataset` did `df[col]` (KeyError) — no clean error surfaced.

**Fix:** validate the chosen columns against the uploaded dataset's schema (require a dataset first; reject unknown columns; reject using the target as a feature — a data-leakage guard).

**Verified live:** bad columns → **400** `"Unknown column(s)…"` (was 200); target-in-features → **400**; valid selection → 200; smoke suite still passes.

---

## Issues documented (not auto-applied — rationale given)

8. **`socketio.run(app, debug=True)` (`app.py:3665`) in the launchd-managed, publicly-tunneled service.** Keeps the Werkzeug reloader live in production (the worker PID was observed cycling on every `.py` write) and risks traceback/debugger exposure. **Recommended:** `debug=os.environ.get("FLASK_DEBUG") == "1"`. *Not applied:* flipping `debug` on a running public service is an outward-facing deployment change — and the live reloader is how this session's fixes were picked up. Owner's call + deliberate restart.
9. **Orphaned Vite dev server** (PID 79583 on `:5175`, ~1.7 days old). Housekeeping; `kill 79583`. Not killed (user-owned process, no functional fault).
10. **Hardcoded `SECRET_KEY`** (`app.py:60`). Good in that sessions survive restarts (verified), but a session-signing secret in source is a smell for public deploys. Recommend an env var with a dev fallback.
11. **ESLint "unused disable directive"** at `Training.tsx:467` — **must stay.** Removing it surfaces 4 `react-hooks/refs` errors (eslint-plugin-react-hooks v7's compiler analysis on `buildExplainRequest` reading a ref during render). The Explain feature works in live testing, so these are latent smells; the one-line warning is the lesser evil. Left intact (verified: removing it = 4 errors).
12. **`rag.KBStore.search` index assumption** — loads `emb.npy` and `chunks.json` independently with no length check; an interrupted `rebuild` (partial write between the two saves) could `IndexError`. Edge case; noted for a `if idx < len(chunks)` guard.
13. **`/predict` silently coerces bad input** — non-numeric values and rows with missing/wrong feature columns return confident predictions (filled with medians/defaults) rather than a warning. Robust-but-silent; not a crash. The frontend always sends schema-correct rows. Left as-is (changing it risks rejecting legitimate partial inputs).
14. **Unauthenticated upload/configure/train** — the pre-account flow allows anonymous use (projects only persist once a user is set; per-session state is isolated). Appears intentional ("try before signup"); only downside is unauthenticated disk writes (minor DoS). Noted, not changed.

---

## Disproven candidate findings (verified NOT bugs)

- **"`Content-Length` int header 500s all downloads/exports."** ❌ Live export (onnx+torchscript) + weights download all 200 with correct bytes — Werkzeug coerces.
- **"Auto-config `claude-opus-4-7` may be retired → 500."** ❌ Live `decide` returns a valid config.
- **"`deleteModel('transformers')` won't match a backend key."** ❌ `rag.delete_model` treats any non-`ollama` backend as an HF-cache delete.
- **"Dataset wiped after one run = can't compare architectures."** ❌ By design (`_cleanup_dataset`: *"Datasets are never persisted"* — privacy).
- **"Duplicate backend processes."** ❌ Reloader monitor+worker pair (a consequence of #8), not independent servers.
- **404s on `agent.zip`(shared) / `dataset/analyze`(no dataset).** ❌ Correct error handling. (An earlier batch of spurious 404s was a test-harness artifact — `venv/bin/python` run from the wrong cwd.)
- **Stop-flag leaking across runs (node + server).** ❌ `train_model` clears `_stop_training` at the start of every run (line 577) — stopping one run never aborts the next.

---

## Live coverage matrix (all ✅ this session)

**Architectures × tasks × export** — every `MODEL_REGISTRY` arch (`mlp, dnn, cnn1d, rnn, lstm, gru, autoencoder, resnet, transformer, wide_deep`) trains, predicts, and exports to **ONNX + TorchScript** for **both** classification and regression. (Transformer TorchScript fixed in #3.)

**data_processor edge cases** — categorical string features, NaN in features/target, single-class target, string-class target, tiny (3/8-row) datasets, all-NaN feature column, target-in-features, rare class + stratify, and the regression/classification boundary (10 vs 11 unique numeric) — all handled without crashing.

**Endpoints** — auth (signup/me/beginner/survey), dataset (upload/configure/health/analyze), model configure, full training E2E (project saved), inference/predict/export/compare, weights download+authz + **upload (parse + bad-name 400)**, RAG (ingest → cloud LLM answer + citations), conversations CRUD + streaming message + **regenerate**, tutor chat (live LLM), auto-config **decide + chat** (live LLM) + rule engine, explain-results (live LLM), devices CRUD + **agent.zip bundle**, project load, state/reset, courses.

**Security** — full cross-user IDOR sweep (projects/inference/predict/export/delete/load, conversations get/patch/delete/message, KBs get/delete/query, direct weights download) all return **404**; `torch.load(weights_only=True)`; upload filename sanitisation.

---

## Files changed

- `backend/app.py` — model-config validation; `node_complete` weights-save guard; upload parse-errors → 400; `dataset/configure` column validation; widened an `auto_config_rules` import.
- `backend/training_engine.py` — fail-fast `epochs < 1` guard; TorchScript `check_trace=False` fallback for the transformer.
- `backend/data_processor.py` — robust `_read_csv` (UTF-8→Latin-1, friendly errors) used by all read sites; `drop_last` on the train loader to avoid a single-sample BatchNorm batch.
- `frontend/src/pages/Architect.tsx` — `min`/clamp on Epochs & Learning-Rate inputs.

All changes verified against the existing test suites (no regressions) and re-verified live (the server runs with the reloader, so each fix hot-reloaded). No changes were made to deployment config, secrets, or running processes.

---

## Test-session artifacts (harmless, deletable)

My testing left a few rows in `backend/vortex.db` (a `debug-…` user, "E2E Debug Run"/"XFormer Debug" projects, "DebugKB", some conversations) and a few orphan `.pt` files in `backend/uploads/weights/` from isolated training scripts. All harmless and removable; say the word to clean them up.
