#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Starting Recall..."
echo ""

echo "Syncing dependencies..."
cd "$ROOT/backend" && uv sync --quiet
cd "$ROOT/frontend" && pnpm install --silent
echo ""

cd "$ROOT/backend"
uv run uvicorn main:app --reload --host 0.0.0.0 &
BACKEND_PID=$!

cd "$ROOT/frontend"
pnpm run dev &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT INT TERM

LAN_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '/src/{print $7; exit}')

echo ""
echo "  Frontend: http://localhost:5173"
if [ -n "$LAN_IP" ]; then
  echo "  On LAN:   http://$LAN_IP:5173  (phone / other devices)"
fi
echo ""
echo "Press Ctrl+C to stop."

wait
