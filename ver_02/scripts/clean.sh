#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

echo "🧹  Stopping and removing everything (containers, volumes, images)..."
docker compose down -v --rmi local --remove-orphans 2>/dev/null || true

# Also remove the named volume explicitly in case compose missed it
docker volume rm dagviz-netflow_netflow_pgdata 2>/dev/null || true

for PORT in 3001 8081 5433; do
  PIDS=$(lsof -ti ":$PORT" 2>/dev/null || true)
  [ -n "$PIDS" ] && echo "⚡ Freeing port $PORT" && echo "$PIDS" | xargs kill -9 2>/dev/null || true
done

docker image prune -f 2>/dev/null || true
echo "✅  Clean complete. Run ./scripts/up.sh to start fresh."
