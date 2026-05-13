"""
Vortex ML — Main Flask Application
Routes, API endpoints, and SocketIO event handlers.
"""

import os
import json
from flask import Flask, request, jsonify, session, send_file, make_response
from flask_cors import CORS
from flask_socketio import SocketIO
import threading

import json as _json

from data_processor import save_uploaded_file, analyze_dataset, prepare_dataset
from training_engine import (
    create_model, train_model, stop_training, MODEL_REGISTRY,
    parse_weight_filename, WEIGHTS_DIR,
)
from models import db, User, Project

app = Flask(__name__)
# Enable CORS with credentials support for session cookies pointing to the frontend
CORS(app, supports_credentials=True, origins=["http://localhost:5173", "http://127.0.0.1:5173"])

app.secret_key = "vortex-ml-secret-key-2026"
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024  # 100 MB max upload

# Database configuration — use SQLite fallback when PostgreSQL is unavailable
if os.environ.get("VORTEX_USE_SQLITE") == "1" or os.environ.get("SQLALCHEMY_DATABASE_URI"):
    _db_uri = os.environ.get("SQLALCHEMY_DATABASE_URI",
        "sqlite:///" + os.path.join(os.path.dirname(__file__), "vortex.db"))
    app.config['SQLALCHEMY_DATABASE_URI'] = _db_uri
else:
    app.config['SQLALCHEMY_DATABASE_URI'] = 'postgresql://postgres:postgres@localhost:5432/vortex_db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)

with app.app_context():
    db.create_all()

# Cache-busting: append version to static URLs so browser loads fresh JS/CSS
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0

@app.context_processor
def inject_cache_buster():
    import time
    return {"cache_version": int(time.time())}

socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# In-memory session state (for single-user simplicity)
_state = {
    "dataset_file": None,
    "dataset_path": None,
    "dataset_info": None,
    "feature_cols": [],
    "target_col": None,
    "model_config": None,
    "training_thread": None,
    "project_name": "VortexProject",
    "last_weights_file": None,
}


# ─────────────────────────────────────────────────────────
# Health Check Route
# ─────────────────────────────────────────────────────────
@app.route("/")
def index():
    return jsonify({"status": "ok", "service": "Vortex ML API"})


# ─────────────────────────────────────────────────────────
# Authentication API
# ─────────────────────────────────────────────────────────

@app.route("/api/auth/signup", methods=["POST"])
def signup():
    data = request.get_json(silent=True) or {}
    email = data.get("email")
    username = data.get("username")
    password = data.get("password")

    if not email or not username or not password:
        return jsonify({"error": "Missing required fields"}), 400

    if User.query.filter_by(email=email).first():
        return jsonify({"error": "Email already in use"}), 409
        
    if User.query.filter_by(username=username).first():
        return jsonify({"error": "Username already taken"}), 409

    new_user = User(email=email, username=username)
    new_user.set_password(password)
    
    db.session.add(new_user)
    db.session.commit()

    # Log them in automatically
    session["user_id"] = new_user.id
    
    return jsonify({"message": "User registered successfully", "user": new_user.to_dict()}), 201


@app.route("/api/auth/signin", methods=["POST"])
def signin():
    data = request.get_json(silent=True) or {}
    email = data.get("email")
    password = data.get("password")

    user = User.query.filter_by(email=email).first()
    if user and user.check_password(password):
        session["user_id"] = user.id
        return jsonify({"message": "Signed in successfully", "user": user.to_dict()})
        
    return jsonify({"error": "Invalid email or password"}), 401


@app.route("/api/auth/me", methods=["GET"])
def get_me():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401
        
    user = User.query.get(user_id)
    if not user:
        # Invalid session, clear it
        session.pop("user_id", None)
        return jsonify({"error": "User not found"}), 404
        
    return jsonify({"user": user.to_dict()})


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    session.pop("user_id", None)
    return jsonify({"message": "Logged out successfully"})


@app.route("/api/auth/survey", methods=["POST"])
def submit_survey():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    data = request.get_json(silent=True) or {}
    is_beginner = data.get("is_beginner")

    if is_beginner is None:
        return jsonify({"error": "Missing survey result"}), 400

    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    user.is_beginner = bool(is_beginner)
    db.session.commit()

    return jsonify({"message": "Survey completed successfully", "user": user.to_dict()})


@app.route("/api/auth/beginner", methods=["PATCH"])
def update_beginner_status():
    """Let a signed-in user flip their beginner flag at any time (not only via survey)."""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    data = request.get_json(silent=True) or {}
    is_beginner = data.get("is_beginner")
    if not isinstance(is_beginner, bool):
        return jsonify({"error": "is_beginner must be a boolean"}), 400

    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    user.is_beginner = is_beginner
    db.session.commit()
    return jsonify({"user": user.to_dict()})

# ─────────────────────────────────────────────────────────
# Dataset API
# ─────────────────────────────────────────────────────────
@app.route("/api/upload", methods=["POST"])
def upload_file():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    allowed = file.filename.lower().endswith((".csv", ".xlsx", ".xls"))
    if not allowed:
        return jsonify({"error": "Only CSV and Excel files are supported"}), 400

    try:
        filename, filepath = save_uploaded_file(file)
        info = analyze_dataset(filepath)
        _state["dataset_file"] = filename
        _state["dataset_path"] = filepath
        _state["dataset_info"] = info
        return jsonify({"filename": filename, "info": info})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/dataset/analyze", methods=["GET"])
