@echo off
setlocal
cd /d "%~dp0"
set URL=http://localhost:8080/

echo.
echo   RMIT Adflow - start in Docker
echo   %URL%
echo.

where docker >nul 2>&1
if errorlevel 1 goto nodocker

docker info >nul 2>&1
if not errorlevel 1 goto build

echo   Docker Desktop is not running - starting it. This can take a minute...
docker desktop start >nul 2>&1
if errorlevel 1 start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
set TRIES=0

:waitloop
timeout /t 3 /nobreak >nul
set /a TRIES+=1
docker info >nul 2>&1
if not errorlevel 1 goto build
if %TRIES% geq 40 goto timeout
echo   ...waiting for Docker Desktop (%TRIES%)
goto waitloop

:build
echo   Building the image and starting the container.
echo   The first run downloads two base images and takes 1-2 minutes; later runs take seconds.
echo.
docker compose up -d --build
if errorlevel 1 goto failed

echo.
echo   Adflow is running. Opening %URL%
start "" %URL%
echo.
echo   You can close this window - the container keeps running in the background,
echo   and starts again with Docker Desktop after a reboot.
echo   To stop it: open Docker Desktop, Containers tab, press Stop on rmit-adflow,
echo   or double-click stop-docker.bat.
pause
goto end

:nodocker
echo   Docker is not installed. Install Docker Desktop from https://www.docker.com/products/docker-desktop/
echo   then double-click this file again.
pause
goto end

:timeout
echo   Docker Desktop did not become ready. Open it from the Start menu, wait for the
echo   whale icon in the tray to stop animating, then double-click this file again.
pause
goto end

:failed
echo.
echo   The build or start failed - see the message above. Common causes: Docker Desktop
echo   still starting (wait and retry), or port 8080 already in use by another app
echo   (change the left-hand 8080 in docker-compose.yml, e.g. "8081:8080").
pause

:end
