/**
 * video-generator Skill
 * 支持自定义配置优先 + 内置 7 key 自动平滑降级
 */

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import https from "node:https";
import http from "node:http";

const DEFAULT_API_BASE = "https://apihub.agnes-ai.com/v1/videos";
const STATE_DIR = process.env.OPENCLAW_STATE_DIR
  || path.join(process.env.OPENCLAW_HOME || process.env.USERPROFILE || process.env.HOME || os.homedir(), '.openclaw');
const SAVE_DIR = path.join(STATE_DIR, 'video-output');

function loadMediaPrefs(kind) {
  try {
    const fname = kind === 'video' ? 'video-generator.json' : 'media-generator.json';
    const p = path.join(STATE_DIR, fname);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {}
  return {};
}

// 内置 7 API keys 轮询
const BUILTIN_API_KEYS = [
  "sk-95sX8HnNOhh8FFfAm3ccOgGFg6MA8yf7zU5PEEQdGxSuKhQY",
  "sk-z2NHJlR99oODMYvS9C5u8qLMNf6hmc9vRm5JenvHHStTfxZn",
  "sk-ct7MSvbC8LqL1gGqJuoVCKgjtecXwbjIUZhXQ0gITEaksCS0",
  "sk-nZtkk9AAyZl3sbkv8Gw4R1R99NnkgUWhRGL4Cp0Dl7LSPsUu",
  "sk-Y6ORz4nnuXHUpwjdXv2WlmLMwCfPBMtmh69iuXxZkQtZazyV",
  "sk-GhS6TUB6W8LibJT5whDhbUvmYW3csM0HdGDdjotpgadQbd2F",
  "sk-HV5HINAfAhMJOnYxYp83ZXDLqeudt8ofLtdm9Bj5p9SUOUGh",
];

export default function createPlugin(apiOrRuntime) {
  const api = apiOrRuntime && typeof apiOrRuntime.registerTool === 'function' ? apiOrRuntime : null;
  const runtime = api?.runtime ?? apiOrRuntime;
  const skill = createSkill(runtime);

  if (api) {
    api.registerTool({
      name: 'draw_video',
      description: skill.description + ' Use when the user asks to generate or create a video.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['prompt'],
        properties: {
          prompt: { type: 'string', description: 'Video description (required)' },
          image_url: { type: 'string', description: 'Optional first-frame image URL' },
          model: { type: 'string', description: 'Model id, e.g. agnes-video-v2.0' },
          duration: { type: 'number', description: 'Duration in seconds' },
          resolution: { type: 'string', description: '480p, 720p, or 1080p' },
          fps: { type: 'number', description: 'Frames per second' },
          aspect_ratio: { type: 'string', description: '16:9, 9:16, 1:1, or 4:3' },
        },
      },
      async execute(_toolCallId, params) {
        const result = await skill.draw_video(params || {});
        const mediaHint = result.filepath ? `\nMEDIA:${result.filepath}` : '';
        return {
          content: [{ type: 'text', text: JSON.stringify(result) + mediaHint }],
          details: result,
        };
      },
    });
    return { name: skill.name };
  }

  return skill;
}

