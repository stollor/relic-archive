@echo off
setlocal
cd /d "%~dp0"
echo.
echo  REMNANT II - Relic Archive - starting local server...
echo.
where py >nul 2>nul
if not errorlevel 1 (
  py -3 serve.py %*
) else (
  where python >nul 2>nul
  if not errorlevel 1 (
    python serve.py %*
  ) else (
    echo [ERROR] Python 3 not found in PATH. Install Python 3.10+ and retry.
    pause
    exit /b 1
  )
)
echo.
echo [serve.py exited] Press any key to close...
pause >nul
endlocal