"""
Vortex ML — Auto-Configure decision rules.

A dependency-free encoding of the same decision tree the Picker LLM is prompted
to follow. Two jobs:

  * `recommend_config(facts)` — a deterministic, principled config used as a
    fallback when the LLM fails to emit one.
  * `guard_config(cfg, facts)` — clamps an LLM (or fallback) config so it can
    never be over-parameterized for the dataset (e.g. a Transformer on 300
    rows), and keeps every field inside the `set_model_config` schema bounds.

`facts` is a plain dict with whatever is known about the dataset:
    rows            int   — number of rows
    task_type       str   — "classification" | "regression"
    n_features      int   — number of selected feature columns
    n_categorical   int   — categorical features among them
    n_numeric       int   — numeric features among them
    sequential      bool  — temporal / ordered structure detected
    anomaly         bool  — user framed it as anomaly/outlier detection

Everything is best-effort: missing facts fall back to safe defaults so the
functions never raise.
"""

# Per-architecture "use when / avoid when" rules. Surfaced in the LLM prompt and
# enforced (for the over-parameterization cases) by guard_config.
ARCH_RULES = {
    "mlp":        {"use": "small/medium independent tabular rows; the safe default",
                   "avoid": "sequential data; very large datasets that want depth"},
    "dnn":        {"use": "medium tabular data needing BatchNorm+Dropout regularization",
                   "avoid": "tiny datasets (<500 rows) where it can still overfit"},
    "cnn1d":      {"use": "ordered features with local structure (signals, spectra)",
                   "avoid": "unordered tabular columns"},
    "rnn":        {"use": "short sequences; rarely preferred over gru/lstm",
                   "avoid": "non-sequential tabular data; long dependencies"},
    "lstm":       {"use": "sequential/time-series with long-range dependencies, rows>2k",
                   "avoid": "non-sequential tabular data; tiny datasets"},
    "gru":        {"use": "sequential/time-series, shorter deps, faster/cheaper than lstm",
                   "avoid": "non-sequential tabular data"},
    "autoencoder": {"use": "anomaly/outlier detection or unsupervised representation",
                    "avoid": "ordinary supervised classification/regression"},
    "resnet":     {"use": "deep stacks on large datasets (>50k rows)",
                   "avoid": "small datasets (<2k rows) — overfits badly"},
    "transformer": {"use": "large datasets with rich feature interactions (>50k rows)",
                    "avoid": "small datasets (<2k rows) — overfits, data-hungry"},
    "wide_deep":  {"use": "mixed sparse categorical + dense numeric tabular data",
                   "avoid": "purely numeric low-dimensional data"},
}

VALID_ARCHS = set(ARCH_RULES)
VALID_OPTIMIZERS = {"adam", "adamw", "sgd", "rmsprop"}
VALID_ACTIVATIONS = {"relu", "leaky_relu", "elu", "selu", "gelu", "tanh", "sigmoid"}
VALID_BATCH = [16, 32, 64, 128, 256]

# Architectures that are data-hungry and overfit on small datasets.
HEAVY_ARCHS = {"transformer", "resnet"}
SMALL_DATA_ROWS = 2000


def size_band(rows):
    if rows < 1000:
        return "<1k"
    if rows < 10000:
        return "1k-10k"
    if rows < 50000:
        return "10k-50k"
    return ">50k"


def capacity_for(rows):
    """Hidden-layer widths by dataset size (same bands as the prompt)."""
    return {
        "<1k": [32, 16],
        "1k-10k": [64, 32],
        "10k-50k": [128, 64],
        ">50k": [256, 128, 64],
    }[size_band(rows)]


def epochs_for(rows):
    """(epochs, early_stopping_patience, early_stopping_enabled)."""
    band = size_band(rows)
    if band == "<1k":
        return 30, 6, True
    if band == "1k-10k":
        return 60, 10, True
    if band == "10k-50k":
        return 80, 12, True
    return 120, 12, False


def batch_for(rows):
    if rows < 500:
        return 16
    if rows > 100000:
        return 128
    if rows > 10000:
        return 64
    return 32


def lr_for(arch, n_layers):
    if arch in HEAVY_ARCHS or n_layers >= 3:
        return 0.0001
    return 0.001


def _f(facts):
    """Normalise facts with safe defaults."""
    return {
        "rows": int(facts.get("rows") or 0),
        "task_type": facts.get("task_type") or "classification",
        "n_features": int(facts.get("n_features") or 0),
        "n_categorical": int(facts.get("n_categorical") or 0),
        "n_numeric": int(facts.get("n_numeric") or 0),
        "sequential": bool(facts.get("sequential")),
        "anomaly": bool(facts.get("anomaly")),
    }


def recommend_arch(facts):
    """Decision tree → (arch_type, rule_name). Pure function of dataset facts."""
    f = _f(facts)
    rows = f["rows"]

    # 1. Unsupervised / anomaly framing wins outright.
    if f["anomaly"]:
        return "autoencoder", "anomaly_detection"

    # 2. Sequential / temporal structure → recurrent family.
    if f["sequential"]:
        if rows >= SMALL_DATA_ROWS:
            return "lstm", "sequential_long"
        return "gru", "sequential_short"

    # 3. Mixed sparse-categorical + dense-numeric → Wide & Deep.
    if f["n_categorical"] >= 3 and f["n_categorical"] >= f["n_numeric"]:
        return "wide_deep", "mixed_sparse_dense"

    # 4. Large datasets can afford depth.
    if rows > 50000:
        return "resnet", "large_dataset_depth"

    # 5. Tiny tabular → simplest model (overfitting is the risk).
    if rows < SMALL_DATA_ROWS:
        return "mlp", "tiny_tabular_safe_default"

    # 6. Medium tabular → DNN (BatchNorm + Dropout regularization).
    return "dnn", "medium_tabular_regularized"


