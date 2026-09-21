@echo off
setlocal
cd /d "%~dp0"

echo.
echo   RMIT Adflow - stop the Docker container
echo.

docker info >nul 2>&1
if errorlevel 1 goto notrunning

docker compose down
echo.
echo   Stopped. Nothing is lost - all work lives in the browser, not the container.
echo   Double-click run-docker.bat to start it again.
pause
goto end

:notrunning
echo   Docker Desktop is not running, so there is nothing to stop.
pause

:end
