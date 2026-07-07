import crypto from "node:crypto";
import { resolveLivePluginConfigObject } from "openclaw/plugin-sdk/config-runtime";
import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  classifyStoreMessage,
  extractStructuredRecord,
  normalizeStoreMessageText,
} from "./src/classifier.js";
import {
  resolveConfiguredWorkspaceDir,
  resolveDatabasePath,
  resolveStoreReportConfig,
} from "./src/config.js";
import { parseConfirmationAction, type ConfirmationAction } from "./src/confirmation.js";
import {
  parseStoreReportCronMessage,
  resolveCronAnchorBusinessDate,
  type StoreReportCronPayload,
} from "./src/cron.js";
import { formatBusinessDate, isoTimestampFromMillis, resolveIsoWeekRange } from "./src/date.js";
import { StoreReportDatabase } from "./src/db.js";
import { generateStoreReport } from "./src/report-service.js";
import {
  STORE_REPORT_PLUGIN_ID,
  type StoreBinding,
  type StoreReportPluginConfig,
} from "./src/types.js";
import { isVoicePlaceholderText, resolvePluginVoiceTranscript } from "./src/voice.js";

type StoreSourceInput = {
  text: string;
  sourceType: "text" | "voice";
  transcriptConfidence?: number;
};

type StoreMessageEvent = {
  from?: string;
  content?: string;
  RawBody?: string;
  CommandBody?: string;
  BodyForAgent?: string;
  Body?: string;
  Transcript?: string;
  rawBody?: string;
  commandBody?: string;
  bodyForAgent?: string;
  transcript?: string;
  body?: string;
  metadata?: Record<string, unknown>;
  channel?: string;
  accountId?: string;
  conversationId?: string;
  threadId?: string | number;
  messageId?: string;
  timestamp?: number;
  isGroup?: boolean;
  senderId?: string;
  senderName?: string;
  senderUsername?: string;
};

type StoreMessageContext = {
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  messageId?: string;
  senderId?: string;
};

type StoreMessageResult = {
  handled: true;
  text?: string;
  replyToId?: string;
};

type StoreHandleOptions = {
  archiveBusinessRecords: boolean;
  handleInteractiveRequests: boolean;
  suppressUntranscribedVoice?: boolean;
};

type RuntimeChannelId = Parameters<
  OpenClawPluginApi["runtime"]["channel"]["outbound"]["loadAdapter"]
>[0];

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function optionalStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function stableFallbackMessageId(params: {
  channel: string;
  accountId?: string;
  chatId: string;
  timestamp?: number;
  content: string;
}): string {
  return crypto
    .createHash("sha256")
    .update(
      [
        params.channel,
        params.accountId ?? "",
        params.chatId,
        String(params.timestamp ?? ""),
        params.content,
      ].join("\u0000"),
    )
    .digest("hex")
    .slice(0, 32);
}

function normalizeChatId(value: string | undefined, channel: string): string | undefined {
  let normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  const prefixes = [`${channel}:`, "channel:", "chat:", "group:", "direct:", "dm:", "user:"];
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of prefixes) {
      if (normalized.startsWith(prefix)) {
        normalized = normalized.slice(prefix.length);
        changed = true;
      }
    }
  }
  const topicIndex = normalized.indexOf(":topic:");
  return topicIndex > 0 ? normalized.slice(0, topicIndex) : normalized;
}

function isAudioMediaType(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.toLowerCase();
  return (
    normalized.startsWith("audio/") ||
    normalized.includes("voice") ||
    normalized.includes("opus") ||
    normalized.includes("amr") ||
    normalized.includes("m4a")
  );
}

function hasAudioMetadata(metadata: Record<string, unknown> | undefined): boolean {
  if (!metadata) {
    return false;
  }
  const mediaType = optionalString(metadata.mediaType);
  if (isAudioMediaType(mediaType)) {
    return true;
  }
  return optionalStringArray(metadata.mediaTypes).some(isAudioMediaType);
}

