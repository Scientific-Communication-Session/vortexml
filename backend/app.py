"""
Vortex ML — Main Flask Application
Routes, API endpoints, and SocketIO event handlers.
"""

import os
# Let Metal (MPS) defer any unsupported op to the CPU instead of erroring.
# Must be set before torch is imported (via training_engine, below).
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
import io
import re
import json
import uuid
import base64
import zipfile
import secrets
import threading
from datetime import datetime, timezone

from flask import Flask, request, jsonify, session, send_file, make_response
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room

import json as _json

import anthropic

from data_processor import save_uploaded_file, analyze_dataset, prepare_dataset
from training_engine import (
    create_model, train_model, stop_training, get_torch_device,
    MODEL_REGISTRY, parse_weight_filename, WEIGHTS_DIR,
)
from device_specs import detect_specs
from system_stats import SystemMonitor
from models import db, User, Project, Device

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
    app.config['SQLALCHEMY_DATABASE_URI'] = 'postgresql://andrei:2006@localhost:5432/vortex_db'
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

# `max_http_buffer_size` is bumped so node agents can ship datasets and
# trained weights to/from the server as base64 payloads over the socket.
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet",
                    max_http_buffer_size=100 * 1024 * 1024)

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Public URL the node agents dial back into. The Cloudflare tunnel for this is
# vortexml.andreinita.com → :5173 (Vite), which proxies /api and /socket.io.
PUBLIC_URL = os.environ.get("VORTEX_PUBLIC_URL", "https://vortexml.andreinita.com")
NODE_BUNDLE_DIR = os.path.join(os.path.dirname(__file__), "node_bundle")

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

# ── Device / remote-training runtime registries (this is a single process) ──
_nodes = {}        # device_id -> {"sid": <node socket id>}
_node_sids = {}    # node socket id -> device_id   (reverse lookup on disconnect)
_jobs = {}         # job_id -> live job dict (epoch/eta/room/owner/config)
_device_busy = {}  # device_id -> job_id   (which job currently occupies it)


