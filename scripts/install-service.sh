#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
PLIST_DST="$HOME/Library/LaunchAgents/com.parser.football.plist"
NODE_BIN="$(which node)"

mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

launchctl list com.parser.football >/dev/null 2>&1 && launchctl unload "$PLIST_DST" 2>/dev/null || true

cat > "$PLIST_DST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.parser.football</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/caffeinate</string>
        <string>-i</string>
        <string>${NODE_BIN}</string>
        <string>${ROOT_DIR}/index.js</string>
        <string>--watch</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${ROOT_DIR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin</string>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>30</integer>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/launchd-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/launchd-stderr.log</string>
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
PLIST

launchctl load "$PLIST_DST"

echo "✅ Service installed and started"
echo "   Node:  $NODE_BIN"
echo "   Root:  $ROOT_DIR"
echo "   Logs:  $LOG_DIR/launchd-stdout.log"
echo ""
echo "Commands:"
echo "   npm run service:status"
echo "   npm run service:stop"
echo "   npm run service:start"
echo "   npm run service:logs"
