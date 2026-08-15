@echo off
title AIOMT OCR PDF/Image - Start App
cd /d "%~dp0"

echo ================================================================
echo         AIOMT OCR PDF/IMAGE - KHOI DONG UNG DUNG
echo ================================================================
echo.

echo [1/2] Kiem tra Node.js...
where node >nul 2>&1
if errorlevel 1 goto NO_NODE
echo      - Node.js: OK

echo.
echo [2/2] Kiem tra thu vien node_modules...
if exist "node_modules\" goto START_APP

echo      - Dang cai dat thu vien, vui long cho...
call npm install
if errorlevel 1 goto INSTALL_ERR

:START_APP
echo      - Thu vien node_modules: OK
echo.
echo ----------------------------------------------------------------
echo   Dia chi: http://localhost:3000
echo   Trinh duyet se tu dong mo ngay bay gio...
echo   (Nhan Ctrl + C de dung ung dung)
echo ----------------------------------------------------------------
echo.

call npm run dev
goto END

:NO_NODE
echo.
echo [LOI] Khong tim thay Node.js tren may tinh!
echo Vui long cai dat Node.js tai: https://nodejs.org/
echo.
pause
exit /b 1

:INSTALL_ERR
echo.
echo [LOI] Cai dat thu vien that bai.
pause
exit /b 1

:END
pause
