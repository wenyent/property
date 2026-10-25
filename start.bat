@echo off
cd /d "%~dp0"
if exist config.json (
  echo Fetching latest URA data...
  node scripts\update-data.js
)
echo Starting preview... keep this window open while you use the page.
start "" cmd /c "ping -n 3 127.0.0.1 >/dev/null & start http://localhost:3000"
node scripts\preview.js
pause
