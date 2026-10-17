@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Local development dependencies are missing. Run npm install first.
  pause
  exit /b 1
)
call npm run build
if errorlevel 1 (
  echo Local build failed. The previous release has not been changed.
  pause
  exit /b 1
)
set ELECTRON_RUN_AS_NODE=
start "Tideweave" "node_modules\electron\dist\electron.exe" "."
exit /b 0
