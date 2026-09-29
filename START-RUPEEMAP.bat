@echo off
rem Double-click to start Rupeemap CRM on this PC, then sign in at http://localhost:3000
rem Keep the three small windows open while you use the CRM. Close them to stop it.
cd /d "%~dp0"
set "COREPACK_HOME=%~dp0.cache\corepack"
set "npm_config_cache=%~dp0.cache\npm"
title Rupeemap CRM starter

rem 1. Database (skipped if it is already running)
node scripts\wait-port.mjs 5433 1 "database" >nul 2>&1
if errorlevel 1 (
  start "Rupeemap database" /min cmd /k "node scripts\local-db.mjs"
)
node scripts\wait-port.mjs 5433 120 "database" || goto failed

rem 2. Server
node scripts\wait-port.mjs 4000 1 "server" >nul 2>&1
if errorlevel 1 (
  start "Rupeemap server" /min cmd /k "cd /d apps\api && npx prisma migrate deploy && npx tsc -p tsconfig.build.json && node --env-file=.env dist/main.js"
)
node scripts\wait-port.mjs 4000 180 "server" || goto failed

rem 3. Website (built once, the first time)
node scripts\wait-port.mjs 3000 1 "website" >nul 2>&1
if errorlevel 1 (
  if not exist "apps\web\.next\BUILD_ID" (
    start "Rupeemap website" /min cmd /k "cd /d apps\web && npx next build && npx next start -p 3000"
  ) else (
    start "Rupeemap website" /min cmd /k "cd /d apps\web && npx next start -p 3000"
  )
)
node scripts\wait-port.mjs 3000 300 "website" || goto failed

start "" http://localhost:3000/login
echo.
echo Rupeemap CRM is open in your browser: http://localhost:3000
echo Demo Admin login: mobile 9000000001, password Rupeemap@123
echo You can close this window. Keep the three small Rupeemap windows open.
pause
exit /b 0

:failed
echo.
echo Something did not start. Open the minimised Rupeemap windows on the taskbar to see the error,
echo or send a screenshot of them to Claude.
pause
exit /b 1
