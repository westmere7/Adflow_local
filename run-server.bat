@echo off
setlocal
set PORT=8080
set URL=http://localhost:%PORT%/

echo.
echo   RMIT Adflow - local dev server
echo   %URL%
echo   Press Ctrl+C in this window to stop.
echo.

REM Wait ~1s in a side window, then open the browser once the server is bound.
start "" /min cmd /c "ping -n 2 127.0.0.1 >nul & start %URL%"

where node >nul 2>&1
if errorlevel 1 goto nonode

echo   Rebuilding local assets and startup registry templates...
node scripts\build-asset-manifest.js
node scripts\build-startup-registry.js
echo   Starting Node dev server with live reload...
node dev-server.js %PORT%
echo.
echo   Server stopped, or failed to start - see the message above.
pause
goto end

:nonode
where python >nul 2>&1
if errorlevel 1 goto trypy
echo   Node not found - falling back to Python, no live reload.
python -m http.server %PORT%
goto end

:trypy
where py >nul 2>&1
if errorlevel 1 goto notools
echo   Node not found - falling back to Python, no live reload.
py -m http.server %PORT%
goto end

:notools
echo   Could not find Node or Python.
echo   Install Node from https://nodejs.org/ or Python from https://www.python.org/ then re-run.
pause

:end
