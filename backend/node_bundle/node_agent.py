#!/usr/bin/env python3
"""
VortexML — Node Agent

Runs on a user's own machine (a home Mac, a server, a spare laptop). It dials
*out* to the central VortexML server — so it works from behind a home router
with no port-forwarding — registers this machine as a training device, and
runs whatever training job the server dispatches, streaming live progress back
over the same socket.

Everything it needs (training_engine.py, data_processor.py, device_specs.py)
ships alongside this file. Per-account configuration lives in node_config.json,
which was generated when you downloaded this bundle.
"""

import os
import sys
import json
import time
import base64
import threading
import traceback

try:
    import socketio  # python-socketio client
except ImportError:
    sys.exit("Missing dependency 'python-socketio'. Run ./run.sh — it installs everything.")

from device_specs import detect_specs
from data_processor import prepare_dataset
from training_engine import create_model, train_model, get_torch_device, _stop_training
from system_stats import SystemMonitor

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "node_config.json")
UPLOAD_DIR = os.path.join(HERE, "uploads")
os.makedirs(os.path.join(UPLOAD_DIR, "weights"), exist_ok=True)


def load_config():
    if not os.path.exists(CONFIG_PATH):
        sys.exit("node_config.json not found — re-download the bundle from VortexML.")
    with open(CONFIG_PATH) as f:
        cfg = json.load(f)
    # Environment overrides — handy for local testing without re-zipping.
    cfg["central_url"] = os.environ.get("VORTEX_CENTRAL_URL", cfg["central_url"])
    return cfg


CONFIG = load_config()
CENTRAL_URL = CONFIG["central_url"].rstrip("/")
DEVICE_TOKEN = CONFIG["device_token"]
NICKNAME = CONFIG.get("nickname", "My Device")

sio = socketio.Client(reconnection=True, reconnection_attempts=0,
                      reconnection_delay=3, reconnection_delay_max=15)

# A node runs exactly one job at a time.
_job_lock = threading.Lock()
_active_job = {"id": None, "thread": None}


class CentralRelay:
    """Stand-in for the flask-socketio object that train_model expects.

    Forwards each per-epoch emit to the central server, tagged with the job id.
    Completion and stop are reported explicitly by the agent (completion needs
    the weights payload attached), so those two events are not relayed here.
    """
    _SKIP = {"training_complete", "training_stopped"}

    def __init__(self, client, job_id):
        self.client = client
        self.job_id = job_id

    def emit(self, event, data, room=None):
        if event in self._SKIP:
            return
        try:
            self.client.emit("node_relay",
                             {"job_id": self.job_id, "event": event, "data": data})
        except Exception:
            pass

    def sleep(self, seconds=0):
        time.sleep(seconds)


def _relay(job_id, event, data):
    try:
        sio.emit("node_relay", {"job_id": job_id, "event": event, "data": data})
    except Exception:
        pass


def _run_job(payload):
    """Execute one training job end to end (runs in a worker thread)."""
    job_id = payload["job_id"]
    csv_path = None
    relay = CentralRelay(sio, job_id)
    # Stream this machine's CPU/GPU/RAM + temps back while it trains.
    monitor = SystemMonitor(
        emit_fn=lambda s: _relay(job_id, "system_stats", s),
        sleep_fn=time.sleep,
    )
    threading.Thread(target=monitor.loop, daemon=True).start()
    try:
        config = payload["config"]
        ds_name = payload.get("dataset_name") or "dataset.csv"
        csv_path = os.path.join(UPLOAD_DIR, f"job_{job_id}_{ds_name}")
        with open(csv_path, "wb") as f:
            f.write(base64.b64decode(payload["csv_b64"]))

        print(f"[node] job {job_id}: preparing '{ds_name}'")
        data = prepare_dataset(csv_path, payload["feature_cols"],
                               payload["target_col"], batch_size=config["batch_size"])
        model = create_model(config["arch_type"], config["layer_sizes"],
                             data["input_dim"], data["output_dim"],
                             activation=config.get("activation", "relu"))

        torch_device = get_torch_device()
        _relay(job_id, "training_info", {
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
        })

        print(f"[node] job {job_id}: training on {torch_device}")
        result = train_model(model, data["train_loader"], data["val_loader"],
                             data["task_type"], config, relay,
                             input_dim=data["input_dim"],
                             output_dim=data["output_dim"],
                             device=torch_device)

        if result is None:
            sio.emit("node_stopped", {"job_id": job_id})
            print(f"[node] job {job_id}: stopped")
        else:
            with open(result["model_path"], "rb") as f:
                weights_b64 = base64.b64encode(f.read()).decode()
            meta = {k: v for k, v in result.items() if k != "model_path"}
            sio.emit("node_complete", {"job_id": job_id, "meta": meta,
                                       "weights_b64": weights_b64})
            print(f"[node] job {job_id}: complete ✓ ({result['weight_filename']})")
    except Exception as e:
        traceback.print_exc()
        try:
            sio.emit("node_error", {"job_id": job_id, "error": str(e)})
        except Exception:
            pass
    finally:
        monitor.stop()
        # Never keep someone's dataset on disk after the run.
        if csv_path and os.path.exists(csv_path):
            try:
                os.remove(csv_path)
            except OSError:
                pass
        with _job_lock:
            _active_job["id"] = None
            _active_job["thread"] = None