def _utcnow():
    """Naive UTC datetime, matching the db.DateTime columns in models.py."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


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
    """Kick off a training run on the chosen device.

    Body: {"device_id": <int|null>, "socket_id": <str>}.
    A null/absent device_id defaults to the shared M4. When the device is the
    shared M4 the run happens here; when it's a personal node the job is
    dispatched to that node's agent and its updates are relayed back.
    """
    if not _state["dataset_path"]:
        return jsonify({"error": "No dataset uploaded"}), 400
    if not _state["feature_cols"] or not _state["target_col"]:
        return jsonify({"error": "Dataset not configured (features/target)"}), 400
    if not _state["model_config"]:
        return jsonify({"error": "Model not configured"}), 400

    body = request.get_json(silent=True) or {}
    device_id = body.get("device_id")
    socket_id = body.get("socket_id")

    # Resolve the target device (a null device_id means the shared M4).
    if device_id is None:
        device = Device.query.filter_by(is_shared=True).first()
    else:
        device = Device.query.get(device_id)
    if device is None:
        return jsonify({"error": "Device not found"}), 404

    # A personal node is only usable by the account it's linked to.
    owner_user_id = session.get("user_id")
    if not device.is_shared and device.user_id != owner_user_id:
        return jsonify({"error": "That device is not linked to your account"}), 403

    if _device_busy.get(device.id):
        return jsonify({"error": f"'{device.nickname}' is already training. Pick another device."}), 409

    config = _state["model_config"]
    job_id = uuid.uuid4().hex[:12]
    room = f"job:{job_id}"

    # Put the requesting browser into the job room *before* training starts so
    # it cannot miss the first epochs.
    _join_job_room(socket_id, room)

    job = {
        "job_id": job_id,
        "device_id": device.id,
        "is_local": device.is_shared,
        "owner_user_id": owner_user_id,
        "project_name": config.get("project_name", "VortexProject"),
        "config": config,
        "room": room,
        "epoch": 0,
        "total_epochs": config.get("epochs", 50),
        "eta_seconds": None,
        "started_at": _utcnow().isoformat() + "Z",
    }

    if device.is_shared:
        # ── Local training on the central M4 ──
        try:
            data = prepare_dataset(
                _state["dataset_path"], _state["feature_cols"],
                _state["target_col"], batch_size=config["batch_size"],
            )
            model = create_model(
                config["arch_type"], config["layer_sizes"],
                data["input_dim"], data["output_dim"],
                activation=config.get("activation", "relu"),
            )
        except Exception as e:
            return jsonify({"error": str(e)}), 500

        torch_device = get_torch_device()
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
            "device": str(torch_device),
        }

        _jobs[job_id] = job
        _device_busy[device.id] = job_id

        def run():
            # Stream CPU/GPU/RAM + temps for this machine while it trains.
            monitor = SystemMonitor(
                emit_fn=lambda s: socketio.emit("system_stats", s, room=room),
                sleep_fn=socketio.sleep,
            )
            socketio.start_background_task(monitor.loop)
            try:
                result = train_model(
                    model, data["train_loader"], data["val_loader"],
                    data["task_type"], config, socketio,
                    input_dim=data["input_dim"], output_dim=data["output_dim"],
                    device=torch_device, room=room,
                )
            except Exception as e:
                socketio.emit("training_error", {"message": str(e)}, room=room)
                result = None
            finally:
                monitor.stop()
            if result:
                _state["last_weights_file"] = result["weight_filename"]
                _persist_project(owner_user_id, config, result)
            _finish_job(job_id)
            _cleanup_dataset()

        socketio.emit("training_info", training_info, room=room)
        thread = socketio.start_background_task(run)
        _state["training_thread"] = thread
        return jsonify({"status": "started", "job_id": job_id, "mode": "local",
                        "device": device.to_dict(), "info": training_info})

    # ── Remote training on the user's own node ──
    node = _nodes.get(device.id)
    if not node:
        return jsonify({"error": f"'{device.nickname}' is offline. Start its node agent and try again."}), 409

    try:
        with open(_state["dataset_path"], "rb") as f:
            csv_b64 = base64.b64encode(f.read()).decode()
    except Exception as e:
        return jsonify({"error": f"Could not read dataset: {e}"}), 500

    _jobs[job_id] = job
    _device_busy[device.id] = job_id

    socketio.emit("node_run_job", {
        "job_id": job_id,
        "config": config,
        "feature_cols": _state["feature_cols"],
        "target_col": _state["target_col"],
        "dataset_name": _state["dataset_file"],
        "csv_b64": csv_b64,
    }, room=node["sid"])

    return jsonify({"status": "started", "job_id": job_id, "mode": "remote",
                    "device": device.to_dict()})


@app.route("/api/training/stop", methods=["POST"])
def stop_training_route():
    body = request.get_json(silent=True) or {}
    job_id = body.get("job_id")
    job = _jobs.get(job_id) if job_id else None
    # If the caller didn't say which job, and exactly one is running, stop that.
    if job is None and len(_jobs) == 1:
        job = next(iter(_jobs.values()))

    if job is None:
        stop_training()  # nothing tracked — still poke the local stop flag
        return jsonify({"status": "stopped"})

    if job["is_local"]:
        stop_training()
    else:
        node = _nodes.get(job["device_id"])
        if node:
            socketio.emit("node_stop", {"job_id": job["job_id"]}, room=node["sid"])
    return jsonify({"status": "stopping"})


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
# Devices & Remote Training
# ─────────────────────────────────────────────────────────
def _join_job_room(socket_id, room):
    """Add a browser's socket to a job room so it receives that run's events."""
    if not socket_id:
        return False
    try:
        socketio.server.enter_room(socket_id, room, namespace="/")
        return True
    except Exception as e:
        print(f"[devices] enter_room failed for {socket_id}: {e}")
        return False


def _cleanup_dataset():
    """Delete the uploaded dataset once a run ends.

    Datasets are never persisted — only the trained weights and the run's
    stats are kept. This wipes the file from the central M4 and clears state.
    """
    path = _state.get("dataset_path")
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass
    _state["dataset_file"] = None
    _state["dataset_path"] = None
    _state["dataset_info"] = None
    _state["feature_cols"] = []
    _state["target_col"] = None


def _finish_job(job_id):
    """Drop a finished job and free its device."""
    job = _jobs.pop(job_id, None)
    if job:
        _device_busy.pop(job["device_id"], None)


def _persist_project(owner_user_id, config, result):
    """Save a completed run as a Project row (weights + stats, no dataset)."""
    if owner_user_id is None:
        return
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


def _device_runtime(device):
    """Live, non-persisted status for a device: online / available / busy."""
    busy_job_id = _device_busy.get(device.id)
    job = _jobs.get(busy_job_id) if busy_job_id else None

    online = True if device.is_shared else (device.id in _nodes)
    status = "busy" if job else ("available" if online else "offline")

    rt = {"online": online, "status": status, "job": None}
    if job:
        rt["job"] = {
            "project_name": job.get("project_name"),
            "epoch": job.get("epoch", 0),
            "total_epochs": job.get("total_epochs", 0),
            "eta_seconds": job.get("eta_seconds"),
            "started_at": job.get("started_at"),
        }
    return rt


@app.route("/api/devices", methods=["GET"])
def list_devices():
    """The shared M4 (always) plus any nodes linked to the signed-in account."""
    user_id = session.get("user_id")
    devices = [d.to_dict(runtime=_device_runtime(d))
               for d in Device.query.filter_by(is_shared=True).all()]
    if user_id:
        owned = (Device.query.filter_by(user_id=user_id)
                 .order_by(Device.created_at).all())
        devices += [d.to_dict(runtime=_device_runtime(d)) for d in owned]
    return jsonify({"devices": devices})


@app.route("/api/devices", methods=["POST"])
def create_device():
    """Register a new personal node and mint its pairing token."""
    user, err = _require_user()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    nickname = ((data.get("nickname") or "").strip() or "My Device")[:80]
    dev = Device(
        user_id=user.id,
        nickname=nickname,
        token="vtx-" + secrets.token_urlsafe(32),
        is_shared=False,
    )
    db.session.add(dev)
    db.session.commit()
    return jsonify({"device": dev.to_dict(runtime=_device_runtime(dev))}), 201


@app.route("/api/devices/<int:device_id>", methods=["PATCH"])
def update_device(device_id):
    """Rename a personal node."""
    user, err = _require_user()
    if err:
        return err
    dev = Device.query.filter_by(id=device_id, user_id=user.id).first()
    if not dev:
        return jsonify({"error": "Device not found"}), 404
    data = request.get_json(silent=True) or {}
    nickname = (data.get("nickname") or "").strip()
    if nickname:
        dev.nickname = nickname[:80]
        db.session.commit()
    return jsonify({"device": dev.to_dict(runtime=_device_runtime(dev))})


@app.route("/api/devices/<int:device_id>", methods=["DELETE"])
def delete_device(device_id):
    """Unlink a personal node from the account."""
    user, err = _require_user()
    if err:
        return err
    dev = Device.query.filter_by(id=device_id, user_id=user.id).first()
    if not dev:
        return jsonify({"error": "Device not found"}), 404
    if _device_busy.get(dev.id):
        return jsonify({"error": "Device is busy training — stop the run first."}), 409
    node = _nodes.pop(dev.id, None)
    if node:
        _node_sids.pop(node["sid"], None)
    db.session.delete(dev)
    db.session.commit()
    return jsonify({"status": "deleted"})


@app.route("/api/devices/<int:device_id>/agent.zip", methods=["GET"])
def download_agent(device_id):
    """Download the node agent bundle for a personal device.

    The zip carries the device's pairing token in node_config.json, so it
    links that machine to this account and no other.
    """
    user, err = _require_user()
    if err:
        return err
    dev = Device.query.filter_by(id=device_id, user_id=user.id).first()
    if not dev:
        return jsonify({"error": "Device not found"}), 404
    if dev.is_shared:
        return jsonify({"error": "The shared device has no downloadable agent"}), 400

    backend_dir = os.path.dirname(__file__)
    node_config = {
        "central_url": PUBLIC_URL,
        "device_token": dev.token,
        "device_id": dev.id,
        "nickname": dev.nickname,
    }

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        # Static bundle files (agent script, launcher, deps, readme).
        for fn in ("node_agent.py", "run.sh", "requirements.txt", "README.txt"):
            p = os.path.join(NODE_BUNDLE_DIR, fn)
            if os.path.exists(p):
                z.write(p, arcname=fn)
        # Backend modules the agent reuses verbatim.
        for fn in ("training_engine.py", "data_processor.py", "device_specs.py",
                   "system_stats.py"):
            z.write(os.path.join(backend_dir, fn), arcname=fn)
        # Per-device config — the API key that pairs this machine to the account.
        z.writestr("node_config.json", _json.dumps(node_config, indent=2))

    buf.seek(0)
    safe_nick = re.sub(r"[^A-Za-z0-9_-]+", "-", dev.nickname).strip("-") or "device"
    resp = make_response(buf.read())
    resp.headers["Content-Type"] = "application/zip"
    resp.headers["Content-Disposition"] = (
        f'attachment; filename="vortexml-node-{safe_nick}.zip"')
    return resp


# ── Node-agent SocketIO protocol ──────────────────────────
@socketio.on("subscribe_job")
def on_subscribe_job(data):
    """A browser asks to receive a specific job's live events."""
    job_id = (data or {}).get("job_id")
    if job_id:
        join_room(f"job:{job_id}")


