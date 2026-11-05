@echo off
cd /d "%~dp0"
title Lekker Story ERP - Local Server
echo.
echo  Lekker Story ERP - starting local server...
echo.
echo  Do NOT double-click index.html — use this server instead.
echo.
echo  Open in your browser:  http://localhost:8080
echo.
echo  Press Ctrl+C to stop the server.
echo.
start http://localhost:8080
python -m http.server 8080
if errorlevel 1 (
    echo.
    echo  Python not found. Install Python from https://www.python.org/
    echo  Or run in PowerShell:  npx serve -l 8080
    pause
)
