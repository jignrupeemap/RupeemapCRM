@echo off
rem Double-click to start Rupeemap CRM on this PC, then sign in at http://localhost:3000
rem Keep the three black windows open while you use the CRM. Close them to stop it.
cd /d "%~dp0"
set "COREPACK_HOME=%~dp0.cache\corepack"
set "npm_config_cache=%~dp0.cache\npm"

echo Starting the database...
start "Rupeemap database" /min cmd /k "node scripts\local-db.mjs"
timeout /t 8 /nobreak >nul

echo Starting the server...
start "Rupeemap server" /min cmd /k "cd /d apps\api && npx prisma migrate deploy && npx tsc -p tsconfig.build.json && node --env-file=.env dist/main.js"
timeout /t 10 /nobreak >nul

echo Starting the website...
if not exist "apps\web\.next\BUILD_ID" (
  start "Rupeemap website" /min cmd /k "cd /d apps\web && npx next build && npx next start -p 3000"
  timeout /t 60 /nobreak >nul
) else (
  start "Rupeemap website" /min cmd /k "cd /d apps\web && npx next start -p 3000"
  timeout /t 10 /nobreak >nul
)

start "" http://localhost:3000/login
echo.
echo Rupeemap CRM is opening in your browser: http://localhost:3000
echo Sign in with mobile 9000000001 and password Rupeemap@123 (demo Admin).
echo You can close this window.
pause
