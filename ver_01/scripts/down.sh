#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo ""
echo "🛑  Stopping DAGViz..."
cd "$PROJECT_DIR"
docker compose down

# Free ports just in case
for PORT in 3000 8080 5432; do
  PIDS=$(lsof -ti ":$PORT" 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "⚡  Freeing port $PORT"
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
  fi
done

echo ""
echo "✅  All services stopped."
echo ""
