# VortexML — Autonomous Fix + Feature Pass — Work Plan

Tracking doc for the autonomous pass across Workstreams A–D. Restates each
item's root cause / requirement, the chosen approach, and any assumptions made
while working without further input.

## Baseline (pre-change)
- Frontend: `npm run build` ✓, `npm run lint` ✓ (1 pre-existing warning:
  `Training.tsx:402` unused eslint-disable directive). Not introduced by me;
  left as-is to avoid scope creep.
- Backend: `test_auto_config.py` is a **live** integration test (needs
  `ANTHROPIC_API_KEY` + network, makes real Claude calls). pytest not installed.
  I will not run it on every change (cost/network); Workstream C adds an
  offline logic test instead.

## Assumptions (made autonomously, no user input available)
1. **State isolation (#8/#9):** auth is via Flask session cookie. I key
   per-request state by `user:<id>` when logged in, else a per-session
   `anon:<uuid>` stored in the session. This preserves the existing
   no-login-required dataset/training flow while stopping cross-user bleed.
2. **Preprocessing persistence (#11):** serialized as a JSON sidecar next to
   the `.pt` (no pickle — avoids an RCE-prone `torch.load`/`pickle` surface and
   keeps it human-inspectable). Stores scaler mean/scale, per-feature encoder
   classes + medians, and target classes.
3. **Inference (#11 / feat 1):** model weights loaded with
   `torch.load(..., weights_only=True)` (state_dict of tensors only). Model
   reconstructed from the Project row's stored arch config.
4. **Explain-results (feat 4) + leaderboard (feat 2):** available to any
   signed-in user (not gated on `is_beginner`), mirroring Auto-Configure.
5. **Queue/resume (feat 6):** pragmatic scope — when a device is busy, new runs
   are queued (dataset snapshotted to a job-private file so cleanup can't wipe
   it), drained automatically when the device frees; a run interrupted by node
   disconnect is re-queued once for resume. True mid-epoch checkpointing is out
   of scope (would need engine changes flagged under skipped #13).
6. Existing committed secrets (hardcoded secret key, `vortex.db` in git, etc.)
   are **out of scope** for this pass (not in the assigned issue list) and left
   untouched.

## Workstream A — Fixes
- **#15 (SDK params):** VERIFIED the params (`output_config={"effort":...}`,
  `thinking={"type":"disabled"|"adaptive"}`, models `claude-sonnet-4-6` /
  `claude-opus-4-7`) are valid in the installed SDK 0.102.0 and succeed in a
  live call. Root issue: `requirements.txt` pins `anthropic>=0.40`, which is far
  below the floor these params require — a clean install could pull an SDK that
  raises `TypeError` and 500 every AI call. Fix: raise the floor.
- **#10 (data leakage):** `StandardScaler.fit_transform(X)` ran on the full
  dataset before the split. Fix: fit on train only, transform val/test.
- **#12 (stratify):** classification split lacked `stratify`, risking class
  drop-out / crashes on imbalanced data. Fix: stratify when safe, fall back
  gracefully when a class is too small.
- **#8 (global state):** single process-wide `_state`; concurrent users clobber
  each other. Fix: per-user/session state store.
- **#9 (cleanup wipes global):** `_cleanup_dataset()` cleared global state on
  any job finishing. Fix: clean only the finishing job's owner state, and only
  if that user's current dataset is still the one the job used.
- **#11 (models unusable):** preprocessing discarded, no inference path. Fix:
  persist preprocessing sidecar + add a predict endpoint.

## Workstream B — Features (1, 2, 4, 5, 6)
- **1** inference UI, **2** leaderboard/compare, **4** explain-my-results,
  **5** dataset health checks, **6** training queue + resume.

## Workstream C — Picker
Rewrite the picker reasoning prompt into an explicit decision tree with
per-architecture use/avoid rules, dataset-size capacity bands, an
over-parameterization guard, and a rule-naming justification requirement.
Add offline fixtures + a logic test (no live API).

## Workstream D — Deferred
Features 3 (confusion matrix / residual plots), 7 (per-device telemetry
history), 8 (ONNX/TorchScript export) → `DEFERRED_FEATURES.md`.

---

## Summary

All assigned items (A: #8,#9,#10,#11,#12,#15 · B: #1,#2,#4,#5,#6 · C · D) are
complete and committed, one logical commit each.

### Workstream A — fixes
- **#15** `fix(#15)` — Verified `output_config.effort`, `thinking`
  disabled/adaptive, and the `claude-sonnet-4-6`/`claude-opus-4-7` model IDs are
  valid in the installed SDK (0.102.0) via a static type check **and a live
  call**. Root issue was `requirements.txt` pinning `anthropic>=0.40` (far below
  the floor these params need); raised it to `>=0.102`.
- **#10** `fix(#10)` — `prepare_dataset` now splits before fitting the
  `StandardScaler` on the training split only. Verified standardized train batch
  (mean≈0/std≈1).
- **#12** `fix(#12)` — Classification splits stratify when safe, with a
  `_split` fallback for rare classes. Verified equal class ratios across
  train/val/test and a no-crash single-member-class case.
- **#8** `fix(#8)` — Replaced the process-global `_state` with a per-user /
  per-session store (`_states` keyed by `user:<id>` or `anon:<uuid>`). Jobs
  snapshot the dataset path/columns/config + carry a `state_key`. Verified two
  independent sessions keep separate dataset state and one session's reset
  doesn't touch the other.
- **#9** `fix(#9)` — `_cleanup_dataset(state_key, used_path)` only clears a
  user's state if it still points at the file the finishing job used. Verified
  an old job cleans its own file but never wipes the user's newer dataset.
- **#11** `fix(#11)` — `prepare_dataset` emits a JSON preprocessing sidecar
  (scaler mean/scale, per-feature encoders/medians, target classes), saved next
  to the `.pt` for local **and** node runs. Added `GET .../inference` (schema)
  and `POST .../predict` (JSON rows or CSV). Verified the full train→save→predict
  pipeline + HTTP endpoints + cross-user 404.

### Workstream B — features
- **#1** `feat(#1)` — `PredictModal`: typed input form / CSV upload → class
  label + confidence + probability bars (or regression value). Wired to a
  "Predict" button on each Profile project.
- **#2** `feat(#2)` — `Leaderboard` page + nav + `/leaderboard` route: ranked,
  sortable table and overlaid val-loss / val-accuracy curves for up to 6
  models, backed by `POST /api/projects/compare`. Verified the endpoint +
  cross-user isolation, and the page renders in-browser.
- **#4** `feat(#4)` — `POST /api/explain-results` builds a factual run summary
  and returns a tutor verdict (overfitting/readiness + next steps). `ExplainModal`
  wired into Profile (by project_id) and the Training dashboard (just-finished
  run). Verified with a stubbed client + the empty-payload 400 guard.
- **#5** `feat(#5)` — `dataset_health` flags tiny data, high-null/constant/
  near-constant cols, ID-like & high-cardinality categoricals, class imbalance,
  and target leakage; `POST /api/dataset/health` takes the live selection. A
  debounced panel renders on the Dataset Designer (verified in-browser).
- **#6** `feat(#6)` — Busy devices now queue runs (FIFO, private dataset
  snapshots) that auto-drain when free; remote runs interrupted by a node
  disconnect re-queue and resume on reconnect. `GET/DELETE /api/training/queue`;
  Training page shows a live queue panel. Verified enqueue/list/cancel/drain +
  cross-user 403 + the refactored immediate local-start path.

### Workstream C — Picker `feat(picker)`
Rewrote the picker prompt as an explicit R1–R7 decision tree with per-arch
use/avoid guardrails and size-band capacity/epoch/lr/batch. Added
`auto_config_rules.py` (`recommend_config` deterministic fallback +
`guard_config` over-parameterization clamp), wired into `/decide` (guards every
result, falls back to rules instead of 502-ing). Output schema unchanged. Added
`test_auto_config_rules.py` (7 fixtures + guard cases, **offline**) — all pass.

### Workstream D `docs(D)`
`DEFERRED_FEATURES.md` documents features 3 (confusion matrix / residuals),
7 (per-device telemetry history), 8 (ONNX/TorchScript export) with rationale,
scope/effort, and dependencies.

### Verification performed
- Backend: deterministic Flask test-client + direct-call tests for every new/
  changed path (state isolation, cleanup guard, inference pipeline + HTTP,
  picker guard/fallback, dataset-health detection, explain, compare, queue
  drain/cancel). `test_auto_config_rules.py` passes offline.
- Frontend: `tsc -b` clean, `vite build` clean, `eslint` at baseline (0 errors;
  the one pre-existing "unused eslint-disable" warning remains, now relocated).
- Browser (restarted dev server): app loads, new **Leaderboard** nav link works
  (auth-gates logged-out, renders logged-in), **Dataset Health** panel shows a
  real warning after upload, **Training** dashboard renders — **zero console
  errors**.
- Confirmed the auto-reloaded backend already serves every new route (correct
  guards vs. a control HTML 404).

### Assumptions / decisions made autonomously
- State keyed per user, anonymous sessions per `anon_id` (kept the no-login
  flow working).
- Preprocessing persisted as JSON (not pickle); inference loads weights with
  `weights_only=True`.
- Explain / leaderboard available to any signed-in user (mirrors Auto-Config).
- Queue/resume scoped pragmatically: device-level FIFO + one auto-resume of an
  interrupted remote run; true mid-epoch checkpointing left to skipped #13.
- Committed pre-existing secrets (hardcoded key, tracked `vortex.db`) were out
  of scope and left untouched.

### Things to note / not fully closed
- **Browser E2E was initially blocked**: the only server on :5173 was an
  11-day-old Vite process that had broken (returning HTTP 500 `EPERM` on every
  route — including `/` — before I made any change; `index.html` itself is
  fine). I stopped that dead process and started a fresh Vite, which serves 200
  and let me complete the in-browser checks above. The app is now in a *better*
  state than found.
- Predict/Explain buttons on Profile and the Training queue panel only appear
  once a project/queued job exists (both require real training to produce);
  they're covered by the clean build + the backend behavioral tests rather than
  a live click-through.
- The live picker integration test (`test_auto_config.py`) was **not** re-run
  (it makes real, paid Opus calls); the new offline rule test covers the
  guard/fallback logic instead.

## Post-completion verification (full live E2E)

Closed the two gaps from the first pass:

1. **Existing test suite re-run** — `test_auto_config.py` (the live Opus picker
   test) now passes against the rewritten picker; **all hard assertions PASS**
   and the justification correctly names the fired rule
   ("Rule R6 tiny_safe fired …"), confirming Workstream C didn't regress it.
2. **Full data-dependent UI E2E** — trained a real model end-to-end through the
   running server and click-tested every data-dependent surface:
   - Training run completes and persists a Project (val_acc 100%, val_loss
     0.044) — `sawRunning` true.
   - **Predict** modal: opens from the Profile card, renders the feature form,
     submit returns a prediction with confidence + probability bars. Prediction
     correctness verified via the direct API (0.9/0.9 → class 1 @1.0; 0.1/0.1 →
     class 0 @0.9995 — the model learned f1+f2>1 and inference reproduces it).
   - **Explain** modal: opens, calls the tutor model, renders an accurate
     markdown verdict citing the run's real loss values (~0.73 → ~0.046).
   - **Leaderboard**: ranked table populated, project preselected, both overlay
     charts mounted; `/api/projects/compare` returns the 8-epoch history.
   - **Dataset Health**, nav **Leaderboard** link, auth-gating: confirmed.
   - Zero console errors throughout. Demo project + weights cleaned up after.

### Environment fix made during verification
The machine's long-running dev servers were both broken before I started and
were blocking live verification, so I restarted them (project convention allows
killing stale servers):
- The **Vite** dev server (11 days up) was returning HTTP 500 `EPERM` on every
  route (incl. `/`) though `index.html` is fine — started a fresh one (now 200).
- The **backend** was in a stale multi-process state (two `app.py` procs on
  different Python versions; the 10h-old listener had my routes but training
  died instantly while the *identical* path completed cleanly in a controlled
  process). Restarted it cleanly on Postgres (preserving the user's projects)
  with `.env` sourced — which also re-enables the chatbot/Explain API key.
  After the restart, training and all AI features work.

Both servers are left **healthy and running** (backend :5050, Vite :5173).
Note: a couple of throwaway test-user rows (`verify_*`, `e2e_*`) remain in the
dev Postgres DB (no delete-user endpoint); harmless.

## Follow-up session — Model Playground + two previously-deferred features

Elevated the inference feature into a first-class experience and pulled two of
the originally-proposed (deferred) features forward:

- **Model Playground** (`feat: Model Playground page`) — new `/predict` page +
  nav link. Pick any trained model, enter a scenario in a typed form (or upload
  a CSV), and get a prediction with confidence + class probabilities. The model
  can be exported to ONNX/TorchScript from the same page.
- **Feature 3** (`feat(#3,#8)`) — on-the-fly evaluation: `predict` returns an
  `evaluation` block (accuracy + confusion matrix, or MAE/RMSE/R² + residuals)
  when the rows carry the true target. Shown on the Playground as a
  confusion-matrix table / residual scatter. Deliberately avoided touching
  `train_model`/schema (scores a labelled CSV on demand).
- **Feature 8** (`feat(#3,#8)`) — `GET /api/projects/<id>/export?format=`
  `onnx|torchscript`. Added `onnx>=1.16` to requirements (the only new dep;
  installed into the venv). TorchScript needs only torch.

Verified in-browser against the live (restarted) server: Playground renders +
"Predict" nav link; model dropdown lists trained models with metrics; scenario
predict returns the correct class @100%; a labelled CSV batch shows 97.5%
accuracy + confusion matrix; ONNX (1.7 KB, validated) and TorchScript (13 KB)
both download; bad export format → 400; zero console errors. Demo projects
cleaned up afterward.

Feature **7** (per-device telemetry history) remains the only deferred item —
see `DEFERRED_FEATURES.md`.

## RAG — Knowledge Assistant (new capability)

Added a full retrieval-augmented-generation feature: upload documents → chunk →
embed → retrieve top-k → ground a local (or cloud) LLM → answer with citations.

- **`backend/rag.py`** — extraction (txt/md/csv/pdf) + overlapping chunking;
  embedders (TF-IDF default = zero download; MiniLM optional); per-KB on-disk
  vector store; and a **pluggable generation-backend registry** with
  human-readable "what / use-when" copy + live availability:
  - **MLX** (Apple Silicon) — recommended here; default model
    `mlx-community/gemma-3-4b-it-4bit` (the ~4B Gemma the brief asked for).
  - **llama.cpp** (GGUF), **Transformers** (PyTorch/MPS), **Ollama** (local
    server), and a **Cloud (Claude)** fallback that works with no download.
- **DB**: `KnowledgeBase` + `Document` models (user-scoped, cascade).
- **API**: `/api/rag/backends`, KB CRUD, `…/documents` ingest, `…/query`
  (retrieve-then-generate).
- **Frontend `/assistant`** (nav "Assistant"): KB management + document upload;
  **expert** mode shows the backend picker that *explains each option* with
  availability + setup hints, plus model/top-k/temperature/embedder controls and
  retrieved-source previews; **novice** mode hides all that and auto-uses the
  recommended backend.

### Dependencies + environment
- Hard adds: `pypdf>=4.0` (PDF ingest). Retrieval (TF-IDF/sklearn) and cloud
  generation work with no extra installs.
- Installed into `backend/venv` on this M4 to light up local backends:
  `mlx-lm` (→ MLX **available + recommended**) which also pulled in
  `transformers` (→ Transformers available). `llama-cpp-python`,
  `sentence-transformers`, and Ollama remain opt-in (detected if present).
  These are documented as optional in `requirements.txt`, not hard deps
  (Apple-only / heavy).

### Verified (live, in-browser)
- `/assistant` renders + "Assistant" nav link; expert backend picker lists all
  five backends with descriptions, "Use when", availability, and the
  ★ recommended (MLX) badge.
- Created a KB, uploaded a doc, asked a question → correct **grounded answer
  with citation [1]** ("…local 4B model via MLX on Apple Silicon [1] … Apple M4
  Mac Mini [1]"). Unavailable backend → 409 with setup hint.
- Novice mode hides the picker and shows the auto-backend note.
- After installing mlx-lm: `/api/rag/backends` reports **recommended: mlx**,
  mlx/transformers/cloud available. Zero console errors. Test KBs cleaned up.

> First MLX query downloads the chosen model (~2.5 GB for a 4-bit 4B) — left to
> the user to trigger; not downloaded during verification.

## RAG — "run on your hardware": device picker, model catalog, download, stats

Extended the Assistant so RAG runs on a chosen device, just like training, with
a browsable/downloadable model catalog and live stats.

- **Pick the device + see its models (the first step):** expert "Run on your
  hardware" panel — choose the shared M4 or a linked node, then see the models
  stored on it with the curated RAG variations (downloaded? + size).
  Backend: `GET /api/rag/devices`, `GET /api/rag/devices/<id>/models`
  (`rag.local_model_inventory` scans the HF cache + Ollama; nodes report theirs
  over the socket).
- **Choose + download a model:** `POST /api/rag/devices/<id>/models/download`
  (huggingface_hub / Ollama locally, or dispatched to a node) streams progress
  over a socket room; the catalog refreshes on completion.
- **Run remotely "on your hardware":** the query takes a `device_id`. Retrieval
  always happens centrally (the vector store is here); for a node we ship only
  the grounded prompt via `node_rag_query` and relay the answer + stats back —
  mirroring the training node protocol. `rag.py` is now shipped in the node
  bundle and the agent has `node_rag_inventory/download/query` handlers.
- **Expert stats:** generation reports tokens, gen_time and **tokens/sec**;
  CPU/GPU/RAM/temp stream over a `rag:<id>` room during the run (full for
  remote nodes; limited during a *local* MLX run by the eventlet GIL-block
  noted in skipped #13, but the final tok/s is always real).

### Verified (live, on real hardware)
- Installed mlx-lm, then **downloaded Gemma-3-4B (MLX 4-bit, 3.4 GB)** through
  the catalog; the catalog flipped the model to ✓ downloaded with its size.
- Ran on-device RAG via the UI: grounded answer + citation, footer
  **"Generated by mlx · mlx-community/gemma-3-4b-it-4bit · 17.3 tok/s
  (26 tokens in 1.504s)"** — real local 4B inference. Zero console errors.
- Note: the local-MLX live CPU/GPU gauges are throttled by the eventlet single
  greenthread during a blocking generate (issue #13); remote-node stats stream
  freely. Tokens/sec is exact in both paths.

## Chat — ChatGPT-style conversations with your models

Generalized generation to multi-turn and added a real chat experience.

- **`rag.chat(backend, model, messages, …)`** is now the generation primitive
  (per-backend generators take a `messages` list); `generate()` is a single-shot
  wrapper so RAG is unchanged.
- **DB**: `Conversation` + `ChatMessage` (user-scoped, cascade). A conversation
  pins backend/model/device + an optional KB for grounding.
- **API**: `/api/conversations` CRUD + `…/<id>/message`, which builds
  system + recent history (+ retrieved KB context with citations when a KB is
  attached), generates on the conversation's device (shared in-process with
  live stats, or a node via `node_chat`), and persists both turns with
  tokens/sec.
- **Frontend `/chat`** (nav "Chat"): conversation sidebar (new/select/delete),
  Markdown message bubbles, a composer (Enter to send), and a settings bar to
  pick backend/model/device + attach a KB (expert) — novices just chat with the
  recommended model. Per-reply tokens/sec + live CPU/GPU/temp for experts.

### Verified (live, in-browser)
- Multi-turn **memory** with the cloud model (told it a name, it recalled it a
  turn later); conversation persisted + auto-titled; sidebar lists it.
- A real **local MLX Gemma-4B** chat turn through the UI
  (footer "gemma-3-4b-it-4bit · N tok/s").
- RAG-grounded chat returns citations (API). Fixed a React key collision
  (namespaced `m<id>`/`i<index>` keys). Test conversations/KBs cleaned up.

## Hardening + tests + streaming (follow-up)

**Probe sweep → real bugs found & fixed** (`fix(security): …`):
- Upload filenames were unsanitised in `os.path.join` → a name like `../app.py`
  escaped the upload/weights dirs. Now `secure_filename` on dataset + weights
  uploads, `basename` on the node-completion write.
- `/api/weights/file/<name>` served ANY file by name (IDOR). Now basenamed and
  scoped to the caller's current weights or a project they own (404 otherwise).
- RAG model download rejects non-local backends (400). Chat ordering switched to
  the monotonic `id`.

**Regression suite** (`test: offline smoke suite`): `test_smoke.py` covers the
non-LLM HTTP surface on a throwaway SQLite DB (auth, dataset upload/health/
config + filename sanitisation, training validation, a real tiny trained project
with inference/evaluation/export/leaderboard, weights-download authz, RAG KB
ingest + TF-IDF retrieval + device catalog, conversation CRUD). All pass.

**Streaming chat** (`feat(chat): stream responses token-by-token` + UI): added
`rag.stream_chat` (cloud/mlx/ollama/llama.cpp stream; transformers falls back).
The message endpoint streams each delta as a `chat_token` over the socket
(with `socketio.sleep(0)` between tokens, which also keeps the event loop
responsive during a local run) then a final `chat_answer`. The UI fills the
assistant bubble live with a blinking cursor; added inline conversation rename.
Caught + fixed a missing module-level `import time` (the streaming task had
crashed with a NameError). Verified live: the local MLX Gemma-4B bubble grows
token-by-token (23→64→76 chars across samples), cloud streams too, rename works,
and an in-page `console.error` hook recorded **0** errors during a streamed turn.

## Chat polish: model dropdown + Stop/Regenerate

- **Model picker bug fix** (`fix(chat): real model dropdown …`): the model field
  was a free-text input + datalist that looked broken next to the real
  dropdowns. Now a proper `<select>` populated from the device model catalog,
  flagging which models are "✓ downloaded" vs "downloads on first use" — matches
  the backend + knowledge-base pickers. Verified: it's a SELECT with the
  expected options and no datalist input remains.
- **Stop** (`feat(chat): stop + regenerate endpoints` + UI): a red Stop button
  during streaming cancels the in-flight job (a `chat_stop` socket event; the
  streaming loop checks a cancel set each token) and keeps the partial reply.
  Verified live: interrupted an MLX stream at 61 chars, kept the 60-char partial,
  returned to the Send state.
- **Regenerate**: redo the last assistant reply (drops it, re-answers the same
  user turn). Verified: conversation stays `[user, assistant]` (no duplicated
  turn), a fresh reply is produced.
- Refactored the turn into `_assemble_chat` / `_launch_chat_stream` (cancellable)
  / `_dispatch_chat`, shared by send + regenerate. Smoke suite still green; 0
  console errors.

