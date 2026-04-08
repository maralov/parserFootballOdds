#!/usr/bin/env bash
set -euo pipefail

PLIST_DST="$HOME/Library/LaunchAgents/com.parser.football.plist"

if launchctl list com.parser.football >/dev/null 2>&1; then
  launchctl unload "$PLIST_DST" 2>/dev/null || true
  echo "Service stopped"
fi

rm -f "$PLIST_DST"
echo "✅ Service uninstalled"
