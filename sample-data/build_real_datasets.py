"""
Exports the real-world demo datasets that ship with VortexML.

All three come bundled with scikit-learn (already a backend dependency), so
this needs no network. The values are the published measurements, untouched —
only the column names are made friendlier and the numeric class ids are
replaced by their real labels.

Run from this directory with the backend venv:
    ../backend/venv/bin/python build_real_datasets.py
"""

from sklearn.datasets import load_breast_cancer, load_diabetes, load_iris


def _clean(col):
    return col.strip().lower().replace(" (cm)", "_cm").replace(" ", "_")


# Iris — Fisher (1936). 150 flowers, 3 species.
iris = load_iris(as_frame=True)
df = iris.frame.rename(columns=_clean)
df["species"] = [iris.target_names[t] for t in iris.target]
df.drop(columns=["target"]).to_csv("iris.csv", index=False)

# Breast Cancer Wisconsin (Diagnostic) — Wolberg, Street & Mangasarian (1995).
# 569 biopsies, 30 cell-nucleus measurements each.
bc = load_breast_cancer(as_frame=True)
df = bc.frame.rename(columns=_clean)
df["diagnosis"] = [bc.target_names[t] for t in bc.target]
df.drop(columns=["target"]).to_csv("breast_cancer.csv", index=False)

# Diabetes — Efron, Hastie, Johnstone & Tibshirani (2004). 442 patients; the
# target is a quantitative measure of disease progression one year on.
# `sex` keeps the source's 1/2 coding (the original paper doesn't say which is
# which, so we don't guess).
diabetes = load_diabetes(as_frame=True, scaled=False)
diabetes.frame.rename(columns={
    "bp": "blood_pressure",
    "s1": "total_cholesterol",
    "s2": "ldl",
    "s3": "hdl",
    "s4": "cholesterol_hdl_ratio",
    "s5": "log_triglycerides",
    "s6": "blood_sugar",
    "target": "disease_progression",
}).to_csv("diabetes.csv", index=False)

print("Wrote iris.csv, breast_cancer.csv, diabetes.csv")
