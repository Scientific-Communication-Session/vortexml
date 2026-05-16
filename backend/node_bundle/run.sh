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
python -m pip install --upgrade pip -q
echo "Installing dependencies — first run can take a few minutes…"
python -m pip install -r requirements.txt -q

# 3. Folder layout VortexML's training engine expects.
mkdir -p uploads/weights

# 4. Launch. Metal fallback lets MPS defer unsupported ops to the CPU.
export PYTORCH_ENABLE_MPS_FALLBACK=1
echo "──────────────────────────────────────────────"
echo "  Starting node agent — leave this window open."
echo "  Press Ctrl+C to stop the node."
echo "──────────────────────────────────────────────"
exec python node_agent.py