# ── SocketIO event handlers ──────────────────────────────
@sio.event
def connect():
    specs = detect_specs()
    print(f"[node] connected to {CENTRAL_URL}")
    sio.emit("node_register", {"token": DEVICE_TOKEN,
                               "nickname": NICKNAME, "specs": specs})


@sio.event
def disconnect():
    print("[node] disconnected — retrying…")


@sio.on("node_registered")
def on_registered(data):
    print(f"[node] paired ✓  device #{data.get('device_id')} "
          f"'{data.get('nickname')}'  [{data.get('accelerator_label', '')}]")
    print("[node] idle — waiting for training jobs…")


@sio.on("node_register_failed")
def on_register_failed(data):
    print(f"[node] ✗ pairing rejected: {data.get('error')}")
    print("[node] Re-download the bundle from your VortexML profile, then retry.")
    sio.disconnect()
    os._exit(1)


@sio.on("node_run_job")
def on_run_job(payload):
    job_id = payload.get("job_id")
    with _job_lock:
        if _active_job["id"] is not None:
            sio.emit("node_error", {"job_id": job_id,
                                    "error": "Node is already running a job"})
            return
        t = threading.Thread(target=_run_job, args=(payload,), daemon=True)
        _active_job["id"] = job_id
        _active_job["thread"] = t
    t.start()


@sio.on("node_stop")
def on_stop(data):
    print(f"[node] stop requested for job {(data or {}).get('job_id')}")
    _stop_training.set()


# ── Startup banners ──────────────────────────────────────
_VORTEX_ART = r"""
$$\    $$\                      $$\                               $$\      $$\ $$\
$$ |   $$ |                     $$ |                              $$$\    $$$ |$$ |
$$ |   $$ | $$$$$$\   $$$$$$\ $$$$$$\    $$$$$$\  $$\   $$\       $$$$\  $$$$ |$$ |
\$$\  $$  |$$  __$$\ $$  __$$\\_$$  _|  $$  __$$\ \$$\ $$  |      $$\$$\$$ $$ |$$ |
 \$$\$$  / $$ /  $$ |$$ |  \__| $$ |    $$$$$$$$ | \$$$$  /       $$ \$$$  $$ |$$ |
  \$$$  /  $$ |  $$ |$$ |       $$ |$$\ $$   ____| $$  $$<        $$ |\$  /$$ |$$ |
   \$  /   \$$$$$$  |$$ |       \$$$$  |\$$$$$$$\ $$  /\$$\       $$ | \_/ $$ |$$$$$$$$\
    \_/     \______/ \__|        \____/  \_______|\__/  \__|      \__|     \__|\________|
"""

_STOP_ART = r"""
         _            _
        | |          | |    _
   ___  | |_   _ __  | |  _| |_    ___
  / __| | __| | '__| | | |_   _|  / __|
 | (__  | |_  | |    | |   |_|   | (__
  \___|  \__| |_| _  |_|          \___|
  | |            | |
  | |_ ___    ___| |_ ___  _ __
  | __/ _ \  / __| __/ _ \| '_ \
 | || (_) | \__ \ || (_) | |_) |
  \__\___/  |___/\__\___/| .__/
                          | |
                          |_|
"""

_RESET = "\033[0m"


def _ansi(rgb):
    return f"\033[38;2;{rgb[0]};{rgb[1]};{rgb[2]}m"


def _solid_banner(art, rgb):
    """Paint every line of the art in one colour."""
    a = _ansi(rgb)
    return "\n".join(a + line + _RESET for line in art.strip("\n").splitlines())


def main():
    # VortexML wordmark — lilly purple.
    print()
    print(_solid_banner(_VORTEX_ART, (190, 150, 255)))
    print()
    print(f"   node agent  ·  '{NICKNAME}'")
    print(f"   central     ·  {CENTRAL_URL}")
    print()
    # "ctrl + c to stop" — red.
    print(_solid_banner(_STOP_ART, (239, 68, 68)))
    print()
    while True:
        try:
            sio.connect(CENTRAL_URL, transports=["websocket", "polling"])
            sio.wait()
        except KeyboardInterrupt:
            print("\n[node] shutting down.")
            sio.disconnect()
            break
        except Exception as e:
            print(f"[node] connection failed: {e} — retrying in 5s")
            time.sleep(5)


if __name__ == "__main__":
    main()
