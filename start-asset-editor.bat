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

where python >nul 2>&1
if errorlevel 1 (
  echo [ERROR] python not found in PATH.
  pause
  exit /b 1
)

cd /d "%EDITOR_DIR%" || (
  echo [ERROR] cannot cd to %EDITOR_DIR%
  pause
  exit /b 1
)

start "FreeFilmCut-OpenBrowser" cmd /c "timeout /t 2 /nobreak >nul & start %EDITOR_URL%"
python "%SERVE_PY%" 5174
echo.
echo Server stopped.
pause
