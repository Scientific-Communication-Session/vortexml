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
import time
import uuid
import base64
import zipfile
import secrets
import shutil
import threading
from collections import defaultdict
from datetime import datetime, timezone

from flask import Flask, request, jsonify, session, send_file, make_response
from werkzeug.utils import secure_filename
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room

import json as _json

import anthropic

from data_processor import (
    save_uploaded_file, analyze_dataset, prepare_dataset, dataset_health,
    save_preprocess, load_preprocess, apply_preprocess,
)
from training_engine import (
    create_model, train_model, stop_training, get_torch_device,
    MODEL_REGISTRY, parse_weight_filename, WEIGHTS_DIR,
    load_weights_for_inference, predict, export_model,
)
from device_specs import detect_specs
from auto_config_rules import (
    recommend_config, guard_config, VALID_OPTIMIZERS, VALID_ACTIVATIONS,
)
import rag
from system_stats import SystemMonitor, sample as sample_stats

# Run blocking hardware sampling (ioreg/nvidia-smi subprocesses, IOKit ctypes)
# in a real OS thread so it never stalls the single eventlet hub that also
# streams training updates and chat tokens.
from eventlet import tpool
_run_blocking = tpool.execute
from models import (db, User, Project, Device, KnowledgeBase, Document,
                    Conversation, ChatMessage)

import logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("vortex")


def _internal_error(context, exc, status=500, public_msg=None):
    """Log the full exception server-side and return a generic client error.

    Avoids leaking internal exception text (stack details, paths, library
    internals) to the browser while keeping the real cause in the logs.
    """
    logger.exception("%s: %s", context, exc)
    return jsonify({"error": public_msg or "Something went wrong on the server. "
                    "Please try again."}), status


app = Flask(__name__)

# ── Allowed web origins (CORS + SocketIO) ─────────────────
# The frontends that may talk to this API. Extra origins can be added via the
# comma-separated VORTEX_ALLOWED_ORIGINS env var (e.g. the production tunnel).
_DEFAULT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
_extra_origins = [o.strip() for o in
                  os.environ.get("VORTEX_ALLOWED_ORIGINS", "").split(",") if o.strip()]
# The public tunnel URL is a legitimate browser origin too.
_public_origin = os.environ.get("VORTEX_PUBLIC_URL", "https://vortexml.andreinita.com")
ALLOWED_ORIGINS = list(dict.fromkeys(_DEFAULT_ORIGINS + _extra_origins + [_public_origin]))

# Enable CORS with credentials support for session cookies pointing to the frontend
CORS(app, supports_credentials=True, origins=ALLOWED_ORIGINS)

# Session signing key. MUST come from the environment in any real deployment —
# a hardcoded key lets anyone forge a session cookie for any account. In dev we
# fall back to a random per-process key (sessions won't survive a restart).
app.secret_key = os.environ.get("VORTEX_SECRET_KEY")
if not app.secret_key:
    if os.environ.get("FLASK_ENV") == "production":
        raise RuntimeError(
            "VORTEX_SECRET_KEY must be set in production (see .env.example).")
    app.secret_key = secrets.token_hex(32)
    print("[security] VORTEX_SECRET_KEY not set — using an ephemeral dev key; "
          "sessions will reset on restart.")

# Harden the session cookie. SECURE is opt-in (off for local HTTP dev) and must
# be enabled in production behind HTTPS via VORTEX_COOKIE_SECURE=1.
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("VORTEX_COOKIE_SECURE", "0") == "1",
)
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024  # 100 MB max upload

# Database configuration. Order of precedence:
#   1. SQLALCHEMY_DATABASE_URI / VORTEX_DATABASE_URL from the environment
#   2. SQLite fallback under backend/ — no credentials are ever hardcoded here.
# Point VORTEX_DATABASE_URL at PostgreSQL in deployment; start.sh sets
# VORTEX_USE_SQLITE when Postgres is unreachable so this falls through to SQLite.
_db_uri = (os.environ.get("SQLALCHEMY_DATABASE_URI")
           or os.environ.get("VORTEX_DATABASE_URL"))
if not _db_uri:
    _db_uri = "sqlite:///" + os.path.join(os.path.dirname(__file__), "vortex.db")
app.config['SQLALCHEMY_DATABASE_URI'] = _db_uri
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)

# ── Rate limiting ─────────────────────────────────────────
# Guards auth endpoints against brute force and the paid-LLM endpoints against
# cost abuse. Identity is the logged-in user when available, else the client IP.
# In-memory storage is fine for this single-process eventlet server; point
# RATELIMIT_STORAGE_URI at Redis if this is ever horizontally scaled.
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address


def _rate_key():
    uid = session.get("user_id")
    return f"user:{uid}" if uid else get_remote_address()


limiter = Limiter(
    key_func=_rate_key,
    app=app,
    default_limits=[],  # opt-in per route; no blanket limit
    storage_uri=os.environ.get("RATELIMIT_STORAGE_URI", "memory://"),
    headers_enabled=True,
)


