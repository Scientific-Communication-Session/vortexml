#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
#  VortexML — install as a launchd service (macOS).
#
#  launchd is macOS's equivalent of Linux systemd. This installs a
#  LaunchAgent so VortexML starts automatically and is kept alive
#  (restarted if it ever exits). Run with:  bash deploy/install-service.sh
# ─────────────────────────────────────────────────────────
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.vortexml.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGDIR="$ROOT/logs"
DOMAIN="gui/$(id -u)"

mkdir -p "$LOGDIR" "$HOME/Library/LaunchAgents"

# launchd hands jobs only a minimal PATH — make sure Homebrew's node / npm /
# python3 are reachable, since start.sh needs them.
BREW_BIN="/opt/homebrew/bin"
command -v brew >/dev/null 2>&1 && BREW_BIN="$(dirname "$(command -v brew)")"

echo "Writing LaunchAgent → $PLIST"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$ROOT/start.sh</string>
    </array>

    <key>WorkingDirectory</key>
    <string>$ROOT</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$BREW_BIN:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>

    <!-- Start at login, and restart automatically if it ever exits. -->
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>15</integer>

    <key>StandardOutPath</key>
    <string>$LOGDIR/service.out.log</string>
    <key>StandardErrorPath</key>
    <string>$LOGDIR/service.err.log</string>
</dict>
</plist>
EOF

# Free the ports from any manual / ad-hoc run so the service can take over.
echo "Stopping any existing VortexML instance…"
lsof -ti :5050 2>/dev/null | xargs kill 2>/dev/null || true
lsof -ti :5173 2>/dev/null | xargs kill 2>/dev/null || true
sleep 1

# (Re)load the service.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl kickstart -k "$DOMAIN/$LABEL"

echo ""
echo "✓ VortexML service installed and started ($LABEL)."
echo ""
echo "  It now starts automatically whenever you log in, and is"
echo "  restarted automatically if it ever crashes."
echo ""
if printf '%s' "$ROOT" | grep -q "/Desktop/"; then
    echo "  ⚠ This project is under ~/Desktop, which macOS sandboxes. If the"
    echo "    service logs show 'Operation not permitted', grant /bin/bash"
    echo "    Full Disk Access (System Settings → Privacy & Security → Full"
    echo "    Disk Access → + → ⇧⌘G → /bin/bash), then: launchctl kickstart"
    echo "    -k $DOMAIN/$LABEL"
fi
echo ""
echo "  For it to start at *boot* (no manual login), also enable"
echo "  auto-login: System Settings → Users & Groups → Automatically"
echo "  log in as → your user."
echo ""
echo "  status :  launchctl print $DOMAIN/$LABEL | grep -E 'state|pid'"
echo "  logs   :  tail -f $LOGDIR/service.out.log"
echo "  restart:  launchctl kickstart -k $DOMAIN/$LABEL"
echo "  remove :  bash deploy/uninstall-service.sh"
echo ""
echo "  Startup takes ~30s (it syncs dependencies). Then: http://localhost:5173"
