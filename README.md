# AI-v24.13.0 开源版

基于 OpenClaw 2026.6.11 的本地 AI 助手网关。

## 快速开始

### 1. 前置条件
- Windows 系统
- 已安装 Node.js v24.x（推荐 nvm-windows）

### 2. 初始化（首次运行）
双击 `init.bat`，脚本会自动：
- 检测系统中的 Node.js（优先 nvm v24.13.0）
- 复制 node.exe 到项目内的 `.node-sandbox/`
- 自动创建 `.openclaw/openclaw.json` 配置文件

### 3. 配置 API Key
编辑 `C:\Users\<你的用户名>\.openclaw\openclaw.json`，将以下占位符替换为你的真实 API Key：
- `YOUR_ZHIPU_API_KEY_HERE` → 智谱 API Key
- `YOUR_YITONG_API_KEY_HERE` → 阿里云 API Key
- `YOUR_AGNES_API_KEY_HERE` → Agnes AI API Key

获取 Agnes API Key：https://agnes-ai.com/zh-Hans/docs/agnes-video-v20

### 4. 启动 Gateway
双击 `start-gateway.bat`，Gateway 将在端口 18789 启动。

## 常见问题

**Q: 启动后窗口闪退？**
A: 检查是否已运行 `init.bat`，确保 `.node-sandbox/node.exe` 存在。

**Q: 提示 "Missing config"？**
A: 运行 `init.bat` 会自动创建配置文件，然后编辑 `openclaw.json` 填入 API Key。

**Q: 全局 node 版本被改了？**
A: 本项目使用 `.node-sandbox/` 内的独立 node，不影响全局。

## 技术栈
- OpenClaw 2026.6.11
- Node.js v24.13.0（本地沙箱）
- 支持微信、Discord、飞书、Telegram 等渠道
