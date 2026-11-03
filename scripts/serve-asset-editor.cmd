@echo off
chcp 65001 >nul
cd /d "%~dp0..\three.js"
title FreeFilmCut Asset Editor
echo FreeFilmCut Asset Editor
echo Open: http://localhost:5174/editor/?v=fcc-ui-18
echo Root: %CD%
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:5174/editor/?v=fcc-ui-18"
python "%~dp0serve_asset_editor.py" 5174
pause
