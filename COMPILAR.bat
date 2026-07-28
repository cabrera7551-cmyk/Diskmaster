@echo off
title DISKMASTER - Compilar portable
color 0A
echo.
echo  DISKMASTER_v1 - Generar DiskMaster.exe portable
echo  ================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js no esta instalado.
    echo Descargalo desde: https://nodejs.org/ ^(version LTS^)
    pause
    exit /b 1
)

echo [1/2] Instalando dependencias...
call npm install
if errorlevel 1 (
    echo [ERROR] Fallo npm install
    pause
    exit /b 1
)

echo.
echo [2/2] Compilando DiskMaster.exe...
call npm run build
if errorlevel 1 (
    echo [ERROR] Fallo la compilacion
    pause
    exit /b 1
)

echo.
echo ========================================
echo  LISTO! El ejecutable esta en:
echo  dist\DiskMaster.exe
echo ========================================
echo.
echo Copia DiskMaster.exe a tu USB y ejecutalo en el PC del cliente.
echo.
pause
explorer dist
