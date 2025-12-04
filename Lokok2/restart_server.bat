@echo off
echo Reiniciando servidor LOKOK2...
echo.

echo Parando processos Node.js existentes...
taskkill /F /IM node.exe >nul 2>&1

echo Aguardando 2 segundos...
timeout /t 2 /nobreak >nul

echo Iniciando servidor...
cd /d "C:\Users\Hilton Yamamoto\LOKOK2"
start "LOKOK2 Server" cmd /k "node server.js"

echo.
echo Servidor LOKOK2 reiniciado!
echo Acesse: http://localhost:3000
echo.
pause
