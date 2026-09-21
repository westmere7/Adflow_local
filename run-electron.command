#!/bin/bash
# =============================================================================
# RMIT Adflow — desktop app (development run), macOS / Linux
# Double-click in Finder. If macOS refuses with a permissions error, the file
# needs its executable bit set once - see MAC-README.txt.
# =============================================================================
set -u
cd "$(dirname "$0")" || exit 1

echo
echo "  RMIT Adflow - desktop app (development run)"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js is not installed. Get it from https://nodejs.org/ (the LTS button),"
  echo "  then double-click this file again."
  read -r -n 1 -p "  Press any key to close this window." _ 2>/dev/null || true
  exit 1
fi

if [ ! -d node_modules/electron ]; then
  echo "  First run: downloading Electron. This takes a couple of minutes and only"
  echo "  happens once."
  echo
  if ! npm install; then
    echo
    echo "  Could not install Electron - see the message above."
    read -r -n 1 -p "  Press any key to close this window." _ 2>/dev/null || true
    exit 1
  fi
fi

echo "  Starting RMIT Adflow..."
npm start
