@echo off
setlocal
cd /d "%~dp0" || exit /b 1

set "ROOT=%CD%"
set "EDITOR_DIR=%ROOT%\three.js"
set "SERVE_PY=%ROOT%\scripts\serve_asset_editor.py"
set "EDITOR_URL=http://localhost:5174/editor/?v=fcc-ui-234"

title FreeFilmCut Asset Editor
echo ========================================
echo   FreeFilmCut Asset Editor (Three.js)
echo   URL:  %EDITOR_URL%
echo   Root: %EDITOR_DIR%
echo ========================================
echo.

if not exist "%EDITOR_DIR%\editor\index.html" (
  echo [ERROR] three.js editor not found:
  echo   %EDITOR_DIR%\editor\index.html
  echo Expected: FreeFilmCut\three.js\editor\
  pause
  exit /b 1
)

if not exist "%SERVE_PY%" (
  echo [ERROR] serve script not found:
  echo   %SERVE_PY%
  pause
  exit /b 1
)

set "PY="
where python >nul 2>&1 && set "PY=python"
if not defined PY (
  where py >nul 2>&1 && set "PY=py -3"
)
if not defined PY (
  echo [INFO] Python not found - trying winget install...
  where winget >nul 2>&1
  if errorlevel 1 (
    echo [ERROR] No Python and no winget. Install Python 3 from https://www.python.org/downloads/
    echo Tip: enable "Add python.exe to PATH" during setup, then reopen this bat.
    pause
    exit /b 1
  )
  winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo [ERROR] winget failed to install Python.
    echo Install manually: https://www.python.org/downloads/
    pause
    exit /b 1
  )
  set "PATH=%LocalAppData%\Programs\Python\Python312;%LocalAppData%\Programs\Python\Python312\Scripts;%PATH%"
  where python >nul 2>&1 && set "PY=python"
  if not defined PY (
    where py >nul 2>&1 && set "PY=py -3"
  )
  if not defined PY (
    echo [ERROR] Python installed but not on PATH in this window.
    echo Close this window, open a NEW terminal, then run start-asset-editor.bat again.
    pause
    exit /b 1
  )
  echo [INFO] Python is ready.
  echo.
)

cd /d "%EDITOR_DIR%" || (
  echo [ERROR] cannot cd to %EDITOR_DIR%
  pause
  exit /b 1
)

start "FreeFilmCut-OpenBrowser" cmd /c "timeout /t 2 /nobreak >nul & start %EDITOR_URL%"
%PY% "%SERVE_PY%" 5174
echo.
echo Server stopped.
pause
