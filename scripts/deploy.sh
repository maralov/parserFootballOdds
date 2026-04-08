#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "📥 Pulling latest changes..."
git pull --ff-only

echo "📦 Installing dependencies..."
npm install --production

echo "🔄 Restarting service..."
launchctl stop com.parser.football 2>/dev/null || true
sleep 2
launchctl start com.parser.football

echo "✅ Deploy complete"
npm run service:status