function resolveTranscriptConfidence(
  metadata: Record<string, unknown> | undefined,
): number | undefined {
  if (!metadata) {
    return undefined;
  }
  return (
    optionalNumber(metadata.transcriptConfidence) ??
    optionalNumber(metadata.transcriptionConfidence) ??
    optionalNumber(metadata.audioConfidence)
  );
}

function optionalEventString(event: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = optionalString(event[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function resolveSourceInput(event: {
  content?: string;
  RawBody?: string;
  CommandBody?: string;
  BodyForAgent?: string;
  Body?: string;
  Transcript?: string;
  rawBody?: string;
  commandBody?: string;
  bodyForAgent?: string;
  transcript?: string;
  body?: string;
  metadata?: Record<string, unknown>;
}): StoreSourceInput {
  const metadata = optionalRecord(event.metadata);
  const metadataTranscript = optionalString(metadata?.transcript);
  const transcript =
    optionalString(event.transcript) ?? optionalString(event.Transcript) ?? metadataTranscript;
  if (transcript) {
    return {
      text: transcript,
      sourceType: "voice",
      ...(resolveTranscriptConfidence(metadata) !== undefined
        ? { transcriptConfidence: resolveTranscriptConfidence(metadata) }
        : {}),
    };
  }
  const text =
    optionalEventString(event as Record<string, unknown>, [
      "rawBody",
      "RawBody",
      "commandBody",
      "CommandBody",
      "bodyForAgent",
      "BodyForAgent",
      "content",
      "body",
      "Body",
    ]) ?? "";
  return {
    text,
    sourceType: hasAudioMetadata(metadata) || isVoicePlaceholderText(text) ? "voice" : "text",
  };
}

function isExplicitlyAddressed(params: { event: StoreMessageEvent; content: string }): boolean {
  const metadata = optionalRecord(params.event.metadata);
  const mentionFlags = [
    metadata?.wasMentioned,
    metadata?.was_mentioned,
    metadata?.mentioned,
    metadata?.isMentioned,
    metadata?.is_mentioned,
  ];
  if (mentionFlags.some((value) => value === true)) {
    return true;
  }
  const trimmed = params.content.trim();
  return /^@\S+/u.test(trimmed) || /<at\b[^>]*>/iu.test(trimmed);
}

function resolveCurrentRuntimeConfig(api: OpenClawPluginApi) {
  const currentConfig = api.runtime.config?.loadConfig?.() ?? api.config;
  const pluginConfig = resolveLivePluginConfigObject(
    api.runtime.config?.loadConfig,
    "store-report-assistant",
    api.pluginConfig,
  );
  return {
    currentConfig,
    pluginConfig: resolveStoreReportConfig(pluginConfig),
  };
}

function openStoreReportDatabase(api: OpenClawPluginApi): {
  db: StoreReportDatabase;
  config: ReturnType<typeof resolveStoreReportConfig>;
  currentConfig: unknown;
} {
  const { currentConfig, pluginConfig } = resolveCurrentRuntimeConfig(api);
  const db = new StoreReportDatabase(
    resolveDatabasePath(
      pluginConfig.databasePath,
      api.resolvePath,
      resolveConfiguredWorkspaceDir(currentConfig),
    ),
  );
  db.seedConfig(pluginConfig);
  return { db, config: pluginConfig, currentConfig };
}

function resolveChannelFacts(
  event: {
    channel?: string;
    accountId?: string;
    conversationId?: string;
    threadId?: string | number;
    messageId?: string;
    timestamp?: number;
    metadata?: Record<string, unknown>;
  },
  ctx: {
    channelId?: string;
    accountId?: string;
    conversationId?: string;
    messageId?: string;
  },
  content: string,
): { channel: string; accountId?: string; chatId: string; messageId: string } | undefined {
  const channel = optionalString(ctx.channelId) ?? optionalString(event.channel);
  const accountId = optionalString(ctx.accountId) ?? optionalString(event.accountId);
  const metadata = optionalRecord(event.metadata);
  const chatId =
    normalizeChatId(optionalString(ctx.conversationId), channel ?? "") ??
    normalizeChatId(optionalString(event.conversationId), channel ?? "") ??
    normalizeChatId(optionalString(metadata?.originatingTo), channel ?? "") ??
    normalizeChatId(optionalString(metadata?.to), channel ?? "") ??
    (typeof event.threadId === "string" || typeof event.threadId === "number"
      ? normalizeChatId(String(event.threadId), channel ?? "")
      : undefined);
  if (!channel || !chatId) {
    return undefined;
  }
  const messageId =
    optionalString(ctx.messageId) ??
    optionalString(event.messageId) ??
    stableFallbackMessageId({ channel, accountId, chatId, timestamp: event.timestamp, content });
  return {
    channel,
    ...(accountId ? { accountId } : {}),
    chatId,
    messageId,
  };
}

function generateAndSaveReport(params: {
  db: StoreReportDatabase;
  binding: StoreBinding;
  reportType: "daily" | "weekly";
  businessDate: string;
  channel: string;
  chatId: string;
  generatedBy?: string;
}): string {
  if (params.reportType === "daily") {
    const records = params.db.listRecordsByDate(params.binding.storeId, params.businessDate);
    const report = generateStoreReport({
      reportType: "daily",
      storeId: params.binding.storeId,
      storeName: params.binding.storeName,
      businessDate: params.businessDate,
      records,
    });
    params.db.saveDailyReport({
      storeId: params.binding.storeId,
      businessDate: params.businessDate,
      channel: params.channel,
      chatId: params.chatId,
      reportText: report.reportText,
      missingFields: report.missingFields,
      sourceRecordCount: report.sourceRecordCount,
      generatedBy: params.generatedBy ?? "manual",
    });
    return report.reportText;
  }

  const week = resolveIsoWeekRange(params.businessDate);
  const records = params.db.listRecordsByRange(
    params.binding.storeId,
    week.weekStartDate,
    week.weekEndDate,
  );
  const report = generateStoreReport({
    reportType: "weekly",
    storeId: params.binding.storeId,
    storeName: params.binding.storeName,
    weekStartDate: week.weekStartDate,
    weekEndDate: week.weekEndDate,
    records,
  });
  params.db.saveWeeklyReport({
    storeId: params.binding.storeId,
    weekStartDate: week.weekStartDate,
    weekEndDate: week.weekEndDate,
    channel: params.channel,
    chatId: params.chatId,
    reportText: report.reportText,
    missingFields: report.missingFields,
    sourceRecordCount: report.sourceRecordCount,
    generatedBy: params.generatedBy ?? "manual",
  });
  return report.reportText;
}

function resolveEventBusinessDate(event: { timestamp?: number }, timezone: string): string {
  const timestamp =
    typeof event.timestamp === "number" && Number.isFinite(event.timestamp)
      ? event.timestamp
      : Date.now();
  return formatBusinessDate(new Date(timestamp), timezone);
}

function truncateSnippet(text: string): string {
  const trimmed = text.replace(/\s+/gu, " ").trim();
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
}

function buildAmbiguousConfirmationText(
  pending: Array<{ id: number; record: { normalizedText: string } }>,
): string {
  const lines = pending.map(
    (entry) => `#${entry.id} ${truncateSnippet(entry.record.normalizedText)}`,
  );
  return [
    "你有多条待确认语音，我还不能确定你要确认哪一条。",
    ...lines,
    "请回复“确认 #编号”“不计入 #编号”，或“改 #编号：正确内容”。",
  ].join("\n");
}

function buildVoiceConfirmationText(params: {
  pendingId: number;
  text: string;
  confidence?: number;
  minConfidence: number;
}): string {
  const reason =
    params.confidence === undefined
      ? "这条语音没有返回明确置信度"
      : `这条语音置信度 ${params.confidence.toFixed(2)}，低于 ${params.minConfidence.toFixed(2)}`;
  return [
    `我听到的是：“${truncateSnippet(params.text)}”`,
    `${reason}，需要确认后才计入日报。`,
    `回复“确认 #${params.pendingId}”计入；回复“不计入 #${params.pendingId}”忽略；或回复“改 #${params.pendingId}：正确内容”。`,
  ].join("\n");
}

function shouldRequireVoiceConfirmation(params: {
  config: StoreReportPluginConfig;
  source: StoreSourceInput;
}): boolean {
  if (params.source.sourceType !== "voice") {
    return false;
  }
  if (params.source.transcriptConfidence === undefined) {
    return params.config.voice.requireConfirmationWhenConfidenceMissing;
  }
  return params.source.transcriptConfidence < params.config.voice.minConfidence;
}

function isUntranscribedVoiceSource(source: StoreSourceInput): boolean {
  return (
    source.sourceType === "voice" && (!source.text.trim() || isVoicePlaceholderText(source.text))
  );
}

async function resolveEffectiveSourceInput(params: {
  api: OpenClawPluginApi;
  event: StoreMessageEvent;
  facts: { channel: string; accountId?: string; chatId: string; messageId: string };
  config: StoreReportPluginConfig;
  currentConfig: unknown;
  source: StoreSourceInput;
  allowPluginStt: boolean;
}): Promise<StoreSourceInput> {
  if (
    !params.allowPluginStt ||
    !params.config.voice.enabled ||
    params.source.sourceType !== "voice" ||
    params.config.voice.transcriptSource === "off" ||
    params.config.voice.transcriptSource === "event-only"
  ) {
    return params.source;
  }
  if (
    params.config.voice.transcriptSource === "auto" &&
    params.source.text.trim() &&
    !isVoicePlaceholderText(params.source.text)
  ) {
    return params.source;
  }
  try {
    const transcript = await resolvePluginVoiceTranscript({
      api: params.api,
      currentConfig: params.currentConfig,
      config: params.config,
      event: params.event,
      facts: params.facts,
    });
    if (!transcript?.text) {
      return params.source;
    }
    return {
      text: transcript.text,
      sourceType: "voice",
      ...(transcript.confidence !== undefined
        ? { transcriptConfidence: transcript.confidence }
        : {}),
    };
  } catch (err) {
    params.api.logger?.warn?.(
      `store-report: voice transcription failed channel=${params.facts.channel} account=${params.facts.accountId ?? "-"} chat=${params.facts.chatId} message=${params.facts.messageId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return params.source;
  }
}

function resolvePendingConfirmation(params: {
  db: StoreReportDatabase;
  action: ConfirmationAction;
  channel: string;
  accountId?: string;
  chatId: string;
  senderId?: string;
}):
  | { kind: "none" }
  | { kind: "ambiguous"; pending: ReturnType<StoreReportDatabase["listPendingConfirmations"]> }
  | {
      kind: "selected";
      pending: ReturnType<StoreReportDatabase["listPendingConfirmations"]>[number];
    } {
  const nowIso = isoTimestampFromMillis(Date.now());
  if (params.action.kind !== "none" && params.action.pendingId !== undefined) {
    const pending = params.db.findPendingConfirmation({
      pendingId: params.action.pendingId,
      channel: params.channel,
      accountId: params.accountId,
      chatId: params.chatId,
      senderId: params.senderId,
      nowIso,
    });
    return pending ? { kind: "selected", pending } : { kind: "none" };
  }

  const pending = params.db.listPendingConfirmations({
    channel: params.channel,
    accountId: params.accountId,
    chatId: params.chatId,
    senderId: params.senderId,
    nowIso,
    limit: 5,
  });
  if (pending.length === 0) {
    return { kind: "none" };
  }
  if (pending.length > 1) {
    return { kind: "ambiguous", pending };
  }
  return { kind: "selected", pending: pending[0] };
}

function handleConfirmation(params: {
  db: StoreReportDatabase;
  config: StoreReportPluginConfig;
  action: ConfirmationAction;
  channel: string;
  accountId?: string;
  chatId: string;
  senderId?: string;
  replyToId: string;
  explicitlyAddressed: boolean;
}): { handled: true; reply?: { text: string; replyToId?: string } } | undefined {
  if (params.action.kind === "none") {
    return undefined;
  }

  const resolved = resolvePendingConfirmation(params);
  if (resolved.kind === "none") {
    if (params.explicitlyAddressed || params.action.pendingId !== undefined) {
      return {
        handled: true,
        reply: {
          text: "没有找到待确认语音。可能已经确认、已过期，或不是同一位发送人的待确认记录。",
          replyToId: params.replyToId,
        },
      };
    }
    return { handled: true };
  }
  if (resolved.kind === "ambiguous") {
    return {
      handled: true,
      reply: {
        text: buildAmbiguousConfirmationText(resolved.pending),
        replyToId: params.replyToId,
      },
    };
  }

  const pending = resolved.pending;
  if (params.action.kind === "reject") {
    params.db.rejectPendingConfirmation(pending.id);
    return {
      handled: true,
      reply: { text: `已标记 #${pending.id} 不计入日报。`, replyToId: params.replyToId },
    };
  }

  if (params.action.kind === "replace") {
    const normalizedText = normalizeStoreMessageText(params.action.text);
    const intent = classifyStoreMessage(normalizedText);
    if (intent.kind !== "business_record") {
      return {
        handled: true,
        reply: {
          text: "这句更正还没识别为经营记录，未计入日报。请按“改 #编号：成交1单，销售额300元”这类格式重发。",
          replyToId: params.replyToId,
        },
      };
    }
    params.db.replacePendingConfirmation(pending.id, {
      rawText: params.config.privacy.storeRawText ? params.action.text : "",
      normalizedText,
      recordType: intent.recordType,
      structured: extractStructuredRecord(normalizedText),
      confidence: 1,
    });
    return {
      handled: true,
      reply: {
        text: `已按更正内容计入日报：${truncateSnippet(normalizedText)}`,
        replyToId: params.replyToId,
      },
    };
  }

  params.db.confirmPendingConfirmation(pending.id);
  return {
    handled: true,
    reply: {
      text: `已确认并计入日报：${truncateSnippet(pending.record.normalizedText)}`,
      replyToId: params.replyToId,
    },
  };
}

async function handleStoreMessage(
  api: OpenClawPluginApi,
  event: StoreMessageEvent,
  ctx: StoreMessageContext,
  options: StoreHandleOptions,
): Promise<StoreMessageResult | undefined> {
  const initialSource = resolveSourceInput(event);
  let content = initialSource.text;
  const facts = resolveChannelFacts(event, ctx, content);
  if (!facts || !content.trim()) {
    return undefined;
  }

  const { db, config, currentConfig } = openStoreReportDatabase(api);
  try {
    const source = await resolveEffectiveSourceInput({
      api,
      event,
      facts,
      config,
      currentConfig,
      source: initialSource,
      allowPluginStt: options.archiveBusinessRecords,
    });
    content = source.text;
    if (!content.trim()) {
      return undefined;
    }
    const normalizedText = normalizeStoreMessageText(content);
    const intent = classifyStoreMessage(normalizedText);
    const binding = db.resolveBinding({
      channel: facts.channel,
      accountId: facts.accountId,
      chatId: facts.chatId,
      defaultTimezone: config.defaultTimezone,
    });
    if (!binding) {
      if (intent.kind !== "non_business") {
        api.logger?.info?.(
          `store-report: no binding for ${intent.kind} channel=${facts.channel} account=${facts.accountId ?? "-"} chat=${facts.chatId}`,
        );
      }
      return undefined;
    }
    if (source.sourceType === "voice" && !config.voice.enabled) {
      return config.archive.ignoreNonBusiness ? { handled: true } : undefined;
    }

    const businessDate = resolveEventBusinessDate(event, binding.timezone);

    if (intent.kind === "confirmation") {
      if (!options.handleInteractiveRequests) {
        return undefined;
      }
      const confirmation = handleConfirmation({
        db,
        config,
        action: parseConfirmationAction(normalizedText),
        channel: facts.channel,
        accountId: facts.accountId,
        chatId: facts.chatId,
        senderId: optionalString(event.senderId) ?? optionalString(ctx.senderId),
        replyToId: facts.messageId,
        explicitlyAddressed: isExplicitlyAddressed({ event, content }),
      });
      return confirmation
        ? {
            handled: true,
            ...(confirmation.reply?.text ? { text: confirmation.reply.text } : {}),
            ...(confirmation.reply?.replyToId ? { replyToId: confirmation.reply.replyToId } : {}),
          }
        : undefined;
    }

    if (intent.kind === "report_request") {
      if (!options.handleInteractiveRequests) {
        return undefined;
      }
      const reportText = generateAndSaveReport({
        db,
        binding,
        reportType: intent.reportType,
        businessDate,
        channel: facts.channel,
        chatId: facts.chatId,
      });
      return {
        handled: true,
        text: reportText,
        replyToId: facts.messageId,
      };
    }

    if (intent.kind === "business_record") {
      if (!options.archiveBusinessRecords) {
        return config.archive.silentBusinessRecords ? { handled: true } : undefined;
      }
      const needsConfirmation = shouldRequireVoiceConfirmation({ config, source });
      const archived = db.archiveRecord({
        messageId: facts.messageId,
        channel: facts.channel,
        accountId: facts.accountId,
        chatId: facts.chatId,
        chatType: event.isGroup ? "group" : "direct",
        senderId: optionalString(event.senderId) ?? optionalString(ctx.senderId),
        senderName: optionalString(event.senderName) ?? optionalString(event.senderUsername),
        storeId: binding.storeId,
        businessDate,
        sentAt: isoTimestampFromMillis(event.timestamp),
        sourceType: source.sourceType,
        rawText: config.privacy.storeRawText ? content : "",
        normalizedText,
        recordType: intent.recordType,
        structured: extractStructuredRecord(normalizedText),
        confidence: intent.confidence,
        confirmed: !needsConfirmation,
        needsConfirmation,
      });
      if (archived.archived) {
        api.logger?.info?.(
          `store-report: archived record store=${binding.storeId} channel=${facts.channel} account=${facts.accountId ?? "-"} chat=${facts.chatId} type=${intent.recordType}`,
        );
      }
      if (needsConfirmation && archived.recordId !== undefined) {
        const pendingId = db.createPendingConfirmation({
          recordId: archived.recordId,
          channel: facts.channel,
          accountId: facts.accountId,
          chatId: facts.chatId,
          senderId: optionalString(event.senderId) ?? optionalString(ctx.senderId),
          promptMessageId: facts.messageId,
          expiresAt: isoTimestampFromMillis(
            Date.now() + config.voice.confirmationTtlMinutes * 60 * 1000,
          ),
        });
        return {
          handled: true,
          text: buildVoiceConfirmationText({
            pendingId,
            text: normalizedText,
            confidence: source.transcriptConfidence,
            minConfidence: config.voice.minConfidence,
          }),
          replyToId: facts.messageId,
        };
      }
      return config.archive.silentBusinessRecords ? { handled: true } : undefined;
    }

    if (options.suppressUntranscribedVoice && isUntranscribedVoiceSource(source)) {
      return { handled: true };
    }

    return undefined;
  } finally {
    db.close();
  }
}

function resolveReplyTarget(
  event: StoreMessageEvent,
  ctx: StoreMessageContext,
  facts: { chatId: string },
): string {
  const metadata = optionalRecord(event.metadata);
  return (
    optionalString(metadata?.originatingTo) ??
    optionalString(metadata?.to) ??
    optionalString(ctx.conversationId) ??
    facts.chatId
  );
}

async function sendMessageReceivedReply(params: {
  api: OpenClawPluginApi;
  event: StoreMessageEvent;
  ctx: StoreMessageContext;
  result: StoreMessageResult;
}): Promise<void> {
  if (!params.result.text) {
    return;
  }
  const facts = resolveChannelFacts(params.event, params.ctx, params.result.text);
  if (!facts) {
    return;
  }
  const adapter = await params.api.runtime.channel.outbound.loadAdapter(
    facts.channel as RuntimeChannelId,
  );
  if (!adapter?.sendText) {
    params.api.logger?.info?.(`store-report: outbound adapter unavailable for ${facts.channel}`);
    return;
  }
  const { currentConfig } = resolveCurrentRuntimeConfig(params.api);
  await adapter.sendText({
    cfg: currentConfig,
    to: resolveReplyTarget(params.event, params.ctx, facts),
    text: params.result.text,
    accountId: facts.accountId,
    replyToId: params.result.replyToId,
  });
}

function formatCronError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveCronBinding(params: {
  db: StoreReportDatabase;
  config: StoreReportPluginConfig;
  payload: StoreReportCronPayload;
}): StoreBinding | undefined {
  const binding = params.db.resolveBinding({
    channel: params.payload.channel,
    accountId: params.payload.accountId,
    chatId: params.payload.chatId,
    defaultTimezone: params.config.defaultTimezone,
  });
  if (!binding || binding.storeId !== params.payload.storeId) {
    return undefined;
  }
  return binding;
}

function handleStoreReportCronPrompt(
  api: OpenClawPluginApi,
  prompt: string,
): { handled: true; reply?: { text: string } } | undefined {
  const payload = parseStoreReportCronMessage(prompt);
  if (!payload) {
    return undefined;
  }
  const { db, config } = openStoreReportDatabase(api);
  try {
    const binding = resolveCronBinding({ db, config, payload });
    if (!binding) {
      return {
        handled: true,
        reply: {
          text: `门店日报 Cron 执行失败：没有找到 ${payload.channel}/${payload.chatId} 对应的门店绑定，或绑定门店不是 ${payload.storeId}。`,
        },
      };
    }
    const timezone = payload.timezone ?? binding.timezone;
    const businessDate = resolveCronAnchorBusinessDate({
      now: new Date(),
      timezone,
      reportType: payload.reportType,
      weekMode: payload.weekMode,
    });
    return {
      handled: true,
      reply: {
        text: generateAndSaveReport({
          db,
          binding,
          reportType: payload.reportType,
          businessDate,
          channel: payload.channel,
          chatId: payload.chatId,
          generatedBy: "cron",
        }),
      },
    };
  } catch (error) {
    return {
      handled: true,
      reply: {
        text: `门店日报 Cron 执行失败：${formatCronError(error)}`,
      },
    };
  } finally {
    db.close();
  }
}

export default definePluginEntry({
  id: STORE_REPORT_PLUGIN_ID,
  name: "Store Report Assistant",
  description: "Archives store group business records and generates daily or weekly reports.",
  register(api: OpenClawPluginApi) {
    api.on(
      "before_agent_reply",
      (event, ctx) => {
        if (ctx.trigger !== "cron") {
          return undefined;
        }
        return handleStoreReportCronPrompt(api, event.cleanedBody);
      },
      { priority: 90 },
    );

    api.on(
      "inbound_claim",
      async (event, ctx) => {
        const result = await handleStoreMessage(api, event, ctx, {
          archiveBusinessRecords: true,
          handleInteractiveRequests: true,
        });
        if (!result) {
          return undefined;
        }
        return {
          handled: true,
          ...(result.text
            ? {
                reply: {
                  text: result.text,
                  ...(result.replyToId ? { replyToId: result.replyToId } : {}),
                },
              }
            : {}),
        };
      },
      { priority: 80 },
    );

    api.on(
      "before_dispatch",
      async (event, ctx) => {
        const result = await handleStoreMessage(api, event, ctx, {
          archiveBusinessRecords: false,
          handleInteractiveRequests: true,
          suppressUntranscribedVoice: true,
        });
        if (!result) {
          return undefined;
        }
        return {
          handled: true,
          ...(result.text ? { text: result.text } : {}),
        };
      },
      { priority: 80 },
    );

    api.on(
      "message_received",
      async (event, ctx) => {
        const result = await handleStoreMessage(api, event, ctx, {
          archiveBusinessRecords: true,
          handleInteractiveRequests: false,
        });
        if (!result?.text) {
          return;
        }
        await sendMessageReceivedReply({ api, event, ctx, result });
      },
      { priority: 80 },
    );

    api.registerCli(
      async ({ program }) => {
        const { registerStoreReportCli } = await import("./src/cli.js");
        registerStoreReportCli({ program, api });
      },
      {
        descriptors: [
          {
            name: "store-report",
            description: "Manage store report bindings, records, and reports",
            hasSubcommands: true,
          },
        ],
      },
    );
  },
});
