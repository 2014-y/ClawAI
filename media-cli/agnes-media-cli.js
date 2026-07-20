/**
 * agnes-media-cli.js
 * 命令行工具：通过 agnes-ai API 或用户自定义 API 生成图片和视频
 * 支持用户自定义配置优先 + 内置 7 key 自动平滑降级
 */

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import https from "node:https";
import http from "node:http";

const DEFAULT_API_BASE = "https://apihub.agnes-ai.com/v1";
const STATE_DIR = process.env.OPENCLAW_STATE_DIR
  || path.join(process.env.OPENCLAW_HOME || process.env.USERPROFILE || process.env.HOME || os.homedir(), '.openclaw');
const SAVE_DIR = path.join(STATE_DIR, 'media-output');

const BUILTIN_API_KEYS = [
  "sk-95sX8HnNOhh8FFfAm3ccOgGFg6MA8yf7zU5PEEQdGxSuKhQY",
  "sk-z2NHJlR99oODMYvS9C5u8qLMNf6hmc9vRm5JenvHHStTfxZn",
  "sk-ct7MSvbC8LqL1gGqJuoVCKgjtecXwbjIUZhXQ0gITEaksCS0",
  "sk-nZtkk9AAyZl3sbkv8Gw4R1R99NnkgUWhRGL4Cp0Dl7LSPsUu",
  "sk-Y6ORz4nnuXHUpwjdXv2WlmLMwCfPBMtmh69iuXxZkQtZazyV",
  "sk-GhS6TUB6W8LibJT5whDhbUvmYW3csM0HdGDdjotpgadQbd2F",
  "sk-HV5HINAfAhMJOnYxYp83ZXDLqeudt8ofLtdm9Bj5p9SUOUGh",
];

function loadUserConfig(type) {
  const prefsFile = type === 'video' ? 'video-generator.json' : 'media-generator.json';
  const defaults = type === 'video'
    ? { apiBase: 'https://apihub.agnes-ai.com/v1/videos', apiKey: null, model: 'agnes-ai/agnes-video-v2.0' }
    : { apiBase: 'https://apihub.agnes-ai.com/v1/images/generations', apiKey: null, model: 'agnes-ai/agnes-image-2.0-flash' };
  const normalizeApiBase = (apiBase, kind) => {
    const b = String(apiBase || '').trim().replace(/\/$/, '');
    if (!b) return defaults.apiBase;
    if (kind === 'image') {
      if (b.endsWith('/images/generations')) return b;
      if (b.endsWith('/images')) return `${b}/generations`;
      if (b.endsWith('/v1')) return `${b}/images/generations`;
      return b;
    }
    if (b.endsWith('/videos')) return b;
    if (b.endsWith('/v1')) return `${b}/videos`;
    return b;
  };
  const normalize = (sec) => {
    if (!sec || typeof sec !== 'object') return null;
    const rawKey = (sec.apiKey || '').trim();
    const isBuiltInKey = !rawKey
      || rawKey === 'sk-builtin-agnes-key-mask'
      || BUILTIN_API_KEYS.includes(rawKey);
    const apiKey = isBuiltInKey ? null : rawKey;
    return {
      apiBase: normalizeApiBase(sec.apiBase, type),
      apiKey,
      model: sec.model || defaults.model
    };
  };
  try {
    const sidecarPath = path.join(STATE_DIR, prefsFile);
    if (fs.existsSync(sidecarPath)) {
      const fromSidecar = normalize(JSON.parse(fs.readFileSync(sidecarPath, 'utf8')));
      if (fromSidecar) return fromSidecar;
    }
  } catch (e) {}
  try {
    const configPath = path.join(STATE_DIR, 'openclaw.json');
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const sec = type === 'video' ? cfg.videoGenerator : cfg.imageGenerator;
      const fromConfig = normalize(sec);
      if (fromConfig) return fromConfig;
    }
  } catch (e) {}
  return { apiBase: defaults.apiBase, apiKey: null, model: defaults.model };
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(fileStream);
      fileStream.on("finish", () => { fileStream.close(); resolve(); });
    }).on("error", reject);
  });
}

