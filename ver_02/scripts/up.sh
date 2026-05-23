#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

echo ""
echo "  NetFlow DAG — Temporal Network Visualiser"
echo "────────────────────────────────────────────"

# Free ports
for PORT in 3001 8081 5433; do
  PIDS=$(lsof -ti ":$PORT" 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "⚡  Freeing port $PORT"
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
    sleep 0.3
  fi
done

# If postgres container exists but is stopped/errored, remove it so it reinitialises cleanly
if docker ps -a --format '{{.Names}}' | grep -q '^netflow-postgres$'; then
  STATUS=$(docker inspect -f '{{.State.Status}}' netflow-postgres 2>/dev/null || echo "missing")
  if [ "$STATUS" != "running" ]; then
    echo "🗑   Removing stale postgres container..."
    docker rm -f netflow-postgres 2>/dev/null || true
  fi
fi

echo "🐳  Building containers..."
docker compose build --parallel

echo "🚀  Starting services..."
docker compose up -d

echo "⏳  Waiting for postgres..."
MAX=90; WAITED=0
until docker compose exec -T postgres pg_isready -U netflow -d netflow &>/dev/null; do
  sleep 2; WAITED=$((WAITED + 2))
  if [ "$WAITED" -ge "$MAX" ]; then
    echo "❌  Postgres did not become ready. Logs:"
    docker compose logs postgres | tail -20
    exit 1
  fi
  echo "   ...${WAITED}s"
done

echo "⏳  Waiting for backend..."
WAITED=0
until docker compose exec -T backend wget -qO- http://localhost:8081/api/health &>/dev/null; do
  sleep 2; WAITED=$((WAITED + 2))
  [ "$WAITED" -ge 60 ] && echo "❌ Backend timeout" && docker compose logs backend | tail -20 && exit 1
  echo "   ...${WAITED}s"
done

echo ""
echo "✅  NetFlow DAG is running!"
echo ""
echo "   🌐  Frontend  →  http://localhost:3001"
echo "   🔌  Backend   →  http://localhost:8081"
echo "   🐘  Postgres  →  localhost:5433"
echo ""
echo "   Drop sample_network_events.csv into the UI to start."
echo "   To stop:  ./scripts/down.sh"
echo "   To wipe:  ./scripts/clean.sh"
echo ""
