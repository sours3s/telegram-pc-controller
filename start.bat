@echo off
chcp 65001 > nul
echo [INFO] Запуск Telegram PC Controller Bot...
cd /d "%~dp0"

if not exist "node_modules" (
    echo [INFO] Установка зависимостей (первый запуск)...
    call npm install
)

echo [INFO] Запуск сервера и туннеля...
node server.js
pause
