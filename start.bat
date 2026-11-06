@echo off
title Kravitas
cd /d "%~dp0"
where node >/dev/null 2>/dev/null || (echo Node.js is not installed. Get the LTS version from https://nodejs.org then run this again. & pause & exit /b 1)
echo Checking dependencies...
call npm install --no-audit --no-fund --loglevel=error || (pause & exit /b 1)
start "" http://localhost:3365/studio
node server.js
pause
