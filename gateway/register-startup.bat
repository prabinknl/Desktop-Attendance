@echo off
title Register Hikvision Gateway Windows Autostart
echo ====================================================
echo  Register Hikvision Local Gateway Windows Autostart
echo ====================================================
echo.

set SCRIPT_DIR=%~dp0
set VBS_PATH=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\HikvisionGateway.vbs

echo Creating background startup launcher in Windows Startup folder:
echo %VBS_PATH%
echo.

(
  echo Set WshShell = CreateObject("WScript.Shell"^^)^
  echo WshShell.CurrentDirectory = "%SCRIPT_DIR%"
  echo WshShell.Run "node index.js", 0, False
) > "%VBS_PATH%"

if exist "%VBS_PATH%" (
  echo [SUCCESS] Startup launcher registered successfully!
  echo The Hikvision Gateway will now automatically start in the background when Windows boots up.
) else (
  echo [ERROR] Failed to write startup script.
)

echo.
echo Press any key to exit...
pause >nul
