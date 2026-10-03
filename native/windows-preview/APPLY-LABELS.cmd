@echo off
setlocal
title DSF / DSP thumbnail labels
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -File "%~dp0apply-user-badges.ps1"
set "dsf_result=%errorlevel%"
echo.
if not "%dsf_result%"=="0" echo Registration did not complete. See the message above.
pause
exit /b %dsf_result%
