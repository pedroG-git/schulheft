@echo off
rem Schulheft ohne Electron starten (zum Entwickeln/Ausprobieren): bauen falls noetig, Server starten, Browser oeffnen.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js fehlt - bitte von https://nodejs.org installieren. & pause & exit /b 1)
if not exist node_modules\ (call npm install || goto fehler)
if not exist public\dist\app.js (call npm run build || goto fehler)
if "%PORT%"=="" set PORT=4711
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 1; Start-Process ('http://localhost:' + $env:PORT + '/')"
node server.js
if errorlevel 1 goto fehler
exit /b 0
:fehler
pause
exit /b 1
