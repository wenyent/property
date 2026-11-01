@echo off
cd /d "%~dp0"
echo Updating data from URA (needs config.json with your key)...
node scripts\update-data.js
echo.
echo Starting Condo Hunt... keep this window open while you use the page.
start "" cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:3000"
node scripts\serve.js
pause