function resolveApiUrl(customBaseUrl, endpoint, defaultBase) {
  const ep = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const base = String(customBaseUrl || defaultBase || DEFAULT_API_BASE).trim().replace(/\/$/, '');
  if (base.endsWith(ep)) return base;
  if (ep === '/images/generations') {
    if (base.endsWith('/images/generations')) return base;
    if (base.endsWith('/images')) return `${base}/generations`;
    if (base.endsWith('/v1')) return `${base}/images/generations`;
  }
  if (ep === '/videos') {
    if (base.endsWith('/videos')) return base;
    if (base.endsWith('/v1')) return `${base}/videos`;
  }
  if (base.includes(ep)) return base;
  return `${base}${ep}`;
}

function apiPost(endpoint, body, apiKey, customBaseUrl) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const fullUrl = resolveApiUrl(customBaseUrl, endpoint, DEFAULT_API_BASE);
    const urlObj = new URL(fullUrl);
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
    }, (res) => {
      let chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString());
          if (result.error && result.error.message) reject(new Error(`API Error: ${result.error.message}`));
          else resolve(result);
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function apiGetRaw(urlStr, apiKey) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlStr);
    const transport = urlObj.protocol === "https:" ? https : http;
    const req = transport.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }, (res) => {
      let chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString());
          if (result.error && result.error.message) reject(new Error(`API Error: ${result.error.message}`));
          else resolve(result);
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function apiWithRetry(endpoint, body, userConfig) {
  if (userConfig && userConfig.apiKey) {
    try {
      return await apiPost(endpoint, body, userConfig.apiKey, userConfig.apiBase);
    } catch (e) {
      console.error(`[media-cli] User API Key failed: ${e.message}, falling back to built-in keys`);
    }
  }

  let lastErr = null;
  for (let i = 0; i < BUILTIN_API_KEYS.length; i++) {
    try {
      return await apiPost(endpoint, body, BUILTIN_API_KEYS[i % BUILTIN_API_KEYS.length], DEFAULT_API_BASE);
    } catch (e) {
      lastErr = e;
      console.error(`[retry] Built-in Key ${i + 1}/${BUILTIN_API_KEYS.length} failed: ${e.message}`);
    }
  }
  throw lastErr;
}

function getArg(name, argv) {
  const idx = argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return argv[idx + 1];
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

function extractVideoUrl(obj) {
  if (!obj || typeof obj !== 'object') return '';
  return obj.metadata?.url
    || obj.video?.url
    || obj.video_url
    || obj.url
    || obj.output_url
    || obj.output?.url
    || obj.result?.url
    || (obj.data && (obj.data.video_url || obj.data.url || obj.data[0]?.url))
    || '';
}

// --- Video ---

async function genVideo(argv) {
  const userConfig = loadUserConfig('video');
  const prompt = getArg("prompt", argv);
  if (!prompt) throw new Error("Missing --prompt");

  const model = getArg("model", argv) || userConfig.model || "agnes-video-v2.0";
  const duration = getArg("duration", argv) || 5;
  const resolution = getArg("resolution", argv) || "720p";
  const fps = getArg("fps", argv) || 24;
  const aspect_ratio = getArg("aspect", argv) || "16:9";
  const image_url = getArg("image_url", argv) || getArg("image", argv);

  ensureDir(SAVE_DIR);
  const filepath = path.join(SAVE_DIR, `video_${Date.now()}.mp4`);
  const filename = path.basename(filepath);

  const cleanModel = model.includes('/') ? model.split('/').pop() : model;
  const body = buildAgnesVideoCreateBody({
    model: cleanModel,
    prompt,
    duration: Number(duration),
    resolution,
    fps: Number(fps),
    aspect_ratio,
    image_url,
  });

  console.error(`[video] prompt="${prompt}" model=${model} ${body.width}x${body.height} frames=${body.num_frames} fps=${body.frame_rate}`);

  const result = await apiWithRetry("/videos", body, userConfig);

  let numFrames = undefined;

  if (result.status === "processing" || result.status === "queued" || result.status === "pending" || result.status === "in_progress" || result.id || result.task_id || result.video_id) {
    const pollId = result.video_id || result.id || result.task_id;
    console.error(`[video] Task submitted, video_id/task=${pollId}, polling status...`);
    const activeKey = userConfig.apiKey || BUILTIN_API_KEYS[0];
    const activeBase = userConfig.apiBase || DEFAULT_API_BASE;
    let pollUrl = '';
    try {
      const origin = new URL(activeBase).origin;
      // 官方推荐：GET /agnesapi?video_id=
      pollUrl = /agnes-ai\.com/i.test(origin)
        ? `${origin}/agnesapi?video_id=${encodeURIComponent(pollId)}&model_name=${encodeURIComponent(cleanModel)}`
        : `${(activeBase.endsWith('/videos') ? activeBase : activeBase.replace(/\/$/, '') + '/videos').replace(/\/$/, '')}/${pollId}`;
    } catch (e) {
      pollUrl = `https://apihub.agnes-ai.com/agnesapi?video_id=${encodeURIComponent(pollId)}&model_name=${encodeURIComponent(cleanModel)}`;
    }
    console.error(`[video] Poll URL: ${pollUrl}`);

    const startTime = Date.now();
    const maxPollTime = 10 * 60 * 1000;
    while (Date.now() - startTime < maxPollTime) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const pollResult = await apiGetRaw(pollUrl, activeKey);
        const st = pollResult.status || (pollResult.data && pollResult.data.status);
        console.error(`[video] Poll status: ${st}`);
        if (st === "succeeded" || st === "completed" || st === "success") {
          const videoUrl = extractVideoUrl(pollResult);
          if (pollResult.num_frames) numFrames = pollResult.num_frames;
          if (!videoUrl) throw new Error("Video succeeded but no video URL in response (expected metadata.url)");

          await downloadFile(videoUrl, filepath);
          console.error(`[video] Saved: ${filepath}`);
          return { success: true, filepath, filename, prompt, duration: Number(duration), resolution, fps: Number(fps), aspect_ratio, model, num_frames: numFrames };
        }
        if (st === "failed" || st === "error") {
          throw new Error(`Video generation failed: ${pollResult.error?.message || pollResult.error || JSON.stringify(pollResult).substring(0, 200)}`);
        }
      } catch (e) {
        if (e.message.includes("No video URL") || e.message.includes("failed")) throw e;
        console.error(`[video] Poll error: ${e.message}`);
      }
    }
    throw new Error("Video generation timed out after 10 minutes");
  }

  const videoUrl = extractVideoUrl(result) || result.remixed_from_video_id;
  if (!videoUrl) throw new Error(`No video URL in response: ${JSON.stringify(result).substring(0, 500)}`);

  await downloadFile(videoUrl, filepath);
  console.error(`[video] Saved: ${filepath}`);

  return { success: true, filepath, filename, prompt, duration: Number(duration), resolution, fps: Number(fps), aspect_ratio, model, num_frames: numFrames };
}

