'use strict';
/**
 * LLM 回包 usage 解析（OpenAI / Ollama 原生 / SSE）
 * 独立模块便于单测；patch_gateway.js 内有同名实现并保持同步。
 */

function parseUsageFromLlmBody(bodyText) {
  if (!bodyText || typeof bodyText !== 'string') return null;
  let inputTokens = 0;
  let outputTokens = 0;
  let hitTokens = 0;

  const inMatch = [...bodyText.matchAll(/"(?:prompt_tokens|promptTokenCount|input_tokens|prompt_eval_count)"\s*:\s*(\d+)/gi)];
  if (inMatch.length > 0) inputTokens = parseInt(inMatch[inMatch.length - 1][1], 10) || 0;

  const outMatch = [...bodyText.matchAll(/"(?:completion_tokens|candidatesTokenCount|output_tokens|eval_count)"\s*:\s*(\d+)/gi)];
  if (outMatch.length > 0) outputTokens = parseInt(outMatch[outMatch.length - 1][1], 10) || 0;

  const hitMatch = [...bodyText.matchAll(/"(?:cached_tokens|cache_read_input_tokens|prompt_eval_count_cached)"\s*:\s*(\d+)/gi)];
  if (hitMatch.length > 0) hitTokens = parseInt(hitMatch[hitMatch.length - 1][1], 10) || 0;

  if (inputTokens === 0 && outputTokens === 0) {
    try {
      const lines = bodyText.split(/\r?\n/).map((l) => l.replace(/^data:\s*/, '').trim()).filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line === '[DONE]') continue;
        try {
          const obj = JSON.parse(line);
          const u = obj.usage || obj;
          const inn = u.prompt_tokens ?? u.promptTokenCount ?? u.input_tokens ?? u.prompt_eval_count;
          const out = u.completion_tokens ?? u.candidatesTokenCount ?? u.output_tokens ?? u.eval_count;
          if (Number(inn) > 0 || Number(out) > 0) {
            inputTokens = Number(inn) || 0;
            outputTokens = Number(out) || 0;
            hitTokens = Number(u.cached_tokens || u.cache_read_input_tokens || 0) || 0;
            break;
          }
        } catch (e) { /* keep scanning */ }
      }
    } catch (e) {}
  }

  if (inputTokens <= 0 && outputTokens <= 0) return null;
  return { prompt_tokens: inputTokens, completion_tokens: outputTokens, hit_tokens: hitTokens };
}

module.exports = { parseUsageFromLlmBody };
