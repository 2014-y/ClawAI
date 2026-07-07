@echo off
chcp 65001 >nul 2>&1
echo ========================================
echo  OpenClaw 蒸馏流程日志
echo ========================================
echo.
py "C:\Users\Yuan\Documents\Codex\2026-06-29\gemma4-e2b\work\chat-viewer.py" distill
echo.
pause