@socketio.on("node_register")
def on_node_register(data):
    """A node agent identifies itself with its pairing token + specs."""
    data = data or {}
    token = data.get("token")
    specs = data.get("specs") or {}
    dev = (Device.query.filter_by(token=token, is_shared=False).first()
           if token else None)
    if dev is None:
        emit("node_register_failed", {"error": "Unknown or revoked device token"})
        return
    _nodes[dev.id] = {"sid": request.sid}
    _node_sids[request.sid] = dev.id
    dev.specs = _json.dumps(specs)
    dev.last_seen = _utcnow()
    db.session.commit()
    print(f"[node] registered: device #{dev.id} '{dev.nickname}' (sid={request.sid})")
    emit("node_registered", {
        "device_id": dev.id,
        "nickname": dev.nickname,
        "accelerator_label": specs.get("accelerator_label", ""),
    })


@socketio.on("node_relay")
def on_node_relay(data):
    """Relay a node's training event to the browser watching that job."""
    data = data or {}
    job = _jobs.get(data.get("job_id"))
    if not job:
        return
    event = data.get("event")
    payload = data.get("data") or {}
    if event == "training_update":
        job["epoch"] = payload.get("epoch", job["epoch"])
        job["total_epochs"] = payload.get("total_epochs", job["total_epochs"])
        job["eta_seconds"] = payload.get("eta_seconds")
    socketio.emit(event, payload, room=job["room"])


