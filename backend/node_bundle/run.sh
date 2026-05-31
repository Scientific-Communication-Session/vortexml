#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
#  VortexML Node Agent — one-shot setup + launch.
#  Creates a venv, installs dependencies, builds the folder
#  layout VortexML expects, and starts the node agent.
# ─────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")"

echo "──────────────────────────────────────────────"
echo "  VortexML Node — setup"
echo "──────────────────────────────────────────────"

# 1. Locate a Python 3 interpreter.
if command -v python3 >/dev/null 2>&1; then
    PY=python3
elif command -v python >/dev/null 2>&1; then
    PY=python
else
    echo "ERROR: Python 3 is required. Install it from https://python.org"
    exit 1
fi
echo "Python: $($PY --version)"

# 2. Virtual environment + dependencies.
if [ ! -d venv ]; then
    echo "Creating virtual environment (venv/)…"
    "$PY" -m venv venv
fi
# shellcheck disable=SC1091
source venv/bin/activate
# --no-cache-dir avoids the "Cache entry deserialization failed" warnings
# that a stale/corrupt pip wheel cache produces.
python -m pip install --upgrade pip -q --no-cache-dir
echo "Installing dependencies — first run can take a few minutes…"
python -m pip install -r requirements.txt -q --no-cache-dir

# 2b. Apple-Silicon extra: MLX is the M4's native/fastest local LLM backend, so
#     a Mac node installs it for full parity. It is Mac-only (it won't install on
#     Linux/Windows or Intel Macs), so other platforms skip it and generate
#     locally via Transformers instead. A failed optional install must NOT abort
#     setup — the node still works without MLX — so we warn and continue.
OS="$(uname -s)"
ARCH="$(uname -m)"
if [ "$OS" = "Darwin" ] && [ "$ARCH" = "arm64" ]; then
    echo "Apple Silicon detected — installing mlx-lm (fastest local backend on this Mac)…"
    if python -m pip install -q --no-cache-dir "mlx-lm>=0.20"; then
        echo "mlx-lm installed ✓"
    else
        echo "WARNING: mlx-lm install failed — the node will still run, using Transformers"
        echo "         for local generation instead. You can retry 'pip install mlx-lm' later."
    fi
else
    echo "Non-Apple-Silicon platform ($OS/$ARCH) — skipping MLX (Mac-only);"
    echo "local generation will use Transformers."
fi

# 3. Folder layout VortexML's training engine expects.
mkdir -p uploads/weights

# 4. Launch. Metal fallback lets MPS defer unsupported ops to the CPU;
#    unbuffered output so the banner + logs show immediately.
export PYTORCH_ENABLE_MPS_FALLBACK=1
export PYTHONUNBUFFERED=1
echo "Launching node agent…"
exec python node_agent.py
