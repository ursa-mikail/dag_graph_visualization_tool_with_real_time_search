#!/usr/bin/env bash
set -euo pipefail

# ─── DAGViz :: UP ──────────────────────────────────────────────────────────────
PORTS=(3000 8080 5432)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo ""
echo "  ██████╗  █████╗  ██████╗ ██╗   ██╗██╗███████╗"
echo "  ██╔══██╗██╔══██╗██╔════╝ ██║   ██║██║╚══███╔╝"
echo "  ██║  ██║███████║██║  ███╗██║   ██║██║  ███╔╝ "
echo "  ██║  ██║██╔══██║██║   ██║╚██╗ ██╔╝██║ ███╔╝  "
echo "  ██████╔╝██║  ██║╚██████╔╝ ╚████╔╝ ██║███████╗"
echo "  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝   ╚═══╝  ╚═╝╚══════╝"
echo ""
echo "  Universal Graph Intelligence Platform"
echo "─────────────────────────────────────────────────"

# Check Docker
if ! command -v docker &>/dev/null; then
  echo "❌  Docker not found. Install Docker Desktop and retry."
  exit 1
fi

# Free ports
for PORT in "${PORTS[@]}"; do
  PIDS=$(lsof -ti ":$PORT" 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "⚡  Freeing port $PORT (PIDs: $PIDS)"
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
    sleep 0.5
  fi
done

# Build & start
echo ""
echo "🐳  Building containers..."
cd "$PROJECT_DIR"
docker compose build --parallel

echo ""
echo "🚀  Starting services..."
docker compose up -d

echo ""
echo "⏳  Waiting for services to be healthy..."
sleep 3

MAX_WAIT=60
WAITED=0
until docker compose exec -T postgres pg_isready -U dagviz &>/dev/null; do
  sleep 2
  WAITED=$((WAITED + 2))
  if [ "$WAITED" -ge "$MAX_WAIT" ]; then
    echo "❌  Postgres did not become ready in time"
    docker compose logs postgres
    exit 1
  fi
  echo "   ... waiting for postgres ($WAITED s)"
done

echo ""
echo "✅  DAGViz is running!"
echo ""
echo "   🌐  Frontend  → http://localhost:3000"
echo "   🔌  Backend   → http://localhost:8080"
echo "   🐘  Postgres  → localhost:5432"
echo ""
echo "   To stop:  ./scripts/down.sh"
echo "   To clean: ./scripts/clean.sh"
echo ""
