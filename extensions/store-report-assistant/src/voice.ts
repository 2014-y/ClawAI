import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { env } from "node:process";
import { promisify } from "node:util";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { StoreReportPluginConfig } from "./types.js";

const execFileAsync = promisify(execFile);
const FEISHU_API_BASE = "https://open.feishu.cn/open-apis";

export type StoreReportVoiceFacts = {
  channel: string;
  accountId?: string;
  chatId: string;
  messageId: string;
};

export type StoreReportVoiceEvent = {
  content?: string;
  body?: string;
  bodyForAgent?: string;
  transcript?: string;
  metadata?: Record<string, unknown>;
};

export type StoreReportVoiceTranscript = {
  text: string;
  confidence?: number;
};

type LocalAudioFile = {
  filePath: string;
  mime?: string;
  cleanup: () => Promise<void>;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getPathValue(value: unknown, dottedPath: string | undefined): unknown {
  if (!dottedPath) {
    return undefined;
  }
  let current: unknown = value;
  for (const part of dottedPath.split(".")) {
    const record = asRecord(current);
    if (!record) {
      return undefined;
    }
    current = record[part];
  }
  return current;
}

function stripTranscriptNoise(text: string): string {
  return text
    .replace(/\u001b\[[0-9;]*m/gu, "")
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*\[[0-9:.]+\s*-->\s*[0-9:.]+\]\s*/u, "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function isAudioMimeLike(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.startsWith("audio/") ||
    normalized.includes("opus") ||
    normalized.includes("voice") ||
    normalized.includes("amr")
  );
}

function hasAudioFileName(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return /\.(?:aac|aiff|amr|caf|flac|m4a|mp3|oga|ogg|opus|wav|webm|wma)$/u.test(normalized);
}

function isFeishuAudioPayload(value: unknown, depth = 0): boolean {
  if (depth > 6) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => isFeishuAudioPayload(entry, depth + 1));
  }
  const record = asRecord(value);
  if (!record) {
    return false;
  }
  const fileKey = asString(record.file_key) ?? asString(record.fileKey);
  if (fileKey) {
    const hasDuration = asNumber(record.duration) !== undefined || asString(record.duration);
    if (
      hasDuration ||
      asString(record.speech_to_text) ||
      isAudioMimeLike(
        asString(record.mime_type) ?? asString(record.mimeType) ?? asString(record.content_type),
      ) ||
      hasAudioFileName(asString(record.file_name) ?? asString(record.fileName))
    ) {
      return true;
    }
  }
  return Object.values(record).some((entry) => isFeishuAudioPayload(entry, depth + 1));
}

