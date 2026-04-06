#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$ROOT_DIR/.pids/live-watch.pid"
LOG_FILE="$ROOT_DIR/logs/live-watch.log"

if [[ ! -f "$PID_FILE" ]]; then
  echo "Status: stopped (no PID file)"
  echo "Log: $LOG_FILE"
  exit 0
fi

PID="$(cat "$PID_FILE" || true)"
if [[ -n "${PID:-}" ]] && kill -0 "$PID" >/dev/null 2>&1; then
  echo "Status: running"
  echo "PID: $PID"
  echo "Log: $LOG_FILE"
  exit 0
fi

echo "Status: stopped (stale PID file)"
echo "Log: $LOG_FILE"
