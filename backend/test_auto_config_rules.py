"""
Offline tests for the Auto-Configure decision rules (auto_config_rules.py).

No network or API key needed — these assert that the deterministic decision
tree and the over-parameterization guard behave sanely across representative
dataset summaries. Run from the backend dir:

    python test_auto_config_rules.py
"""

import sys

from auto_config_rules import (
    recommend_arch, recommend_config, guard_config,
    VALID_ARCHS, VALID_OPTIMIZERS, VALID_ACTIVATIONS, VALID_BATCH,
)

PASS, FAIL = "[ PASS ]", "[ FAIL ]"


# (label, facts, expected_arch) — representative dataset summaries.
FIXTURES = [
    ("tiny binary tabular (~800 rows, numeric)",
     {"rows": 800, "task_type": "classification", "n_features": 5,
      "n_numeric": 5, "n_categorical": 0, "sequential": False},
     "mlp"),
    ("medium tabular (~20k rows)",
     {"rows": 20000, "task_type": "classification", "n_features": 12,
      "n_numeric": 10, "n_categorical": 2, "sequential": False},
     "dnn"),
    ("large tabular (~120k rows)",
     {"rows": 120000, "task_type": "regression", "n_features": 30,
      "n_numeric": 28, "n_categorical": 2, "sequential": False},
     "resnet"),
    ("time-series, long (~5k rows)",
     {"rows": 5000, "task_type": "regression", "n_features": 8,
      "n_numeric": 8, "n_categorical": 0, "sequential": True},
     "lstm"),
    ("short sequence (~800 rows)",
     {"rows": 800, "task_type": "classification", "n_features": 6,
      "n_numeric": 6, "n_categorical": 0, "sequential": True},
     "gru"),
    ("mixed sparse categorical + dense",
     {"rows": 30000, "task_type": "classification", "n_features": 9,
      "n_numeric": 2, "n_categorical": 6, "sequential": False},
     "wide_deep"),
    ("anomaly detection framing",
     {"rows": 10000, "task_type": "classification", "n_features": 15,
      "n_numeric": 15, "n_categorical": 0, "sequential": False, "anomaly": True},
     "autoencoder"),
]


def _valid_config(cfg):
    """Every config (recommended or guarded) must satisfy the tool schema."""
    checks = [
        cfg["arch_type"] in VALID_ARCHS,
        isinstance(cfg["layer_sizes"], list) and 1 <= len(cfg["layer_sizes"]) <= 8,
        all(isinstance(x, int) and 1 <= x <= 2048 for x in cfg["layer_sizes"]),
        isinstance(cfg["epochs"], int) and 1 <= cfg["epochs"] <= 1000,
        1e-6 <= cfg["lr"] <= 1.0,
        cfg["batch_size"] in VALID_BATCH,
        cfg["optimizer"] in VALID_OPTIMIZERS,
        cfg["activation"] in VALID_ACTIVATIONS,
        isinstance(cfg["early_stopping"], dict) and "enabled" in cfg["early_stopping"],
        isinstance(cfg.get("justification"), str) and len(cfg["justification"]) >= 30,
    ]
    return all(checks)


def main():
    failures = 0

    print("\n-- Decision tree: arch per fixture --------------------")
    for label, facts, expected in FIXTURES:
        arch, rule = recommend_arch(facts)
        ok = arch == expected
        failures += not ok
        print(f"  {PASS if ok else FAIL} {label}: got {arch} (rule={rule}), want {expected}")

    print("\n-- recommend_config is schema-valid -------------------")
    for label, facts, _ in FIXTURES:
        cfg = recommend_config(facts)
        ok = _valid_config(cfg)
        failures += not ok
        print(f"  {PASS if ok else FAIL} {label}: valid config (arch={cfg['arch_type']}, "
              f"layers={cfg['layer_sizes']}, epochs={cfg['epochs']}, es={cfg['early_stopping']['enabled']})")

    print("\n-- Guard: reject over-parameterized small-data picks --")
    # An LLM proposes a Transformer on 300 rows — must be downgraded + capped.
    facts_small = {"rows": 300, "task_type": "classification", "n_features": 4,
                   "n_numeric": 4, "n_categorical": 0, "sequential": False}
    bad = {"arch_type": "transformer", "layer_sizes": [512, 512, 512, 512],
           "epochs": 500, "lr": 0.01, "batch_size": 128, "optimizer": "adam",
           "activation": "relu", "early_stopping": {"enabled": False},
           "justification": "x" * 40}
    guarded, notes = guard_config(bad, facts_small)
    checks = {
        "downgraded off transformer": guarded["arch_type"] not in {"transformer", "resnet"},
        "depth <= 3": len(guarded["layer_sizes"]) <= 3,
        "width <= 128": max(guarded["layer_sizes"]) <= 128,
        "batch <= 16 (very small data)": guarded["batch_size"] <= 16,
        "early stopping forced on": guarded["early_stopping"]["enabled"] is True,
        "still schema-valid": _valid_config(guarded),
        "recorded adjustments": len(notes) > 0,
    }
    for label, ok in checks.items():
        failures += not ok
        print(f"  {PASS if ok else FAIL} {label}")
    print(f"     guard notes: {notes}")

    print("\n-- Guard: leaves a sane pick essentially intact -------")
    good = recommend_config(FIXTURES[1][1])  # medium tabular -> dnn
    guarded2, notes2 = guard_config(good, FIXTURES[1][1])
    ok = guarded2["arch_type"] == "dnn" and _valid_config(guarded2)
    failures += not ok
    print(f"  {PASS if ok else FAIL} medium-tabular dnn unchanged by guard (notes={notes2})")

    print("\n-------------------------------------------------------")
    if failures == 0:
        print("All decision-rule assertions passed.")
        sys.exit(0)
    print(f"{failures} assertion(s) failed.")
    sys.exit(1)


if __name__ == "__main__":
    main()
