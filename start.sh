#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
#  VortexML — One-click Start Script
#  Sets up venvs, installs packages, and launches both
#  the Flask backend and the Vite frontend.
# ─────────────────────────────────────────────────────────
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
VENV_DIR="$BACKEND_DIR/venv"

# ── Colors ───────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[  OK]${NC}  $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $1"; }

# ── Cleanup on exit ─────────────────────────────────────
cleanup() {
    info "Shutting down…"
    # Kill background jobs (backend & frontend)
    kill $(jobs -p) 2>/dev/null
    wait 2>/dev/null
    ok "All processes stopped."
}
trap cleanup EXIT INT TERM

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║         🌀  VortexML  Launcher           ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""

# ─────────────────────────────────────────────────────────
# 0. Load secrets from .env (git-ignored)
# ─────────────────────────────────────────────────────────
# .env lives next to this script. The repo's .gitignore already excludes it,
# so paste real keys there — never inline in this script.
ENV_FILE="$ROOT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
    # `set -a` exports every assignment until we turn it off again.
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
    ok "Loaded environment from .env"
fi

if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    ok "Chatbot enabled (ANTHROPIC_API_KEY found, length=${#ANTHROPIC_API_KEY})"
else
    warn "ANTHROPIC_API_KEY not set — the Novice-mode chatbot will be disabled."
    warn "  Add ANTHROPIC_API_KEY=sk-ant-... to $ENV_FILE and rerun, or export it"
    warn "  in this shell before running this script. See .env.example for the template."
fi

echo ""

# ─────────────────────────────────────────────────────────
# 1. Check prerequisites
# ─────────────────────────────────────────────────────────
info "Checking prerequisites…"

# Python 3
if command -v python3 &>/dev/null; then
    PYTHON=python3
elif command -v python &>/dev/null; then
    PYTHON=python
else
    fail "Python 3 is required but not found. Install it from https://python.org"
    exit 1
fi
ok "Python found: $($PYTHON --version)"

# Node.js & npm
if ! command -v node &>/dev/null; then
    fail "Node.js is required but not found. Install it from https://nodejs.org"
    exit 1
fi
ok "Node.js found: $(node --version)"

if ! command -v npm &>/dev/null; then
    fail "npm is required but not found."
    exit 1
fi
ok "npm found: $(npm --version)"

echo ""

# ─────────────────────────────────────────────────────────
# 2. Backend — Python virtual environment & dependencies
# ─────────────────────────────────────────────────────────
info "Setting up Python backend…"

if [ ! -d "$VENV_DIR" ]; then
    info "Creating virtual environment at $VENV_DIR…"
    $PYTHON -m venv "$VENV_DIR"
    ok "Virtual environment created."
else
    ok "Virtual environment already exists."
fi

# Activate venv and use its Python explicitly
source "$VENV_DIR/bin/activate"
PYTHON="$VENV_DIR/bin/python"
ok "Virtual environment activated."

# Upgrade pip silently
"$PYTHON" -m pip install --upgrade pip -q

# Install requirements
info "Installing Python dependencies (this may take a while on first run)…"
"$PYTHON" -m pip install -r "$BACKEND_DIR/requirements.txt" -q
ok "Python dependencies installed."

# ── Check database connectivity ─────────────────────────
info "Checking PostgreSQL connectivity…"
if $PYTHON -c "import psycopg2; psycopg2.connect('postgresql://postgres:postgres@localhost:5432/vortex_db').close()" 2>/dev/null; then
    ok "PostgreSQL is reachable."
else
    warn "PostgreSQL is not reachable — switching backend to SQLite."
    warn "Auth features will use a local SQLite database (backend/vortex.db)."

    # Patch the database URI in app.py for this session via env var
    export SQLALCHEMY_DATABASE_URI="sqlite:///$BACKEND_DIR/vortex.db"

    # Create a tiny wrapper so app.py picks up the env var
    export VORTEX_USE_SQLITE=1
fi

echo ""

# ─────────────────────────────────────────────────────────
# 3. Frontend — Node modules
# ─────────────────────────────────────────────────────────
info "Setting up React frontend…"

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    info "Installing npm packages (first run)…"
    (cd "$FRONTEND_DIR" && npm install --silent)
    ok "npm packages installed."
else
    ok "node_modules already present. Running quick install to sync…"
    (cd "$FRONTEND_DIR" && npm install --silent)
    ok "npm packages up to date."
fi

echo ""

# ─────────────────────────────────────────────────────────
# 4. Launch both servers
# ─────────────────────────────────────────────────────────
echo -e "${BOLD}── Starting servers ──────────────────────────${NC}"
echo ""

# Backend (Flask + SocketIO on port 5050)
info "Starting backend on http://localhost:5050 …"
(cd "$BACKEND_DIR" && $PYTHON app.py) &
BACKEND_PID=$!

# Give the backend a moment to boot
sleep 2

# Frontend (Vite dev server on port 5173)
info "Starting frontend on http://localhost:5173 …"
(cd "$FRONTEND_DIR" && npm run dev -- --host) &
FRONTEND_PID=$!

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  🌀  VortexML is running!                ║${NC}"
echo -e "${BOLD}║                                          ║${NC}"
echo -e "${BOLD}║  Frontend:  ${GREEN}http://localhost:5173${NC}${BOLD}        ║${NC}"
echo -e "${BOLD}║  Backend:   ${GREEN}http://localhost:5050${NC}${BOLD}        ║${NC}"
echo -e "${BOLD}║                                          ║${NC}"
echo -e "${BOLD}║  Press ${RED}Ctrl+C${NC}${BOLD} to stop both servers.     ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""

# Wait for either process to exit
wait
