# Sample datasets

The datasets behind the **Demo** page, the **Tutorial**, and the "try a sample"
chips on the Dataset page. `backend/demo_data.py` is the registry: it describes
each one and carries the preset model the demo trains on it.

| File | Rows × features | Task | Origin |
| --- | --- | --- | --- |
| `iris.csv` | 150 × 4 | classification (3 species) | Real — R. A. Fisher (1936), UCI Machine Learning Repository |
| `breast_cancer.csv` | 569 × 30 | classification (benign / malignant) | Real — Breast Cancer Wisconsin (Diagnostic), Wolberg, Street & Mangasarian (1995), UCI |
| `diabetes.csv` | 442 × 10 | regression (disease progression) | Real — Efron, Hastie, Johnstone & Tibshirani (2004), "Least Angle Regression" |
| `student_performance.csv` | 800 × 5 | classification (passed 0/1) | **Synthetic** — generated for teaching by `generate.py` |

The three real datasets are exported, values untouched, from the copies bundled
with scikit-learn (a backend dependency, so no download is needed):

```bash
../backend/venv/bin/python build_real_datasets.py
```

Only the column names are made friendlier and numeric class ids are replaced by
their labels. In `diabetes.csv`, `sex` keeps the source's 1/2 coding — the
original paper does not say which is which, so it is not translated.

`student_performance.csv` is reproducible with `python generate.py` (fixed seed).

## Adding a dataset

1. Put the CSV in this directory.
2. Add an entry to `DEMO_DATASETS` in `backend/demo_data.py` (title, source,
   target column, and a model preset that trains well on it).
3. Optionally give it an icon in `ICONS` in `frontend/src/pages/Demo.tsx`.
