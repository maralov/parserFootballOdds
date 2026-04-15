#!/usr/bin/env bash
set -euo pipefail

LABEL="com.parser.football"
GUI_DOMAIN="gui/$(id -u)"
PLIST_DST="$HOME/Library/LaunchAgents/${LABEL}.plist"

if [[ ! -f "$PLIST_DST" ]]; then
  echo "Not installed"
  exit 0
fi

if launchctl print "${GUI_DOMAIN}/${LABEL}" >/dev/null 2>&1; then
  launchctl print "${GUI_DOMAIN}/${LABEL}"
  exit 0
fi

echo "Installed but not loaded/running"
echo "Plist: $PLIST_DST"
