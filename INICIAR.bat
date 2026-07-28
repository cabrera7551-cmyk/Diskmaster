@echo off
title DISKMASTER - Instalacion y ejecucion
color 0A
echo.
echo  DISKMASTER_v1 - Gestor de almacenamiento
echo  ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js no esta instalado.
    echo.
    echo Descargalo desde: https://nodejs.org/
    echo Instala la version LTS y vuelve a ejecutar este archivo.
    echo.
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
echo [2/2] Iniciando DISKMASTER...
call npm start
