@echo off
cd /d "%~dp0"
for %%F in (*.exe) do (
  start "" "%%~fF"
  goto :eof
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app.ps1"
