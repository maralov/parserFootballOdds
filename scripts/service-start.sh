#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_DST="$HOME/Library/LaunchAgents/com.parser.football.plist"

cd "$ROOT_DIR"

if [[ ! -f "$PLIST_DST" ]]; then
  echo "Service is not installed yet. Installing..."
  bash "$ROOT_DIR/scripts/install-service.sh"
  exit 0
fi

if ! launchctl list com.parser.football >/dev/null 2>&1; then
  echo "Service plist exists but not loaded. Loading..."
  launchctl load "$PLIST_DST"
fi

echo "Starting com.parser.football..."
launchctl start com.parser.football

echo "Service start command sent."
echo "Check status: npm run service:status"
