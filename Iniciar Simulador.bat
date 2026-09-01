@echo off
title Simulador TC Educacional
color 0A
echo.
echo =====================================================
echo   SIMULADOR EDUCACIONAL DE TOMOGRAFIA COMPUTADORIZADA
echo =====================================================
echo.
echo  Iniciando servidor local...
echo  Porta: 8181
echo.

:: Verifica se Python esta disponivel
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERRO] Python nao encontrado.
    echo  Instale o Python em: https://www.python.org/downloads/
    echo.
    pause
    exit /b 1
)

:: Abre o navegador apos 1.5 segundos
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:8181"

echo  Navegador abrindo em: http://localhost:8181
echo.
echo  Para encerrar o servidor, feche esta janela ou pressione Ctrl+C
echo.
echo =====================================================
echo.

:: Inicia o servidor (bloqueia ate Ctrl+C)
python -m http.server 8181

echo.
echo  Servidor encerrado.
pause