def get_dataset_info():
    if _state["dataset_info"] is None:
        return jsonify({"error": "No dataset uploaded yet"}), 404
    return jsonify({
        "filename": _state["dataset_file"],
        "info": _state["dataset_info"],
    })


@app.route("/api/dataset/configure", methods=["POST"])
def configure_dataset():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No JSON body"}), 400

    feature_cols = data.get("feature_cols", [])
    target_col = data.get("target_col")

    if not feature_cols:
        return jsonify({"error": "Select at least one feature column"}), 400
    if not target_col:
        return jsonify({"error": "Select a target column"}), 400

    _state["feature_cols"] = feature_cols
    _state["target_col"] = target_col

    return jsonify({"status": "ok", "features": feature_cols, "target": target_col})


# ─────────────────────────────────────────────────────────
# Model API
# ─────────────────────────────────────────────────────────
@app.route("/api/architectures", methods=["GET"])
def list_architectures():
    archs = [
        {"key": "mlp", "name": "Multi-Layer Perceptron", "short": "MLP",
         "desc": "Classic feedforward network. Great for general tabular classification and regression.",
         "icon": "🔵", "beginner_friendly": True},
        {"key": "dnn", "name": "Deep Neural Network", "short": "DNN",
         "desc": "Deep feedforward with BatchNorm and Dropout for complex patterns.",
         "icon": "🟣", "beginner_friendly": True},
        {"key": "cnn1d", "name": "1D Convolutional Network", "short": "CNN-1D",
         "desc": "Detects local patterns and sequences in feature columns.",
         "icon": "🟢", "beginner_friendly": False},
        {"key": "rnn", "name": "Recurrent Neural Network", "short": "RNN",
         "desc": "Processes sequential/time-series data with memory.",
         "icon": "🔴", "beginner_friendly": False},
        {"key": "lstm", "name": "Long Short-Term Memory", "short": "LSTM",
         "desc": "Captures long-term dependencies in sequential data.",
         "icon": "🟡", "beginner_friendly": False},
        {"key": "gru", "name": "Gated Recurrent Unit", "short": "GRU",
         "desc": "Efficient alternative to LSTM with fewer parameters.",
         "icon": "🟠", "beginner_friendly": False},
        {"key": "autoencoder", "name": "Autoencoder", "short": "AE",
         "desc": "Learns compressed feature representations. Good for anomaly detection.",
         "icon": "🔷", "beginner_friendly": False},
        {"key": "resnet", "name": "Residual Network", "short": "ResNet",
         "desc": "Skip connections allow very deep networks without vanishing gradients.",
         "icon": "⬛", "beginner_friendly": False},
        {"key": "transformer", "name": "Transformer", "short": "TF",
         "desc": "Attention-based architecture for learning feature relationships.",
         "icon": "💎", "beginner_friendly": False},
        {"key": "wide_deep", "name": "Wide & Deep Network", "short": "W&D",
         "desc": "Combines memorization (wide) with generalization (deep).",
         "icon": "🌐", "beginner_friendly": True},
    ]
    return jsonify(archs)


@app.route("/api/model/configure", methods=["POST"])
def configure_model():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No JSON body"}), 400

    arch_type = data.get("arch_type")
    layer_sizes = data.get("layer_sizes", [64])
    epochs = data.get("epochs", 50)
    lr = data.get("lr", 0.001)
    batch_size = data.get("batch_size", 32)
    optimizer = data.get("optimizer", "adam")
    activation = data.get("activation", "relu")
    project_name = data.get("project_name", "VortexProject")

    # Early stopping
    early_stopping = data.get("early_stopping", {})

    if arch_type not in MODEL_REGISTRY:
        return jsonify({"error": f"Unknown architecture: {arch_type}"}), 400

    _state["project_name"] = project_name
    _state["model_config"] = {
        "arch_type": arch_type,
        "layer_sizes": layer_sizes,
        "epochs": epochs,
        "lr": lr,
        "batch_size": batch_size,
        "optimizer": optimizer,
        "activation": activation,
        "project_name": project_name,
        "early_stopping": early_stopping,
    }

    return jsonify({"status": "ok", "config": _state["model_config"]})


