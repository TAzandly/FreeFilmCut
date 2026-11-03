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

REM Bun default install location (used after auto-install in this same window)
if exist "%USERPROFILE%\.bun\bin\bun.exe" (
  set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
)

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
  echo [INFO] Bun not found - installing automatically...
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://bun.sh/install.ps1 | iex"
  if errorlevel 1 (
    echo [ERROR] Auto-install Bun failed.
    echo Manual install: powershell -c "irm https://bun.sh/install.ps1 ^| iex"
    echo Docs: https://bun.sh/docs/installation
    pause
    exit /b 1
  )
  if exist "%USERPROFILE%\.bun\bin\bun.exe" (
    set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
  )
  where bun >nul 2>&1
  if errorlevel 1 (
    echo [ERROR] Bun installed but still not on PATH in this window.
    echo Close this window, open a NEW terminal, then run start-filmcut.bat again.
    pause
    exit /b 1
  )
  echo [INFO] Bun is ready.
  echo.
)

cd /d "%NLE_DIR%" || (
  echo [ERROR] cannot cd to %NLE_DIR%
  pause
  exit /b 1
)

REM First clone / missing deps: install project packages.
if not exist "node_modules" (
  echo [INFO] node_modules missing - running bun install ...
  bun install
  if errorlevel 1 (
    echo [ERROR] bun install failed.
    pause
    exit /b 1
  )
) else if not exist "node_modules\turbo\bin\turbo" (
  REM Folder rename can break turbo junctions inside node_modules.
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
