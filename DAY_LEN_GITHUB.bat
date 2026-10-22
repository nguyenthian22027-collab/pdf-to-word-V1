@echo off
title Day Code Len GitHub - MathOCR Studio
cd /d "%~dp0"

echo ========================================================================
echo                 DAY MA NGUON LEN GITHUB (GIT PUSH)
echo ========================================================================
echo.

echo [1/2] Dang tu dong kiem tra va luu thay doi...
git add -A
git diff-index --quiet HEAD || git commit -m "update: cap nhat ma nguon tu dong"

echo.
echo [2/2] Dang day ma nguon len GitHub...
git push origin main
set PUSH_STATUS=%errorlevel%

echo.
if %PUSH_STATUS% NEQ 0 (
    echo [THONG BAO] Qua trinh day code chua hoan tat hoac can xac thuc.
    echo Neu man hinh xuat hien cua so trinh duyet dang nhap GitHub, vui long bam xac thuc.
) else (
    echo [THANH CONG] Da day toan bo ma nguon len GitHub thanh cong!
)

echo.
pause
