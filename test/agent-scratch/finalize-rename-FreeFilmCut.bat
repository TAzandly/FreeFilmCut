@echo off
REM Run AFTER closing Cursor (and any bun/node in this tree).
REM 1) Removes freefilmcut junction if present
REM 2) Renames opencut-classic -> freefilmcut
REM 3) Renames parent FreeCapCut -> FreeFilmCut
setlocal
set "PARENT=D:\GrokbotWork"
set "ROOT=%PARENT%\FreeCapCut"
set "FINAL=%PARENT%\FreeFilmCut"

if not exist "%ROOT%" (
  echo [ERROR] Not found: %ROOT%
  echo If already renamed, open %FINAL% in Cursor.
  pause
  exit /b 1
)

cd /d "%PARENT%" || exit /b 1

if exist "%ROOT%\freefilmcut" (
  fsutil reparsepoint query "%ROOT%\freefilmcut" >nul 2>&1
  if not errorlevel 1 (
    echo Removing junction freefilmcut ...
    rmdir "%ROOT%\freefilmcut"
  )
)

if exist "%ROOT%\opencut-classic" (
  if exist "%ROOT%\freefilmcut" (
    echo [ERROR] Both opencut-classic and freefilmcut exist. Resolve manually.
    pause
    exit /b 1
  )
  echo Renaming opencut-classic -^> freefilmcut ...
  ren "%ROOT%\opencut-classic" freefilmcut
  if errorlevel 1 (
    echo [ERROR] Could not rename opencut-classic. Close Cursor/terminals and retry.
    pause
    exit /b 1
  )
)

if exist "%FINAL%" (
  echo [ERROR] Target already exists: %FINAL%
  pause
  exit /b 1
)

echo Renaming FreeCapCut -^> FreeFilmCut ...
ren "%ROOT%" FreeFilmCut
if errorlevel 1 (
  echo [ERROR] Could not rename parent folder. Close Cursor and retry.
  pause
  exit /b 1
)

echo Done. Open folder in Cursor: %FINAL%
pause
