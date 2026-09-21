@echo off
setlocal
cd /d "%~dp0"

echo.
echo   RMIT Adflow - desktop app (development run)
echo.

where node >nul 2>&1
if errorlevel 1 goto nonode

if exist "node_modules\electron" goto launch

echo   First run: downloading Electron. This takes a couple of minutes and only
echo   happens once.
echo.
call npm install
if errorlevel 1 goto failed

:launch
echo   Starting RMIT Adflow...
call npm start
goto end

:nonode
echo   Node.js is not installed. Get it from https://nodejs.org/ (the LTS button),
echo   then double-click this file again.
pause
goto end

:failed
echo.
echo   Could not install Electron - see the message above.
pause

:end
