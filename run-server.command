#!/bin/bash
# =============================================================================
# RMIT Adflow — local dev server, macOS / Linux (the Mac twin of run-server.bat)
# Double-click in Finder. If macOS refuses with a permissions error, the file
# needs its executable bit set once - see MAC-README.txt.
#
#   ./run-server.command          serve on http://localhost:8080/
#   ./run-server.command 8193     serve on another port
#
# Uses the Node dev server (no caching + live reload) when Node is installed,
# otherwise falls back to Python's static server (no live reload).
#
# Keep the port the same between runs: projects autosave per address, so a
# different port opens on an empty workspace (your work is still there on the
# old port). Close this window or press Ctrl+C to stop the server.
# =============================================================================
set -u
cd "$(dirname "$0")" || exit 1

PORT="${1:-${PORT:-8080}}"
URL="http://localhost:${PORT}/"

pause_and_exit() {
  read -r -n 1 -p "  Press any key to close this window." _ 2>/dev/null || true
  echo
  exit "${1:-1}"
}

echo
echo "  RMIT Adflow - local dev server"
echo "  ${URL}"
echo "  Close this window or press Ctrl+C to stop."
echo

# Something already listening here would make the server fail to bind, or worse,
# open the browser on whatever else owns the port.
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "  Port ${PORT} is already in use - is Adflow already running in another window?"
  echo "  Close that first, or run with another port:  ./run-server.command 8081"
  echo
  pause_and_exit 1
fi

# Open the browser once the server actually answers, rather than after a guess.
open_when_ready() {
  for _ in $(seq 1 40); do
    if curl -fsS -o /dev/null "${URL}data/version.txt" 2>/dev/null; then
      if command -v open >/dev/null 2>&1; then open "${URL}"        # macOS
      elif command -v xdg-open >/dev/null 2>&1; then xdg-open "${URL}" >/dev/null 2>&1  # Linux
      fi
      return
    fi
    sleep 0.25
  done
}

if command -v node >/dev/null 2>&1; then
  echo "  Rebuilding local assets and startup registry templates..."
  node scripts/build-asset-manifest.js
  node scripts/build-startup-registry.js
  echo "  Starting Node dev server with live reload..."
  echo
  open_when_ready &
  node dev-server.js "${PORT}"
  echo
  echo "  Server stopped, or failed to start - see the message above."
  pause_and_exit 1
fi

# No Node. On a Mac without the developer tools, /usr/bin/python3 is only a stub
# that offers to install them; --version is enough to tell the two apart.
if command -v python3 >/dev/null 2>&1 && python3 --version >/dev/null 2>&1; then
  echo "  Node not found - falling back to Python, no live reload."
  echo "  (Install Node from https://nodejs.org/ for live reload and fresh files.)"
  echo
  open_when_ready &
  python3 -m http.server "${PORT}"
  pause_and_exit 1
fi

echo "  Could not find Node or Python."
echo "  Install Node from https://nodejs.org/ (the LTS button), then double-click"
echo "  this file again."
echo
pause_and_exit 1
