@echo off
chcp 65001 >nul
title Công Cụ Tạo Mã Kích Hoạt - Ứng Dụng pdf-to-word-mathtype
cd /d "%~dp0"

echo ========================================================================
echo        CÔNG CỤ TẠO MÃ KÍCH HOẠT CHO ỨNG DỤNG PDF-TO-WORD-MATHTYPE
echo ========================================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [LỖI] Chưa cài đặt Node.js trên máy tính!
    echo Vui lòng cài đặt Node.js từ: https://nodejs.org/
    pause
    exit /b 1
)

node keygen.js

echo.
echo Nhấn phím bất kỳ để thoát...
pause >nul
