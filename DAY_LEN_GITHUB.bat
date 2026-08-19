@echo off
chcp 65001 >nul
title Đẩy Code Lên GitHub - MathOCR Studio
cd /d "%~dp0"

echo ========================================================================
echo                 ĐẨY MÃ NGUỒN LÊN GITHUB (GIT PUSH)
echo ========================================================================
echo.

git push origin main

echo.
if errorlevel 1 (
    echo [THÔNG BÁO] Quá trình đẩy code chưa hoàn tất. Nếu GitHub yêu cầu đăng nhập, vui lòng xác thực trên cửa sổ trình duyệt.
) else (
    echo [THÀNH CÔNG] Đã đẩy toàn bộ mã nguồn lên GitHub thành công!
)
echo.
pause