export function createSkill(runtime) {
  if (!fs.existsSync(SAVE_DIR)) {
    fs.mkdirSync(SAVE_DIR, { recursive: true });
  }

  const customConfig = {
    ...(runtime?.config?.videoGenerator || {}),
    ...loadMediaPrefs('video'),
  };
  const rawKey = (customConfig.apiKey || '').trim();
  const userApiKey = (rawKey && rawKey !== 'sk-builtin-agnes-key-mask') ? rawKey : null;
  const userApiBase = customConfig.apiBase || DEFAULT_API_BASE;
  const customModel = customConfig.model || runtime?.config?.agents?.defaults?.videoGenerationModel?.primary || "agnes-video-v2.0";

  return {
    name: "video-generator",
    description: "Generate videos via agnes-ai or user-customized API with full parameter control",

    instruction: `当用户要求生成视频时使用此技能。支持以下参数控制：

- prompt (必填): 视频描述文本
- image_url (可选): 首帧图片 URL
- model: 模型名称
- duration (默认 5): 视频时长（秒）
- resolution (默认 "720p"): 分辨率
- fps (默认 24): 帧率
- aspect_ratio (默认 "16:9"): 宽高比`,

    async draw_video({
      prompt,
      image_url,
      model,
      duration = 5,
      resolution = "720p",
      fps = 24,
      aspect_ratio = "16:9",
      output_dir,
    }) {
      const dir = output_dir || SAVE_DIR;
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const selectedModel = model || customModel;
      const filename = `video_${Date.now()}.mp4`;
      const filepath = path.join(dir, filename);

      const cleanModel = selectedModel.includes('/') ? selectedModel.split('/').pop() : selectedModel;
      const body = buildAgnesVideoCreateBody({
        model: cleanModel,
        prompt,
        duration: Number(duration),
        resolution,
        fps: Number(fps),
        aspect_ratio,
        image_url,
      });

      console.log(`[video-generator] Generating: ${prompt} | model=${selectedModel} | ${body.width}x${body.height} frames=${body.num_frames} fps=${body.frame_rate}`);

      const videoUrl = await callVideoAPIWithRetry(body, userApiBase, userApiKey);

      await downloadFile(videoUrl, filepath);

      console.log(`[video-generator] Video saved to: ${filepath}`);

      return {
        success: true,
        filepath,
        filename,
        prompt,
        duration: Number(duration),
        resolution,
        fps: Number(fps),
        aspect_ratio,
        model: selectedModel,
      };
    },
  };
}

function framesForDuration(seconds, fps) {
  const target = Math.max(1, Math.round(Number(seconds) * Number(fps) || 120));
  let best = 1;
  for (let n = 0; n <= 55; n++) {
    const frames = 8 * n + 1;
    if (frames > 441) break;
    if (Math.abs(frames - target) < Math.abs(best - target)) best = frames;
  }
  return best;
}

function sizeForResolution(resolution, aspectRatio) {
  const presets = {
    '480p': { '16:9': [832, 448], '9:16': [448, 832], '1:1': [640, 640], '4:3': [640, 480], '3:4': [480, 640] },
    '720p': { '16:9': [1152, 768], '9:16': [768, 1152], '1:1': [768, 768], '4:3': [1024, 768], '3:4': [768, 1024] },
    '1080p': { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:3': [1440, 1080], '3:4': [1080, 1440] },
  };
  const resKey = String(resolution || '720p').toLowerCase();
  const ratioKey = String(aspectRatio || '16:9');
  const table = presets[resKey] || presets['720p'];
  const pair = table[ratioKey] || table['16:9'];
  return { width: pair[0], height: pair[1] };
}

/** 按官方文档构造创建任务 body：https://agnes-ai.com/zh-Hans/docs/agnes-video-v20 */
function buildAgnesVideoCreateBody({ model, prompt, duration = 5, resolution = '720p', fps = 24, aspect_ratio = '16:9', image_url }) {
  const frameRate = Math.min(60, Math.max(1, Number(fps) || 24));
  const { width, height } = sizeForResolution(resolution, aspect_ratio);
  const body = {
    model: model || 'agnes-video-v2.0',
    prompt,
    width,
    height,
    num_frames: framesForDuration(duration, frameRate),
    frame_rate: frameRate,
  };
  if (image_url) body.image = image_url;
  return body;
}

function resolveVideoPollUrl(videoId, apiBaseUrl, modelName) {
  const base = String(apiBaseUrl || DEFAULT_API_BASE).trim();
  try {
    const origin = new URL(base).origin;
    // 官方推荐：GET /agnesapi?video_id=（兼容旧版才是 /v1/videos/<task_id>）
    if (/agnes-ai\.com/i.test(origin)) {
      let url = `${origin}/agnesapi?video_id=${encodeURIComponent(videoId)}`;
      if (modelName) url += `&model_name=${encodeURIComponent(String(modelName).replace(/^.*\//, ''))}`;
      return url;
    }
  } catch (e) {}
  return `${base.replace(/\/$/, '')}/${videoId}`;
}

function extractVideoUrl(result) {
  if (!result || typeof result !== 'object') return '';
  // 官方完成态：metadata.url
  return result.metadata?.url
    || result.video?.url
    || result.video_url
    || result.url
    || result.output_url
    || result.output?.url
    || result.result?.url
    || result.data?.[0]?.url
    || '';
}

function pickVideoPollId(result) {
  // 新接入优先 video_id
  return result?.video_id || result?.id || result?.task_id || null;
}

async function callVideoAPIWithRetry(body, apiBase, userApiKey) {
  let lastError = null;

  if (userApiKey) {
    try {
      return await callVideoAPI(body, userApiKey, apiBase);
    } catch (err) {
      lastError = err;
      console.warn(`[video-generator] Custom API key failed: ${err.message}, falling back to built-in keys...`);
    }
  }

  for (let attempt = 0; attempt < BUILTIN_API_KEYS.length; attempt++) {
    const apiKey = BUILTIN_API_KEYS[attempt % BUILTIN_API_KEYS.length];
    try {
      return await callVideoAPI(body, apiKey, DEFAULT_API_BASE);
    } catch (err) {
      lastError = err;
      console.warn(`[video-generator] Built-in key ${attempt + 1}/${BUILTIN_API_KEYS.length} failed: ${err.message}`);
    }
  }

  throw new Error(`All video API keys failed. Last error: ${lastError?.message}`);
}

function callVideoAPI(body, apiKey, apiBaseUrl) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const urlObj = new URL(apiBaseUrl);
    const transport = urlObj.protocol === "https:" ? https : http;

    const req = transport.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 60000,
    }, (res) => {
      let chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", async () => {
        try {
          const raw = Buffer.concat(chunks).toString();
          const result = JSON.parse(raw);
          if (res.statusCode < 200 || res.statusCode >= 300 || result.error) {
            reject(new Error(result.error?.message || `HTTP ${res.statusCode}`));
            return;
          }

          const immediateUrl = extractVideoUrl(result);
          if (immediateUrl && !result.status && !result.id && !result.task_id && !result.video_id) {
            resolve(immediateUrl);
            return;
          }

          if (result.status === "processing" || result.status === "queued" || result.status === "pending" || result.status === "in_progress" || result.id || result.task_id || result.video_id) {
            const pollId = pickVideoPollId(result);
            if (pollId) {
              try {
                const finalUrl = await pollVideoResult(pollId, apiKey, apiBaseUrl, body.model);
                resolve(finalUrl);
                return;
              } catch (pollErr) {
                reject(pollErr);
                return;
              }
            }
          }

          if (immediateUrl) {
            resolve(immediateUrl);
          } else {
            reject(new Error(`No video URL in response`));
          }
        } catch (e) {
          reject(new Error(`Response parse error: ${e.message}`));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Video create request timeout"));
    });
    req.write(data);
    req.end();
  });
}

