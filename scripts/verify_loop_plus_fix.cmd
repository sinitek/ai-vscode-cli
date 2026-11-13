@echo off
setlocal
node "%~dp0verify_loop_plus_fix.js" --live %*
set "VERIFY_EXIT=%ERRORLEVEL%"
if "%~1"=="" pause
exit /b %VERIFY_EXIT%