@socketio.on("node_complete")
def on_node_complete(data):
    """A node finished a run: save the weights it shipped back, persist stats."""
    data = data or {}
    job = _jobs.get(data.get("job_id"))
    if not job:
        return
    meta = data.get("meta") or {}
    weight_filename = meta.get("weight_filename")
    weights_b64 = data.get("weights_b64")
    if weight_filename and weights_b64:
        try:
            with open(os.path.join(WEIGHTS_DIR, weight_filename), "wb") as f:
                f.write(base64.b64decode(weights_b64))
        except Exception as e:
            print(f"[node] failed to save weights {weight_filename}: {e}")
    _state["last_weights_file"] = weight_filename
    _persist_project(job["owner_user_id"], job["config"], meta)
    socketio.emit("training_complete", meta, room=job["room"])
    _finish_job(job["job_id"])
    _cleanup_dataset()


@socketio.on("node_stopped")
def on_node_stopped(data):
    job = _jobs.get((data or {}).get("job_id"))
    if not job:
        return
    socketio.emit("training_stopped", {}, room=job["room"])
    _finish_job(job["job_id"])
    _cleanup_dataset()


@socketio.on("node_error")
def on_node_error(data):
    data = data or {}
    job = _jobs.get(data.get("job_id"))
    if not job:
        return
    socketio.emit("training_error",
                  {"message": data.get("error", "Remote training failed")},
                  room=job["room"])
    _finish_job(job["job_id"])
    _cleanup_dataset()


def _seed_shared_device():
    """Ensure the shared M4 Mac Mini exists and its specs are up to date."""
    dev = Device.query.filter_by(is_shared=True).first()
    specs = detect_specs()
    if dev is None:
        dev = Device(
            nickname="VortexML M4 Mac Mini",
            token="vtx-shared-" + secrets.token_urlsafe(16),
            is_shared=True,
            user_id=None,
            specs=_json.dumps(specs),
        )
        db.session.add(dev)
    else:
        dev.specs = _json.dumps(specs)
    db.session.commit()
    print(f"[devices] shared device ready: '{dev.nickname}' "
          f"({specs.get('accelerator_label')})")


with app.app_context():
    _seed_shared_device()


# ─────────────────────────────────────────────────────────
# Novice-mode Chatbot
# ─────────────────────────────────────────────────────────
_anthropic_client = None


def _get_anthropic_client():
    """Lazily build the Anthropic client. ANTHROPIC_API_KEY comes from env."""
    global _anthropic_client
    if _anthropic_client is None:
        _anthropic_client = anthropic.Anthropic()
    return _anthropic_client


CHAT_SYSTEM_PROMPT = (
    "You are a friendly machine-learning tutor embedded in VortexML, a web app "
    "for training small neural networks on tabular data.\n\n"
    "Your audience is a beginner who has explicitly opted in to Novice mode. "
    "Help them understand:\n"
    "- Core ML concepts (epochs, loss, overfitting, learning rate, optimisers, "
    "  activation functions, train/val/test split, classification vs regression, etc.).\n"
    "- The VortexML app's tabs and features:\n"
    "  * Dataset tab — upload CSV / Excel, preview rows, pick which columns are\n"
    "    features (inputs) and which column is the target (what the model predicts).\n"
    "  * Architect tab — pick one of the 10 architectures (MLP, DNN, CNN-1D, RNN,\n"
    "    LSTM, GRU, Autoencoder, ResNet, Transformer, Wide & Deep), configure hidden\n"
    "    layer sizes and hyperparameters (epochs, learning rate, batch size, optimiser,\n"
    "    activation), and optionally enable Early Stopping.\n"
    "  * Training tab — live loss / accuracy chart and a network visualisation while\n"
    "    the model trains; saves a .pt weights file when finished.\n"
    "  * Profile tab — saved projects, each with its config + weights, downloadable\n"
    "    or reloadable into the Architect.\n"
    "- Picking reasonable defaults for a first run (e.g. MLP, layers [32,16], 20 epochs,\n"
    "  Adam, lr 0.001, batch size 32, ReLU activation).\n\n"
    "Guidelines:\n"
    "- Keep answers short: 2-4 short paragraphs, plain prose, minimal code unless asked.\n"
    "- Use simple language. Define jargon when you introduce it.\n"
    "- Be encouraging and make concrete recommendations rather than hedging.\n"
    "- If a question is unrelated to ML or VortexML, politely steer back.\n"
    "- Never invent VortexML features that aren't in the list above."
)

# Limits to keep cost + latency predictable
_CHAT_MAX_HISTORY = 20         # last N turns we'll forward to Claude
_CHAT_MAX_MESSAGE_CHARS = 4000  # per-message cap (silently truncated)
_CHAT_MAX_TOKENS = 1024         # cap on the assistant's reply


