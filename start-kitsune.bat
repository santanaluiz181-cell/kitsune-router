@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Encerrando instancia antiga do Kitsune na porta 4319 (se houver)...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 4319 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $c=(Get-CimInstance Win32_Process -Filter ('ProcessId='+$_.OwningProcess)).CommandLine; if ($c -match 'cli\.ts') { Stop-Process -Id $_.OwningProcess -Force } }"
echo Iniciando Kitsune Router em http://127.0.0.1:4319 ...
start "" "http://127.0.0.1:4319"
node src\cli.ts serve --port 4319
pause
