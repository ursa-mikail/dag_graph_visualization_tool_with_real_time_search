#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

echo "🛑  Stopping NetFlow DAG..."
docker compose down

for PORT in 3001 8081 5433; do
  PIDS=$(lsof -ti ":$PORT" 2>/dev/null || true)
  [ -n "$PIDS" ] && echo "⚡ Freeing port $PORT" && echo "$PIDS" | xargs kill -9 2>/dev/null || true
done
echo "✅  Stopped. Data volume preserved. Run clean.sh to wipe data."
