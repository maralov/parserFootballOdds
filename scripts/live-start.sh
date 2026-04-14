#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PID_DIR="$ROOT_DIR/.pids"
LOG_DIR="$ROOT_DIR/logs"
PID_FILE="$PID_DIR/live-watch.pid"
LOG_FILE="$LOG_DIR/live-watch.log"

mkdir -p "$PID_DIR" "$LOG_DIR"

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE" || true)"
  if [[ -n "${OLD_PID:-}" ]] && kill -0 "$OLD_PID" >/dev/null 2>&1; then
    echo "Live watcher already running with PID $OLD_PID"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

cd "$ROOT_DIR"
nohup caffeinate -i npm run live:watch:3m:anytime >>"$LOG_FILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" >"$PID_FILE"

echo "Live watcher started."
echo "PID: $NEW_PID"
echo "Log: $LOG_FILE"
