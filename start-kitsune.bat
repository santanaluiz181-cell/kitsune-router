@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Iniciando Kitsune Router em http://127.0.0.1:4319 ...
start "" "http://127.0.0.1:4319"
node src\cli.ts serve --port 4319
