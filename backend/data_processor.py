"""
Vortex ML — Data Processor
Handles file uploads, Excel→CSV conversion, dataset analysis, and data preparation.
"""

import os
import json
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, LabelEncoder
import torch
from torch.utils.data import DataLoader, TensorDataset

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


def save_uploaded_file(file_storage):
    """Save an uploaded file. If Excel, convert to CSV automatically."""
    filename = file_storage.filename
    filepath = os.path.join(UPLOAD_DIR, filename)
    file_storage.save(filepath)

    # Auto-convert Excel to CSV
    if filename.endswith((".xlsx", ".xls")):
        df = pd.read_excel(filepath, engine="openpyxl")
        csv_filename = os.path.splitext(filename)[0] + ".csv"
        csv_path = os.path.join(UPLOAD_DIR, csv_filename)
        df.to_csv(csv_path, index=False)
        os.remove(filepath)  # Remove original Excel file
        return csv_filename, csv_path
    
    return filename, filepath


def analyze_dataset(csv_path):
    """Analyze a CSV and return metadata for the Dataset Designer UI."""
    df = pd.read_csv(csv_path)

    columns = []
    for col in df.columns:
        col_info = {
            "name": col,
            "dtype": str(df[col].dtype),
            "non_null": int(df[col].notna().sum()),
            "null_count": int(df[col].isna().sum()),
            "unique": int(df[col].nunique()),
            "is_numeric": pd.api.types.is_numeric_dtype(df[col]),
        }
        if col_info["is_numeric"]:
            col_info["min"] = float(df[col].min()) if not df[col].isna().all() else None
            col_info["max"] = float(df[col].max()) if not df[col].isna().all() else None
            col_info["mean"] = float(df[col].mean()) if not df[col].isna().all() else None
            col_info["std"] = float(df[col].std()) if not df[col].isna().all() else None
        else:
            top_values = df[col].value_counts().head(5).to_dict()
            col_info["top_values"] = {str(k): int(v) for k, v in top_values.items()}
        columns.append(col_info)

    # Preview rows (first 10)
    preview = df.head(10).fillna("").to_dict(orient="records")

    return {
        "rows": len(df),
        "cols": len(df.columns),
        "columns": columns,
        "preview": preview,
    }


def _split(X, y, test_size, stratify):
    """train_test_split that uses stratification when possible.

    Stratifying keeps the class balance identical across train/val/test, which
    matters for imbalanced classification. It requires >= 2 samples per class in
    the split, so we fall back to an unstratified split if a class is too rare
    (otherwise sklearn raises and training never starts).
    """
    if stratify is not None:
        try:
            return train_test_split(X, y, test_size=test_size,
                                    random_state=42, stratify=stratify)
        except ValueError:
            pass
    return train_test_split(X, y, test_size=test_size, random_state=42)


