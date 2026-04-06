#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$ROOT_DIR/.pids/live-watch.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "No PID file found. Live watcher is probably not running."
  exit 0
fi

PID="$(cat "$PID_FILE" || true)"
if [[ -z "${PID:-}" ]]; then
  rm -f "$PID_FILE"
  echo "PID file was empty. Cleaned up."
  exit 0
fi

if kill -0 "$PID" >/dev/null 2>&1; then
  kill "$PID" >/dev/null 2>&1 || true
  sleep 1
  if kill -0 "$PID" >/dev/null 2>&1; then
    kill -9 "$PID" >/dev/null 2>&1 || true
  fi
  echo "Stopped live watcher PID $PID"
else
  echo "Process $PID is not running."
fi

rm -f "$PID_FILE"