def _chatbot_available_reason(user):
    """Return None if the chatbot is available for this user, else a 'why not' string."""
    if not user.is_beginner:
        return "Chatbot is only available in Novice mode."
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return "Chatbot is not configured. The admin must set ANTHROPIC_API_KEY."
    return None


@app.route("/api/chat/status", methods=["GET"])
def chat_status():
    user, err = _require_user()
    if err:
        return err
    reason = _chatbot_available_reason(user)
    if reason:
        return jsonify({"available": False, "reason": reason})
    return jsonify({"available": True})


@app.route("/api/chat", methods=["POST"])
def chat():
    user, err = _require_user()
    if err:
        return err

    reason = _chatbot_available_reason(user)
    if reason:
        # 503 when misconfigured server-side; 403 when the user isn't novice
        status_code = 403 if user.is_beginner is False else 503
        return jsonify({"error": reason}), status_code

    data = request.get_json(silent=True) or {}
    raw_messages = data.get("messages")
    if not isinstance(raw_messages, list) or not raw_messages:
        return jsonify({"error": "messages array required"}), 400

    # Sanitise + cap incoming messages.
    cleaned = []
    for m in raw_messages[-_CHAT_MAX_HISTORY:]:
        if not isinstance(m, dict):
            continue
        role = m.get("role")
        content = m.get("content")
        if role not in ("user", "assistant"):
            continue
        if not isinstance(content, str):
            continue
        content = content.strip()
        if not content:
            continue
        if len(content) > _CHAT_MAX_MESSAGE_CHARS:
            content = content[:_CHAT_MAX_MESSAGE_CHARS]
        cleaned.append({"role": role, "content": content})

    if not cleaned or cleaned[0]["role"] != "user":
        return jsonify({"error": "First message must be from the user."}), 400

    try:
        client = _get_anthropic_client()
        resp = client.messages.create(
            # Sonnet 4.6 is ~40% cheaper per token than Opus 4.7 and the
            # right tier for a Q&A tutor. Per the Anthropic migration guide,
            # set `effort: low` and disable thinking for chat workloads —
            # otherwise 4.6 defaults to `effort: high` and burns tokens.
            model="claude-sonnet-4-6",
            max_tokens=_CHAT_MAX_TOKENS,
            thinking={"type": "disabled"},
            output_config={"effort": "low"},
            system=[
                {
                    "type": "text",
                    "text": CHAT_SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=cleaned,
        )
    except anthropic.AuthenticationError:
        return jsonify({"error": "Chatbot misconfigured (invalid API key)."}), 503
    except anthropic.RateLimitError:
        return jsonify({"error": "Chatbot is busy — please try again in a moment."}), 429
    except anthropic.APIError as e:
        return jsonify({"error": f"Chatbot error: {e}"}), 502
    except Exception as e:
        return jsonify({"error": f"Chatbot error: {e}"}), 500

    text = ""
    for block in resp.content:
        if getattr(block, "type", None) == "text":
            text = block.text
            break

    return jsonify({"role": "assistant", "content": text})


# ─────────────────────────────────────────────────────────
# Auto-Configure (two-bot flow)
# ─────────────────────────────────────────────────────────
# Bot 1 (questioner): conversational, asks 1-3 clarifying questions.
# Bot 2 (picker):     one-shot, tool-use, emits a strict JSON config.
# Available to ALL signed-in users (not gated on is_beginner).

AUTO_CONFIG_QUESTIONER_PROMPT = (
    "You are an ML expert helping a user pick a neural-network architecture and "
    "hyperparameters for a dataset they have already uploaded to VortexML. "
    "You are inside the Architect tab.\n\n"
    "Your ONLY job in this conversation is to understand the user's goal well "
    "enough that a separate picker model can make a great recommendation. You "
    "MUST NOT output a configuration, recommend architectures, or list "
    "hyperparameters yourself — that's done in a separate step.\n\n"
    "Style:\n"
    "- The user has already seen the greeting 'Describe your problem in a few "
    "  words — what do you want the model to predict?'. Respond to whatever "
    "  they typed.\n"
    "- Ask AT MOST 1-3 short follow-up questions across the whole conversation, "
    "  one per turn. Stop early if the user's answer is already clear.\n"
    "- Useful things to confirm only if not obvious from the dataset/their "
    "  message: classification vs regression, time-series vs independent rows, "
    "  speed vs accuracy preference, risk of overfitting on small data.\n"
    "- Each message: under 2 short sentences. Friendly, not chatty.\n"
    "- When you have enough info, send a short reply ending with this exact "
    "  sentence: 'Click **Generate Configuration** below when you're ready.'\n"
    "- Never list architectures or hyperparameters. Never propose a config.\n\n"
    "The user's dataset summary follows."
)

AUTO_CONFIG_PICKER_PROMPT = (
    "You are a senior ML engineer choosing the BEST neural network configuration "
    "for a user's dataset and stated problem in VortexML. Quality matters: the "
    "user will train this model and judge VortexML by the result. Reason carefully "
    "before you commit to a configuration — do NOT make a snap decision.\n\n"
    "Available architectures (use EXACTLY one of these keys): mlp, dnn, cnn1d, "
    "rnn, lstm, gru, autoencoder, resnet, transformer, wide_deep.\n\n"
    "Your reasoning process MUST cover these steps, in order, before you call the "
    "tool. Use the extended-thinking block to work through them. Do not skip a step.\n\n"
    "1. TASK TYPE — Decide whether this is classification, regression, anomaly "
    "   detection, or unsupervised representation learning. Anchor your answer to "
    "   concrete dataset facts: the target column's dtype and unique-value count. "
    "   A numeric target with many unique values → regression. A non-numeric or "
    "   low-cardinality numeric target → classification. If the user said anomaly / "
    "   fraud / outlier detection, lean autoencoder.\n\n"
    "2. STRUCTURE — Is there sequential / temporal structure (time-series, ordered "
    "   rows, columns with names like 'date', 'time', 't', 'timestamp', 'lag_*', "
    "   'step')? If yes → RNN family (lstm for long deps, gru for short and faster). "
    "   Are features otherwise independent and tabular? Then a feedforward family.\n\n"
    "3. ARCHITECTURE CANDIDATES — List 2-3 architectures that could fit, then rule "
    "   each one out or in based on dataset size, feature count, and the structure "
    "   above. Pick the survivor. Never pick transformer or resnet on tiny datasets "
    "   (< 2k rows) — they overfit. Never pick rnn/lstm/gru on clearly non-sequential "
    "   tabular data. Wide & Deep is for sparse categorical-heavy data with both "
    "   memorization and generalization needs (rare for typical user datasets).\n\n"
    "4. CAPACITY — Choose layer_sizes based on dataset size and feature count:\n"
    "   - < 1k rows:    [32, 16]      (small — overfitting is the risk)\n"
    "   - 1k-10k rows:  [64, 32]      (modest)\n"
    "   - 10k-50k rows: [128, 64]     (standard)\n"
    "   - > 50k rows:   [256, 128, 64] (deeper allowed)\n"
    "   For LSTM/GRU/Transformer, layer_sizes encode hidden/d_model dims — keep "
    "   the FIRST value ≥ 32. For Wide & Deep, treat layer_sizes as the deep arm.\n\n"
    "5. EPOCHS — Anchor to dataset size:\n"
    "   - < 1k rows:    20-40 epochs, ALWAYS enable early_stopping (patience 5-8).\n"
    "   - 1k-50k rows:  40-80 epochs, early_stopping recommended (patience 8-12).\n"
    "   - > 50k rows:   80-150 epochs, early_stopping optional (patience 10-15).\n\n"
    "6. LEARNING RATE — Default 0.001 for adam. For transformer/resnet/deeper "
    "   stacks (3+ layers) → 0.0001. For very small datasets → 0.001 still fine.\n\n"
    "7. BATCH SIZE — 32 default. Bump to 64 for > 10k rows, 128 for > 100k rows. "
    "   Drop to 16 only if rows < 500.\n\n"
    "8. OPTIMIZER & ACTIVATION — Default optimizer 'adam', activation 'relu'. "
    "   Use 'adamw' on transformer/resnet. Use 'gelu' for transformer. Use 'tanh' "
    "   inside rnn/lstm/gru only if the user mentioned bounded outputs.\n\n"
    "9. SANITY CHECK — Before you commit, re-read your choices: does each one "
    "   match a CONCRETE fact in the dataset summary (rows, dtype, cardinality, "
    "   user message)? If a hyperparameter feels arbitrary, fix it.\n\n"
    "JUSTIFICATION — When you finally call the tool, your `justification` string "
    "MUST cite specific facts from THIS dataset: the row count, the target "
    "column's name and characteristics, and ONE other property that drove your "
    "architecture choice. Avoid generic platitudes like 'this is a flexible "
    "architecture'. 2-4 sentences.\n\n"
    "OUTPUT CONTRACT — Reason through every step above in the extended-thinking "
    "block. Then your visible response MUST be a single call to the "
    "`set_model_config` tool. Do NOT respond with plain text instead of a tool "
    "call. Do NOT ask the user follow-up questions. Do NOT call the tool more "
    "than once. The tool call IS your answer."
)

_AUTO_CONFIG_TOOL = {
    "name": "set_model_config",
    "description": "Submit the chosen neural-network architecture and hyperparameters.",
    "input_schema": {
        "type": "object",
        "properties": {
            "arch_type": {
                "type": "string",
                "enum": ["mlp", "dnn", "cnn1d", "rnn", "lstm", "gru",
                         "autoencoder", "resnet", "transformer", "wide_deep"],
            },
            "layer_sizes": {
                "type": "array",
                "items": {"type": "integer", "minimum": 1, "maximum": 2048},
                "minItems": 1,
                "maxItems": 8,
                "description": "Hidden-layer widths, in order. E.g. [128, 64, 32].",
            },
            "epochs": {"type": "integer", "minimum": 1, "maximum": 1000},
            "lr": {"type": "number", "minimum": 1e-6, "maximum": 1.0},
            "batch_size": {
                "type": "integer",
                "enum": [16, 32, 64, 128, 256],
            },
            "optimizer": {
                "type": "string",
                "enum": ["adam", "adamw", "sgd", "rmsprop"],
            },
            "activation": {
                "type": "string",
                "enum": ["relu", "leaky_relu", "elu", "selu", "gelu", "tanh", "sigmoid"],
            },
            "early_stopping": {
                "type": "object",
                "properties": {
                    "enabled": {"type": "boolean"},
                    "patience": {"type": "integer", "minimum": 1, "maximum": 100},
                    "min_delta": {"type": "number", "minimum": 0},
                },
                "required": ["enabled"],
            },
            "justification": {
                "type": "string",
                "description": (
                    "2-4 sentences explaining WHY this configuration suits THIS "
                    "specific dataset and user goal. MUST cite concrete dataset "
                    "facts: the row count, the target column's name and key "
                    "characteristic (dtype / cardinality / range), and one other "
                    "property that drove the architecture choice. Do not use "
                    "generic platitudes."
                ),
            },
        },
        "required": [
            "arch_type", "layer_sizes", "epochs", "lr", "batch_size",
            "optimizer", "activation", "early_stopping", "justification",
        ],
    },
}


def _auto_config_available_reason():
    """Return None if Auto-Configure is callable, else a reason string."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return "Auto-Configure is not configured. The admin must set ANTHROPIC_API_KEY."
    return None


def _sanitize_chat_messages(raw_messages):
    """Apply the same trim/cap rules used by the tutor chatbot."""
    cleaned = []
    for m in raw_messages[-_CHAT_MAX_HISTORY:]:
        if not isinstance(m, dict):
            continue
        role = m.get("role")
        content = m.get("content")
        if role not in ("user", "assistant"):
            continue
        if not isinstance(content, str):
            continue
        content = content.strip()
        if not content:
            continue
        if len(content) > _CHAT_MAX_MESSAGE_CHARS:
            content = content[:_CHAT_MAX_MESSAGE_CHARS]
        cleaned.append({"role": role, "content": content})
    return cleaned


def _format_float(v):
    try:
        return f"{float(v):.4g}"
    except (TypeError, ValueError):
        return "n/a"


def _build_dataset_context():
    """Compose a compact text summary of the current dataset for the AI bots."""
    info = _state.get("dataset_info")
    if not info:
        return "(No dataset has been uploaded yet.)"

    feature_cols = _state.get("feature_cols") or []
    target_col = _state.get("target_col")

    lines = [
        f"Filename: {_state.get('dataset_file')}",
        f"Rows: {info.get('rows')}, Columns: {info.get('cols')}",
        f"User-selected target column: {target_col or '(not yet picked)'}",
        f"User-selected feature columns: {feature_cols if feature_cols else '(not yet picked)'}",
        "Columns:",
    ]
    for c in (info.get("columns") or [])[:40]:
        line = (
            f"  - {c.get('name')} ({c.get('dtype')}) — "
            f"{c.get('non_null')} non-null, {c.get('unique')} unique"
        )
        if c.get("is_numeric"):
            line += (
                f", range [{_format_float(c.get('min'))}, "
                f"{_format_float(c.get('max'))}], mean {_format_float(c.get('mean'))}"
            )
        else:
            tv = c.get("top_values") or {}
            if tv:
                preview = ", ".join(f"{k}={v}" for k, v in list(tv.items())[:3])
                line += f", top: {preview}"
        lines.append(line)
    return "\n".join(lines)


@app.route("/api/auto-config/status", methods=["GET"])
def auto_config_status():
    user, err = _require_user()
    if err:
        return err
    reason = _auto_config_available_reason()
    if reason:
        return jsonify({"available": False, "reason": reason})
    return jsonify({"available": True, "has_dataset": _state["dataset_path"] is not None})


@app.route("/api/auto-config/chat", methods=["POST"])
def auto_config_chat():
    user, err = _require_user()
    if err:
        return err

    reason = _auto_config_available_reason()
    if reason:
        return jsonify({"error": reason}), 503

    data = request.get_json(silent=True) or {}
    raw_messages = data.get("messages")
    if not isinstance(raw_messages, list) or not raw_messages:
        return jsonify({"error": "messages array required"}), 400

    cleaned = _sanitize_chat_messages(raw_messages)
    if not cleaned or cleaned[0]["role"] != "user":
        return jsonify({"error": "First message must be from the user."}), 400

    ds_context = _build_dataset_context()
    sys_text = f"{AUTO_CONFIG_QUESTIONER_PROMPT}\n\n--- DATASET SUMMARY ---\n{ds_context}"

    try:
        client = _get_anthropic_client()
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=400,
            thinking={"type": "disabled"},
            output_config={"effort": "low"},
            system=[
                {
                    "type": "text",
                    "text": sys_text,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=cleaned,
        )
    except anthropic.AuthenticationError:
        return jsonify({"error": "Auto-Configure misconfigured (invalid API key)."}), 503
    except anthropic.RateLimitError:
        return jsonify({"error": "Auto-Configure is busy — please try again."}), 429
    except anthropic.APIError as e:
        return jsonify({"error": f"Auto-Configure error: {e}"}), 502
    except Exception as e:
        return jsonify({"error": f"Auto-Configure error: {e}"}), 500

    text = ""
    for block in resp.content:
        if getattr(block, "type", None) == "text":
            text = block.text
            break
    return jsonify({"role": "assistant", "content": text})


@app.route("/api/auto-config/decide", methods=["POST"])
def auto_config_decide():
    user, err = _require_user()
    if err:
        return err

    reason = _auto_config_available_reason()
    if reason:
        return jsonify({"error": reason}), 503

    if not _state["dataset_path"]:
        return jsonify({"error": "Upload a dataset before using Auto-Configure."}), 400

    data = request.get_json(silent=True) or {}
    raw_messages = data.get("messages") or []
    if not isinstance(raw_messages, list):
        raw_messages = []
    cleaned = _sanitize_chat_messages(raw_messages)

    transcript_lines = [f"{m['role'].upper()}: {m['content']}" for m in cleaned]
    transcript = "\n".join(transcript_lines) if transcript_lines else (
        "(no conversation — user clicked Generate Configuration without describing their problem)"
    )

    ds_context = _build_dataset_context()

    picker_messages = [
        {
            "role": "user",
            "content": (
                "Below is the user's dataset summary and the transcript of a "
                "clarifying conversation. Based on this, choose ONE configuration "
                "via the `set_model_config` tool.\n\n"
                f"--- DATASET SUMMARY ---\n{ds_context}\n\n"
                f"--- CONVERSATION TRANSCRIPT ---\n{transcript}"
            ),
        }
    ]

    # Picker uses the most capable model (Opus 4.7) with adaptive thinking at
    # high effort — a single, high-stakes call per session, so quality wins.
    #
    # Two API constraints we have to obey:
    #   - Opus 4.7 only accepts thinking.type "adaptive" or "disabled". The
    #     literal {"type": "enabled", "budget_tokens": N} form returns 400.
    #     Adaptive + effort=high tells the model to deliberate as needed.
    #   - Forced tool_choice ({"type": "tool", ...}) is rejected when thinking
    #     is on. We leave tool_choice at the default ("auto") and rely on the
    #     "OUTPUT CONTRACT" section of the system prompt to make calling the
    #     tool the only sensible response.
    try:
        client = _get_anthropic_client()
        resp = client.messages.create(
            model="claude-opus-4-7",
            max_tokens=8192,
            thinking={"type": "adaptive"},
            output_config={"effort": "high"},
            system=[
                {
                    "type": "text",
                    "text": AUTO_CONFIG_PICKER_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            tools=[_AUTO_CONFIG_TOOL],
            messages=picker_messages,
        )
    except anthropic.AuthenticationError:
        return jsonify({"error": "Auto-Configure misconfigured (invalid API key)."}), 503
    except anthropic.RateLimitError:
        return jsonify({"error": "Auto-Configure is busy — please try again."}), 429
    except anthropic.APIError as e:
        return jsonify({"error": f"Auto-Configure error: {e}"}), 502
    except Exception as e:
        return jsonify({"error": f"Auto-Configure error: {e}"}), 500

    config = None
    fallback_text = ""
    for block in resp.content:
        btype = getattr(block, "type", None)
        if btype == "tool_use" and getattr(block, "name", None) == "set_model_config":
            config = block.input
            break
        if btype == "text" and not fallback_text:
            fallback_text = getattr(block, "text", "") or ""

    if not config or not isinstance(config, dict):
        hint = (
            f' (The picker replied with text instead: "{fallback_text[:200]}")'
            if fallback_text else ""
        )
        return jsonify({"error": f"Picker did not produce a configuration.{hint}"}), 502

    return jsonify({"config": config})


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
    # If a node agent dropped, mark it offline and fail any run it was doing.
    dev_id = _node_sids.pop(request.sid, None)
    if dev_id is None:
        print("Client disconnected")
        return
    node = _nodes.get(dev_id)
    if node and node.get("sid") == request.sid:
        _nodes.pop(dev_id, None)
    busy_job_id = _device_busy.get(dev_id)
    if busy_job_id:
        job = _jobs.get(busy_job_id)
        if job:
            socketio.emit("training_error",
                          {"message": "Node disconnected during training"},
                          room=job["room"])
        _finish_job(busy_job_id)
        _cleanup_dataset()
    print(f"[node] disconnected: device #{dev_id}")


# ─────────────────────────────────────────────────────────
# Run
# ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5050, debug=True)
