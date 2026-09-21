#!/bin/bash
# =============================================================================
# RMIT Adflow — start in Docker (macOS / Linux)
#
# macOS: double-click this file in Finder. If macOS refuses with a permissions
# error, it needs the executable bit once — see DEPLOYMENT.md section 1.
# Linux: ./run-docker.command
#
# Windows users: use run-docker.bat instead.
# =============================================================================
set -u

# Finder launches scripts from the home folder, so move to the repo first.
cd "$(dirname "$0")" || exit 1

URL="http://localhost:8080/"

echo
echo "  RMIT Adflow - start in Docker"
echo "  $URL"
echo

pause_and_exit() {
  echo
  read -r -n 1 -p "  Press any key to close this window." _ 2>/dev/null || true
  echo
  exit "${1:-0}"
}

open_browser() {
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1
  elif command -v powershell.exe >/dev/null 2>&1; then powershell.exe -NoProfile -Command "Start-Process '$URL'" >/dev/null 2>&1
  else echo "  Open $URL in your browser."
  fi
}

if ! command -v docker >/dev/null 2>&1; then
  echo "  Docker is not installed."
  echo "  Install Docker Desktop from https://www.docker.com/products/docker-desktop/"
  echo "  then double-click this file again."
  pause_and_exit 1
fi

# `docker compose` (v2, bundled with Docker Desktop) or the old `docker-compose`.
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "  Docker is installed but Compose is missing."
  echo "  On Linux install the docker-compose-plugin package; on macOS update Docker Desktop."
  pause_and_exit 1
fi

if ! docker info >/dev/null 2>&1; then
  if [ "$(uname -s)" = "Darwin" ]; then
    echo "  Docker Desktop is not running - starting it. This can take a minute..."
    open -a Docker 2>/dev/null || true
  else
    echo "  The Docker daemon is not running."
    echo "  Start it (for example: sudo systemctl start docker) and run this again."
    pause_and_exit 1
  fi

  tries=0
  until docker info >/dev/null 2>&1; do
    sleep 3
    tries=$((tries + 1))
    if [ "$tries" -ge 40 ]; then
      echo "  Docker Desktop did not become ready. Open it from Applications, wait for the"
      echo "  whale icon in the menu bar to stop animating, then double-click this file again."
      pause_and_exit 1
    fi
    echo "  ...waiting for Docker Desktop ($tries)"
  done
fi

echo "  Building the image and starting the container."
echo "  The first run downloads two base images and takes 1-2 minutes; later runs take seconds."
echo

if ! $COMPOSE up -d --build; then
  echo
  echo "  The build or start failed - see the message above. Common causes: Docker still"
  echo "  starting (wait and retry), or port 8080 already in use by another app (change"
  echo "  the left-hand 8080 in docker-compose.yml, e.g. \"8081:8080\")."
  pause_and_exit 1
fi

echo
echo "  Adflow is running. Opening $URL"
open_browser
echo
echo "  You can close this window - the container keeps running in the background,"
echo "  and starts again with Docker Desktop after a reboot."
echo "  To stop it: open Docker Desktop, Containers tab, press Stop on rmit-adflow,"
echo "  or double-click stop-docker.command."
pause_and_exit 0
