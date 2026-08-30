@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo          NOVUS LAUNCHER V1
echo ========================================
echo.

if not exist node_modules (
  echo [1/2] Installation des dependances...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERREUR] npm install a echoue.
    pause
    exit /b 1
  )
)

echo [2/2] Demarrage du launcher...
call npm start
pause
