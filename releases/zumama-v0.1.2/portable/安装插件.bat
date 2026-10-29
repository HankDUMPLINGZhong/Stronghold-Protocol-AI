@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0install-windows.ps1" %*
set "ZUMAMA_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %ZUMAMA_EXIT%
