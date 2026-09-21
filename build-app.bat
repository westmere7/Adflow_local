@echo off
setlocal
cd /d "%~dp0"

echo.
echo   RMIT Adflow - package the desktop app
echo.
echo   This produces a portable folder in dist\win-unpacked. It is not an
echo   installer: the folder runs from anywhere, with nothing installed.
echo.

where node >nul 2>&1
if errorlevel 1 goto nonode

if exist "node_modules\electron" goto build

echo   First run: downloading Electron. This takes a couple of minutes and only
echo   happens once.
echo.
call npm install
if errorlevel 1 goto failed

:build
echo   Building. This takes a few minutes - leave the window open.
echo.
call npm run build:win
if errorlevel 1 goto failed

echo.
echo   Done. Your app is in:
echo     %~dp0dist\win-unpacked
echo.
echo   Hand someone that whole folder. They double-click "RMIT Adflow.exe"
echo   inside it - no install, no admin rights.
echo.
echo   Windows will warn the first time it is run from a downloaded copy,
echo   because the app is not code-signed yet. Click More info - Run anyway.
echo.
if exist "dist\win-unpacked" start "" "dist\win-unpacked"
pause
goto end

:nonode
echo   Node.js is not installed. Get it from https://nodejs.org/ (the LTS button),
echo   then double-click this file again.
pause
goto end

:failed
echo.
echo   The build failed - see the message above.
pause

:end
