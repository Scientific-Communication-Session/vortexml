# Deferred Features

Features proposed in the review that were intentionally **not** implemented in
this pass (scope was features 1, 2, 4, 5, 6). Each entry has enough detail to
pick up cold.

---

## Feature 3 — Confusion matrix & regression residual plots

**Original item:** "Confusion matrix / regression residual plots on the held-out
test set (you compute a test split but never use it for reporting)."

**Why deferred:** Out of the assigned set {1,2,4,5,6}. It also depends on
plumbing that doesn't exist yet: the training pipeline builds a `test_loader`
in `prepare_dataset` but `train_model` never evaluates on it, and nothing about
the test set is persisted on the `Project` row or streamed to the client.
Delivering this properly means changing the training engine's outputs and the
DB schema, which is a wider blast radius than a UI add.

**Rough scope / effort (M, ~0.5–1 day):**
- Backend: in `training_engine.train_model`, after restoring best weights, run a
  final pass over `test_loader` and compute, for classification, a confusion
  matrix (`output_dim x output_dim` counts) + per-class precision/recall; for
  regression, residuals (y_true − y_pred) and R²/MAE. Return them in
  `complete_data`.
- Persist a compact summary on `Project` (new nullable `test_metrics` Text/JSON
  column) via `_persist_project`; relay it in `training_complete`.
- Frontend: render a heatmap confusion matrix (can reuse chart.js or a simple
  CSS grid) on the Training results panel and in the Profile project detail;
  for regression, a residual scatter / histogram.

**Dependencies:** test-set evaluation in the engine; a `Project.test_metrics`
column (DB migration / `db.create_all` is fine for SQLite dev). The preprocessing
sidecar from feature 1 already gives target class names for axis labels.

---

## Feature 7 — Per-device telemetry history

**Original item:** "Per-device telemetry history — you already stream
temps/CPU/RAM; persist and chart it per device over time."

**Why deferred:** Out of the assigned set, and it introduces a time-series
storage concern (volume, retention/downsampling) that the current single-row
`Device.specs` model and SQLite-by-default setup aren't shaped for. The
`system_stats` data is currently emitted live over SocketIO (`system_stats`
event) and never stored.

**Rough scope / effort (M–L, ~1–1.5 days):**
- Backend: a `DeviceTelemetry` table (device_id, ts, cpu_pct, ram_pct,
  gpu_pct, temp_c) written on a throttled cadence (e.g. 1 sample / 5–10s, not
  every emit) by the `SystemMonitor` loop / the `node_relay` handler for remote
  nodes. Add a retention/rollup job or a hard cap per device.
- Endpoint `GET /api/devices/<id>/telemetry?window=...` returning downsampled
  series.
- Frontend: a sparkline/area chart per device card and a detail view.

**Dependencies:** a new table + write path from both the local `SystemMonitor`
and the remote `node_relay` "system_stats" path; a retention strategy. Should
land after, or alongside, a decision on Postgres-vs-SQLite for production since
telemetry is the first real high-write table.

---

## Feature 8 — Export to ONNX / TorchScript

**Original item:** "Export to ONNX / TorchScript for portability beyond the
Python .pt."

**Why deferred:** Out of the assigned set. Correct ONNX export needs a valid
example input per architecture and careful handling of the dynamic batch axis,
and several of the 10 architectures (LSTM/GRU/Transformer with their
`unsqueeze`-based tabular adaptation) need export-time verification. This is
best done after feature 1 (inference) so exported graphs can be validated
against the in-process predictions.

**Rough scope / effort (M, ~0.5–1 day):**
- Backend: `POST /api/projects/<id>/export?format=onnx|torchscript`. Rebuild the
  model (reuse `load_weights_for_inference` from feature 1), create a dummy
  input of shape `(1, input_dim)`, then `torch.onnx.export(...)` with a dynamic
  batch axis, or `torch.jit.script/trace` for TorchScript. Stream the artifact
  as a download.
- Bundle the preprocessing sidecar (feature 1) alongside the export so the
  model is actually usable elsewhere (inputs must be scaled/encoded identically).
- Frontend: an "Export" dropdown on the Profile project card.

**Dependencies:** feature 1's `load_weights_for_inference` + preprocessing
sidecar; `onnx` would be a new runtime dependency (TorchScript needs none).
Validate exported outputs match `predict()` within tolerance before exposing.
