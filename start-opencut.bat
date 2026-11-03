@echo off
setlocal EnableExtensions
cd /d "%~dp0" || (
  echo [ERROR] cannot cd to bat directory
  pause
  exit /b 1
)

set "ROOT=%CD%"
set "NLE_DIR=%ROOT%\freefilmcut"
set "LOCK=%NLE_DIR%\apps\web\.next\dev\lock"

title FreeFilmCut NLE
echo ========================================
echo   FreeFilmCut NLE
echo   URL:  http://localhost:3000
echo   Root: %NLE_DIR%
echo ========================================
echo.

if not exist "%NLE_DIR%\package.json" (
  echo [ERROR] freefilmcut not found:
  echo   %NLE_DIR%
  echo Expected: FreeFilmCut\freefilmcut\package.json
  pause
  exit /b 1
)

where bun >nul 2>&1
if errorlevel 1 (
  echo [ERROR] bun not found in PATH.
  echo Tip: install Bun, or open a terminal where "where bun" works.
  pause
  exit /b 1
)

cd /d "%NLE_DIR%" || (
  echo [ERROR] cannot cd to %NLE_DIR%
  pause
  exit /b 1
)

REM Folder rename can break turbo junctions inside node_modules.
if not exist "node_modules\turbo\bin\turbo" (
  echo [WARN] turbo missing - running bun install ...
  bun install
  if errorlevel 1 (
    echo [ERROR] bun install failed.
    pause
    exit /b 1
  )
)

REM If port 3000 already listening, just open the browser.
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [INFO] Already running on http://localhost:3000 - opening browser.
  start "" http://localhost:3000
  pause
  exit /b 0
)

if exist "%LOCK%" (
  echo [WARN] Stale Next.js lock found, removing:
  echo   %LOCK%
  del /f /q "%LOCK%" >nul 2>&1
)

start "FreeFilmCut-OpenBrowser" cmd /c "timeout /t 8 /nobreak >nul & start http://localhost:3000"
bun run dev:web
set "EC=%ERRORLEVEL%"
echo.
if not "%EC%"=="0" (
  echo [ERROR] bun run dev:web exited with code %EC%
  echo If you see lock/port errors, close other FreeFilmCut windows and retry.
)
echo Server stopped.
pause
exit /b %EC%