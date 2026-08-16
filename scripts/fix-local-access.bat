@echo off
REM One-time permanent fix for demo.localhost / admin.localhost on Windows.
REM Double-click this file, then click "Yes" on the Windows (UAC) popup.
REM It pins *.localhost to 127.0.0.1 in the hosts file and trusts Caddy's local CA.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"\"%~dp0fix-local-access.ps1\"\"'"
echo.
echo Done. Open https://demo.localhost in your browser.
pause
