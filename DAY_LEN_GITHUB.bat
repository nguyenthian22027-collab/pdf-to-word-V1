@echo off
chcp 65001 >nul
title Đẩy Code Lên GitHub - MathOCR Studio
cd /d "%~dp0"

echo ========================================================================
echo                 ĐẨY MÃ NGUỒN LÊN GITHUB (GIT PUSH)
echo ========================================================================
echo.

echo Đang tự động kiểm tra và lưu các thay đổi...
git add -A
git diff-index --quiet HEAD || git commit -m "update: cap nhat ma nguon tu dong"

echo Đang đẩy mã nguồn lên GitHub, vui lòng chờ trong giây lát...
git push origin main
set PUSH_STATUS=%errorlevel%

echo.
if %PUSH_STATUS% NEQ 0 (
    echo [THÔNG BÁO] Quá trình đẩy code chưa hoàn tất hoặc cần xác thực tài khoản.
    echo Nếu màn hình xuất hiện cửa sổ trình duyệt đăng nhập GitHub, thầy/cô vui lòng bấm xác thực.
) else (
    echo [THÀNH CÔNG] Đã đẩy toàn bộ mã nguồn lên GitHub thành công rực rỡ!
)

echo.
pause
