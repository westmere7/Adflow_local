#!/bin/bash
# =============================================================================
# RMIT Adflow — package the desktop app, macOS / Linux
# Double-click in Finder. If macOS refuses with a permissions error, the file
# needs its executable bit set once — see MAC-README.txt.
# =============================================================================
set -u
cd "$(dirname "$0")" || exit 1

pause_then_exit() {
  read -r -n 1 -p "  Press any key to close this window." _ 2>/dev/null || true
  exit "${1:-0}"
}

echo
echo "  RMIT Adflow - package the desktop app"
echo
echo "  This produces a portable app in dist/. It is not an installer:"
echo "  the app runs from anywhere, with nothing installed."
echo

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js is not installed. Get it from https://nodejs.org/ (the LTS button),"
  echo "  then double-click this file again."
  pause_then_exit 1
fi

if [ ! -d node_modules/electron ]; then
  echo "  First run: downloading Electron. This takes a couple of minutes and only"
  echo "  happens once."
  echo
  if ! npm install; then
    echo
    echo "  Could not install Electron - see the message above."
    pause_then_exit 1
  fi
fi

echo "  Building. This takes a few minutes - leave the window open."
echo
if ! npm run build:mac; then
  echo
  echo "  The build failed - see the message above."
  pause_then_exit 1
fi

echo
echo "  Done. Your app is in:"
echo "    $(pwd)/dist"
echo
echo "  macOS will refuse to open it the first time, because the app is not"
echo "  code-signed yet. Right-click it, choose Open, then confirm."
echo
[ -d dist ] && open dist 2>/dev/null
pause_then_exit 0
