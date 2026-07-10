# CHANGELOG

# AI-v24.13.0 变更日志


## [1.0.7] - 2026-07-10

### 修复
- **配置模板彻底清理**：移除所有可能导致启动失败的未识别 key（input、reasoning、api、heartbeat、subagents、contextPruning 等）
- **移除空对象 {}**：删除 agents.defaults.models 中的空对象，修复首次对话触发 /new 错误
- **API 占位符统一**：所有占位符统一为 YOUR_*_API_KEY_HERE 格式
- **插件精简**：仅保留 6 个核心插件（openclaw-weixin、ollama、tavily、duckduckgo、searxng、matrix）
- **配置模板从 12KB 精简到 6KB**

## [1.0.7b] - 2026-07-10

### 修复
- **移除所有文件的 UTF-8 BOM**（371 个文件），修复 Node.js/PowerShell 解析失败
- **创建 .gitattributes** 确保跨平台行尾一致性
- **修复 extensions/plugins 中残留 BOM**

## [1.0.7c] - 2026-07-10

### 修复
- **修复 auto-finetune.py 中硬编码路径**
- **修复 run-gateway.py 中硬编码路径**
- **移除 extensions 中 6 个 JSON 文件的 BOM**

## [1.0.7d] - 2026-07-10

### 修复
- **修复 docs 中剩余的 C:\Users\<用户名> 硬编码路径**
- **所有文档统一使用 %USERPROFILE%**
## [1.0.2] - 2026-07-10

### 修复
- **配置兼容性修复**：init.bat 自动清理配置文件中不被 OpenClaw 识别的 key（如 maxMessages、maxTurns 等），避免启动时报 "Invalid config" 错误
- **硬编码路径修复**：所有脚本和源码中的 硬编码路径替换为动态环境变量（%USERPROFILE% / process.env.USERPROFILE）
- **NVM 版本硬编码修复**：gateway.cmd、start-gateway.bat、run-gateway.py 不再硬编码 24.13.0，改为动态查找最新 NVM 版本
- **Ollama 路径修复**：auto-finetune.py 改用 shutil.which() 动态查找 ollama，不再硬编码安装路径
- **Codex 路径修复**：hooks/handler.ts 动态查找 Codex 可执行文件
- **文档路径修复**：docs/ 中的 D:\ai\AI-v24.13.0 示例路径替换为通用 <项目目录>
- **SKILL.md 路径修复**：workspace/skills/ 中的硬编码路径替换为 $env:USERPROFILE


## [1.0.1] - 2026-07-09

### 修复
- **图片识别修复**：多轮对话中 AI 只识别第一张图片的问题
  - 配置 tools.media.image.attachments.mode 设为 all，处理所有媒体附件
  - 模型声明 input 类型包含 text+image，确保正确传递图片
  - SOUL.md 新增图片识别规则指导 AI 只描述最新收到的图片
- **配置兼容性修复**：移除不支持的 contextPruning.mode 和 maxMessages
- **禁用冲突插件**：关闭 memory-core、memory-wiki、active-memory 插件

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
## [1.0.1] - 2026-07-08

### 修复
- **Computer Use 桌面控制解除后鼠标键盘失灵** (严重)
  - 根因：`open-computer-use.exe` 原生进程在管道关闭后未正确退出，持续持有鼠标/键盘独占锁
  - 修复：在 `computer-use-client.mjs` 中新增 `cleanupOrphanedComputerUseProcesses()` 清理函数
  - 修补 `NativePipeComputerUseClient.close()` — 在 finally 块中调用清理
  - 修补 `NativePipeComputerUseTransport.close()` — 关闭 socket 后等待 500ms 再清理
  - 注册 `process.on("exit")` 兜底清理 — Node.js 进程退出时强制终止残留进程
  - 影响：Windows 平台，修复后解除控制时自动清理残留进程，恢复正常输入