# ─────────────────────────────────────────────────────────
# Training API
# ─────────────────────────────────────────────────────────
@app.route("/api/training/start", methods=["POST"])
def start_training():
    if not _state["dataset_path"]:
        return jsonify({"error": "No dataset uploaded"}), 400
    if not _state["feature_cols"] or not _state["target_col"]:
        return jsonify({"error": "Dataset not configured (features/target)"}), 400
    if not _state["model_config"]:
        return jsonify({"error": "Model not configured"}), 400

    config = _state["model_config"]

    # Capture the session user_id BEFORE entering the background thread —
    # the Flask session is request-scoped and won't be reachable from run().
    owner_user_id = session.get("user_id")

    try:
        # Prepare data
        data = prepare_dataset(
            _state["dataset_path"],
            _state["feature_cols"],
            _state["target_col"],
            batch_size=config["batch_size"]
        )

        # Create model
        model = create_model(
            config["arch_type"],
            config["layer_sizes"],
            data["input_dim"],
            data["output_dim"],
            activation=config.get("activation", "relu")
        )

        training_info = {
            "arch_type": config["arch_type"],
            "layer_sizes": config["layer_sizes"],
            "input_dim": data["input_dim"],
            "output_dim": data["output_dim"],
            "task_type": data["task_type"],
            "train_size": data["train_size"],
            "val_size": data["val_size"],
            "test_size": data["test_size"],
            "epochs": config["epochs"],
            "early_stopping": config.get("early_stopping", {}),
        }

        def run():
            result = train_model(
                model, data["train_loader"], data["val_loader"],
                data["task_type"], config, socketio,
                input_dim=data["input_dim"], output_dim=data["output_dim"],
            )
            # `result` is None if training was stopped before completion.
            if not result:
                return

            _state["last_weights_file"] = result["weight_filename"]

            # Persist a Project record if the run was started by a logged-in user.
            if owner_user_id is not None:
                with app.app_context():
                    user = User.query.get(owner_user_id)
                    if user is None:
                        return  # user deleted mid-train; drop the record
                    proj = Project(
                        user_id=owner_user_id,
                        name=config.get("project_name", "VortexProject"),
                        arch_type=config["arch_type"],
                        layer_sizes=_json.dumps(config["layer_sizes"]),
                        epochs=config["epochs"],
                        lr=float(config["lr"]),
                        batch_size=config["batch_size"],
                        optimizer=config.get("optimizer", "adam"),
                        activation=config.get("activation", "relu"),
                        early_stopping=_json.dumps(config.get("early_stopping") or {}),
                        task_type=result["task_type"],
                        input_dim=result["input_dim"],
                        output_dim=result["output_dim"],
                        final_train_loss=result["final_train_loss"],
                        final_val_loss=result["final_val_loss"],
                        final_val_acc=result.get("final_val_acc"),
                        early_stopped=result["early_stopped"],
                        stopped_epoch=result.get("stopped_epoch"),
                        history=_json.dumps(result["history"]),
                        weight_filename=result["weight_filename"],
                    )
                    db.session.add(proj)
                    db.session.commit()

        thread = socketio.start_background_task(run)
        _state["training_thread"] = thread

        return jsonify({"status": "started", "info": training_info})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/training/stop", methods=["POST"])
def stop_training_route():
    stop_training()
    return jsonify({"status": "stopped"})


@app.route("/api/state/reset", methods=["POST"])
def reset_state():
    """
    Clear in-memory app state. Accepts JSON body {"scope": "dataset"|"model"|"all"}.
    Default scope is "all". Uploaded files on disk are left untouched.
    """
    data = request.get_json(silent=True) or {}
    scope = data.get("scope", "all")
    if scope not in ("dataset", "model", "all"):
        return jsonify({"error": "scope must be one of: dataset, model, all"}), 400

    if scope in ("dataset", "all"):
        _state["dataset_file"] = None
        _state["dataset_path"] = None
        _state["dataset_info"] = None
        _state["feature_cols"] = []
        _state["target_col"] = None

    if scope in ("model", "all"):
        _state["model_config"] = None
        _state["project_name"] = "VortexProject"
        _state["last_weights_file"] = None

    return jsonify({"status": "ok", "scope": scope})


@app.route("/api/state", methods=["GET"])
def get_state():
    """Return current app state for page resumption."""
    return jsonify({
        "has_dataset": _state["dataset_path"] is not None,
        "dataset_file": _state["dataset_file"],
        "has_features": len(_state["feature_cols"]) > 0,
        "feature_cols": _state["feature_cols"],
        "target_col": _state["target_col"],
        "has_model": _state["model_config"] is not None,
        "model_config": _state["model_config"],
        "last_weights_file": _state["last_weights_file"],
    })


# ─────────────────────────────────────────────────────────
# Weights API
# ─────────────────────────────────────────────────────────
@app.route("/api/weights/download", methods=["GET"])
def download_weights_redirect():
    """Redirect to the named download URL."""
    filename = _state.get("last_weights_file")
    if not filename:
        return jsonify({"error": "No weights file available"}), 404
    return jsonify({"redirect": f"/api/weights/file/{filename}", "filename": filename})