// --- Image ---

async function genImage(argv) {
  const userConfig = loadUserConfig('image');
  const prompt = getArg("prompt", argv);
  if (!prompt) throw new Error("Missing --prompt");

  const model = getArg("model", argv) || userConfig.model || "agnes-image-2.0-flash";
  const size = getArg("size", argv) || "1024x1024";
  const quality = getArg("quality", argv) || "standard";
  const count = Number(getArg("count", argv)) || 1;

  ensureDir(SAVE_DIR);
  const ts = Date.now();
  const results = [];

  console.error(`[image] prompt="${prompt}" model=${model} size=${size} quality=${quality} count=${count}`);

  const cleanModel = model.includes('/') ? model.split('/').pop() : model;
  const body = { model: cleanModel, prompt, size, n: Number(count) };
  if (quality) body.quality = quality;

  const result = await apiWithRetry("/images/generations", body, userConfig);

  if (result.data) {
    for (let i = 0; i < result.data.length; i++) {
      const item = result.data[i];
      const filename = `image_${ts}_${i + 1}.png`;
      const filepath = path.join(SAVE_DIR, filename);

      if (item.url) {
        await downloadFile(item.url, filepath);
      } else if (item.b64_json) {
        fs.writeFileSync(filepath, item.b64_json, "base64");
      } else {
        console.error(`[image] No url or b64_json for item ${i}`);
        continue;
      }
      results.push({ filepath, filename, index: i + 1 });
      console.error(`[image] Saved: ${filepath}`);
    }
  }

  return { success: true, files: results, prompt, model, size, count: results.length };
}

// --- Main ---

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (!cmd || !["video", "image"].includes(cmd)) {
    console.error("Usage: node agnes-media-cli.js video|image --prompt \"...\" [options]");
    process.exit(1);
  }

  try {
    let res;
    if (cmd === "video") {
      res = await genVideo(argv);
    } else {
      res = await genImage(argv);
    }
    console.log(JSON.stringify(res));
  } catch (e) {
    console.log(JSON.stringify({ success: false, error: e.message }));
    process.exit(1);
  }
}

main();
