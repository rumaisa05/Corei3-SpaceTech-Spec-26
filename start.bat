@echo off
cd /d "%~dp0"
if exist D:\iverilog\bin\iverilog.exe set "PATH=D:\iverilog\bin;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
 echo Node.js is not on PATH. Install it and reopen this file.
 pause
 exit /b 1
)
echo Keep this window open. After Corei3 ready appears, open http://127.0.0.1:8080
node server.js
pause