export function isVoicePlaceholderText(text: string | undefined): boolean {
  const trimmed = text?.trim();
  if (!trimmed) {
    return false;
  }
  const normalized = trimmed.toLowerCase();
  if (
    /^<media:audio>(?:\s|\(|$)/iu.test(trimmed) ||
    /^\[(?:语音|voice|audio)\](?:\s|\(|$)/iu.test(trimmed)
  ) {
    return true;
  }
  return [
    "<media:audio>",
    "[语音]",
    "语音",
    "[voice]",
    "voice",
    "voice message",
    "[audio]",
    "audio",
  ].includes(normalized)
    ? true
    : isFeishuAudioPayload(parseJsonMaybe(trimmed));
}

function findStringByKey(value: unknown, keys: Set<string>, depth = 0): string | undefined {
  if (depth > 8) {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findStringByKey(entry, keys, depth + 1);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  for (const [key, entry] of Object.entries(record)) {
    if (keys.has(key) && typeof entry === "string" && entry.trim()) {
      return entry.trim();
    }
  }
  for (const entry of Object.values(record)) {
    const found = findStringByKey(entry, keys, depth + 1);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function parseJsonMaybe(value: string | undefined): unknown {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function extractFeishuFileKey(
  event: StoreReportVoiceEvent,
  messagePayload?: unknown,
): string | undefined {
  const metadata = asRecord(event.metadata);
  return (
    findStringByKey(metadata, new Set(["file_key", "fileKey"])) ??
    findStringByKey(parseJsonMaybe(event.content), new Set(["file_key", "fileKey"])) ??
    findStringByKey(messagePayload, new Set(["file_key", "fileKey"]))
  );
}

function extractFeishuMessageContent(payload: unknown): string | undefined {
  const direct =
    asString(getPathValue(payload, "data.item.body.content")) ??
    asString(getPathValue(payload, "data.item.content")) ??
    asString(getPathValue(payload, "data.message.body.content")) ??
    asString(getPathValue(payload, "data.message.content")) ??
    asString(getPathValue(payload, "data.body.content")) ??
    asString(getPathValue(payload, "data.content")) ??
    asString(getPathValue(payload, "body.content")) ??
    asString(getPathValue(payload, "content"));
  if (direct) {
    return direct;
  }
  const items = getPathValue(payload, "data.items");
  if (Array.isArray(items)) {
    for (const item of items) {
      const content = extractFeishuMessageContent(item);
      if (content) {
        return content;
      }
    }
  }
  return undefined;
}

function resolveFeishuAccount(
  config: unknown,
  accountId: string | undefined,
): Record<string, unknown> {
  const channels = asRecord(asRecord(config)?.channels);
  const section = asRecord(channels?.feishu);
  const accounts = asRecord(section?.accounts);
  const resolvedAccountId = accountId ?? asString(section?.defaultAccount);
  return (
    asRecord(resolvedAccountId ? accounts?.[resolvedAccountId] : undefined) ??
    asRecord(accounts?.main) ??
    asRecord(accounts?.default) ??
    section ??
    {}
  );
}

function resolveFeishuCredentials(
  config: unknown,
  accountId: string | undefined,
): {
  appId: string;
  appSecret: string;
} {
  const account = resolveFeishuAccount(config, accountId);
  const appId = asString(account.appId);
  const appSecret = asString(account.appSecret);
  if (!appId || !appSecret) {
    throw new Error("Feishu voice download requires channels.feishu appId/appSecret");
  }
  return { appId, appSecret };
}

async function fetchJson(url: string, init: RequestInit, timeoutSeconds: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${asString(getPathValue(payload, "msg")) ?? text}`);
    }
    const code = getPathValue(payload, "code");
    if (typeof code === "number" && code !== 0) {
      throw new Error(asString(getPathValue(payload, "msg")) ?? `Feishu API returned code ${code}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function getFeishuTenantAccessToken(params: {
  currentConfig: unknown;
  accountId?: string;
  timeoutSeconds: number;
}): Promise<string> {
  const credentials = resolveFeishuCredentials(params.currentConfig, params.accountId);
  const payload = await fetchJson(
    `${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        app_id: credentials.appId,
        app_secret: credentials.appSecret,
      }),
    },
    params.timeoutSeconds,
  );
  const token =
    asString(getPathValue(payload, "tenant_access_token")) ??
    asString(getPathValue(payload, "data.tenant_access_token"));
  if (!token) {
    throw new Error("Feishu tenant access token response did not include a token");
  }
  return token;
}

async function getFeishuMessagePayload(params: {
  token: string;
  messageId: string;
  timeoutSeconds: number;
}): Promise<unknown> {
  return await fetchJson(
    `${FEISHU_API_BASE}/im/v1/messages/${encodeURIComponent(params.messageId)}`,
    {
      method: "GET",
      headers: { authorization: `Bearer ${params.token}` },
    },
    params.timeoutSeconds,
  );
}

function extensionFromMime(mime: string | undefined): string {
  if (!mime) {
    return ".audio";
  }
  const normalized = mime.toLowerCase();
  if (normalized.includes("ogg") || normalized.includes("opus")) {
    return ".ogg";
  }
  if (normalized.includes("amr")) {
    return ".amr";
  }
  if (normalized.includes("mpeg") || normalized.includes("mp3")) {
    return ".mp3";
  }
  if (normalized.includes("mp4") || normalized.includes("m4a")) {
    return ".m4a";
  }
  if (normalized.includes("wav")) {
    return ".wav";
  }
  return ".audio";
}

async function downloadFeishuMessageResource(params: {
  token: string;
  messageId: string;
  fileKey: string;
  maxBytes: number;
  timeoutSeconds: number;
}): Promise<LocalAudioFile> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutSeconds * 1000);
  try {
    const url = new URL(
      `${FEISHU_API_BASE}/im/v1/messages/${encodeURIComponent(params.messageId)}/resources/${encodeURIComponent(params.fileKey)}`,
    );
    url.searchParams.set("type", "file");
    const response = await fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${params.token}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Feishu message resource download failed: HTTP ${response.status}`);
    }
    const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(contentLength) && contentLength > params.maxBytes) {
      throw new Error("Feishu audio resource exceeds configured max size");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > params.maxBytes) {
      throw new Error("Feishu audio resource exceeds configured max size");
    }
    const mime = response.headers.get("content-type") ?? undefined;
    const tempDir = await fs.mkdtemp(path.join(tmpdir(), "store-report-voice-"));
    const filePath = path.join(tempDir, `voice${extensionFromMime(mime)}`);
    await fs.writeFile(filePath, buffer);
    return {
      filePath,
      ...(mime ? { mime } : {}),
      cleanup: async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveFeishuAudioFile(params: {
  currentConfig: unknown;
  event: StoreReportVoiceEvent;
  facts: StoreReportVoiceFacts;
  config: StoreReportPluginConfig;
}): Promise<LocalAudioFile> {
  const timeoutSeconds = params.config.voice.stt.timeoutSeconds;
  const token = await getFeishuTenantAccessToken({
    currentConfig: params.currentConfig,
    accountId: params.facts.accountId,
    timeoutSeconds,
  });
  const messagePayload = await getFeishuMessagePayload({
    token,
    messageId: params.facts.messageId,
    timeoutSeconds,
  });
  const messageContent = extractFeishuMessageContent(messagePayload);
  const contentPayload = parseJsonMaybe(messageContent);
  const fileKey = extractFeishuFileKey(params.event, contentPayload ?? messagePayload);
  if (!fileKey) {
    throw new Error("Feishu voice message did not include a file_key");
  }
  return await downloadFeishuMessageResource({
    token,
    messageId: params.facts.messageId,
    fileKey,
    maxBytes: params.config.voice.download.maxMb * 1024 * 1024,
    timeoutSeconds,
  });
}

async function transcribeWithOpenClawMedia(params: {
  api: OpenClawPluginApi;
  currentConfig: unknown;
  file: LocalAudioFile;
}): Promise<StoreReportVoiceTranscript | undefined> {
  const runtime = params.api.runtime.mediaUnderstanding;
  if (!runtime?.transcribeAudioFile) {
    throw new Error("OpenClaw media audio runtime is unavailable");
  }
  const result = await runtime.transcribeAudioFile({
    filePath: params.file.filePath,
    cfg: params.currentConfig as OpenClawPluginApi["config"],
    ...(params.file.mime ? { mime: params.file.mime } : {}),
  });
  const text = stripTranscriptNoise(result.text ?? "");
  return text ? { text } : undefined;
}

function resolveTokenRef(tokenRef: string | undefined): string | undefined {
  if (!tokenRef) {
    return undefined;
  }
  if (tokenRef.startsWith("env:")) {
    return env[tokenRef.slice("env:".length)];
  }
  return undefined;
}

function applyAuthHeaders(
  headers: Record<string, string>,
  auth: StoreReportPluginConfig["voice"]["stt"]["auth"],
): Record<string, string> {
  if (!auth?.tokenRef) {
    return headers;
  }
  const token = resolveTokenRef(auth.tokenRef);
  if (!token) {
    throw new Error(`STT tokenRef is not available: ${auth.tokenRef}`);
  }
  const headerName =
    auth.mode === "header" ? (auth.headerName ?? "authorization") : "authorization";
  const prefix = auth.mode === "header" ? (auth.prefix ?? "") : "Bearer ";
  return {
    ...headers,
    [headerName]: `${prefix}${token}`,
  };
}

async function transcribeWithCustomHttp(params: {
  config: StoreReportPluginConfig;
  file: LocalAudioFile;
}): Promise<StoreReportVoiceTranscript | undefined> {
  const stt = params.config.voice.stt;
  if (!stt.endpoint) {
    throw new Error("custom-http STT requires voice.stt.endpoint");
  }
  const audio = await fs.readFile(params.file.filePath);
  const form = new FormData();
  form.set(
    "file",
    new Blob([audio], { type: params.file.mime ?? "application/octet-stream" }),
    path.basename(params.file.filePath),
  );
  form.set("language", stt.language);
  const headers = applyAuthHeaders(stt.headers, stt.auth);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), stt.timeoutSeconds * 1000);
  try {
    const response = await fetch(stt.endpoint, {
      method: "POST",
      headers,
      body: form,
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const payload: unknown = contentType.includes("json")
      ? await response.json()
      : { text: await response.text() };
    if (!response.ok) {
      throw new Error(`custom-http STT failed: HTTP ${response.status}`);
    }
    const text = stripTranscriptNoise(String(getPathValue(payload, stt.responseTextPath) ?? ""));
    const confidence = asNumber(getPathValue(payload, stt.responseConfidencePath));
    return text ? { text, ...(confidence !== undefined ? { confidence } : {}) } : undefined;
  } finally {
    clearTimeout(timer);
  }
}

function buildLocalWhisperCommand(params: {
  config: StoreReportPluginConfig;
  filePath: string;
  outputDir: string;
}): { executable: string; args: string[]; outputFile?: string } {
  const stt = params.config.voice.stt;
  const executable =
    stt.executable ?? (stt.backend === "openai-whisper" ? "whisper" : "whisper-cli");
  if (stt.backend === "openai-whisper") {
    const args = [
      params.filePath,
      "--language",
      stt.language,
      "--output_format",
      "txt",
      "--output_dir",
      params.outputDir,
    ];
    if (stt.model) {
      args.push("--model", stt.model);
    }
    const basename = path.basename(params.filePath, path.extname(params.filePath));
    return {
      executable,
      args,
      outputFile: path.join(params.outputDir, `${basename}.txt`),
    };
  }
  const args = ["-f", params.filePath, "-l", stt.language, "-nt"];
  if (stt.model) {
    args.unshift("-m", stt.model);
  }
  return { executable, args };
}

async function transcribeWithLocalWhisper(params: {
  config: StoreReportPluginConfig;
  file: LocalAudioFile;
}): Promise<StoreReportVoiceTranscript | undefined> {
  const outputDir = await fs.mkdtemp(path.join(tmpdir(), "store-report-whisper-"));
  try {
    const command = buildLocalWhisperCommand({
      config: params.config,
      filePath: params.file.filePath,
      outputDir,
    });
    const result = await execFileAsync(command.executable, command.args, {
      timeout: params.config.voice.stt.timeoutSeconds * 1000,
      maxBuffer: 1024 * 1024,
    });
    const output = command.outputFile
      ? await fs.readFile(command.outputFile, "utf8").catch(() => result.stdout)
      : result.stdout;
    const text = stripTranscriptNoise(output);
    return text ? { text } : undefined;
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true });
  }
}

async function transcribeLocalAudioFile(params: {
  api: OpenClawPluginApi;
  currentConfig: unknown;
  config: StoreReportPluginConfig;
  file: LocalAudioFile;
}): Promise<StoreReportVoiceTranscript | undefined> {
  switch (params.config.voice.stt.mode) {
    case "openclaw-media":
      return await transcribeWithOpenClawMedia(params);
    case "custom-http":
      return await transcribeWithCustomHttp({ config: params.config, file: params.file });
    case "local-whisper":
      return await transcribeWithLocalWhisper({ config: params.config, file: params.file });
    case "disabled":
      return undefined;
  }
}

export async function resolvePluginVoiceTranscript(params: {
  api: OpenClawPluginApi;
  currentConfig: unknown;
  config: StoreReportPluginConfig;
  event: StoreReportVoiceEvent;
  facts: StoreReportVoiceFacts;
}): Promise<StoreReportVoiceTranscript | undefined> {
  if (
    params.config.voice.transcriptSource === "off" ||
    params.config.voice.transcriptSource === "event-only" ||
    params.config.voice.stt.mode === "disabled"
  ) {
    return undefined;
  }
  if (params.facts.channel !== "feishu") {
    return undefined;
  }
  const file = await resolveFeishuAudioFile(params);
  try {
    return await transcribeLocalAudioFile({ ...params, file });
  } finally {
    await file.cleanup();
  }
}

export function buildVoiceStatus(config: StoreReportPluginConfig): {
  enabled: boolean;
  transcriptSource: string;
  sttMode: string;
  requireConfirmationWhenConfidenceMissing: boolean;
  localWhisperConfigured: boolean;
  customHttpConfigured: boolean;
} {
  return {
    enabled: config.voice.enabled,
    transcriptSource: config.voice.transcriptSource,
    sttMode: config.voice.stt.mode,
    requireConfirmationWhenConfidenceMissing: config.voice.requireConfirmationWhenConfidenceMissing,
    localWhisperConfigured:
      config.voice.stt.mode === "local-whisper" &&
      Boolean(config.voice.stt.executable || config.voice.stt.backend),
    customHttpConfigured:
      config.voice.stt.mode === "custom-http" && Boolean(config.voice.stt.endpoint),
  };
}

export function buildVoiceDiagnoseChecks(config: StoreReportPluginConfig): Array<{
  name: string;
  status: "ok" | "warn" | "fail";
  message: string;
}> {
  const checks: Array<{ name: string; status: "ok" | "warn" | "fail"; message: string }> = [
    {
      name: "voice.enabled",
      status: config.voice.enabled ? "ok" : "warn",
      message: config.voice.enabled ? "语音处理已开启" : "语音处理已关闭",
    },
    {
      name: "voice.transcriptSource",
      status: config.voice.transcriptSource === "off" ? "warn" : "ok",
      message: config.voice.transcriptSource,
    },
    {
      name: "voice.sttMode",
      status: config.voice.stt.mode === "disabled" ? "warn" : "ok",
      message: config.voice.stt.mode,
    },
  ];
  if (config.voice.stt.mode === "custom-http") {
    checks.push({
      name: "voice.customHttp",
      status: config.voice.stt.endpoint ? "ok" : "fail",
      message: config.voice.stt.endpoint
        ? "custom-http endpoint 已配置"
        : "缺少 voice.stt.endpoint",
    });
  }
  if (config.voice.stt.mode === "local-whisper") {
    checks.push({
      name: "voice.localWhisper",
      status: config.voice.stt.executable || config.voice.stt.backend ? "ok" : "fail",
      message:
        config.voice.stt.executable || config.voice.stt.backend
          ? `backend=${config.voice.stt.backend}`
          : "缺少 local-whisper executable/backend",
    });
  }
  return checks;
}
