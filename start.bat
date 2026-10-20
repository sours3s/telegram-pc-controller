@echo off
chcp 65001 > nul
echo [INFO] Запуск Telegram PC Controller Bot...
cd /d "%~dp0"
npm install
node server.js
pause