async function pollVideoResult(videoId, apiKey, apiBaseUrl, modelName) {
  const maxAttempts = 120; // 最长约 10 分钟
  const pollUrl = resolveVideoPollUrl(videoId, apiBaseUrl, modelName);
  console.log(`[video-generator] Polling ${pollUrl}`);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const result = await checkVideoTaskStatus(pollUrl, apiKey);
      const status = result.status || result.data?.status || '';
      if (attempt === 0 || attempt % 6 === 5) {
        console.log(`[video-generator] Poll #${attempt + 1} status=${status || 'unknown'}`);
      }
      if (status === "succeeded" || status === "completed" || status === "success") {
        const videoUrl = extractVideoUrl(result);
        if (videoUrl) return videoUrl;
        throw new Error("Video succeeded but no video URL in response (expected metadata.url)");
      }
      if (status === "failed" || status === "error") {
        const errMsg = result.error?.message || result.error || result.message || 'Unknown error';
        throw new Error(`Video generation failed: ${errMsg}`);
      }
    } catch (e) {
      if (/failed|no video URL/i.test(e.message || '')) throw e;
      console.warn(`[video-generator] Poll error: ${e.message}`);
    }
  }
  throw new Error("Video generation timed out after 10 minutes");
}

function checkVideoTaskStatus(pollUrl, apiKey) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(pollUrl);
    const transport = urlObj.protocol === "https:" ? https : http;

    const req = transport.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 30000,
    }, (res) => {
      let chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString());
          if (res.statusCode < 200 || res.statusCode >= 300 || result.error?.message) {
            reject(new Error(result.error?.message || `HTTP ${res.statusCode}`));
            return;
          }
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Video poll request timeout"));
    });
    req.end();
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const transport = url.startsWith("https:") ? https : http;
    const fileStream = fs.createWriteStream(destPath);
    transport.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(downloadFile(res.headers.location, destPath));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(fileStream);
      fileStream.on("finish", () => { fileStream.close(); resolve(); });
    }).on("error", (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}
