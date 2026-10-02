@echo off
setlocal
cd /d "%~dp0"

:: Inicia diretamente a janela Electron. Não abre navegador, servidor local
:: nem console persistente.
if exist "node_modules\electron\dist\electron.exe" (
    start "Simulador TC Educacional" /b "node_modules\electron\dist\electron.exe" .
    exit /b 0
)

echo O Electron nao foi encontrado. Execute "npm install" nesta pasta.
pause
exit /b 1
