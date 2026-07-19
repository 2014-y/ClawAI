'use strict';
/**
 * OpenClaw media-understanding 依赖 models.providers.*.models[].input 声明识图能力。
 * 缺省时 OpenClaw 视为 text-only → 「Model does not support images」→ 主模型收不到图片上下文而乱答。
 */

const VISION_MODEL_ID_PATTERNS = [
  /^agnes-\d+\.\d+-flash$/i,
  /^agnes-1\.5-flash$/i,
  /vl/i,
  /vision/i,
  /llava/i,
  /gemma3/i,
  /pixtral/i,
  /moondream/i,
  /minicpm-v/i,
  /qwen.*vl/i,
  /gpt-4o/i,
  /gpt-4\.1/i,
  /claude-.*-(?:sonnet|opus|haiku)/i,
  /gemini/i
];

const GENERATION_ONLY_PATTERNS = [
  /^agnes-image-/i,
  /^agnes-video-/i,
  /^dall-e/i,
  /^stable-diffusion/i
];

const DEFAULT_VISION_MODEL = 'agnes-ai/agnes-2.0-flash';
const DEFAULT_MEDIA_PROMPT =
  '请用中文详细描述这张图片的内容，包括场景、物体、文字、颜色等。如果有多个物体，逐个描述。不超过300字。';

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function parseModelRef(ref) {
  const s = String(ref || '').trim();
  if (!s || !s.includes('/')) return null;
  const idx = s.indexOf('/');
  return {
    provider: s.slice(0, idx).trim(),
    model: s.slice(idx + 1).trim(),
    primary: s
  };
}

function isGenerationOnlyModelId(modelId) {
  const id = String(modelId || '').trim();
  return GENERATION_ONLY_PATTERNS.some((re) => re.test(id));
}

function isLikelyVisionModelId(modelId) {
  const id = String(modelId || '').trim();
  if (!id || isGenerationOnlyModelId(id)) return false;
  return VISION_MODEL_ID_PATTERNS.some((re) => re.test(id));
}

function ensureModelInput(model) {
  if (!isObject(model)) return false;
  const id = model.id || model.name || '';
  if (!isLikelyVisionModelId(id)) return false;
  const current = Array.isArray(model.input) ? model.input.map(String) : null;
  if (current && current.includes('image')) return false;
  model.input = ['text', 'image'];
  return true;
}

function findFirstVisionModelRef(cfg) {
  const providers = cfg && cfg.models && cfg.models.providers;
  if (!isObject(providers)) return null;

  for (const [providerId, provider] of Object.entries(providers)) {
    if (!isObject(provider) || !Array.isArray(provider.models)) continue;
    for (const model of provider.models) {
      if (!isObject(model)) continue;
      const id = model.id || model.name;
      if (!id) continue;
      const hasImage = Array.isArray(model.input) && model.input.includes('image');
      if (hasImage || isLikelyVisionModelId(id)) {
        return `${providerId}/${id}`;
      }
    }
  }
  return null;
}

function resolveVisionModelRef(cfg) {
  const imageModelRef =
    cfg &&
    cfg.agents &&
    cfg.agents.defaults &&
    cfg.agents.defaults.imageModel &&
    cfg.agents.defaults.imageModel.primary;
  if (imageModelRef) return String(imageModelRef).trim();

  const primaryRef =
    cfg &&
    cfg.agents &&
    cfg.agents.defaults &&
    cfg.agents.defaults.model &&
    (typeof cfg.agents.defaults.model === 'string'
      ? cfg.agents.defaults.model
      : cfg.agents.defaults.model.primary);
  const parsedPrimary = parseModelRef(primaryRef);
  if (parsedPrimary && isLikelyVisionModelId(parsedPrimary.model)) {
    return parsedPrimary.primary;
  }

  return findFirstVisionModelRef(cfg) || DEFAULT_VISION_MODEL;
}

function ensureMediaImageTools(cfg, visionRef) {
  if (!cfg.tools) cfg.tools = {};
  if (!cfg.tools.media) cfg.tools.media = {};
  if (!cfg.tools.media.image) cfg.tools.media.image = {};

  let changed = false;
  const imageCfg = cfg.tools.media.image;
  if (imageCfg.enabled !== true) {
    imageCfg.enabled = true;
    changed = true;
  }
  if (!isObject(imageCfg.attachments)) {
    imageCfg.attachments = { mode: 'all' };
    changed = true;
  } else if (imageCfg.attachments.mode !== 'all') {
    imageCfg.attachments.mode = 'all';
    changed = true;
  }

  const parsed = parseModelRef(visionRef);
  if (!parsed) return changed;

  const models = Array.isArray(imageCfg.models) ? imageCfg.models : [];
  const hasMatch = models.some(
    (entry) =>
      isObject(entry) &&
      String(entry.provider || '').trim() === parsed.provider &&
      String(entry.model || '').trim() === parsed.model
  );

  if (!hasMatch) {
    imageCfg.models = [
      {
        prompt: DEFAULT_MEDIA_PROMPT,
        provider: parsed.provider,
        model: parsed.model
      },
      ...models.filter(
        (entry) =>
          !(
            isObject(entry) &&
            String(entry.provider || '').trim() === parsed.provider &&
            String(entry.model || '').trim() === parsed.model
          )
      )
    ];
    changed = true;
  } else if (models[0] && isObject(models[0]) && !models[0].prompt) {
    models[0].prompt = DEFAULT_MEDIA_PROMPT;
    changed = true;
  }

  return changed;
}

/**
 * 补齐识图模型 input 元数据、agents.defaults.imageModel 与 tools.media.image。
 * @returns {{ config: object, changed: boolean, visionModel?: string }}
 */
function ensureVisionModelConfig(cfg, opts = {}) {
  if (!isObject(cfg)) return { config: cfg, changed: false };

  let changed = false;

  const providers = cfg.models && cfg.models.providers;
  if (isObject(providers)) {
    for (const provider of Object.values(providers)) {
      if (!isObject(provider) || !Array.isArray(provider.models)) continue;
      for (const model of provider.models) {
        if (ensureModelInput(model)) changed = true;
      }
    }
  }

  if (!cfg.agents) {
    cfg.agents = {};
    changed = true;
  }
  if (!cfg.agents.defaults) {
    cfg.agents.defaults = {};
    changed = true;
  }
  if (!cfg.agents.defaults.imageModel) {
    cfg.agents.defaults.imageModel = {};
    changed = true;
  }

  const visionRef = resolveVisionModelRef(cfg);
  const currentImageModel =
    cfg.agents.defaults.imageModel.primary && String(cfg.agents.defaults.imageModel.primary).trim();
  if (!currentImageModel) {
    cfg.agents.defaults.imageModel.primary = visionRef;
    changed = true;
  }

  const effectiveVisionRef = cfg.agents.defaults.imageModel.primary || visionRef;
  if (ensureMediaImageTools(cfg, effectiveVisionRef)) changed = true;

  return {
    config: cfg,
    changed,
    visionModel: effectiveVisionRef
  };
}

module.exports = {
  DEFAULT_VISION_MODEL,
  isLikelyVisionModelId,
  isGenerationOnlyModelId,
  ensureVisionModelConfig
};