@app.route("/api/weights/file/<filename>", methods=["GET"])
def download_weights_file(filename):
    """Download a specific weights file by name."""
    # Ensure it ends with .pt for safety
    if not filename.endswith(".pt"):
        return jsonify({"error": "Invalid filename"}), 400
    filepath = os.path.join(WEIGHTS_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({"error": "Weights file not found on disk"}), 404

    with open(filepath, "rb") as f:
        data = f.read()
    response = make_response(data)
    response.headers["Content-Type"] = "application/octet-stream"
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    response.headers["Content-Length"] = len(data)
    return response


@app.route("/api/weights/upload", methods=["POST"])
def upload_weights():
    """Upload a .pt weights file and parse its filename to extract architecture config."""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if file.filename == "" or not file.filename.endswith(".pt"):
        return jsonify({"error": "Only .pt weight files are supported"}), 400

    try:
        # Save the file
        filepath = os.path.join(WEIGHTS_DIR, file.filename)
        file.save(filepath)

        # Parse config from filename
        config = parse_weight_filename(file.filename)

        # Validate architecture exists
        if config["arch_type"] not in MODEL_REGISTRY:
            return jsonify({"error": f"Unknown architecture in weights: {config['arch_type']}"}), 400

        # Store in state
        _state["last_weights_file"] = file.filename
        _state["project_name"] = config.get("project_name", "VortexProject")
        _state["model_config"] = config

        return jsonify({
            "status": "ok",
            "filename": file.filename,
            "config": config,
        })
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Failed to parse weights: {str(e)}"}), 500


# ─────────────────────────────────────────────────────────
# Projects API (logged-in user only)
# ─────────────────────────────────────────────────────────
def _require_user():
    """Return the current logged-in User or (None, error response)."""
    user_id = session.get("user_id")
    if not user_id:
        return None, (jsonify({"error": "Not authenticated"}), 401)
    user = User.query.get(user_id)
    if not user:
        session.pop("user_id", None)
        return None, (jsonify({"error": "User not found"}), 404)
    return user, None


@app.route("/api/projects", methods=["GET"])
def list_projects():
    user, err = _require_user()
    if err:
        return err
    projs = (Project.query
             .filter_by(user_id=user.id)
             .order_by(Project.created_at.desc())
             .all())
    return jsonify({"projects": [p.to_dict() for p in projs]})


@app.route("/api/projects/<int:project_id>", methods=["GET"])
def get_project(project_id):
    user, err = _require_user()
    if err:
        return err
    proj = Project.query.filter_by(id=project_id, user_id=user.id).first()
    if not proj:
        return jsonify({"error": "Project not found"}), 404
    return jsonify({"project": proj.to_dict(include_history=True)})


@app.route("/api/projects/<int:project_id>", methods=["DELETE"])
def delete_project(project_id):
    user, err = _require_user()
    if err:
        return err
    proj = Project.query.filter_by(id=project_id, user_id=user.id).first()
    if not proj:
        return jsonify({"error": "Project not found"}), 404

    # Remove the weight file if no other project references it.
    filename = proj.weight_filename
    db.session.delete(proj)
    db.session.commit()

    still_referenced = Project.query.filter_by(weight_filename=filename).first()
    if not still_referenced:
        filepath = os.path.join(WEIGHTS_DIR, filename)
        if os.path.exists(filepath):
            try:
                os.remove(filepath)
            except OSError:
                pass  # ignore disk errors — record is gone, file can be cleaned later

    return jsonify({"status": "deleted"})


@app.route("/api/projects/<int:project_id>/load", methods=["POST"])
def load_project(project_id):
    """Restore a project's config + weights as the current in-memory state."""
    user, err = _require_user()
    if err:
        return err
    proj = Project.query.filter_by(id=project_id, user_id=user.id).first()
    if not proj:
        return jsonify({"error": "Project not found"}), 404

    cfg = {
        "arch_type": proj.arch_type,
        "layer_sizes": _json.loads(proj.layer_sizes),
        "epochs": proj.epochs,
        "lr": proj.lr,
        "batch_size": proj.batch_size,
        "optimizer": proj.optimizer,
        "activation": proj.activation,
        "project_name": proj.name,
        "early_stopping": _json.loads(proj.early_stopping) if proj.early_stopping else {},
    }
    _state["model_config"] = cfg
    _state["project_name"] = proj.name
    _state["last_weights_file"] = proj.weight_filename

    return jsonify({"status": "ok", "config": cfg, "weight_filename": proj.weight_filename})


# ─────────────────────────────────────────────────────────
# Courses API
# ─────────────────────────────────────────────────────────
MOCK_COURSES = [
    {
        "id": "intro-nn",
        "title": "Introduction to Neural Networks",
        "type": "text",
        "description": "Learn the mathematics, history, and intuition behind neural networks.",
        "duration": "25 min",
        "tags": ["Beginner", "Theory", "History"],
        "content": r"""# Introduction to Neural Networks

Neural networks are computing systems inspired by the biological neural networks that constitute animal brains. They are the backbone of modern Deep Learning, powering everything from voice assistants to autonomous vehicles.

## 🏛️ A Brief History

The history of neural networks spans several decades, marked by periods of intense hype followed by "AI winters":

*   **1943: The McCulloch-Pitts Neuron.** Warren McCulloch and Walter Pitts created a computational model for neural networks based on mathematics and algorithms.
*   **1958: The Perceptron.** Frank Rosenblatt created the Perceptron, an algorithm for pattern recognition based on a two-layer learning computer network. It generated massive hype but was later shown by Minsky and Papert (1969) to be incapable of solving non-linear problems like XOR.
*   **1986: Backpropagation.** Geoffrey Hinton, David Rumelhart, and Ronald Williams popularized the backpropagation algorithm, allowing multi-layer networks to be trained efficiently.
*   **2012: The Deep Learning Boom.** Alex Krizhevsky and his team won the ImageNet competition using a deep convolutional neural network (AlexNet) trained on GPUs, crushing traditional machine learning methods and sparking the current AI revolution.

## 🧮 The Mathematics: Forward and Backward Propagation

### 1. Forward Propagation (The Prediction)

A single neuron takes inputs $x_i$, multiplies them by weights $w_i$, sums them up, adds a bias $b$, and passes the result through an activation function $\sigma$ (like ReLU or Sigmoid).

Mathematically, for a single layer:
$$Z = WX + b$$
$$A = \sigma(Z)$$

Where $W$ is the weight matrix, $X$ is the input vector, $b$ is the bias vector, and $A$ is the activation output.

### 2. Loss Function (The Error)

We need to measure how wrong our prediction was. A common choice for regression is Mean Squared Error (MSE):
$$Loss = \frac{1}{n} \sum (y_{true} - y_{pred})^2$$

### 3. Backpropagation (The Learning)

To minimize the loss, we need to know how to adjust the weights. We use calculus (the Chain Rule) to find the gradient of the loss with respect to each weight.

$$\frac{\partial Loss}{\partial W} = \frac{\partial Loss}{\partial A} \cdot \frac{\partial A}{\partial Z} \cdot \frac{\partial Z}{\partial W}$$

We then update the weights using an optimizer (like Gradient Descent or Adam) and a learning rate $\eta$:
$$W_{new} = W_{old} - \eta \cdot \frac{\partial Loss}{\partial W}$$

## 💻 Code Example (PyTorch)

Here is how you define a simple Neural Network layer in PyTorch:

```python
import torch
import torch.nn as nn

class SimpleNeuron(nn.Module):
    def __init__(self, input_features):
        super().__init__()
        # nn.Linear automatically initializes Weights (W) and bias (b)
        self.linear = nn.Linear(in_features=input_features, out_features=1)
        # Activation function
        self.relu = nn.ReLU()
        
    def forward(self, x):
        # Z = WX + b
        z = self.linear(x)
        # A = sigma(Z)
        a = self.relu(z)
        return a

# Create input tensor
x = torch.randn(1, 5) # 1 sample, 5 features
model = SimpleNeuron(5)
output = model(x)
print(output)
```

## 🌐 Architectures available in Vortex ML
Proceed to our specialized courses for a deep dive into the architectures we support:
*   Multi-Layer Perceptron (MLP) & Deep Neural Networks (DNN)
*   1D Convolutional Neural Networks (CNN-1D)
*   Recurrent Neural Networks (RNN, LSTM, GRU)
*   Autoencoders (AE)
*   Residual Networks (ResNet)
*   Transformers
*   Wide & Deep Networks
"""
    },
    {
        "id": "course-mlp-dnn",
        "title": "MLP & Deep Neural Networks",
        "type": "text",
        "description": "Master classic feedforward networks: Multi-Layer Perceptrons and DNNs.",
        "duration": "15 min",
        "tags": ["Architecture", "Fundamentals"],
        "content": r"""# Multi-Layer Perceptrons (MLP) and Deep Neural Networks (DNN)

## The Multi-Layer Perceptron (MLP)
An MLP is the quintessential deep learning architecture. It consists of multiple layers of nodes in a directed graph, with each layer fully connected to the next one. 

### Why do we need hidden layers?
A single-layer perceptron can only learn linearly separable patterns. By adding hidden layers with non-linear activation functions (like ReLU), an MLP becomes a **Universal Function Approximator**—capable of approximating any continuous function, allowing it to solve complex, non-linear problems XOR.

## Deep Neural Networks (DNN)
A DNN is essentially an MLP with many hidden layers. However, simply stacking layers leads to problems like vanishing gradients and overfitting. 

In modern DNNs, we introduce specific layers to stabilize training:
1.  **Batch Normalization (`nn.BatchNorm1d`)**: Normalizes the activations of the previous layer at each batch, stabilizing the learning process and significantly accelerating training.
2.  **Dropout (`nn.Dropout`)**: Randomly zeroes some of the elements of the input tensor with probability $p$ during training. This prevents complex co-adaptations on training data (preventing overfitting).

## 💻 PyTorch Implementation inside Vortex ML

```python
import torch.nn as nn

class DNNModel(nn.Module):
    def __init__(self, input_dim, output_dim, layer_sizes, dropout=0.3):
        super().__init__()
        layers = []
        prev = input_dim
        
        for size in layer_sizes:
            layers.append(nn.Linear(prev, size))
            layers.append(nn.BatchNorm1d(size))  # Stabilize training
            layers.append(nn.ReLU())             # Non-linearity
            layers.append(nn.Dropout(dropout))   # Prevent overfitting
            prev = size
            
        layers.append(nn.Linear(prev, output_dim))
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x)
```
"""
    },
    {
        "id": "course-cnn1d",
        "title": "1D Convolutional Networks",
        "type": "text",
        "description": "Learn how convolutions apply to sequential and tabular feature data.",
        "duration": "20 min",
        "tags": ["Architecture", "Pattern Recognition"],
        "content": r"""# 1D Convolutional Neural Networks (CNN-1D)

While 2D CNNs are famous for image processing, **1D CNNs** are incredibly effective for sequential data, time series, and even tabular data where local feature interactions exist.

## The Mathematics of Convolutions
Instead of a matrix multiplying every input across the entire layer (dense layer), a convolution uses a small, sliding **Kernel** (or filter).

Mathematically, a 1D convolution operation is defined as:
$$(f * g)[n] = \sum_{m=-M}^{M} f[m] \cdot g[n-m]$$
Where $f$ is our input vector, $g$ is our kernel vector, and $n$ is the current position.

### Why Convolutions?
1.  **Local Receptive Field:** Kernels only look at a tiny window of features at a time. This allows the network to learn "patterns" (e.g., a sudden spike in price).
2.  **Weight Sharing:** The same kernel slides over the whole sequence. This drastically reduces the number of parameters needed compared to an MLP.

## 💻 PyTorch Implementation inside Vortex ML

In tabular data, we treat the input feature vector as a sequence of length $N$ with $1$ channel.

```python
import torch.nn as nn

class CNN1DModel(nn.Module):
    def __init__(self, input_dim, output_dim, layer_sizes):
        super().__init__()
        
        conv_layers = []
        in_channels = 1 # Treat tabular data as a 1D sequence
        
        for out_channels in layer_sizes:
            # kernel_size=3 means the filter looks at 3 features at a time
            conv_layers.append(
                nn.Conv1d(in_channels, out_channels, kernel_size=3, padding=1)
            )
            conv_layers.append(nn.ReLU())
            in_channels = out_channels
            
        self.conv = nn.Sequential(*conv_layers)
        # Flatten the channels and features for the final prediction
        self.fc = nn.Linear(in_channels * input_dim, output_dim)

    def forward(self, x):
        # Reshape: (batch_size, channels, sequence_length) -> (batch, 1, features)
        x = x.unsqueeze(1)  
        x = self.conv(x)     
        x = x.view(x.size(0), -1) # Flatten
        return self.fc(x)
```
"""
    },
    {
        "id": "course-rnn-lstm-gru",
        "title": "Sequences: RNN, LSTM, GRU",
        "type": "text",
        "description": "Dive into Recurrent networks and memory mechanism architectures.",
        "duration": "25 min",
        "tags": ["Architecture", "Time-Series", "Memory"],
        "content": r"""# Recurrent Architectures (RNN, LSTM, GRU)

Feedforward networks (like MLPs) have no memory. They process each input independently. Recurrent Neural Networks (RNNs) address this by maintaining a hidden state $h_t$ that carries information across time steps.

## Vanilla RNN
An RNN processes sequences step-by-step. At time $t$, it combines the current input $x_t$ with the previous hidden state $h_{t-1}$:

$$h_t = \tanh(W_{hh}h_{t-1} + W_{xh}x_t + b)$$

**The Flaw**: Vanilla RNNs suffer terribly from the **Vanishing Gradient Problem**. Over long sequences, the gradients multiplied during backpropagation shrink to zero, making the network "forget" early inputs.

## Long Short-Term Memory (LSTM)
LSTMs solve the vanishing gradient problem by introducing a **Cell State** ($C_t$) and three "Gates" that regulate information flow:
1.  **Forget Gate**: Decides what information to throw away from the cell state.
2.  **Input Gate**: Decides which new values to update in the cell state.
3.  **Output Gate**: Decides what the next hidden state should be based on the cell state.

Because the cell state acts like a highway strictly controlled by gates, gradients flow easily without vanishing.

## Gated Recurrent Unit (GRU)
GRUs are a newer variation on LSTMs. They combine the forget and input gates into a single "Update Gate" and merge the cell state and hidden state. They perform similarly to LSTMs but are computationally cheaper because they have fewer parameters.

## 💻 PyTorch Implementation inside Vortex ML

```python
import torch.nn as nn

class LSTMModel(nn.Module):
    def __init__(self, input_dim, output_dim, layer_sizes):
        super().__init__()
        hidden_size = layer_sizes[0] if layer_sizes else 64
        num_layers = len(layer_sizes) if layer_sizes else 1
        
        # PyTorch provides optimized LSTM implementations
        self.lstm = nn.LSTM(
            input_size=input_dim, 
            hidden_size=hidden_size,
            num_layers=num_layers, 
            batch_first=True
        )
        self.fc = nn.Linear(hidden_size, output_dim)

    def forward(self, x):
        # We treat tabular data as a sequence of length 1: (batch, seq_len=1, features)
        x = x.unsqueeze(1)
        
        # LSTM returns: output, (hidden_state, cell_state)
        # We only care about the output from the final sequence step: [:, -1, :]
        out, (h_n, c_n) = self.lstm(x)
        return self.fc(out[:, -1, :])
```
"""
    },
    {
        "id": "course-autoencoders",
        "title": "Autoencoders & Bottlenecks",
        "type": "text",
        "description": "Learn representation learning through Encoders and Decoders.",
        "duration": "15 min",
        "tags": ["Architecture", "Unsupervised", "Anomaly Detection"],
        "content": r"""# Autoencoders (AE)

Autoencoders are an unsupervised learning technique where neural networks are trained to copy their input to their output. 

## The Bottleneck
If we simply made a wide network, it would trivially learn the identity function ($output = input$). Autoencoders force the data through an information **bottleneck**. 

The architecture consists of two parts:
1.  **Encoder**: Compresses the input $x$ into a latent-space representation $z$ (a lower-dimensional feature vector).
2.  **Decoder**: Reconstructs the input $x'$ from the latent space $z$.

By forcing the network to compress and reconstruct, it is forced to learn the most salient, underlying features of the training data.

### Use Cases in Tabular Data
*   **Dimensionality Reduction**: Like PCA, but non-linear and much more powerful.
*   **Anomaly Detection**: If an Autoencoder is trained entirely on "normal" data, it will accurately reconstruct normal rows. If you pass an anomalous/fraudulent row, the reconstruction error will be massively high, raising a flag.

## 💻 PyTorch Implementation inside Vortex ML

```python
import torch.nn as nn

class AutoencoderModel(nn.Module):
    def __init__(self, input_dim, output_dim, layer_sizes):
        super().__init__()
        
        # ENCODER: Compresses down to the latent space (bottleneck)
        enc_layers = []
        prev = input_dim
        for size in layer_sizes:
            enc_layers.append(nn.Linear(prev, size))
            enc_layers.append(nn.ReLU())
            prev = size
        self.encoder = nn.Sequential(*enc_layers)

        # DECODER: Reconstructs back to original input dimension
        dec_layers = []
        for size in reversed(layer_sizes[:-1]):
            dec_layers.append(nn.Linear(prev, size))
            dec_layers.append(nn.ReLU())
            prev = size
        dec_layers.append(nn.Linear(prev, input_dim))
        self.decoder = nn.Sequential(*dec_layers)

        # PREDICTION HEAD: Uses the compressed latent vector for the actual task
        latent_dim = layer_sizes[-1] if layer_sizes else input_dim
        self.head = nn.Linear(latent_dim, output_dim)

    def forward(self, x):
        # Predict target based on compressed latent representation
        encoded = self.encoder(x)
        return self.head(encoded)

    def reconstruct(self, x):
        # Utility method for Anomaly Detection (not used directly in standard forward)
        return self.decoder(self.encoder(x))
```
"""
    },
     {
        "id": "course-resnet",
        "title": "Residual Networks (ResNet)",
        "type": "text",
        "description": "Master Skip Connections designed to train ultra-deep networks.",
        "duration": "18 min",
        "tags": ["Architecture", "Deep Learning"],
        "content": r"""# Residual Networks (ResNet)

As deep learning progressed, researchers realized that adding more layers didn't always improve performance. Often, **ultradeep networks performed worse** than shallow ones due to the vanishing gradient problem.

In 2015, Kaiming He introduced ResNets, altering the fundamental architecture of neural networks and winning every major AI competition that year.

## The Skip Connection

The core idea of a ResNet is the **Residual Block**. Instead of layers learning the desired underlying mapping directly, they are forced to learn a **residual** (the difference) from the identity mapping.

This is achieved via "Skip Connections" or "Shortcut Connections", where the input to a block is added the block's output:
$$y = F(x) + x$$

Where $F(x)$ represents the stacked non-linear layers.

**Why is this brilliant?**
1.  If the optimal mapping is closer to an identity mapping, it is easier for the network to push the non-linear weights to zero ($F(x) = 0$).
2.  **Gradient Superhighways:** During backpropagation, the gradients can flow completely unimpeded along the skip connection ($+x$). This explicitly solves the vanishing gradient problem, allowing networks with *thousands* of layers to easily train.

## 💻 PyTorch Implementation inside Vortex ML

While famous for CNNs on images, this paradigm is equally powerful for dense MLPs on tabular data.

```python
import torch.nn as nn

class ResidualBlock(nn.Module):
    def __init__(self, dim, dropout=0.1):
        super().__init__()
        # F(x) path
        self.block = nn.Sequential(
            nn.Linear(dim, dim),
            nn.BatchNorm1d(dim),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(dim, dim),
            nn.BatchNorm1d(dim),
        )
        self.act = nn.ReLU()

    def forward(self, x):
        # y = F(x) + x
        return self.act(self.block(x) + x)

class ResNetModel(nn.Module):
    def __init__(self, input_dim, output_dim, layer_sizes):
        super().__init__()
        hidden = layer_sizes[0] if layer_sizes else 64
        
        # Project inputs to the hidden dimension size
        self.input_proj = nn.Linear(input_dim, hidden)
        
        # Stack Residual blocks based on layer configurations
        self.blocks = nn.Sequential(
            *[ResidualBlock(hidden) for _ in layer_sizes]
        )
        self.head = nn.Linear(hidden, output_dim)

    def forward(self, x):
        x = self.input_proj(x)
        x = self.blocks(x)
        return self.head(x)
```
"""
    },
    {
        "id": "course-transformers",
        "title": "Transformers & Attention",
        "type": "text",
        "description": "Understand Attention mechanisms, the foundation of modern LLMs.",
        "duration": "30 min",
        "tags": ["Architecture", "State of the Art"],
        "content": r"""# Transformers and Attention Mechanisms

Introduced in the seminal 2017 paper *"Attention Is All You Need"*, Transformers completely usurped RNNs and LSTMs, leading directly to the creation of GPT, BERT, and the modern generative AI era.

## The Problem with RNNs
RNNs compress entire sequences into a single fixed-size bottleneck vector (the hidden state). They also process data sequentially, which makes them incredibly slow to train on GPUs since computation cannot be parallelized.

## The Solution: Self-Attention
Transformers throw out recurrence entirely. Instead, they look at the *entire* sequence at once and compute an **Attention Score**.
For every word (or feature), Self-Attention asks: *How important is every other feature in the sequence for understanding this specific feature?*

### The Math: Scaled Dot-Product Attention
Inputs are multiplied by learned weight matrices to create three vectors for each feature:
*   **Query ($Q$)**: What am I looking for?
*   **Key ($K$)**: What do I represent?
*   **Value ($V$)**: If I am what you're looking for, here is my information.

$$Attention(Q, K, V) = softmax\left(\frac{QK^T}{\sqrt{d_k}}\right)V$$
Where $d_k$ is the dimension of the keys, scaling the dot product down so gradients don't vanish inside the softmax function.

## 💻 PyTorch Implementation inside Vortex ML

While famous for NLP, Attention performs brilliantly on tabular data by dynamically weighting the importance of different columns for each specific row.

```python
import torch.nn as nn

class TransformerModel(nn.Module):
    def __init__(self, input_dim, output_dim, layer_sizes):
        super().__init__()
        d_model = layer_sizes[0] if layer_sizes else 64
        
        # Multi-Head Attention requires d_model to be divisible by n_heads
        n_heads = max(1, d_model // 16)
        d_model = n_heads * (d_model // n_heads) 
        num_layers = len(layer_sizes) if layer_sizes else 1

        # Project flat tabular features into the embedding dimension
        self.input_proj = nn.Linear(input_dim, d_model)
        
        # PyTorch provides optimized Transformer logic
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model, 
            nhead=n_heads, 
            dim_feedforward=d_model * 4,
            dropout=0.1, 
            batch_first=True
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)
        self.head = nn.Linear(d_model, output_dim)

    def forward(self, x):
        # Add a dummy sequence dimension: (batch, 1, d_model)
        x = self.input_proj(x).unsqueeze(1)  
        
        # Self-Attention is computed here
        x = self.transformer(x)
        
        # Extract the sequence and predict
        return self.head(x[:, 0, :])
```
"""
    },
    {
        "id": "course-wide-deep",
        "title": "Wide & Deep Networks",
        "type": "text",
        "description": "Combine memorization and generalization (invented by Google for Recommender systems).",
        "duration": "15 min",
        "tags": ["Architecture", "Production"],
        "content": r"""# Wide & Deep Networks

Originally developed by Google in 2016 for their Play Store Recommendation Engine, the Wide & Deep architecture elegantly solves a classic problem: how do we memorize specific sparse rules while still generalizing to unseen data?

## The Problem
*   **Linear Models (Wide)** are great at **memorization**. For example, they can strongly learn the specific rule: `IF user_searches="Fried Chicken" AND user_city="KFC" THEN predict=High_CTR`. However, they fail to generalize to unseen combinations.
*   **Deep Neural Networks (Deep)** are great at **generalization** by learning dense feature embeddings. However, they can sometimes overdraw generalized conclusions and ignore highly specific, perfectly correlated rule exceptions.

## The Solution: Combine Them
A Wide & Deep Network trains both architectures synchronously.

1.  **The Wide Part**: A simple linear layer connecting input features directly to the output node.
2.  **The Deep Part**: A stacked MLP.

Their outputs are simply summed before the final prediction.

## 💻 PyTorch Implementation inside Vortex ML

```python
import torch.nn as nn

class WideDeepModel(nn.Module):
    def __init__(self, input_dim, output_dim, layer_sizes):
        super().__init__()
        
        # 1. WIDE PATH: Direct linear mapping (Memorization)
        self.wide = nn.Linear(input_dim, output_dim)

        # 2. DEEP PATH: Multi-Layer Perceptron (Generalization)
        deep_layers = []
        prev = input_dim
        for size in layer_sizes:
            deep_layers.append(nn.Linear(prev, size))
            deep_layers.append(nn.ReLU())
            prev = size
        deep_layers.append(nn.Linear(prev, output_dim))
        
        self.deep = nn.Sequential(*deep_layers)

    def forward(self, x):
        # Simply sum the memorized output and the generalized output
        return self.wide(x) + self.deep(x)
```
"""
    }
]

@app.route("/api/courses", methods=["GET"])
def get_courses():
    # Return everything except the heavy content/transcript for the grid list
    summaries = []
    for c in MOCK_COURSES:
        summary = {k: v for k, v in c.items() if k not in ["content", "transcript", "video_url", "notebook_url"]}
        summaries.append(summary)
    return jsonify(summaries)

@app.route("/api/courses/<course_id>", methods=["GET"])
def get_course_detail(course_id):
    course = next((c for c in MOCK_COURSES if c["id"] == course_id), None)
    if not course:
        return jsonify({"error": "Course not found"}), 404
    return jsonify(course)

# ─────────────────────────────────────────────────────────
# SocketIO events
# ─────────────────────────────────────────────────────────
@socketio.on("connect")
def on_connect():
    print("Client connected")


@socketio.on("disconnect")
def on_disconnect():
    print("Client disconnected")


# ─────────────────────────────────────────────────────────
# Run
# ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5050, debug=True)
