#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo ""
echo "🧹  Full DAGViz cleanup — removing containers, volumes, images..."
cd "$PROJECT_DIR"

docker compose down -v --rmi local --remove-orphans 2>/dev/null || true

# Free ports
for PORT in 3000 8080 5432; do
  PIDS=$(lsof -ti ":$PORT" 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "⚡  Freeing port $PORT"
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
  fi
done

# Remove dangling images
docker image prune -f 2>/dev/null || true

echo ""
echo "✅  Clean complete. Run ./scripts/up.sh to start fresh."
echo ""
