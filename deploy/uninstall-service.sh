#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
#  VortexML — remove the launchd service (macOS).
#  Run with:  bash deploy/uninstall-service.sh
# ─────────────────────────────────────────────────────────
LABEL="com.vortexml.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

echo "Stopping + unloading $LABEL…"
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
rm -f "$PLIST"

# Stop the running servers too.
lsof -ti :5050 2>/dev/null | xargs kill 2>/dev/null || true
lsof -ti :5173 2>/dev/null | xargs kill 2>/dev/null || true

echo "✓ VortexML service removed. It will no longer start automatically."
echo "  (Run ./start.sh manually whenever you want it, or reinstall the"
echo "  service with: bash deploy/install-service.sh)"
