@echo off
chcp 65001 >nul 2>&1
echo ========================================
echo  OpenClaw 对话日志查看器
echo ========================================
echo.
py "C:\Users\Yuan\Documents\Codex\2026-06-29\gemma4-e2b\work\chat-viewer.py" %1
echo.
pause

