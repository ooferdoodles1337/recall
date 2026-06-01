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
uv run uvicorn main:app --reload --log-level warning &
BACKEND_PID=$!

cd "$ROOT/frontend"
pnpm run dev &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT INT TERM

echo "  Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop."

wait
