#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
#  VortexML — remove the launchd (macOS) or systemd user (Linux) service.
#  Run with:  bash deploy/uninstall-service.sh
# ─────────────────────────────────────────────────────────
LABEL="com.vortexml.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

if [ "$(uname -s)" = "Linux" ]; then
    echo "Stopping + disabling vortexml.service…"
    systemctl --user disable --now vortexml.service 2>/dev/null || true
    rm -f "$HOME/.config/systemd/user/vortexml.service"
    systemctl --user daemon-reload
    echo "✓ VortexML service removed. It will no longer start automatically."
    exit 0
fi

echo "Stopping + unloading $LABEL…"
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
rm -f "$PLIST"

# Stop the running servers too.
lsof -ti :5050 2>/dev/null | xargs kill 2>/dev/null || true
lsof -ti :5173 2>/dev/null | xargs kill 2>/dev/null || true

echo "✓ VortexML service removed. It will no longer start automatically."
echo "  (Run ./start.sh manually whenever you want it, or reinstall the"
echo "  service with: bash deploy/install-service.sh)"
