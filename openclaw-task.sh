#!/bin/bash
# openclaw-task - 将大任务拆分为多个小步骤，每步独立会话执行
# 用法: ./openclaw-task "打开网易云音乐 播放周杰伦的晴天"
#      ./openclaw-task "打开浏览器 访问google.com"

TASK="$1"
SESSION_PREFIX="task-step"

if [ -z "$TASK" ]; then
  echo "用法: $0 <任务描述>"
  echo ""
  echo "示例:"
  echo "  $0 \"打开网易云音乐 播放周杰伦的晴天\""
  echo "  $0 \"打开浏览器 访问google.com\""
  echo ""
  echo "任务会自动拆分为多个步骤，每步使用独立会话，避免上下文溢出。"
  exit 1
fi

# 定义步骤
STEPS=(
  "分析任务并制定执行计划，列出需要操作的步骤"
  "执行第一步操作"
  "执行第二步操作"
  "执行第三步操作"
  "确认操作完成并总结结果"
)

echo "=========================================="
echo "  任务: $TASK"
echo "=========================================="
echo ""

for i in "${!STEPS[@]}"; do
  STEP_NUM=$((i + 1))
  SESSION_KEY="${SESSION_PREFIX}-${STEP_NUM}"
  PROMPT="${TASK} - ${STEPS[$i]}"

  echo "--- 步骤 ${STEP_NUM}/${#STEPS[@]} ---"
  echo "会话: ${SESSION_KEY}"
  echo "指令: ${PROMPT}"
  echo ""

  # 调用 openclaw 发送消息到新会话
  # 根据你的实际 openclaw CLI 命令调整
  RESULT=$(openclaw send "$PROMPT" --session "$SESSION_KEY" 2>&1)
  EXIT_CODE=$?

  echo "$RESULT"
  echo ""

  if [ $EXIT_CODE -ne 0 ]; then
    echo "[!] 步骤 ${STEP_NUM} 执行失败，退出码: ${EXIT_CODE}"
    echo "    你可以手动重试或调整任务后重新执行。"
    break
  fi

  # 步骤之间短暂等待，让前一步完成
  sleep 2
done

echo "=========================================="
echo "  所有步骤执行完毕"
echo "=========================================="
