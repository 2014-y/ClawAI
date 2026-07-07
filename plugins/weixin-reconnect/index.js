/**
 * WeChat 自动重连增强插件 v2
 * 
 * 监控 WeChat channel 连接状态，检测到断线后自动触发重连。
 * 通过 HTTP API 查询 channel 状态，超过阈值未活动则重启 channel。
 */

const PLUGIN_NAME = 'weixin-reconnect';
const GATEWAY_URL = 'http://127.0.0.1:18789';
const CHECK_INTERVAL_MS = 30_000;    // 每30秒检查一次
const DISCONNECT_THRESHOLD_MS = 3 * 60_000; // 3分钟无活动视为断线
const MAX_RECONNECT_ATTEMPTS = 3;   // 连续重连上限
const RECONNECT_COOLDOWN_MS = 15_000; // 重连冷却

export default function createPlugin(runtime) {
  console.log(`[${PLUGIN_NAME}] 🔌 WeChat 自动重连插件已加载`);

  let lastEventAt = 0;
  let consecutiveDisconnects = 0;
  let isReconnecting = false;
  let timer = null;

  /** 查询 WeChat channel 状态 */
  async function getChannelStatus() {
    try {
      const resp = await fetch(`${GATEWAY_URL}/api/channels/openclaw-weixin/status`, {
        signal: AbortSignal.timeout(5000)
      });
      if (!resp.ok) return null;
      return await resp.json();
    } catch {
      return null;
    }
  }

  /** 重启 WeChat channel */
  async function restartChannel() {
    if (isReconnecting) {
      console.log(`[${PLUGIN_NAME}] ⏳ 重连进行中，跳过`);
      return false;
    }
    if (consecutiveDisconnects >= MAX_RECONNECT_ATTEMPTS) {
      console.log(`[${PLUGIN_NAME}] ❌ 重连已达上限 (${MAX_RECONNECT_ATTEMPTS})，需手动干预`);
      return false;
    }

    isReconnecting = true;
    consecutiveDisconnects++;

    console.log(`[${PLUGIN_NAME}] 🔄 重启 WeChat channel (第 ${consecutiveDisconnects}/${MAX_RECONNECT_ATTEMPTS} 次)...`);

    try {
      // 通过 gateway RPC 重启 channel
      const resp = await fetch(`${GATEWAY_URL}/api/channels/openclaw-weixin/restart`, {
        method: 'POST',
        signal: AbortSignal.timeout(10000)
      });

      if (resp.ok) {
        console.log(`[${PLUGIN_NAME}] ✅ WeChat 重启成功`);
        consecutiveDisconnects = 0;
        isReconnecting = false;
        return true;
      } else {
        console.log(`[${PLUGIN_NAME}] ⚠️ 重启失败: ${resp.status}`);
      }
    } catch (err) {
      console.log(`[${PLUGIN_NAME}] ⚠️ 重启异常: ${err.message}`);
    }

    isReconnecting = false;
    return false;
  }

  /** 心跳检测循环 */
  async function checkLoop() {
    const status = await getChannelStatus();

    if (status) {
      // 从状态中提取最后活动时间
      const account = status.accounts?.[0] || status;
      const lastActivity = account.lastEventAt || account.last_activity || 0;

      if (lastActivity > lastEventAt) {
        lastEventAt = lastActivity;
        consecutiveDisconnects = 0; // 有活动就重置
      }

      // 检查是否断线
      if (lastEventAt > 0 && (Date.now() - lastEventAt) > DISCONNECT_THRESHOLD_MS) {
        console.log(`[${PLUGIN_NAME}] ⚠️ 检测到断线: ${Math.round((Date.now() - lastEventAt) / 60000)} 分钟无活动`);
        await restartChannel();
      } else if (lastEventAt > 0) {
        // 正常连接状态
        if (consecutiveDisconnects > 0) {
          console.log(`[${PLUGIN_NAME}] ✅ WeChat 连接恢复正常`);
        }
        consecutiveDisconnects = 0;
      }
    } else {
      // API 返回 null，channel 可能不存在或未注册
      console.log(`[${PLUGIN_NAME}] ℹ️ Channel 状态不可查，跳过检测`);
    }
  }

  return {
    name: PLUGIN_NAME,

    async onReady() {
      console.log(`[${PLUGIN_NAME}] 📡 开始监控 WeChat 连接 (间隔: ${CHECK_INTERVAL_MS/1000}s, 断线阈值: ${DISCONNECT_THRESHOLD_MS/60000}min)`);
      
      // 初始延迟5秒后开始检测
      await new Promise(r => setTimeout(r, 5000));
      await checkLoop();
      
      timer = setInterval(checkLoop, CHECK_INTERVAL_MS);
    },

    async onShutdown() {
      if (timer) clearInterval(timer);
      console.log(`[${PLUGIN_NAME}] 🛑 插件已停止`);
    }
  };
}