def _ensure_columns():
    """Lightweight, idempotent column migration.

    `create_all()` only creates missing *tables*, never alters existing ones, so
    columns added to a model after its table already exists (e.g. the `reasoning`
    fields) need an explicit ALTER. Both SQLite and PostgreSQL support
    `ALTER TABLE ... ADD COLUMN`.
    """
    from sqlalchemy import inspect as _inspect, text as _text
    insp = _inspect(db.engine)
    false_lit = "FALSE" if db.engine.dialect.name == "postgresql" else "0"
    wanted = {
        "conversations": [("reasoning", f"BOOLEAN NOT NULL DEFAULT {false_lit}")],
        "chat_messages": [("reasoning", "TEXT")],
    }
    for table, cols in wanted.items():
        if not insp.has_table(table):
            continue
        existing = {c["name"] for c in insp.get_columns(table)}
        for name, ddl in cols:
            if name not in existing:
                db.session.execute(_text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
    db.session.commit()


with app.app_context():
    db.create_all()
    _ensure_columns()

# Cache-busting: append version to static URLs so browser loads fresh JS/CSS
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0

@app.context_processor
def inject_cache_buster():
    import time
    return {"cache_version": int(time.time())}

# `max_http_buffer_size` is bumped so node agents can ship datasets and
# trained weights to/from the server as base64 payloads over the socket.
socketio = SocketIO(app, cors_allowed_origins=ALLOWED_ORIGINS, async_mode="eventlet",
                    max_http_buffer_size=100 * 1024 * 1024)

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Public URL the node agents dial back into. The Cloudflare tunnel for this is
# vortexml.andreinita.com → :5173 (Vite), which proxies /api and /socket.io.
PUBLIC_URL = os.environ.get("VORTEX_PUBLIC_URL", "https://vortexml.andreinita.com")
NODE_BUNDLE_DIR = os.path.join(os.path.dirname(__file__), "node_bundle")

# ── Per-user / per-session working state ──────────────────
# This is one process serving many users. The working state (uploaded dataset,
# column selection, model config) is keyed per user — or per anonymous session
# for not-logged-in visitors — so one person's upload can't clobber another's
# in-flight setup, and a finishing job can't wipe an unrelated user's state.
def _default_state():
    return {
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


_states = defaultdict(_default_state)
# state_key -> last access epoch, so abandoned anonymous state can be evicted.
_state_last_seen = {}


def _state_key():
    """Stable key for the caller's working state. Must run in a request context.

    Logged-in users key by user id; anonymous visitors get a per-session uuid
    persisted in the (signed) session cookie.
    """
    uid = session.get("user_id")
    if uid is not None:
        return f"user:{uid}"
    anon = session.get("anon_id")
    if not anon:
        anon = uuid.uuid4().hex
        session["anon_id"] = anon
    return f"anon:{anon}"


def _get_state():
    """The caller's working-state dict. Must run in a request context."""
    key = _state_key()
    _state_last_seen[key] = time.time()
    return _states[key]

# ── Device / remote-training runtime registries (this is a single process) ──
_nodes = {}        # device_id -> {"sid": <node socket id>}
_node_sids = {}    # node socket id -> device_id   (reverse lookup on disconnect)
_jobs = {}         # job_id -> live job dict (epoch/eta/room/owner/config)
_device_busy = {}  # device_id -> job_id   (which job currently occupies it)
_queues = defaultdict(list)  # device_id -> [pending job dicts] (FIFO)
_MAX_RESUME_ATTEMPTS = 1     # auto-restart an interrupted remote job this many times
_rag_jobs = {}     # job_id -> {citations, chunks, backend, model, room} for remote RAG queries
_rag_download_cancels = {}  # job_id -> threading.Event() for in-flight model downloads (local + remote)
_chat_jobs = {}    # job_id -> {conversation_id, owner_user_id, citations, model, room} for remote chat turns
_predict_jobs = {} # job_id -> {device, room} for remote neural-net inference


# Anonymous working-state lives only in memory; without eviction every
# not-logged-in visitor leaks a dict (and possibly an uploaded file) forever.
_ANON_STATE_TTL = 6 * 3600  # seconds of inactivity before an anon entry is dropped


def _active_state_keys():
    """state_keys referenced by a running or queued job — never evict these."""
    keys = {j.get("state_key") for j in _jobs.values()}
    for q in _queues.values():
        keys.update(j.get("state_key") for j in q)
    keys.discard(None)
    return keys


def _evict_stale_state():
    """Drop abandoned anonymous state (and any orphaned upload it points at).

    Logged-in (`user:`) state is kept; so is any state tied to a live/queued job.
    """
    now = time.time()
    active = _active_state_keys()
    for key in list(_states.keys()):
        if not key.startswith("anon:") or key in active:
            continue
        if now - _state_last_seen.get(key, 0) <= _ANON_STATE_TTL:
            continue
        st = _states.pop(key, None)
        _state_last_seen.pop(key, None)
        # Reclaim a non-shared upload file the abandoned state still referenced.
        p = st.get("dataset_path") if st else None
        if p and "queued_" not in os.path.basename(p) and os.path.exists(p):
            try:
                os.remove(p)
            except OSError:
                pass


def _state_evictor_loop():
    """Background sweeper: prune stale anonymous state every 30 minutes."""
    while True:
        socketio.sleep(1800)
        try:
            _evict_stale_state()
        except Exception as e:
            logger.warning("state evictor failed: %s", e)


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
@limiter.limit("10 per hour", key_func=get_remote_address)
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
@limiter.limit("10 per minute; 50 per hour", key_func=get_remote_address)
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

    allowed = file.filename.lower().endswith((
        ".csv", ".tsv", ".xlsx", ".xls", ".json", ".parquet",
        ".docx", ".html", ".htm",
    ))
    if not allowed:
        return jsonify({"error": "Unsupported file type. Upload a table as CSV, "
                                 "TSV, Excel (.xlsx/.xls), JSON, Parquet, or a "
                                 "Word/HTML file containing a table."}), 400

    try:
        filename, filepath = save_uploaded_file(file)
        info = analyze_dataset(filepath)
        st = _get_state()
        st["dataset_file"] = filename
        st["dataset_path"] = filepath
        st["dataset_info"] = info
        return jsonify({"filename": filename, "info": info})
    except ValueError as e:
        # Unparseable/empty/garbled file — a client error, not a server fault.
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Could not process this file: {e}"}), 400


@app.route("/api/dataset/analyze", methods=["GET"])
def get_dataset_info():
    st = _get_state()
    if st["dataset_info"] is None:
        return jsonify({"error": "No dataset uploaded yet"}), 404
    return jsonify({
        "filename": st["dataset_file"],
        "info": st["dataset_info"],
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

    st = _get_state()
    # Validate the chosen columns exist in the uploaded dataset. Otherwise a bad
    # selection is accepted here and only blows up later inside the training
    # thread when prepare_dataset does df[col] (KeyError), with no clean error
    # surfaced to the user.
    info = st.get("dataset_info")
    if not info:
        return jsonify({"error": "Upload a dataset first"}), 400
    known = {c["name"] for c in info.get("columns", [])}
    missing = [c for c in list(feature_cols) + [target_col] if c not in known]
    if missing:
        return jsonify({"error": f"Unknown column(s) for this dataset: {', '.join(missing)}"}), 400
    if target_col in feature_cols:
        return jsonify({"error": "The target column can't also be a feature column"}), 400

    st["feature_cols"] = feature_cols
    st["target_col"] = target_col

    return jsonify({"status": "ok", "features": feature_cols, "target": target_col})


@app.route("/api/dataset/health", methods=["POST"])
def dataset_health_route():
    """Data-quality warnings for the current dataset.

    Optional body {feature_cols, target_col} reflects the user's live (unsaved)
    column selection so target-aware checks (imbalance, leakage) run before they
    commit. Falls back to the saved selection in state.
    """
    st = _get_state()
    if not st.get("dataset_path"):
        return jsonify({"error": "No dataset uploaded yet"}), 404
    body = request.get_json(silent=True) or {}
    feature_cols = body.get("feature_cols")
    if not isinstance(feature_cols, list):
        feature_cols = st.get("feature_cols") or []
    target_col = body.get("target_col")
    if target_col is None:
        target_col = st.get("target_col")
    try:
        result = dataset_health(st["dataset_path"], feature_cols, target_col)
    except Exception as e:
        return _internal_error("dataset_health failed", e,
                               public_msg="Could not analyze this dataset.")
    return jsonify(result)


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

    # Validate the hyperparameters before they reach the training loop. Without
    # this, invalid values (e.g. epochs<=0, negative lr, non-positive layer
    # widths, batch_size<=0) crash the background training thread with a cryptic
    # error instead of returning a clean 400. The epochs/lr inputs in the UI are
    # free number fields, so a negative value is reachable from the browser.
    if not isinstance(layer_sizes, list) or not (1 <= len(layer_sizes) <= 16):
        return jsonify({"error": "layer_sizes must be a list of 1–16 layer widths"}), 400
    try:
        layer_sizes = [int(n) for n in layer_sizes]
    except (TypeError, ValueError):
        return jsonify({"error": "layer_sizes must contain whole numbers"}), 400
    if any(n < 1 or n > 8192 for n in layer_sizes):
        return jsonify({"error": "each layer width must be between 1 and 8192"}), 400
    try:
        epochs = int(epochs)
    except (TypeError, ValueError):
        return jsonify({"error": "epochs must be a whole number"}), 400
    if not (1 <= epochs <= 100000):
        return jsonify({"error": "epochs must be between 1 and 100000"}), 400
    try:
        lr = float(lr)
    except (TypeError, ValueError):
        return jsonify({"error": "lr must be a number"}), 400
    if not (0 < lr <= 10):
        return jsonify({"error": "lr must be greater than 0 and at most 10"}), 400
    try:
        batch_size = int(batch_size)
    except (TypeError, ValueError):
        return jsonify({"error": "batch_size must be a whole number"}), 400
    if not (1 <= batch_size <= 100000):
        return jsonify({"error": "batch_size must be between 1 and 100000"}), 400
    if optimizer not in VALID_OPTIMIZERS:
        return jsonify({"error": f"Unknown optimizer: {optimizer}"}), 400
    if activation not in VALID_ACTIVATIONS:
        return jsonify({"error": f"Unknown activation: {activation}"}), 400

    st = _get_state()
    st["project_name"] = project_name
    st["model_config"] = {
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

    return jsonify({"status": "ok", "config": st["model_config"]})


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
    st = _get_state()
    if not st["dataset_path"]:
        return jsonify({"error": "No dataset uploaded"}), 400
    if not st["feature_cols"] or not st["target_col"]:
        return jsonify({"error": "Dataset not configured (features/target)"}), 400
    if not st["model_config"]:
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

    # Snapshot everything this run needs out of the per-user state, so the
    # background task, the queue, and socket relays don't depend on state
    # another request might mutate (or clean up) while it runs/waits.
    state_key = _state_key()
    config = st["model_config"]
    ds_path = st["dataset_path"]
    job_id = uuid.uuid4().hex[:12]
    room = f"job:{job_id}"

    # Put the requesting browser into the job room *before* training starts so
    # it cannot miss the first epochs (or queued→running transition).
    _join_job_room(socket_id, room)

    job = {
        "job_id": job_id,
        "device_id": device.id,
        "is_local": device.is_shared,
        "owner_user_id": owner_user_id,
        "state_key": state_key,
        "dataset_path": ds_path,
        "feature_cols": st["feature_cols"],
        "target_col": st["target_col"],
        "dataset_file": st["dataset_file"],
        "project_name": config.get("project_name", "VortexProject"),
        "config": config,
        "room": room,
        "epoch": 0,
        "total_epochs": config.get("epochs", 50),
        "eta_seconds": None,
        "started_at": None,
        "attempts": 0,
    }

    # The device is occupied (running or has a queue) → enqueue behind it.
    # Remote jobs and queued jobs get a private dataset copy so neither a
    # finishing run's cleanup nor a new upload can pull the data out from under
    # them; immediate local runs read the live file (cleaned when they finish).
    busy = bool(_device_busy.get(device.id)) or bool(_queues.get(device.id))
    if busy or not device.is_shared:
        job["dataset_path"] = _snapshot_dataset(job_id, ds_path)

    if busy:
        _queues[device.id].append(job)
        return jsonify({"status": "queued", "job_id": job_id,
                        "position": len(_queues[device.id]),
                        "device": device.to_dict()})

    if device.is_shared:
        try:
            training_info = _start_local_job(job)
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        st["training_thread"] = True
        return jsonify({"status": "started", "job_id": job_id, "mode": "local",
                        "device": device.to_dict(), "info": training_info})

    # ── Remote training on the user's own node ──
    node = _nodes.get(device.id)
    if not node:
        _delete_job_snapshot(job)
        return jsonify({"error": f"'{device.nickname}' is offline. Start its node agent and try again."}), 409
    try:
        _start_remote_job(job, node["sid"])
    except Exception as e:
        _delete_job_snapshot(job)
        return jsonify({"error": f"Could not read dataset: {e}"}), 500
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


@app.route("/api/training/queue", methods=["GET"])
def list_queue():
    """The caller's running + queued jobs (across all their devices)."""
    key = _state_key()
    jobs = []
    for j in _jobs.values():
        if j.get("state_key") == key:
            jobs.append(_queue_view(j, "running", 0))
    for q in _queues.values():
        for pos, j in enumerate(q):
            if j.get("state_key") == key:
                jobs.append(_queue_view(j, "queued", pos + 1))
    return jsonify({"jobs": jobs})


@app.route("/api/training/queue/<job_id>", methods=["DELETE"])
def cancel_queued(job_id):
    """Remove a job that is still waiting in a device queue (not yet running)."""
    key = _state_key()
    for q in _queues.values():
        for i, j in enumerate(q):
            if j["job_id"] == job_id:
                if j.get("state_key") != key:
                    return jsonify({"error": "Not your job"}), 403
                q.pop(i)
                _delete_job_snapshot(j)
                socketio.emit("training_stopped", {}, room=j["room"])
                return jsonify({"status": "cancelled"})
    return jsonify({"error": "Queued job not found (it may have already started)"}), 404


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

    st = _get_state()
    if scope in ("dataset", "all"):
        st["dataset_file"] = None
        st["dataset_path"] = None
        st["dataset_info"] = None
        st["feature_cols"] = []
        st["target_col"] = None

    if scope in ("model", "all"):
        st["model_config"] = None
        st["project_name"] = "VortexProject"
        st["last_weights_file"] = None

    return jsonify({"status": "ok", "scope": scope})


@app.route("/api/state", methods=["GET"])
def get_state():
    """Return current app state for page resumption."""
    st = _get_state()
    return jsonify({
        "has_dataset": st["dataset_path"] is not None,
        "dataset_file": st["dataset_file"],
        "has_features": len(st["feature_cols"]) > 0,
        "feature_cols": st["feature_cols"],
        "target_col": st["target_col"],
        "has_model": st["model_config"] is not None,
        "model_config": st["model_config"],
        "last_weights_file": st["last_weights_file"],
    })


# ─────────────────────────────────────────────────────────
# Weights API
# ─────────────────────────────────────────────────────────
@app.route("/api/weights/download", methods=["GET"])
def download_weights_redirect():
    """Redirect to the named download URL."""
    filename = _get_state().get("last_weights_file")
    if not filename:
        return jsonify({"error": "No weights file available"}), 404
    return jsonify({"redirect": f"/api/weights/file/{filename}", "filename": filename})


@app.route("/api/weights/file/<filename>", methods=["GET"])
def download_weights_file(filename):
    """Download a weights file — only the caller's own (their current run, or a
    project they own). Prevents downloading arbitrary files by guessed name."""
    filename = os.path.basename(filename)  # never trust the path component
    if not filename.endswith(".pt"):
        return jsonify({"error": "Invalid filename"}), 400

    # Authorize: the caller's current weights, or a project they own.
    owned = _get_state().get("last_weights_file") == filename
    if not owned:
        uid = session.get("user_id")
        if uid is not None:
            owned = Project.query.filter_by(user_id=uid, weight_filename=filename).first() is not None
    if not owned:
        return jsonify({"error": "Weights file not found"}), 404

    filepath = os.path.join(WEIGHTS_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({"error": "Weights file not found on disk"}), 404

    # Stream from disk rather than buffering the whole file in memory — a large
    # weights file would otherwise double peak memory and stall the event loop.
    return send_file(filepath, mimetype="application/octet-stream",
                     as_attachment=True, download_name=filename)


@app.route("/api/weights/upload", methods=["POST"])
def upload_weights():
    """Upload a .pt weights file and parse its filename to extract architecture config."""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if file.filename == "" or not file.filename.endswith(".pt"):
        return jsonify({"error": "Only .pt weight files are supported"}), 400

    # Strip any path component so the upload can't be written outside WEIGHTS_DIR.
    safe = secure_filename(file.filename)
    if not safe.endswith(".pt"):
        return jsonify({"error": "Invalid weights filename"}), 400

    try:
        # Save the file
        filepath = os.path.join(WEIGHTS_DIR, safe)
        file.save(filepath)

        # Parse config from filename
        config = parse_weight_filename(safe)

        # Validate architecture exists
        if config["arch_type"] not in MODEL_REGISTRY:
            return jsonify({"error": f"Unknown architecture in weights: {config['arch_type']}"}), 400

        # Store in state
        st = _get_state()
        st["last_weights_file"] = safe
        st["project_name"] = config.get("project_name", "VortexProject")
        st["model_config"] = config

        return jsonify({
            "status": "ok",
            "filename": safe,
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


@app.route("/api/projects/compare", methods=["POST"])
def compare_projects():
    """Return full configs + per-epoch histories for several of the user's
    projects in one request, for the leaderboard's overlaid curves."""
    user, err = _require_user()
    if err:
        return err
    body = request.get_json(silent=True) or {}
    raw_ids = body.get("ids") or []
    ids = []
    for i in raw_ids:
        try:
            ids.append(int(i))
        except (TypeError, ValueError):
            continue
    ids = ids[:8]  # cap overlay
    if not ids:
        return jsonify({"projects": []})
    projs = (Project.query
             .filter(Project.user_id == user.id, Project.id.in_(ids))
             .all())
    return jsonify({"projects": [p.to_dict(include_history=True) for p in projs]})


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
        for p in (filepath, filepath[:-3] + ".preprocess.json" if filepath.endswith(".pt") else None):
            if p and os.path.exists(p):
                try:
                    os.remove(p)
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
    st = _get_state()
    st["model_config"] = cfg
    st["project_name"] = proj.name
    st["last_weights_file"] = proj.weight_filename

    return jsonify({"status": "ok", "config": cfg, "weight_filename": proj.weight_filename})


# ─────────────────────────────────────────────────────────
# Inference — run a saved model on new rows
# ─────────────────────────────────────────────────────────
def _project_preprocess(proj):
    """Load a project's preprocessing sidecar, or None if it predates this feature."""
    return load_preprocess(os.path.join(WEIGHTS_DIR, proj.weight_filename))


def _inference_resource(elapsed, n_rows):
    """Resource-consumption summary for a forward pass: timing, throughput, and a
    one-shot hardware snapshot (sampled off the event loop so it doesn't stall)."""
    try:
        snap = _run_blocking(sample_stats) or {}
    except Exception:
        snap = {}
    return {
        "inference_ms": round(elapsed * 1000, 1),
        "rows_per_sec": round(n_rows / elapsed, 1) if elapsed > 0 else None,
        "stats": snap,
    }


@app.route("/api/projects/<int:project_id>/inference", methods=["GET"])
def inference_schema(project_id):
    """Describe the inputs a saved model expects, so the UI can build a form."""
    user, err = _require_user()
    if err:
        return err
    proj = Project.query.filter_by(id=project_id, user_id=user.id).first()
    if not proj:
        return jsonify({"error": "Project not found"}), 404

    pp = _project_preprocess(proj)
    weights_exist = os.path.exists(os.path.join(WEIGHTS_DIR, proj.weight_filename))
    if pp is None or not weights_exist:
        return jsonify({
            "ready": False,
            "reason": ("This model was trained before prediction support was added — "
                       "retrain it to enable predictions."
                       if weights_exist else "Weights file is missing on the server."),
            "task_type": proj.task_type,
        })

    fields = []
    for col in pp["feature_cols"]:
        meta = pp["features"].get(col, {"kind": "numeric"})
        field = {"name": col, "kind": meta.get("kind", "numeric")}
        if meta.get("kind") == "categorical":
            field["options"] = [c for c in meta.get("classes", []) if c != "__MISSING__"]
        fields.append(field)

    return jsonify({
        "ready": True,
        "task_type": pp["task_type"],
        "target_col": pp.get("target_col"),
        "target_classes": pp.get("target_classes"),
        "fields": fields,
    })


@app.route("/api/projects/<int:project_id>/predict", methods=["POST"])
def predict_project(project_id):
    """Run the saved model on submitted rows.

    Accepts either JSON {"rows": [{col: value, ...}, ...]} or a multipart CSV
    upload (field name 'file'). Returns one prediction per row.
    """
    user, err = _require_user()
    if err:
        return err
    proj = Project.query.filter_by(id=project_id, user_id=user.id).first()
    if not proj:
        return jsonify({"error": "Project not found"}), 404

    pp = _project_preprocess(proj)
    weights_path = os.path.join(WEIGHTS_DIR, proj.weight_filename)
    if pp is None or not os.path.exists(weights_path):
        return jsonify({"error": "This model can't be used for prediction "
                                 "(missing weights or preprocessing). Retrain it."}), 409

    # device_id / socket_id may arrive as JSON (rows body) or multipart form fields.
    device_id = request.form.get("device_id", type=int) if request.form else None
    socket_id = request.form.get("socket_id") if request.form else None

    # Collect input rows from a CSV upload or a JSON body.
    rows = []
    if "file" in request.files and request.files["file"].filename:
        f = request.files["file"]
        if not f.filename.lower().endswith((".csv", ".xlsx", ".xls")):
            return jsonify({"error": "Only CSV/Excel files are supported"}), 400
        try:
            import pandas as pd
            if f.filename.lower().endswith(".csv"):
                # Match the dataset pipeline's robust read: many real-world CSVs
                # (Excel exports) are Windows-1252/Latin-1, not UTF-8, so a strict
                # read would 400 on a file that trained fine. Latin-1 maps all 256
                # byte values and never fails to decode.
                data = f.read()
                try:
                    df = pd.read_csv(io.BytesIO(data))
                except UnicodeDecodeError:
                    df = pd.read_csv(io.BytesIO(data), encoding="latin-1")
            else:
                df = pd.read_excel(f, engine="openpyxl")
            rows = df.to_dict(orient="records")
        except Exception as e:
            return jsonify({"error": f"Could not read file: {e}"}), 400
    else:
        body = request.get_json(silent=True) or {}
        rows = body.get("rows") or []
        if isinstance(rows, dict):
            rows = [rows]
        device_id = body.get("device_id")
        socket_id = body.get("socket_id")

    if not rows:
        return jsonify({"error": "No input rows provided"}), 400
    if len(rows) > 5000:
        return jsonify({"error": "Too many rows (max 5000 per request)"}), 400

    # Which device runs the forward pass? None / shared → here; a personal node
    # → ship the model + rows to that node and relay the result back.
    device, derr = _resolve_rag_device(device_id, user.id)
    if derr:
        return derr

    if device is not None and not device.is_shared:
        node = _nodes.get(device.id)
        if not node:
            return jsonify({"error": f"'{device.nickname}' is offline. Start its node agent and try again."}), 409
        try:
            with open(weights_path, "rb") as wf:
                weights_b64 = base64.b64encode(wf.read()).decode()
        except Exception as e:
            return jsonify({"error": f"Could not read weights: {e}"}), 500
        job_id = uuid.uuid4().hex[:12]
        room = f"predict:{job_id}"
        _join_job_room(socket_id, room)
        _predict_jobs[job_id] = {"device": device.nickname, "room": room}
        # Rows from a CSV upload can carry numpy scalars (np.int64, np.bool_) that
        # the socket's JSON encoder can't serialize — coerce to plain Python first.
        rows_payload = _json.loads(_json.dumps(
            rows, default=lambda o: o.item() if hasattr(o, "item") else None))
        socketio.emit("node_predict", {
            "job_id": job_id,
            "weights_b64": weights_b64,
            "arch_type": proj.arch_type,
            "layer_sizes": _json.loads(proj.layer_sizes),
            "activation": proj.activation,
            "preprocess": pp,
            "rows": rows_payload,
        }, room=node["sid"])
        return jsonify({"status": "predicting", "mode": "remote",
                        "job_id": job_id, "room": room, "device": device.nickname,
                        "count": len(rows)})

    # ── Local: run the forward pass here on the shared device ──
    try:
        X = apply_preprocess(pp, rows)
        model = load_weights_for_inference(
            weights_path, proj.arch_type, _json.loads(proj.layer_sizes),
            pp["input_dim"], pp["output_dim"], activation=proj.activation,
        )
        t0 = time.time()
        out = predict(model, X, pp["task_type"])
        elapsed = time.time() - t0
    except Exception as e:
        return _internal_error("inference failed", e,
                               public_msg="Prediction failed — check the input rows and try again.")

    from training_engine import format_predictions, evaluate_predictions
    predictions = format_predictions(pp, out)
    # If the caller supplied the true target alongside the features (e.g. a
    # labelled CSV), evaluate the model against it on the spot.
    evaluation = evaluate_predictions(pp, rows, predictions)

    return jsonify({
        "task_type": pp["task_type"],
        "target_col": pp.get("target_col"),
        "count": len(predictions),
        "predictions": predictions,
        "evaluation": evaluation,
        "device": device.nickname if device else "Shared device",
        "resource": _inference_resource(elapsed, len(rows)),
    })


@app.route("/api/projects/<int:project_id>/export", methods=["GET"])
def export_project(project_id):
    """Download a trained model as ONNX or TorchScript for use outside VortexML."""
    user, err = _require_user()
    if err:
        return err
    proj = Project.query.filter_by(id=project_id, user_id=user.id).first()
    if not proj:
        return jsonify({"error": "Project not found"}), 404

    fmt = (request.args.get("format") or "onnx").lower()
    if fmt not in ("onnx", "torchscript"):
        return jsonify({"error": "format must be 'onnx' or 'torchscript'"}), 400

    weights_path = os.path.join(WEIGHTS_DIR, proj.weight_filename)
    if not os.path.exists(weights_path):
        return jsonify({"error": "Weights file is missing on the server"}), 404

    input_dim = proj.input_dim
    if not input_dim:
        pp = _project_preprocess(proj)
        input_dim = pp.get("input_dim") if pp else None
    if not input_dim or not proj.output_dim:
        return jsonify({"error": "Model has no recorded input/output shape; retrain to export."}), 409

    try:
        data = export_model(weights_path, proj.arch_type, _json.loads(proj.layer_sizes),
                            input_dim, proj.output_dim, proj.activation, fmt)
    except Exception as e:
        return jsonify({"error": f"Export failed for this architecture: {e}"}), 500

    base = proj.weight_filename[:-3] if proj.weight_filename.endswith(".pt") else proj.weight_filename
    ext = "onnx" if fmt == "onnx" else "torchscript.pt"
    resp = make_response(data)
    resp.headers["Content-Type"] = "application/octet-stream"
    resp.headers["Content-Disposition"] = f'attachment; filename="{base}.{ext}"'
    resp.headers["Content-Length"] = len(data)
    return resp


# ─────────────────────────────────────────────────────────
# RAG — knowledge bases + retrieval-augmented chat
# ─────────────────────────────────────────────────────────
@app.route("/api/rag/backends", methods=["GET"])
def rag_backends():
    """Generation backends + embedders with availability + the copy the UI
    shows to explain what each one does."""
    user, err = _require_user()
    if err:
        return err
    data = rag.list_backends()
    data["embedders"] = [
        {"key": k, "label": v["label"], "description": v["description"],
         "available": rag.embedder_available(k)}
        for k, v in rag.EMBEDDERS.items()
    ]
    return jsonify(data)


@app.route("/api/rag/kb", methods=["GET"])
def list_kbs():
    user, err = _require_user()
    if err:
        return err
    kbs = (KnowledgeBase.query.filter_by(user_id=user.id)
           .order_by(KnowledgeBase.created_at.desc()).all())
    return jsonify({"knowledge_bases": [k.to_dict() for k in kbs]})


@app.route("/api/rag/kb", methods=["POST"])
def create_kb():
    user, err = _require_user()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    name = ((data.get("name") or "").strip() or "Knowledge Base")[:120]
    embedder = data.get("embedder", "tfidf")
    if embedder not in rag.EMBEDDERS:
        return jsonify({"error": f"Unknown embedder: {embedder}"}), 400
    if not rag.embedder_available(embedder):
        return jsonify({"error": f"Embedder '{embedder}' isn't installed on the server."}), 400
    try:
        chunk_size = max(200, min(4000, int(data.get("chunk_size", 900))))
        overlap = max(0, min(chunk_size // 2, int(data.get("overlap", 150))))
    except (TypeError, ValueError):
        return jsonify({"error": "chunk_size/overlap must be integers"}), 400
    kb = KnowledgeBase(user_id=user.id, name=name, embedder=embedder,
                       chunk_size=chunk_size, overlap=overlap)
    db.session.add(kb)
    db.session.commit()
    return jsonify({"knowledge_base": kb.to_dict()}), 201


@app.route("/api/rag/kb/<int:kb_id>", methods=["GET"])
def get_kb(kb_id):
    user, err = _require_user()
    if err:
        return err
    kb = KnowledgeBase.query.filter_by(id=kb_id, user_id=user.id).first()
    if not kb:
        return jsonify({"error": "Knowledge base not found"}), 404
    return jsonify({"knowledge_base": kb.to_dict(include_docs=True)})


@app.route("/api/rag/kb/<int:kb_id>", methods=["DELETE"])
def delete_kb(kb_id):
    user, err = _require_user()
    if err:
        return err
    kb = KnowledgeBase.query.filter_by(id=kb_id, user_id=user.id).first()
    if not kb:
        return jsonify({"error": "Knowledge base not found"}), 404
    rag.KBStore(kb_id).destroy()
    db.session.delete(kb)
    db.session.commit()
    return jsonify({"status": "deleted"})


@app.route("/api/rag/kb/<int:kb_id>/documents", methods=["POST"])
def add_kb_documents(kb_id):
    """Ingest one or more uploaded files: extract text, chunk, embed, persist.
    Files come under the 'file' field (repeatable)."""
    user, err = _require_user()
    if err:
        return err
    kb = KnowledgeBase.query.filter_by(id=kb_id, user_id=user.id).first()
    if not kb:
        return jsonify({"error": "Knowledge base not found"}), 404

    files = [f for f in request.files.getlist("file") if f and f.filename]
    if not files:
        return jsonify({"error": "No files provided"}), 400

    store = rag.KBStore(kb_id)
    chunks = store.load_chunks()
    next_id = max((c["id"] for c in chunks), default=-1) + 1
    added = []
    for f in files:
        try:
            text = rag.extract_text(f.filename, f.read())
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        doc_chunks = rag.chunk_text(text, kb.chunk_size, kb.overlap)
        if not doc_chunks:
            continue
        doc = Document(kb_id=kb.id, filename=f.filename[:255],
                       char_count=len(text), chunk_count=len(doc_chunks))
        db.session.add(doc)
        db.session.flush()  # assign doc.id
        for ch in doc_chunks:
            chunks.append({"id": next_id, "doc_id": doc.id,
                           "doc_name": f.filename, "text": ch})
            next_id += 1
        added.append(doc)

    if not added:
        db.session.rollback()
        return jsonify({"error": "No usable text found in the upload(s)."}), 400

    try:
        store.rebuild(chunks, embedder=kb.embedder,
                      chunk_size=kb.chunk_size, overlap=kb.overlap)
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Embedding failed: {e}"}), 500

    kb.n_docs = (kb.n_docs or 0) + len(added)
    kb.n_chunks = len(chunks)
    db.session.commit()
    return jsonify({"knowledge_base": kb.to_dict(include_docs=True),
                    "added": [d.to_dict() for d in added]})


def _resolve_rag_device(device_id, user_id):
    """Pick the target device for a RAG op: the shared M4 when device_id is
    None, else a device the user owns. Returns (device, error_response)."""
    if device_id is None:
        return Device.query.filter_by(is_shared=True).first(), None
    device = Device.query.get(device_id)
    if device is None:
        return None, (jsonify({"error": "Device not found"}), 404)
    if not device.is_shared and device.user_id != user_id:
        return None, (jsonify({"error": "That device is not linked to your account"}), 403)
    return device, None


@app.route("/api/rag/devices", methods=["GET"])
def rag_devices():
    """Devices a RAG query can run on — the shared M4 plus the user's nodes."""
    user, err = _require_user()
    if err:
        return err
    devices = [d.to_dict(runtime=_device_runtime(d))
               for d in Device.query.filter_by(is_shared=True).all()]
    owned = Device.query.filter_by(user_id=user.id).order_by(Device.created_at).all()
    devices += [d.to_dict(runtime=_device_runtime(d)) for d in owned]
    return jsonify({"devices": devices})


@app.route("/api/rag/devices/<int:device_id>/models", methods=["GET"])
def rag_device_models(device_id):
    """Models stored on a device + the curated RAG 'variations' (downloaded?)."""
    user, err = _require_user()
    if err:
        return err
    device, derr = _resolve_rag_device(device_id, user.id)
    if derr:
        return derr

    if device.is_shared:
        inventory = rag.local_model_inventory()
        return jsonify({"online": True, "device": device.to_dict(),
                        "catalog": rag.device_model_catalog(inventory),
                        "installed": rag.installed_models(inventory)})

    node = _nodes.get(device.id)
    inventory = node.get("rag_inventory") if node else None
    if inventory is None:
        return jsonify({"online": device.id in _nodes, "device": device.to_dict(),
                        "catalog": [], "installed": {"hf": [], "ollama": []},
                        "reason": "Device is offline or hasn't reported its models yet. "
                                  "Start its node agent."})
    return jsonify({"online": True, "device": device.to_dict(),
                    "catalog": rag.device_model_catalog(inventory),
                    "installed": rag.installed_models(inventory)})


@app.route("/api/rag/devices/<int:device_id>/models/download", methods=["POST"])
def rag_download_model(device_id):
    """Download a model onto a device. Progress streams over a socket room."""
    user, err = _require_user()
    if err:
        return err
    device, derr = _resolve_rag_device(device_id, user.id)
    if derr:
        return derr
    data = request.get_json(silent=True) or {}
    backend = data.get("backend")
    model = data.get("model")
    socket_id = data.get("socket_id")
    if backend not in rag.BACKENDS or not model:
        return jsonify({"error": "backend and model are required"}), 400
    if not rag.BACKENDS[backend].get("local"):
        return jsonify({"error": f"'{backend}' has no downloadable local model."}), 400

    job_id = uuid.uuid4().hex[:12]
    room = f"rag:{job_id}"
    _join_job_room(socket_id, room)

    if device.is_shared:
        cancel_event = threading.Event()
        _rag_download_cancels[job_id] = cancel_event

        def run():
            socketio.emit("rag_download",
                          {"status": "starting", "phase": f"Starting download of {model}…",
                           "downloaded_bytes": 0, "total_bytes": None,
                           "percent": None, "speed_bps": None}, room=room)
            try:
                rag.download_model(
                    backend, model, cancel_event=cancel_event,
                    progress=lambda p: socketio.emit("rag_download", p, room=room))
                inv = rag.local_model_inventory()
                socketio.emit("rag_download_complete",
                              {"model": model, "catalog": rag.device_model_catalog(inv),
                               "installed": rag.installed_models(inv)}, room=room)
            except rag.DownloadCancelled:
                # Best-effort remove partial files so a re-download starts clean.
                try:
                    rag.delete_model(backend, model)
                except Exception:
                    pass
                socketio.emit("rag_download_cancelled",
                              {"model": model, "error": "Download cancelled",
                               "cancelled": True}, room=room)
            except Exception as e:
                socketio.emit("rag_download_error", {"error": str(e)}, room=room)
            finally:
                _rag_download_cancels.pop(job_id, None)
        socketio.start_background_task(run)
        return jsonify({"status": "downloading", "mode": "local", "job_id": job_id, "room": room})

    node = _nodes.get(device.id)
    if not node:
        return jsonify({"error": f"'{device.nickname}' is offline. Start its node agent."}), 409
    # Track the device sid so the cancel endpoint can target the right node.
    _rag_download_cancels[job_id] = {"node_sid": node["sid"]}
    socketio.emit("node_rag_download", {"job_id": job_id, "backend": backend, "model": model},
                  room=node["sid"])
    return jsonify({"status": "downloading", "mode": "remote", "job_id": job_id, "room": room})


@app.route("/api/rag/devices/<int:device_id>/models/download/cancel", methods=["POST"])
def rag_cancel_download(device_id):
    """Cancel an in-flight model download (shared/local or a remote node)."""
    user, err = _require_user()
    if err:
        return err
    device, derr = _resolve_rag_device(device_id, user.id)
    if derr:
        return derr
    data = request.get_json(silent=True) or {}
    job_id = data.get("job_id")
    if not job_id:
        return jsonify({"error": "job_id is required"}), 400

    entry = _rag_download_cancels.get(job_id)
    if entry is None:
        # Already finished/cancelled — treat as success so the UI can reset.
        return jsonify({"status": "not_found", "job_id": job_id})

    if isinstance(entry, threading.Event):
        entry.set()  # local download: the background task observes this and aborts
    elif isinstance(entry, dict) and entry.get("node_sid"):
        socketio.emit("node_rag_download_cancel", {"job_id": job_id}, room=entry["node_sid"])
    return jsonify({"status": "cancelling", "job_id": job_id})


@app.route("/api/rag/devices/<int:device_id>/models", methods=["DELETE"])
def rag_delete_model(device_id):
    """Delete a downloaded model from a device to reclaim disk."""
    user, err = _require_user()
    if err:
        return err
    device, derr = _resolve_rag_device(device_id, user.id)
    if derr:
        return derr
    data = request.get_json(silent=True) or {}
    backend = data.get("backend")  # 'ollama' or any HF-backed backend
    model = data.get("model")
    if not backend or not model:
        return jsonify({"error": "backend and model are required"}), 400

    if device.is_shared:
        try:
            rag.delete_model(backend, model)
        except ValueError as e:
            return jsonify({"error": str(e)}), 404
        except Exception as e:
            return jsonify({"error": f"Delete failed: {e}"}), 500
        inv = rag.local_model_inventory()
        return jsonify({"status": "deleted",
                        "catalog": rag.device_model_catalog(inv),
                        "installed": rag.installed_models(inv)})

    node = _nodes.get(device.id)
    if not node:
        return jsonify({"error": f"'{device.nickname}' is offline. Start its node agent."}), 409
    socketio.emit("node_rag_delete", {"backend": backend, "model": model}, room=node["sid"])
    return jsonify({"status": "deleting", "mode": "remote"})


@app.route("/api/rag/kb/<int:kb_id>/query", methods=["POST"])
@limiter.limit("30 per minute")
def query_kb(kb_id):
    """Retrieve-then-generate against a knowledge base, on the chosen device.

    Retrieval always happens here (the vector store is central). For the shared
    M4 we generate in-process and stream hardware stats over a socket room; for
    a personal node we ship only the grounded prompt and the node generates on
    its own hardware, relaying stats + the answer back."""
    user, err = _require_user()
    if err:
        return err
    kb = KnowledgeBase.query.filter_by(id=kb_id, user_id=user.id).first()
    if not kb:
        return jsonify({"error": "Knowledge base not found"}), 404

    data = request.get_json(silent=True) or {}
    query = (data.get("query") or "").strip()
    if not query:
        return jsonify({"error": "query is required"}), 400
    backend = data.get("backend") or rag.default_backend()
    model = data.get("model") or None
    socket_id = data.get("socket_id")
    try:
        top_k = max(1, min(12, int(data.get("top_k", 4))))
        temperature = max(0.0, min(1.5, float(data.get("temperature", 0.2))))
    except (TypeError, ValueError):
        return jsonify({"error": "top_k/temperature must be numbers"}), 400

    device, derr = _resolve_rag_device(data.get("device_id"), user.id)
    if derr:
        return derr

    job_id = uuid.uuid4().hex[:12]
    room = f"rag:{job_id}"
    _join_job_room(socket_id, room)

    # ── Remote: dispatch the grounded prompt to the user's node ──
    if device is not None and not device.is_shared:
        node = _nodes.get(device.id)
        if not node:
            return jsonify({"error": f"'{device.nickname}' is offline. Start its node agent."}), 409
        ctx = rag.build_context(kb_id, query, top_k=top_k)
        if ctx is None:
            return jsonify({"answer": "Nothing relevant in this knowledge base yet.",
                            "citations": [], "chunks": [], "backend": backend, "model": model})
        _rag_jobs[job_id] = {"citations": ctx["citations"], "chunks": ctx["hits"],
                             "backend": backend, "model": model, "room": room}
        socketio.emit("node_rag_query", {
            "job_id": job_id, "backend": backend, "model": model,
            "system": ctx["system"], "user": ctx["user"],
            "temperature": temperature, "max_tokens": 700,
        }, room=node["sid"])
        return jsonify({"status": "generating", "mode": "remote",
                        "job_id": job_id, "room": room,
                        "citations": ctx["citations"]})

    # ── Local: generate on the shared M4, streaming hardware stats ──
    monitor = SystemMonitor(
        emit_fn=lambda s: socketio.emit("rag_stats", s, room=room),
        sleep_fn=socketio.sleep, run_blocking=_run_blocking,
    )
    socketio.start_background_task(monitor.loop)
    try:
        result = rag.rag_answer(kb_id, query, backend=backend, model=model,
                                top_k=top_k, temperature=temperature)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 409  # backend not available
    except Exception as e:
        return _internal_error("RAG generation failed", e,
                               public_msg="Generation failed — please try again.")
    finally:
        monitor.stop()
    result["mode"] = "local"
    result["room"] = room
    return jsonify(result)


# ─────────────────────────────────────────────────────────
# Chat — ChatGPT-style multi-turn conversations with your models
# ─────────────────────────────────────────────────────────
CHAT_ASSISTANT_PROMPT = (
    "You are a helpful, knowledgeable assistant running inside VortexML. Answer "
    "clearly and concisely, use Markdown when it helps, and keep a friendly tone."
)
_CHAT_HISTORY_LIMIT = 20  # prior turns sent to the model


@app.route("/api/conversations", methods=["GET"])
def list_conversations():
    user, err = _require_user()
    if err:
        return err
    convs = (Conversation.query.filter_by(user_id=user.id)
             .order_by(Conversation.updated_at.desc()).all())
    return jsonify({"conversations": [c.to_dict() for c in convs]})


@app.route("/api/conversations", methods=["POST"])
def create_conversation():
    user, err = _require_user()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    backend = data.get("backend") or rag.default_backend()
    conv = Conversation(
        user_id=user.id,
        title=((data.get("title") or "").strip() or "New chat")[:200],
        backend=backend,
        model=(data.get("model") or None),
        device_id=data.get("device_id"),
        kb_id=data.get("kb_id"),
        reasoning=bool(data.get("reasoning", False)),
    )
    db.session.add(conv)
    db.session.commit()
    return jsonify({"conversation": conv.to_dict()}), 201


@app.route("/api/conversations/<int:conv_id>", methods=["GET"])
def get_conversation(conv_id):
    user, err = _require_user()
    if err:
        return err
    conv = Conversation.query.filter_by(id=conv_id, user_id=user.id).first()
    if not conv:
        return jsonify({"error": "Conversation not found"}), 404
    return jsonify({"conversation": conv.to_dict(include_messages=True)})


@app.route("/api/conversations/<int:conv_id>", methods=["PATCH"])
def update_conversation(conv_id):
    user, err = _require_user()
    if err:
        return err
    conv = Conversation.query.filter_by(id=conv_id, user_id=user.id).first()
    if not conv:
        return jsonify({"error": "Conversation not found"}), 404
    data = request.get_json(silent=True) or {}
    if "title" in data:
        conv.title = ((data.get("title") or "").strip() or conv.title)[:200]
    for field in ("backend", "model"):
        if field in data:
            setattr(conv, field, data.get(field))
    if "device_id" in data:
        conv.device_id = data.get("device_id")
    if "kb_id" in data:
        conv.kb_id = data.get("kb_id")
    if "reasoning" in data:
        conv.reasoning = bool(data.get("reasoning"))
    db.session.commit()
    return jsonify({"conversation": conv.to_dict()})


@app.route("/api/conversations/<int:conv_id>", methods=["DELETE"])
def delete_conversation(conv_id):
    user, err = _require_user()
    if err:
        return err
    conv = Conversation.query.filter_by(id=conv_id, user_id=user.id).first()
    if not conv:
        return jsonify({"error": "Conversation not found"}), 404
    db.session.delete(conv)
    db.session.commit()
    return jsonify({"status": "deleted"})


_chat_cancel = set()  # job_ids the user asked to stop mid-stream


def _assemble_chat(conv, user, rag_query):
    """Build the message list for a turn: system (+ RAG context if a KB is
    attached, retrieved for `rag_query`) + recent history. The history already
    ends with the latest user turn (the caller persists it first)."""
    system_parts = [CHAT_ASSISTANT_PROMPT]
    citations = None
    if conv.kb_id:
        kb = KnowledgeBase.query.filter_by(id=conv.kb_id, user_id=user.id).first()
        if kb:
            ctx = rag.build_context(conv.kb_id, rag_query, top_k=4)
            if ctx:
                system_parts.append(
                    "Use the following retrieved passages to ground your answer when "
                    "relevant, citing them as [1], [2], etc.\n\n" +
                    "\n\n".join(f"[{h['n']}] (from {h['doc_name']})\n{h['text']}"
                               for h in ctx["hits"]))
                citations = ctx["citations"]
    messages = [{"role": "system", "content": "\n\n".join(system_parts)}]
    history = (conv.messages.order_by(ChatMessage.id.desc())
               .limit(_CHAT_HISTORY_LIMIT).all())[::-1]
    for m in history:
        messages.append({"role": m.role, "content": m.content})
    return messages, citations


def _launch_chat_stream(cid, backend, model, resolved_model, messages, cit_json, citations, temperature, room, job_id, reasoning=False):
    """Background task: stream the reply token-by-token (separating any
    reasoning/thinking from the answer, honouring a stop request), then persist
    it and emit the final chat_answer."""
    def run():
        monitor = SystemMonitor(emit_fn=lambda s: socketio.emit("rag_stats", s, room=room),
                                sleep_fn=socketio.sleep, run_blocking=_run_blocking)
        socketio.start_background_task(monitor.loop)
        t0 = time.time()
        answer_parts, reasoning_parts, stopped = [], [], False
        try:
            for kind, delta in rag.stream_chat(backend, model, messages,
                                               temperature=temperature, reasoning=reasoning):
                if job_id in _chat_cancel:
                    stopped = True
                    break
                if not delta:
                    continue
                (reasoning_parts if kind == "reasoning" else answer_parts).append(delta)
                socketio.emit("chat_token", {"job_id": job_id, "delta": delta, "kind": kind}, room=room)
                socketio.sleep(0)  # flush the token + let other clients run
        except Exception as e:
            socketio.emit("chat_error", {"error": str(e)}, room=room)
            monitor.stop(); _chat_jobs.pop(job_id, None); _chat_cancel.discard(job_id)
            return
        monitor.stop()
        _chat_cancel.discard(job_id)
        text = "".join(answer_parts).strip()
        reasoning_text = "".join(reasoning_parts).strip() or None
        if not text and not reasoning_text:  # stopped before any output
            socketio.emit("chat_stopped", {}, room=room)
            _chat_jobs.pop(job_id, None)
            return
        elapsed = time.time() - t0
        ntok = max(1, round((len(text) + len(reasoning_text or "")) / 4))
        tps = round(ntok / elapsed, 1) if elapsed > 0 else None
        with app.app_context():
            msg = ChatMessage(conversation_id=cid, role="assistant", content=text,
                              tokens=ntok, tokens_per_second=tps, model=resolved_model,
                              citations=cit_json, reasoning=reasoning_text)
            db.session.add(msg)
            conv2 = Conversation.query.get(cid)
            if conv2:
                conv2.updated_at = _utcnow()
            db.session.commit()
            payload = msg.to_dict()
        socketio.emit("chat_answer", {"message": payload, "stopped": stopped,
                                      "stats": {"tokens": ntok, "tokens_per_second": tps,
                                                "gen_time": round(elapsed, 3)}}, room=room)
        _chat_jobs.pop(job_id, None)

    _chat_jobs[job_id] = {"conversation_id": cid, "room": room}
    socketio.start_background_task(run)


def _dispatch_chat(conv, user, messages, citations, socket_id, temperature):
    """Send a turn to the conversation's device (node → node_chat; shared M4 →
    local streaming) and return the HTTP response."""
    device, derr = _resolve_rag_device(conv.device_id, user.id)
    if derr:
        return derr
    job_id = uuid.uuid4().hex[:12]
    room = f"rag:{job_id}"
    _join_job_room(socket_id, room)

    if device is not None and not device.is_shared:
        node = _nodes.get(device.id)
        if not node:
            return jsonify({"error": f"'{device.nickname}' is offline. Start its node agent."}), 409
        _chat_jobs[job_id] = {"conversation_id": conv.id, "owner_user_id": user.id,
                              "citations": citations, "model": conv.model, "room": room}
        socketio.emit("node_chat", {
            "job_id": job_id, "backend": conv.backend, "model": conv.model,
            "messages": messages, "temperature": temperature, "max_tokens": 700,
            "reasoning": conv.reasoning,
        }, room=node["sid"])
        return jsonify({"status": "generating", "mode": "remote",
                        "job_id": job_id, "room": room, "citations": citations})

    resolved_model = conv.model or rag.BACKENDS.get(conv.backend, {}).get("default_model")
    cit_json = _json.dumps(citations) if citations else None
    _launch_chat_stream(conv.id, conv.backend, conv.model, resolved_model, messages,
                        cit_json, citations, temperature, room, job_id, reasoning=conv.reasoning)
    return jsonify({"status": "streaming", "mode": "streaming", "job_id": job_id,
                    "room": room, "citations": citations})


@app.route("/api/conversations/<int:conv_id>/message", methods=["POST"])
@limiter.limit("30 per minute")
def send_message(conv_id):
    """Add a user message and stream the assistant reply."""
    user, err = _require_user()
    if err:
        return err
    conv = Conversation.query.filter_by(id=conv_id, user_id=user.id).first()
    if not conv:
        return jsonify({"error": "Conversation not found"}), 404
    data = request.get_json(silent=True) or {}
    content = (data.get("content") or "").strip()
    if not content:
        return jsonify({"error": "content is required"}), 400
    try:
        temperature = max(0.0, min(1.5, float(data.get("temperature", 0.7))))
    except (TypeError, ValueError):
        temperature = 0.7

    # Persist the user turn first, then assemble from history (which now ends
    # with it). Name the chat from the first message.
    if conv.messages.count() == 0 and conv.title == "New chat":
        conv.title = content[:60]
    db.session.add(ChatMessage(conversation_id=conv.id, role="user", content=content))
    conv.updated_at = _utcnow()
    db.session.commit()

    messages, citations = _assemble_chat(conv, user, rag_query=content)
    return _dispatch_chat(conv, user, messages, citations, data.get("socket_id"), temperature)


@app.route("/api/conversations/<int:conv_id>/regenerate", methods=["POST"])
@limiter.limit("30 per minute")
def regenerate_message(conv_id):
    """Drop the last assistant reply and generate a fresh one for the same
    last user turn."""
    user, err = _require_user()
    if err:
        return err
    conv = Conversation.query.filter_by(id=conv_id, user_id=user.id).first()
    if not conv:
        return jsonify({"error": "Conversation not found"}), 404
    data = request.get_json(silent=True) or {}
    try:
        temperature = max(0.0, min(1.5, float(data.get("temperature", 0.7))))
    except (TypeError, ValueError):
        temperature = 0.7

    msgs = conv.messages.order_by(ChatMessage.id).all()
    if not msgs or msgs[-1].role != "assistant":
        return jsonify({"error": "Nothing to regenerate yet."}), 400
    last_user = next((m for m in reversed(msgs) if m.role == "user"), None)
    if last_user is None:
        return jsonify({"error": "No user message to respond to."}), 400
    db.session.delete(msgs[-1])
    conv.updated_at = _utcnow()
    db.session.commit()

    messages, citations = _assemble_chat(conv, user, rag_query=last_user.content)
    return _dispatch_chat(conv, user, messages, citations, data.get("socket_id"), temperature)


@socketio.on("chat_stop")
def on_chat_stop(data):
    """Browser asked to stop an in-flight streaming reply."""
    jid = (data or {}).get("job_id")
    if jid:
        _chat_cancel.add(jid)


# NN prediction formatting + evaluation now live in training_engine
# (format_predictions / evaluate_predictions) so the server and a remote node
# produce byte-identical results.


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


def _cleanup_dataset(state_key, used_path=None):
    """Delete the finishing job's dataset and clear that owner's dataset state.

    Datasets are never persisted — only the trained weights and the run's
    stats are kept. Scoped to `state_key` so a job finishing for one user never
    wipes another user's in-flight setup.

    `used_path` is the dataset file the job actually trained on. When given, the
    owner's working state is only cleared if it still points at that same file —
    so a user who has already uploaded their *next* dataset (while the previous
    run wraps up) doesn't get it wiped out from under them.
    """
    st = _states.get(state_key)
    path = used_path or (st.get("dataset_path") if st else None)
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass
    if st is None:
        return
    if used_path is not None and st.get("dataset_path") != used_path:
        return  # user moved on to a different dataset — leave it alone
    st["dataset_file"] = None
    st["dataset_path"] = None
    st["dataset_info"] = None
    st["feature_cols"] = []
    st["target_col"] = None


def _finish_job(job_id):
    """Drop a finished job, free its device, and start the next queued run."""
    job = _jobs.pop(job_id, None)
    if job:
        _device_busy.pop(job["device_id"], None)
        _drain_queue(job["device_id"])


# ── Job launch + queue plumbing ───────────────────────────
def _snapshot_dataset(job_id, src_path):
    """Copy a dataset to a job-private file so it survives other runs' cleanup
    and the user uploading a new dataset while this job waits in the queue."""
    dst = os.path.join(UPLOAD_DIR, f"queued_{job_id}.csv")
    shutil.copy(src_path, dst)
    return dst


def _delete_job_snapshot(job):
    """Remove a job's private dataset copy, if it has one."""
    p = job.get("dataset_path")
    if p and "queued_" in os.path.basename(p) and os.path.exists(p):
        try:
            os.remove(p)
        except OSError:
            pass


def _start_local_job(job):
    """Begin a local (shared-M4) run NOW. Raises on setup error so the immediate
    caller can return 500; the queue drainer catches and reports to the room."""
    config = job["config"]
    data = prepare_dataset(job["dataset_path"], job["feature_cols"],
                           job["target_col"], batch_size=config["batch_size"])
    model = create_model(config["arch_type"], config["layer_sizes"],
                         data["input_dim"], data["output_dim"],
                         activation=config.get("activation", "relu"))
    torch_device = get_torch_device()
    room = job["room"]
    state_key = job["state_key"]
    owner_user_id = job["owner_user_id"]
    ds_path = job["dataset_path"]
    job_id = job["job_id"]

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

    job["started_at"] = _utcnow().isoformat() + "Z"
    _jobs[job_id] = job
    _device_busy[job["device_id"]] = job_id

    def run():
        monitor = SystemMonitor(
            emit_fn=lambda s: socketio.emit("system_stats", s, room=room),
            sleep_fn=socketio.sleep, run_blocking=_run_blocking,
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
            _states[state_key]["last_weights_file"] = result["weight_filename"]
            try:
                save_preprocess(os.path.join(WEIGHTS_DIR, result["weight_filename"]),
                                data["preprocess"])
            except Exception as e:
                print(f"[train] failed to save preprocess sidecar: {e}")
            _persist_project(owner_user_id, config, result)
        _finish_job(job_id)
        _cleanup_dataset(state_key, ds_path)

    socketio.emit("training_info", training_info, room=room)
    socketio.start_background_task(run)
    return training_info


def _start_remote_job(job, node_sid):
    """Dispatch a job to a node agent NOW. Raises if the dataset can't be read."""
    with open(job["dataset_path"], "rb") as f:
        csv_b64 = base64.b64encode(f.read()).decode()
    job["started_at"] = _utcnow().isoformat() + "Z"
    _jobs[job["job_id"]] = job
    _device_busy[job["device_id"]] = job["job_id"]
    socketio.emit("node_run_job", {
        "job_id": job["job_id"],
        "config": job["config"],
        "feature_cols": job["feature_cols"],
        "target_col": job["target_col"],
        "dataset_name": job["dataset_file"],
        "csv_b64": csv_b64,
    }, room=node_sid)


def _drain_queue(device_id):
    """If the device is free and has a queued job, start the next one (FIFO)."""
    if _device_busy.get(device_id):
        return
    q = _queues.get(device_id)
    if not q:
        return
    job = q.pop(0)
    if job["is_local"]:
        try:
            _start_local_job(job)
        except Exception as e:
            socketio.emit("training_error", {"message": str(e)}, room=job["room"])
            _delete_job_snapshot(job)
            _drain_queue(device_id)  # skip the broken one, try the next
    else:
        node = _nodes.get(device_id)
        if not node:
            q.insert(0, job)  # node offline — wait for it to reconnect
            return
        try:
            _start_remote_job(job, node["sid"])
        except Exception as e:
            socketio.emit("training_error", {"message": str(e)}, room=job["room"])
            _delete_job_snapshot(job)
            _drain_queue(device_id)


def _queue_view(job, status, position):
    return {
        "job_id": job["job_id"],
        "device_id": job["device_id"],
        "is_local": job["is_local"],
        "project_name": job.get("project_name"),
        "status": status,
        "position": position,
        "epoch": job.get("epoch", 0),
        "total_epochs": job.get("total_epochs", 0),
        "started_at": job.get("started_at"),
    }


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
                   "system_stats.py", "rag.py"):
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
    """A browser asks to receive a specific job's live events.

    Only the job's owner may join its room — otherwise any connected client
    could subscribe to another user's training stream by guessing a job id.
    """
    job_id = (data or {}).get("job_id")
    if not job_id:
        return
    job = _jobs.get(job_id)
    # Allow the join only if the caller's working-state key matches the job's
    # owner. Unknown jobs (not yet started / already finished) are refused.
    if job is not None and job.get("state_key") == _state_key():
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
    # Resume any jobs that were queued (or interrupted by a disconnect) while
    # this node was offline.
    _drain_queue(dev.id)


# ── Node RAG protocol (model inventory, download, remote generation) ──
@socketio.on("node_rag_inventory")
def on_node_rag_inventory(data):
    """A node reports which models it has stored, so the catalog can show them."""
    dev_id = _node_sids.get(request.sid)
    if dev_id is not None and dev_id in _nodes:
        _nodes[dev_id]["rag_inventory"] = (data or {}).get("inventory") or {}


@socketio.on("node_rag_download_progress")
def on_node_rag_download_progress(data):
    data = data or {}
    progress = data.get("progress")
    if isinstance(progress, dict):
        payload = progress  # new structured shape — relay as-is
    else:
        # Backwards-tolerant: an older node sends {"status": "<free text>"}.
        payload = {"status": "downloading", "phase": data.get("status", ""),
                   "downloaded_bytes": 0, "total_bytes": None,
                   "percent": None, "speed_bps": None}
    socketio.emit("rag_download", payload, room=f"rag:{data.get('job_id')}")


@socketio.on("node_rag_download_complete")
def on_node_rag_download_complete(data):
    data = data or {}
    _rag_download_cancels.pop(data.get("job_id"), None)
    dev_id = _node_sids.get(request.sid)
    if dev_id is not None and dev_id in _nodes and data.get("inventory"):
        _nodes[dev_id]["rag_inventory"] = data["inventory"]
    catalog = rag.device_model_catalog(data.get("inventory")) if data.get("inventory") else []
    socketio.emit("rag_download_complete", {"model": data.get("model"), "catalog": catalog},
                  room=f"rag:{data.get('job_id')}")


@socketio.on("node_rag_download_error")
def on_node_rag_download_error(data):
    data = data or {}
    _rag_download_cancels.pop(data.get("job_id"), None)
    room = f"rag:{data.get('job_id')}"
    if data.get("cancelled"):
        socketio.emit("rag_download_cancelled",
                      {"model": data.get("model"),
                       "error": data.get("error", "Download cancelled"),
                       "cancelled": True}, room=room)
    else:
        socketio.emit("rag_download_error", {"error": data.get("error", "Download failed")},
                      room=room)


@socketio.on("node_rag_stats")
def on_node_rag_stats(data):
    data = data or {}
    socketio.emit("rag_stats", data.get("stats") or {}, room=f"rag:{data.get('job_id')}")


@socketio.on("node_rag_complete")
def on_node_rag_complete(data):
    """A node finished generating: merge the centrally-built citations and push
    the final answer to the browser room."""
    data = data or {}
    job = _rag_jobs.pop(data.get("job_id"), None)
    room = job["room"] if job else f"rag:{data.get('job_id')}"
    socketio.emit("rag_answer", {
        "answer": (data.get("text") or "").strip(),
        "citations": job["citations"] if job else [],
        "chunks": job["chunks"] if job else [],
        "backend": job["backend"] if job else data.get("backend"),
        "model": data.get("model") or (job["model"] if job else None),
        "stats": data.get("stats"),
    }, room=room)


@socketio.on("node_rag_error")
def on_node_rag_error(data):
    data = data or {}
    _rag_jobs.pop(data.get("job_id"), None)
    socketio.emit("rag_error", {"error": data.get("error", "Remote generation failed")},
                  room=f"rag:{data.get('job_id')}")


@socketio.on("node_predict_stats")
def on_node_predict_stats(data):
    data = data or {}
    socketio.emit("predict_stats", data.get("stats") or {}, room=f"predict:{data.get('job_id')}")


@socketio.on("node_predict_complete")
def on_node_predict_complete(data):
    """A node finished a forward pass: push the predictions + resource use out."""
    data = data or {}
    jid = data.get("job_id")
    job = _predict_jobs.pop(jid, None)
    socketio.emit("predict_result", {
        "task_type": data.get("task_type"),
        "target_col": data.get("target_col"),
        "count": data.get("count"),
        "predictions": data.get("predictions") or [],
        "evaluation": data.get("evaluation"),
        "resource": data.get("resource"),
        "device": job["device"] if job else None,
    }, room=f"predict:{jid}")


@socketio.on("node_predict_error")
def on_node_predict_error(data):
    data = data or {}
    _predict_jobs.pop(data.get("job_id"), None)
    socketio.emit("predict_error", {"error": data.get("error", "Remote prediction failed")},
                  room=f"predict:{data.get('job_id')}")


@socketio.on("node_chat_complete")
def on_node_chat_complete(data):
    """A node finished a chat turn: persist the assistant message + push it out."""
    data = data or {}
    job = _chat_jobs.pop(data.get("job_id"), None)
    room = job["room"] if job else f"rag:{data.get('job_id')}"
    text = (data.get("text") or "").strip()
    stats = data.get("stats") or {}
    payload = {"role": "assistant", "content": text}
    if job:
        conv = Conversation.query.get(job["conversation_id"])
        if conv:
            msg = ChatMessage(
                conversation_id=conv.id, role="assistant", content=text,
                tokens=stats.get("tokens"), tokens_per_second=stats.get("tokens_per_second"),
                model=job.get("model"),
                citations=_json.dumps(job["citations"]) if job.get("citations") else None)
            db.session.add(msg)
            conv.updated_at = _utcnow()
            db.session.commit()
            payload = msg.to_dict()
    socketio.emit("chat_answer", {"message": payload, "stats": stats}, room=room)


@socketio.on("node_chat_error")
def on_node_chat_error(data):
    data = data or {}
    _chat_jobs.pop(data.get("job_id"), None)
    socketio.emit("chat_error", {"error": data.get("error", "Remote chat failed")},
                  room=f"rag:{data.get('job_id')}")


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
    # A node's reported filename is data from the wire — strip any path part so
    # it can only ever land inside WEIGHTS_DIR.
    weight_filename = os.path.basename(meta.get("weight_filename") or "")
    meta["weight_filename"] = weight_filename
    weights_b64 = data.get("weights_b64")
    saved = False
    if weight_filename and weights_b64:
        try:
            with open(os.path.join(WEIGHTS_DIR, weight_filename), "wb") as f:
                f.write(base64.b64decode(weights_b64))
            pp = data.get("preprocess")
            if pp:
                save_preprocess(os.path.join(WEIGHTS_DIR, weight_filename), pp)
            saved = True
        except Exception as e:
            print(f"[node] failed to save weights {weight_filename}: {e}")
    state_key = job["state_key"]
    used_path = job.get("dataset_path")
    if not saved:
        # The node finished but shipped no usable weights (missing/corrupt
        # payload or a disk error above). Persisting a Project here would create
        # a row whose weight_filename points at a file that isn't on disk, so
        # every later inference/export/download for it would 404. Surface a
        # training error and clean up instead of recording a broken project.
        print(f"[node] run {job['job_id']} completed without usable weights — not persisting")
        socketio.emit("training_error",
                      {"error": "The device finished but did not return usable model weights."},
                      room=job["room"])
        _finish_job(job["job_id"])
        _cleanup_dataset(state_key, used_path)
        return
    _states[state_key]["last_weights_file"] = weight_filename
    _persist_project(job["owner_user_id"], job["config"], meta)
    socketio.emit("training_complete", meta, room=job["room"])
    _finish_job(job["job_id"])
    _cleanup_dataset(state_key, used_path)


@socketio.on("node_stopped")
def on_node_stopped(data):
    job = _jobs.get((data or {}).get("job_id"))
    if not job:
        return
    state_key = job["state_key"]
    used_path = job.get("dataset_path")
    socketio.emit("training_stopped", {}, room=job["room"])
    _finish_job(job["job_id"])
    _cleanup_dataset(state_key, used_path)


@socketio.on("node_error")
def on_node_error(data):
    data = data or {}
    job = _jobs.get(data.get("job_id"))
    if not job:
        return
    state_key = job["state_key"]
    used_path = job.get("dataset_path")
    socketio.emit("training_error",
                  {"message": data.get("error", "Remote training failed")},
                  room=job["room"])
    _finish_job(job["job_id"])
    _cleanup_dataset(state_key, used_path)


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
@limiter.limit("30 per minute")
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
        return _internal_error("chatbot call failed", e,
                               public_msg="Chatbot error — please try again.")

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
    "user will train this model and judge VortexML by the result. Work the "
    "decision tree below in order, in the extended-thinking block, before you "
    "call the tool. Do NOT make a snap decision and do NOT skip a step.\n\n"
    "Available architectures (use EXACTLY one of these keys): mlp, dnn, cnn1d, "
    "rnn, lstm, gru, autoencoder, resnet, transformer, wide_deep.\n\n"
    "STEP 1 — TASK TYPE, from concrete target facts.\n"
    "  Look at the target column's dtype and unique-value count.\n"
    "  - numeric target with > 10 unique values → regression.\n"
    "  - non-numeric, or numeric with <= 10 unique values → classification.\n"
    "  - user said anomaly / fraud / outlier / 'find unusual' → treat as anomaly.\n\n"
    "STEP 2 — STRUCTURE, from feature facts.\n"
    "  - SEQUENTIAL? Time-series / ordered rows, or columns named like 'date', "
    "    'time', 'timestamp', 't', 'lag_*', 'step', 'year', 'month'.\n"
    "  - HETEROGENEITY? Count categorical vs numeric features. 'Sparse-categorical-"
    "    heavy' means >= 3 categorical features and at least as many categorical as "
    "    numeric.\n"
    "  - SIZE BAND from row count: <1k, 1k-10k, 10k-50k, >50k.\n\n"
    "STEP 3 — ARCHITECTURE DECISION TREE. Evaluate these rules top-to-bottom and "
    "take the FIRST that matches. Name the rule you used in the justification.\n"
    "  (R1 anomaly)        anomaly/unsupervised framing            → autoencoder.\n"
    "  (R2 sequential_long)  sequential AND >= 2k rows             → lstm.\n"
    "  (R3 sequential_short) sequential AND < 2k rows              → gru.\n"
    "  (R4 mixed_sparse_dense) sparse-categorical-heavy tabular    → wide_deep.\n"
    "  (R5 large_depth)     non-sequential AND > 50k rows          → resnet.\n"
    "  (R6 tiny_safe)       non-sequential tabular AND < 2k rows   → mlp.\n"
    "  (R7 medium_reg)      non-sequential tabular, 2k-50k rows    → dnn.\n"
    "  cnn1d only for genuinely ordered/local-structure features (signals); rnn is "
    "  almost never preferred over lstm/gru.\n\n"
    "  USE-WHEN / AVOID-WHEN guardrails (do not violate):\n"
    "  - transformer & resnet: only for large data (> 50k rows). NEVER on < 2k rows "
    "    — they overfit catastrophically.\n"
    "  - lstm/gru/rnn: ONLY when Step 2 found sequential structure. NEVER on plain "
    "    independent tabular rows.\n"
    "  - wide_deep: when there is a real mix of sparse categorical + dense numeric.\n"
    "  - autoencoder: anomaly detection / representation learning, not ordinary "
    "    supervised tasks.\n"
    "  - mlp: the safe default for small tabular; dnn adds BatchNorm+Dropout for "
    "    medium tabular.\n\n"
    "STEP 4 — CAPACITY by size band (the deep arm for wide_deep; hidden/d_model "
    "  for recurrent/transformer, first value >= 32):\n"
    "  - <1k:    [32, 16]      - 1k-10k:  [64, 32]\n"
    "  - 10k-50k:[128, 64]     - >50k:    [256, 128, 64]\n"
    "  OVER-PARAMETERIZATION GUARD: on < 2k rows, never exceed depth 3 or width "
    "  128, and ALWAYS enable early stopping.\n\n"
    "STEP 5 — EPOCHS by band: <1k → 20-40 (early stop, patience 5-8); 1k-50k → "
    "  40-80 (early stop, patience 8-12); >50k → 80-150 (early stop optional).\n\n"
    "STEP 6 — LEARNING RATE: 0.001 default; 0.0001 for transformer/resnet or "
    "  stacks with 3+ layers.\n\n"
    "STEP 7 — BATCH SIZE: 32 default; 64 for > 10k rows; 128 for > 100k rows; 16 "
    "  for < 500 rows.\n\n"
    "STEP 8 — OPTIMIZER & ACTIVATION: adam + relu by default; adamw for "
    "  transformer/resnet; gelu for transformer; tanh inside rnn/lstm/gru only if "
    "  the user mentioned bounded outputs.\n\n"
    "STEP 9 — SANITY CHECK: re-read every choice against a CONCRETE dataset fact "
    "  (rows, target dtype/cardinality, feature mix, user message). Fix anything "
    "  arbitrary, and re-verify the guardrails in Step 3/4.\n\n"
    "JUSTIFICATION (required) — 2-4 sentences that (a) NAME which decision-tree "
    "rule fired (e.g. 'R6 tiny_safe'), and (b) cite specific facts from THIS "
    "dataset: row count, the target column's name + key characteristic "
    "(dtype/cardinality/range), and one more property (feature count or mix, "
    "sequential structure) that drove the choice. No generic platitudes.\n\n"
    "OUTPUT CONTRACT — Reason through every step in the extended-thinking block. "
    "Then your visible response MUST be a single call to the `set_model_config` "
    "tool. Do NOT respond with plain text instead of a tool call. Do NOT ask "
    "follow-up questions. Do NOT call the tool more than once. The tool call IS "
    "your answer."
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
    st = _get_state()
    info = st.get("dataset_info")
    if not info:
        return "(No dataset has been uploaded yet.)"

    feature_cols = st.get("feature_cols") or []
    target_col = st.get("target_col")

    lines = [
        f"Filename: {st.get('dataset_file')}",
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


_SEQ_HINTS = ("date", "time", "timestamp", "lag", "step", "year", "month", "day", "seq")


def _dataset_facts(transcript_text=""):
    """Structured dataset facts for the rule engine (auto_config_rules).

    Derived from the analysed dataset + the user's column selection, mirroring
    the task-type rule in data_processor.prepare_dataset so the guard agrees
    with how training will actually treat the data.
    """
    st = _get_state()
    info = st.get("dataset_info") or {}
    feature_cols = st.get("feature_cols") or []
    target_col = st.get("target_col")
    columns = {c.get("name"): c for c in (info.get("columns") or [])}

    task_type = "classification"
    tinfo = columns.get(target_col)
    if tinfo and tinfo.get("is_numeric") and (tinfo.get("unique") or 0) > 10:
        task_type = "regression"

    n_numeric = sum(1 for c in feature_cols if columns.get(c, {}).get("is_numeric"))
    n_categorical = len(feature_cols) - n_numeric
    sequential = any(
        any(h in (c or "").lower() for h in _SEQ_HINTS) for c in feature_cols)
    anomaly = any(w in (transcript_text or "").lower()
                  for w in ("anomaly", "anomalies", "fraud", "outlier", "unusual"))

    return {
        "rows": info.get("rows") or 0,
        "task_type": task_type,
        "n_features": len(feature_cols),
        "n_numeric": n_numeric,
        "n_categorical": n_categorical,
        "sequential": sequential,
        "anomaly": anomaly,
    }


@app.route("/api/auto-config/status", methods=["GET"])
def auto_config_status():
    user, err = _require_user()
    if err:
        return err
    reason = _auto_config_available_reason()
    if reason:
        return jsonify({"available": False, "reason": reason})
    return jsonify({"available": True, "has_dataset": _get_state()["dataset_path"] is not None})


@app.route("/api/auto-config/chat", methods=["POST"])
@limiter.limit("30 per minute")
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
        return _internal_error("auto-configure call failed", e,
                               public_msg="Auto-Configure error — please try again.")

    text = ""
    for block in resp.content:
        if getattr(block, "type", None) == "text":
            text = block.text
            break
    return jsonify({"role": "assistant", "content": text})


@app.route("/api/auto-config/decide", methods=["POST"])
@limiter.limit("10 per minute")
def auto_config_decide():
    user, err = _require_user()
    if err:
        return err

    reason = _auto_config_available_reason()
    if reason:
        return jsonify({"error": reason}), 503

    if not _get_state()["dataset_path"]:
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

    # Structured facts for the rule engine: used to guard the LLM's pick and as
    # a deterministic fallback if it fails to emit a config.
    facts = _dataset_facts(transcript)
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
        return _internal_error("auto-configure call failed", e,
                               public_msg="Auto-Configure error — please try again.")

    config = None
    for block in resp.content:
        btype = getattr(block, "type", None)
        if btype == "tool_use" and getattr(block, "name", None) == "set_model_config":
            config = block.input
            break

    source = "picker"
    if not config or not isinstance(config, dict):
        # The picker failed to emit a tool call — fall back to the deterministic
        # decision tree instead of erroring out.
        config = recommend_config(facts)
        source = "rules"

    # Always run the over-parameterization guard so the final config can't be
    # too heavy for the dataset, no matter which path produced it.
    config, adjustments = guard_config(config, facts)
    return jsonify({"config": config, "source": source, "adjustments": adjustments})


# ─────────────────────────────────────────────────────────
# Explain-my-results (tutor bot reviews a finished run)
# ─────────────────────────────────────────────────────────
EXPLAIN_RESULTS_PROMPT = (
    "You are a friendly ML tutor in VortexML reviewing the results of a neural "
    "network the user just trained on tabular data. Give a short, encouraging, "
    "plain-English verdict. Cover, in 2-4 short paragraphs:\n"
    "- How the training went overall (did the loss come down and settle?).\n"
    "- Overfitting vs underfitting: read the gap and trend between training and "
    "  validation loss. A validation loss that rises while training loss keeps "
    "  falling = overfitting; both stuck high = underfitting.\n"
    "- A readiness verdict: is this model good enough to use, or worth retraining?\n"
    "- 1-2 concrete next steps tied to what you see (e.g. enable early stopping, "
    "  add/reduce capacity, lower the learning rate, get more data).\n"
    "Use simple language, define any jargon briefly, and be specific to the "
    "numbers given — do not invent metrics that aren't provided."
)


def _summarize_run(name, cfg, task_type, history, final):
    """Compact, factual summary of a finished run for the tutor to reason over."""
    lines = [
        f"Project: {name}",
        f"Task type: {task_type}",
        f"Architecture: {cfg.get('arch_type')} layers={cfg.get('layer_sizes')}",
        f"Hyperparameters: lr={cfg.get('lr')}, batch_size={cfg.get('batch_size')}, "
        f"optimizer={cfg.get('optimizer')}, activation={cfg.get('activation')}, "
        f"requested_epochs={cfg.get('epochs')}",
        f"Early stopping: {cfg.get('early_stopping')}",
    ]
    if history:
        first, last = history[0], history[-1]
        lines.append(f"Epochs actually run: {len(history)}")
        lines.append(f"First epoch: train_loss={first.get('train_loss')}, val_loss={first.get('val_loss')}")
        lines.append(f"Last epoch:  train_loss={last.get('train_loss')}, val_loss={last.get('val_loss')}")
        val_losses = [h.get("val_loss") for h in history if h.get("val_loss") is not None]
        if val_losses:
            best = min(val_losses)
            lines.append(f"Best validation loss: {round(best, 6)} at epoch "
                         f"{val_losses.index(best) + 1}")
        if task_type == "classification":
            accs = [h.get("val_acc") for h in history if h.get("val_acc") is not None]
            if accs:
                lines.append(f"Validation accuracy: first={accs[0]}%, last={accs[-1]}%, best={max(accs)}%")
    if final:
        lines.append(f"Final metrics: {final}")
    return "\n".join(lines)


@app.route("/api/explain-results", methods=["POST"])
@limiter.limit("20 per minute")
def explain_results():
    """Plain-English verdict on a finished run. Accepts either {project_id}
    (loads a saved project) or the just-finished run's {config, history,
    task_type, metrics} from the Training page."""
    user, err = _require_user()
    if err:
        return err
    reason = _auto_config_available_reason()  # needs ANTHROPIC_API_KEY
    if reason:
        return jsonify({"error": reason}), 503

    body = request.get_json(silent=True) or {}
    project_id = body.get("project_id")
    if project_id is not None:
        proj = Project.query.filter_by(id=project_id, user_id=user.id).first()
        if not proj:
            return jsonify({"error": "Project not found"}), 404
        cfg = {
            "arch_type": proj.arch_type,
            "layer_sizes": _json.loads(proj.layer_sizes),
            "epochs": proj.epochs, "lr": proj.lr, "batch_size": proj.batch_size,
            "optimizer": proj.optimizer, "activation": proj.activation,
            "early_stopping": _json.loads(proj.early_stopping) if proj.early_stopping else {},
        }
        history = _json.loads(proj.history) if proj.history else []
        task_type = proj.task_type
        name = proj.name
        final = {"final_train_loss": proj.final_train_loss,
                 "final_val_loss": proj.final_val_loss,
                 "final_val_acc": proj.final_val_acc,
                 "early_stopped": proj.early_stopped,
                 "stopped_epoch": proj.stopped_epoch}
    else:
        cfg = body.get("config") or {}
        history = body.get("history") or []
        if not isinstance(history, list):
            history = []
        history = history[:500]  # cap forwarded payload
        task_type = body.get("task_type") or "classification"
        name = cfg.get("project_name") or "your model"
        final = body.get("metrics") or {}

    if not history and not final:
        return jsonify({"error": "Nothing to explain — no training history provided."}), 400

    summary = _summarize_run(name, cfg, task_type, history, final)
    try:
        client = _get_anthropic_client()
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=700,
            thinking={"type": "disabled"},
            output_config={"effort": "low"},
            system=[{"type": "text", "text": EXPLAIN_RESULTS_PROMPT,
                     "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user",
                       "content": f"Here is the training run to review:\n\n{summary}"}],
        )
    except anthropic.AuthenticationError:
        return jsonify({"error": "Explain is misconfigured (invalid API key)."}), 503
    except anthropic.RateLimitError:
        return jsonify({"error": "Busy — please try again in a moment."}), 429
    except anthropic.APIError as e:
        return jsonify({"error": f"Explain error: {e}"}), 502
    except Exception as e:
        return _internal_error("explain-results call failed", e,
                               public_msg="Explain error — please try again.")

    text = ""
    for block in resp.content:
        if getattr(block, "type", None) == "text":
            text = block.text
            break
    return jsonify({"explanation": text})


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
        if job and not job["is_local"] and job.get("attempts", 0) < _MAX_RESUME_ATTEMPTS:
            # Resume: re-queue the interrupted run (it keeps its dataset snapshot)
            # so it restarts automatically when the node reconnects.
            job["attempts"] = job.get("attempts", 0) + 1
            job["started_at"] = None
            _jobs.pop(busy_job_id, None)
            _device_busy.pop(dev_id, None)
            _queues[dev_id].insert(0, job)
            socketio.emit("training_requeued",
                          {"message": "Node disconnected — will resume when it reconnects."},
                          room=job["room"])
        else:
            state_key = job.get("state_key") if job else None
            used_path = job.get("dataset_path") if job else None
            if job:
                socketio.emit("training_error",
                              {"message": "Node disconnected during training"},
                              room=job["room"])
            _finish_job(busy_job_id)
            if state_key:
                _cleanup_dataset(state_key, used_path)
    print(f"[node] disconnected: device #{dev_id}")


# ─────────────────────────────────────────────────────────
# Run
# ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    # Debug mode exposes the Werkzeug debugger (arbitrary code execution on an
    # unhandled error) and must stay OFF unless explicitly opted in. Likewise,
    # bind to localhost by default and let a reverse proxy / tunnel own any
    # public exposure; override with VORTEX_BIND=0.0.0.0 when that's intended.
    debug = os.environ.get("FLASK_DEBUG") == "1"
    host = os.environ.get("VORTEX_BIND", "127.0.0.1")
    port = int(os.environ.get("VORTEX_PORT", "5050"))
    # Periodically prune abandoned anonymous working-state so memory doesn't
    # grow without bound on a long-running public instance.
    socketio.start_background_task(_state_evictor_loop)
    socketio.run(app, host=host, port=port, debug=debug)
