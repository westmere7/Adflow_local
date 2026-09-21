#!/bin/bash
# =============================================================================
# RMIT Adflow — stop the Docker container (macOS / Linux)
# Windows users: use stop-docker.bat instead.
# =============================================================================
set -u

cd "$(dirname "$0")" || exit 1

echo
echo "  RMIT Adflow - stop the Docker container"
echo

pause_and_exit() {
  echo
  read -r -n 1 -p "  Press any key to close this window." _ 2>/dev/null || true
  echo
  exit "${1:-0}"
}

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "  Docker is not running, so there is nothing to stop."
  pause_and_exit 0
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
else
  COMPOSE="docker-compose"
fi

$COMPOSE down

echo
echo "  Stopped. Nothing is lost - all work lives in the browser, not the container."
echo "  Double-click run-docker.command to start it again."
pause_and_exit 0
