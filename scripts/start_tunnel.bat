@echo off
setlocal ENABLEDELAYEDEXPANSION

REM Inicia script PowerShell que configura o túnel e imprime a URL
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_tunnel.ps1"

if %ERRORLEVEL% NEQ 0 (
  echo Falha ao iniciar o túnel. Verifique se o Node e o cloudflared estao instalados.
  pause
)

endlocal

