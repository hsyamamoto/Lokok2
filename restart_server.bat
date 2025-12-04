@echo off
echo Reiniciando servidor LOKOK2...
echo.

echo Parando processos Node.js existentes...
taskkill /F /IM node.exe >nul 2>&1

echo Aguardando 2 segundos...
timeout /t 2 /nobreak >nul

echo Iniciando servidor (porta 3003, Excel local, sem DB)...
cd /d "C:\Users\Hilton Yamamoto\LOKOK2"
set NODE_ENV=development
set FORCE_LOCAL_EXCEL=1
set EXCEL_PATH=./data/Wholesale Suppliers and Product Opportunities.xlsx
set USE_DB=false
set DATABASE_URL=
set PORT=3003
start "LOKOK2 Server" cmd /k "node server.js"

echo.
echo Servidor LOKOK2 reiniciado!
echo Acesse: http://localhost:3003
echo.
pause
