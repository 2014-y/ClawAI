# CHANGELOG

# AI-v24.13.0 变更日志

## [1.0.0] - 2026-07-07

### 新增
- OpenClaw 2026.6.11 网关
- Agnes-AI 大模型集成 (agnes-2.0-flash, agnes-1.5-flash)
- Ollama 本地模型支持 (gemma4:latest)
- MCP Computer Use 桌面控制 (9 个工具)
- 微信/WhatsApp 多渠道消息
- 双模型训练插件 (Teacher-Student 蒸馏)
- 记忆核心插件
- 语音通话插件
- 图像/视频生成 CLI (支持 30 秒+ 视频)
- 20+ 技能包 (video-generator, image-generator, humanize-cli 等)
- 健康检查插件
- Cron 定时调度
- 一键启动脚本 (bat/ps1/sh/js)

### 修复
- 视频生成 duration→num_frames 转换 bug (原返回 5 秒 → 现支持 30 秒+)
- MCP 服务器路径配置问题
- API Key 轮询机制优化

### 技术栈
- Node.js v24.13.0
- OpenClaw 2026.6.11
- open-computer-use 0.1.54
- Agnes-AI API
- SQLite (会话存储)