def prepare_dataset(csv_path, feature_cols, target_col, batch_size=32, test_size=0.2, val_size=0.1):
    """
    Prepare a dataset for training.
    Returns train_loader, val_loader, test_loader, input_dim, output_dim, task_type.
    """
    df = pd.read_csv(csv_path)

    # Determine task type
    target_series = df[target_col]
    if pd.api.types.is_numeric_dtype(target_series) and target_series.nunique() > 10:
        task_type = "regression"
    else:
        task_type = "classification"

    # Encode categorical feature columns. `features_meta` records exactly how
    # each column was transformed so the same mapping can be replayed at
    # inference time (see apply_preprocess).
    label_encoders = {}
    features_meta = {}
    for col in feature_cols:
        if not pd.api.types.is_numeric_dtype(df[col]):
            le = LabelEncoder()
            df[col] = le.fit_transform(df[col].astype(str).fillna("__MISSING__"))
            label_encoders[col] = le
            features_meta[col] = {"kind": "categorical",
                                  "classes": [str(c) for c in le.classes_]}
        else:
            median = float(df[col].median()) if not df[col].isna().all() else 0.0
            df[col] = df[col].fillna(median)
            features_meta[col] = {"kind": "numeric", "median": median}

    # Prepare features
    X = df[feature_cols].values.astype(np.float32)

    # Prepare target
    if task_type == "classification":
        le_target = LabelEncoder()
        y = le_target.fit_transform(target_series.astype(str).fillna("__MISSING__"))
        output_dim = len(le_target.classes_)
        y = y.astype(np.int64)
        target_classes = [str(c) for c in le_target.classes_]
    else:
        y = target_series.fillna(target_series.median()).values.astype(np.float32)
        output_dim = 1
        target_classes = None

    # Split FIRST, then fit the scaler on the training split only. Fitting on
    # the full matrix leaks validation/test statistics (mean, std) into the
    # training distribution and inflates reported metrics.
    strat = y if task_type == "classification" else None
    X_train, X_test, y_train, y_test = _split(X, y, test_size, strat)
    strat_train = y_train if task_type == "classification" else None
    X_train, X_val, y_train, y_val = _split(X_train, y_train, val_size, strat_train)

    # Scale features — fit on train, apply the same transform to val/test.
    scaler = StandardScaler()
    X_train = scaler.fit_transform(X_train)
    X_val = scaler.transform(X_val)
    X_test = scaler.transform(X_test)

    # Create DataLoaders
    def make_loader(X_arr, y_arr, shuffle):
        X_t = torch.tensor(X_arr)
        y_t = torch.tensor(y_arr)
        ds = TensorDataset(X_t, y_t)
        return DataLoader(ds, batch_size=batch_size, shuffle=shuffle)

    train_loader = make_loader(X_train, y_train, shuffle=True)
    val_loader = make_loader(X_val, y_val, shuffle=False)
    test_loader = make_loader(X_test, y_test, shuffle=False)

    input_dim = len(feature_cols)

    # Everything needed to reproduce this exact preprocessing on new rows.
    preprocess = {
        "feature_cols": list(feature_cols),
        "target_col": target_col,
        "task_type": task_type,
        "input_dim": input_dim,
        "output_dim": output_dim,
        "scaler": {"mean": scaler.mean_.tolist(), "scale": scaler.scale_.tolist()},
        "features": features_meta,
        "target_classes": target_classes,
    }

    return {
        "train_loader": train_loader,
        "val_loader": val_loader,
        "test_loader": test_loader,
        "input_dim": input_dim,
        "output_dim": output_dim,
        "task_type": task_type,
        "train_size": len(X_train),
        "val_size": len(X_val),
        "test_size": len(X_test),
        "preprocess": preprocess,
    }


# ─────────────────────────────────────────────────────────
# Inference — replay the training preprocessing on new rows
# ─────────────────────────────────────────────────────────
def preprocess_sidecar_path(weights_path):
    """The JSON sidecar path for a given .pt weights file (same base name)."""
    base = weights_path[:-3] if weights_path.endswith(".pt") else weights_path
    return base + ".preprocess.json"


def save_preprocess(weights_path, preprocess):
    """Persist preprocessing metadata next to the weights file."""
    with open(preprocess_sidecar_path(weights_path), "w", encoding="utf-8") as f:
        json.dump(preprocess, f)


def load_preprocess(weights_path):
    """Load preprocessing metadata for a weights file, or None if absent."""
    path = preprocess_sidecar_path(weights_path)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def apply_preprocess(preprocess, rows):
    """Turn a list of {col: value} dicts into a scaled float32 feature matrix,
    replaying the exact transforms recorded at training time.

    Unknown categorical values fall back to the '__MISSING__' bucket (or 0);
    missing/non-numeric numeric values fall back to the stored training median.
    """
    feature_cols = preprocess["feature_cols"]
    feats = preprocess["features"]
    mean = np.array(preprocess["scaler"]["mean"], dtype=np.float32)
    scale = np.array(preprocess["scaler"]["scale"], dtype=np.float32)

    matrix = []
    for row in rows:
        encoded = []
        for col in feature_cols:
            meta = feats.get(col, {"kind": "numeric", "median": 0.0})
            raw = row.get(col)
            if meta["kind"] == "categorical":
                classes = meta["classes"]
                key = "__MISSING__" if raw is None else str(raw)
                if key in classes:
                    encoded.append(float(classes.index(key)))
                elif "__MISSING__" in classes:
                    encoded.append(float(classes.index("__MISSING__")))
                else:
                    encoded.append(0.0)
            else:
                try:
                    val = float(raw)
                    if np.isnan(val):
                        val = meta["median"]
                except (TypeError, ValueError):
                    val = meta["median"]
                encoded.append(val)
        matrix.append(encoded)

    X = np.array(matrix, dtype=np.float32)
    return (X - mean) / scale
