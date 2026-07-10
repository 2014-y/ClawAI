import sqlite3
import json
import os
import re
import sys
import io
from datetime import datetime

# 强制将标准输出设置为 UTF-8 编码，防止 Windows 平台下的 GBK 编码字符集崩溃
if sys.platform.startswith('win'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

db_path = r"C:\Users\Yuan\.openclaw\state\openclaw.sqlite"
log_dir = r"C:\Users\Yuan\AppData\Local\Temp\openclaw"
learning_log_path = r"C:\Users\Yuan\glm4_finetune\learning_data\learning_log.jsonl"

stats = {
    "total_tokens": 0,
    "total_requests": 0,
    "total_cost": 0.0,
    "sub_input_tokens": 0,
    "sub_output_tokens": 0,
    "sub_hit_tokens": 0,
    "hit_rate": 0.0,
    "hourly_trend": {}, # {hour: {cost: 0, hit: 0, input: 0, output: 0}}
    "logs": [],
    "providers": {},
    "models": {}
}

# 1. 优先读取微调对话日志 (用户本地的最核心真实人机交互数据)
if os.path.exists(learning_log_path):
    try:
        with open(learning_log_path, "r", encoding="utf-8-sig") as lf:
            for line in lf:
                line = line.strip()
                if not line:
                    continue
                obj = json.loads(line)
                
                # 时间戳解析
                ts_str = obj.get("timestamp", "")
                dt = datetime.now()
                if ts_str:
                    try:
                        dt = datetime.strptime(ts_str[:19], "%Y-%m-%dT%H:%M:%S")
                    except:
                        pass
                
                q = obj.get("question", "") or ""
                la = obj.get("local_answer", "") or ""
                za = obj.get("zhipu_answer", "") or ""
                
                # 中文字数估算 Token (字数*2)
                input_t = len(q) * 2
                output_t = (len(la) + len(za)) * 2
                total_t = input_t + output_t
                if total_t == 0:
                    total_t = 1000
                    input_t = 800
                    output_t = 200
                
                p_name = obj.get("source") or "zhipu"
                m_name = obj.get("zhipu_model") or "glm-4.7"
                
                stats["total_tokens"] += total_t
                stats["total_requests"] += 1
                stats["sub_input_tokens"] += input_t
                stats["sub_output_tokens"] += output_t
                
                hour_str = dt.strftime("%H:00")
                if hour_str not in stats["hourly_trend"]:
                    stats["hourly_trend"][hour_str] = {"cost": 0, "hit": 0, "input": 0, "output": 0}
                stats["hourly_trend"][hour_str]["input"] += input_t
                stats["hourly_trend"][hour_str]["output"] += output_t
                
                if p_name not in stats["providers"]:
                    stats["providers"][p_name] = {"requests": 0, "tokens": 0, "hit": 0}
                stats["providers"][p_name]["requests"] += 1
                stats["providers"][p_name]["tokens"] += total_t
                
                if m_name not in stats["models"]:
                    stats["models"][m_name] = {"provider": p_name, "calls": 0, "tokens": 0, "duration": 0.0, "hit": 0}
                stats["models"][m_name]["calls"] += 1
                stats["models"][m_name]["tokens"] += total_t
                stats["models"][m_name]["duration"] += 1.5
                
                time_str = dt.strftime("%H:%M:%S")
                stats["logs"].append({
                    "time": time_str,
                    "provider": p_name,
                    "model": m_name,
                    "input": input_t,
                    "output": output_t,
                    "hit": 0,
                    "duration": "1.5s",
                    "status": "成功",
                    "timestamp": int(dt.timestamp() * 1000)
                })
    except Exception as e:
        pass

# 2. 读取 SQLite 里的 cron 运行记录
if os.path.exists(db_path):
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [t[0] for t in cursor.fetchall()]
        if "cron_run_logs" in tables:
            cursor.execute("SELECT model, provider, total_tokens, duration_ms, run_at_ms FROM cron_run_logs WHERE total_tokens IS NOT NULL AND total_tokens > 0;")
            rows = cursor.fetchall()
            for r in rows:
                model, provider, total_tokens, duration_ms, run_at_ms = r
                
                input_t = int(total_tokens * 0.8)
                output_t = total_tokens - input_t
                
                stats["total_tokens"] += total_tokens
                stats["total_requests"] += 1
                stats["sub_input_tokens"] += input_t
                stats["sub_output_tokens"] += output_t
                
                dt = datetime.fromtimestamp(run_at_ms / 1000.0)
                hour_str = dt.strftime("%H:00")
                
                if hour_str not in stats["hourly_trend"]:
                    stats["hourly_trend"][hour_str] = {"cost": 0, "hit": 0, "input": 0, "output": 0}
                stats["hourly_trend"][hour_str]["input"] += input_t
                stats["hourly_trend"][hour_str]["output"] += output_t
                
                p_name = provider or "unknown"
                if p_name not in stats["providers"]:
                    stats["providers"][p_name] = {"requests": 0, "tokens": 0, "hit": 0}
                stats["providers"][p_name]["requests"] += 1
                stats["providers"][p_name]["tokens"] += total_tokens
                
                m_name = model or "unknown"
                if m_name not in stats["models"]:
                    stats["models"][m_name] = {"provider": p_name, "calls": 0, "tokens": 0, "duration": 0.0, "hit": 0}
                stats["models"][m_name]["calls"] += 1
                stats["models"][m_name]["tokens"] += total_tokens
                stats["models"][m_name]["duration"] += (duration_ms / 1000.0)
                
                time_str = dt.strftime("%H:%M:%S")
                stats["logs"].append({
                    "time": time_str,
                    "provider": p_name,
                    "model": m_name,
                    "input": input_t,
                    "output": output_t,
                    "hit": 0,
                    "duration": f"{(duration_ms / 1000.0):.1f}s",
                    "status": "成功",
                    "timestamp": run_at_ms
                })
        conn.close()
    except Exception as e:
        pass

# 3. 读取文本日志中的 model-fetch 交互记录
if os.path.exists(log_dir):
    try:
        log_files = [f for f in os.listdir(log_dir) if f.startswith("openclaw-") and f.endswith(".log")]
        for f_name in log_files:
            f_path = os.path.join(log_dir, f_name)
            with open(f_path, "r", encoding="utf-8-sig", errors="ignore") as lf:
                for line in lf:
                    if "[model-fetch] response" in line:
                        try:
                            obj = json.loads(line)
                            msg = obj.get("1", "")
                            meta = obj.get("_meta", {})
                            date_str = meta.get("date", "")
                            
                            prov_match = re.search(r"provider=([^\s]+)", msg)
                            model_match = re.search(r"model=([^\s]+)", msg)
                            elapsed_match = re.search(r"elapsedMs=([0-9]+)", msg)
                            
                            if prov_match and model_match:
                                p_name = prov_match.group(1)
                                m_name = model_match.group(1)
                                elapsed = int(elapsed_match.group(1)) if elapsed_match else 1000
                                
                                est_tokens = 3500
                                input_t = 3000
                                output_t = 500
                                hit_t = 0
                                
                                if elapsed < 500:
                                    hit_t = 2800
                                    est_tokens = 700
                                    input_t = 200
                                
                                stats["total_tokens"] += est_tokens
                                stats["total_requests"] += 1
                                stats["sub_input_tokens"] += input_t
                                stats["sub_output_tokens"] += output_t
                                stats["sub_hit_tokens"] += hit_t
                                
                                dt = datetime.now()
                                if date_str:
                                    try:
                                        dt = datetime.strptime(date_str[:19], "%Y-%m-%dT%H:%M:%S")
                                    except:
                                        pass
                                hour_str = dt.strftime("%H:00")
                                
                                if hour_str not in stats["hourly_trend"]:
                                    stats["hourly_trend"][hour_str] = {"cost": 0, "hit": 0, "input": 0, "output": 0}
                                stats["hourly_trend"][hour_str]["input"] += input_t
                                stats["hourly_trend"][hour_str]["output"] += output_t
                                stats["hourly_trend"][hour_str]["hit"] += hit_t
                                
                                if p_name not in stats["providers"]:
                                    stats["providers"][p_name] = {"requests": 0, "tokens": 0, "hit": 0}
                                stats["providers"][p_name]["requests"] += 1
                                stats["providers"][p_name]["tokens"] += est_tokens
                                stats["providers"][p_name]["hit"] += hit_t
                                
                                if m_name not in stats["models"]:
                                    stats["models"][m_name] = {"provider": p_name, "calls": 0, "tokens": 0, "duration": 0.0, "hit": 0}
                                stats["models"][m_name]["calls"] += 1
                                stats["models"][m_name]["tokens"] += est_tokens
                                stats["models"][m_name]["duration"] += (elapsed / 1000.0)
                                stats["models"][m_name]["hit"] += hit_t
                                
                                time_str = dt.strftime("%H:%M:%S")
                                stats["logs"].append({
                                    "time": time_str,
                                    "provider": p_name,
                                    "model": m_name,
                                    "input": input_t,
                                    "output": output_t,
                                    "hit": hit_t,
                                    "duration": f"{(elapsed / 1000.0):.1f}s",
                                    "status": "成功",
                                    "timestamp": int(dt.timestamp() * 1000)
                                })
                        except:
                            pass
    except Exception as e:
        pass

# 4. 规范化及合并结果
if stats["total_tokens"] > 0:
    stats["hit_rate"] = (stats["sub_hit_tokens"] / float(stats["total_tokens"])) * 100.0

stats["total_cost"] = (stats["sub_input_tokens"] / 1000000.0) * 1.5 + (stats["sub_output_tokens"] / 1000000.0) * 6.0

# 整理日志排序 (取最近 50 条)
stats["logs"].sort(key=lambda x: x["timestamp"], reverse=True)
stats["logs"] = stats["logs"][:50]

print(json.dumps(stats, ensure_ascii=False))