def recommend_config(facts):
    """A complete, schema-valid config plus a rule-naming justification."""
    f = _f(facts)
    rows = f["rows"]
    arch, rule = recommend_arch(facts)
    layers = capacity_for(rows)
    epochs, patience, es_enabled = epochs_for(rows)
    batch = batch_for(rows)
    lr = lr_for(arch, len(layers))

    activation = "gelu" if arch == "transformer" else "relu"
    optimizer = "adamw" if arch in HEAVY_ARCHS else "adam"

    band = size_band(rows)
    justification = (
        f"Rule '{rule}' fired: {rows} rows ({band} band), task={f['task_type']}, "
        f"{f['n_features']} features ({f['n_numeric']} numeric / "
        f"{f['n_categorical']} categorical), sequential={f['sequential']}. "
        f"Chose {arch} — {ARCH_RULES[arch]['use']}. Capacity {layers} and "
        f"{epochs} epochs are tied to the {band} size band; "
        f"early stopping {'on' if es_enabled else 'off'}."
    )

    cfg = {
        "arch_type": arch,
        "layer_sizes": layers,
        "epochs": epochs,
        "lr": lr,
        "batch_size": batch,
        "optimizer": optimizer,
        "activation": activation,
        "early_stopping": {"enabled": es_enabled, "patience": patience, "min_delta": 0.0001},
        "justification": justification,
        "_rule": rule,
    }
    return cfg


def guard_config(cfg, facts):
    """Clamp a config so it can't be over-parameterized for the dataset and so
    every field stays within the set_model_config schema. Returns
    (clamped_cfg, adjustments) where adjustments is a list of human-readable
    notes about what changed (empty if nothing did).
    """
    f = _f(facts)
    rows = f["rows"]
    out = dict(cfg)
    notes = []

    # arch_type must be valid; fall back to a size-appropriate default.
    if out.get("arch_type") not in VALID_ARCHS:
        out["arch_type"] = recommend_arch(facts)[0]
        notes.append(f"unknown architecture replaced with {out['arch_type']}")

    # Over-parameterization guard: heavy, data-hungry nets on small data.
    if rows and rows < SMALL_DATA_ROWS and out["arch_type"] in HEAVY_ARCHS:
        replacement = "dnn" if rows >= 500 else "mlp"
        notes.append(
            f"{out['arch_type']} rejected on {rows} rows (<{SMALL_DATA_ROWS}); "
            f"using {replacement} to avoid overfitting")
        out["arch_type"] = replacement

    # layer_sizes: coerce, clamp widths/depth; cap hard on small data.
    layers = out.get("layer_sizes")
    if not isinstance(layers, list) or not layers:
        layers = capacity_for(rows or 1000)
        notes.append("missing layer_sizes filled from size band")
    layers = [int(x) for x in layers if isinstance(x, (int, float)) and x >= 1][:8]
    if not layers:
        layers = capacity_for(rows or 1000)
    layers = [min(2048, max(1, w)) for w in layers]
    if rows and rows < SMALL_DATA_ROWS:
        capped = [min(128, w) for w in layers][:3]
        if capped != layers:
            notes.append(f"capacity capped to {capped} for small data (<{SMALL_DATA_ROWS} rows)")
        layers = capped
    out["layer_sizes"] = layers

    # Scalar bounds.
    try:
        out["epochs"] = int(out.get("epochs", 50))
    except (TypeError, ValueError):
        out["epochs"] = epochs_for(rows or 1000)[0]
    out["epochs"] = min(1000, max(1, out["epochs"]))

    try:
        out["lr"] = float(out.get("lr", 0.001))
    except (TypeError, ValueError):
        out["lr"] = 0.001
    out["lr"] = min(1.0, max(1e-6, out["lr"]))

    if out.get("batch_size") not in VALID_BATCH:
        want = batch_for(rows or 1000)
        out["batch_size"] = min(VALID_BATCH, key=lambda b: abs(b - want))
        notes.append(f"batch_size snapped to {out['batch_size']}")
    if rows and rows < 500 and out["batch_size"] > 16:
        out["batch_size"] = 16
        notes.append("batch_size reduced to 16 for very small data (<500 rows)")

    if out.get("optimizer") not in VALID_OPTIMIZERS:
        out["optimizer"] = "adam"
    if out.get("activation") not in VALID_ACTIVATIONS:
        out["activation"] = "relu"

    es = out.get("early_stopping")
    if not isinstance(es, dict) or "enabled" not in es:
        es = {"enabled": rows < 50000 if rows else True}
        notes.append("early_stopping defaulted")
    # Small data should always early-stop.
    if rows and rows < SMALL_DATA_ROWS and not es.get("enabled"):
        es = dict(es, enabled=True, patience=es.get("patience", 6))
        notes.append("early stopping enabled for small data")
    out["early_stopping"] = es

    if notes and isinstance(out.get("justification"), str):
        out["justification"] += " [auto-guard: " + "; ".join(notes) + "]"

    return out, notes
