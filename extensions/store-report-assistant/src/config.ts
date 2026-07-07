import path from "node:path";
import type { StoreBindingSeed, StoreReportPluginConfig, StoreSeed } from "./types.js";

const DEFAULT_DATABASE_PATH = "data/store_report/store_report.sqlite";
const DEFAULT_TIMEZONE = "Asia/Shanghai";
const DEFAULT_DAILY_TIME = "21:30";
const DEFAULT_WEEKLY_DAY = "MON";
const DEFAULT_WEEKLY_TIME = "09:30";
const DEFAULT_VOICE_MIN_CONFIDENCE = 0.8;
const DEFAULT_VOICE_CONFIRMATION_TTL_MINUTES = 240;
const DEFAULT_VOICE_DOWNLOAD_MAX_MB = 30;
const DEFAULT_VOICE_STT_TIMEOUT_SECONDS = 180;
const DEFAULT_CHAT_RECORD_RETENTION_DAYS = 180;
const DEFAULT_REPORT_RETENTION_DAYS = 365;
const DEFAULT_PENDING_CONFIRMATION_RETENTION_DAYS = 7;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asPositiveInteger(value: unknown): number | undefined {
  const number = asFiniteNumber(value);
  return number !== undefined && number >= 1 ? Math.floor(number) : undefined;
}

function asStringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] =>
        typeof entry[0] === "string" && typeof entry[1] === "string",
    ),
  );
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeStoreSeed(value: unknown, fallbackTimezone: string): StoreSeed | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const storeId = asString(record.storeId);
  const storeName = asString(record.storeName);
  if (!storeId || !storeName) {
    return undefined;
  }
  const source = asString(record.source);
  return {
    storeId,
    storeName,
    timezone: asString(record.timezone) ?? fallbackTimezone,
    source: source === "import" || source === "local" || source === "external" ? source : "manual",
    ...(asString(record.externalRef) ? { externalRef: asString(record.externalRef) } : {}),
    enabled: asBoolean(record.enabled) ?? true,
  };
}

function normalizeBindingSeed(
  value: unknown,
  stores: Map<string, StoreSeed>,
  fallbackTimezone: string,
): StoreBindingSeed | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const channel = asString(record.channel);
  const chatId = asString(record.chatId);
  const storeId = asString(record.storeId);
  if (!channel || !chatId || !storeId) {
    return undefined;
  }
  const store = stores.get(storeId);
  return {
    channel,
    ...(asString(record.accountId) ? { accountId: asString(record.accountId) } : {}),
    chatId,
    chatType: asString(record.chatType) === "direct" ? "direct" : "group",
    storeId,
    ...((asString(record.storeName) ?? store?.storeName)
      ? { storeName: asString(record.storeName) ?? store?.storeName }
      : {}),
    timezone: asString(record.timezone) ?? store?.timezone ?? fallbackTimezone,
    enabled: asBoolean(record.enabled) ?? true,
  };
}

export function resolveStoreReportConfig(raw: unknown): StoreReportPluginConfig {
  const config = asRecord(raw) ?? {};
  const database = asRecord(config.database) ?? {};
  const archive = asRecord(config.archive) ?? {};
  const reports = asRecord(config.reports) ?? {};
  const voice = asRecord(config.voice) ?? {};
  const voiceDownload = asRecord(voice.download) ?? {};
  const voiceStt = asRecord(voice.stt) ?? {};
  const voiceSttAuth = asRecord(voiceStt.auth) ?? {};
  const transcriptSource = asString(voice.transcriptSource);
  const sttMode = asString(voiceStt.mode);
  const sttAuthMode = asString(voiceSttAuth.mode);
  const privacy = asRecord(config.privacy) ?? {};
  const retention = asRecord(privacy.retention) ?? {};
  const defaultTimezone = asString(config.defaultTimezone) ?? DEFAULT_TIMEZONE;
  const stores = asArray(config.stores)
    .map((entry) => normalizeStoreSeed(entry, defaultTimezone))
    .filter((entry): entry is StoreSeed => entry !== undefined);
  const storeMap = new Map(stores.map((store) => [store.storeId, store]));
  const bindings = asArray(config.bindings)
    .map((entry) => normalizeBindingSeed(entry, storeMap, defaultTimezone))
    .filter((entry): entry is StoreBindingSeed => entry !== undefined);

  return {
    databasePath: asString(database.path) ?? DEFAULT_DATABASE_PATH,
    defaultTimezone,
    archive: {
      silentBusinessRecords: asBoolean(archive.silentBusinessRecords) ?? true,
      ignoreNonBusiness: asBoolean(archive.ignoreNonBusiness) ?? true,
      dedupeByMessageId: asBoolean(archive.dedupeByMessageId) ?? true,
    },
    reports: {
      dailyTime: asString(reports.dailyTime) ?? DEFAULT_DAILY_TIME,
      weeklyDay: asString(reports.weeklyDay) ?? DEFAULT_WEEKLY_DAY,
      weeklyTime: asString(reports.weeklyTime) ?? DEFAULT_WEEKLY_TIME,
    },
    voice: {
      enabled: asBoolean(voice.enabled) ?? true,
      transcriptSource:
        transcriptSource === "event-only" ||
        transcriptSource === "plugin-stt" ||
        transcriptSource === "off"
          ? transcriptSource
          : "auto",
      minConfidence: Math.min(
        1,
        Math.max(0, asFiniteNumber(voice.minConfidence) ?? DEFAULT_VOICE_MIN_CONFIDENCE),
      ),
      confirmationTtlMinutes:
        asPositiveInteger(voice.confirmationTtlMinutes) ?? DEFAULT_VOICE_CONFIRMATION_TTL_MINUTES,
      requireConfirmationWhenConfidenceMissing:
        asBoolean(voice.requireConfirmationWhenConfidenceMissing) ?? true,
      download: {
        maxMb: asFiniteNumber(voiceDownload.maxMb) ?? DEFAULT_VOICE_DOWNLOAD_MAX_MB,
      },
      stt: {
        mode:
          sttMode === "custom-http" || sttMode === "local-whisper" || sttMode === "disabled"
            ? sttMode
            : "openclaw-media",
        timeoutSeconds:
          asPositiveInteger(voiceStt.timeoutSeconds) ?? DEFAULT_VOICE_STT_TIMEOUT_SECONDS,
        ...(asString(voiceStt.endpoint) ? { endpoint: asString(voiceStt.endpoint) } : {}),
        headers: asStringRecord(voiceStt.headers),
        ...(sttAuthMode === "bearer" || sttAuthMode === "header"
          ? {
              auth: {
                mode: sttAuthMode,
                ...(asString(voiceSttAuth.tokenRef)
                  ? { tokenRef: asString(voiceSttAuth.tokenRef) }
                  : {}),
                ...(asString(voiceSttAuth.headerName)
                  ? { headerName: asString(voiceSttAuth.headerName) }
                  : {}),
                ...(asString(voiceSttAuth.prefix) ? { prefix: asString(voiceSttAuth.prefix) } : {}),
              },
            }
          : {}),
        responseTextPath: asString(voiceStt.responseTextPath) ?? "text",
        ...(asString(voiceStt.responseConfidencePath)
          ? { responseConfidencePath: asString(voiceStt.responseConfidencePath) }
          : {}),
        backend: asString(voiceStt.backend) === "openai-whisper" ? "openai-whisper" : "whisper-cpp",
        ...(asString(voiceStt.executable) ? { executable: asString(voiceStt.executable) } : {}),
        ...(asString(voiceStt.model) ? { model: asString(voiceStt.model) } : {}),
        language: asString(voiceStt.language) ?? "zh",
      },
    },
    privacy: {
      storeRawText: asBoolean(privacy.storeRawText) ?? false,
      redactExportsByDefault: asBoolean(privacy.redactExportsByDefault) ?? false,
      retention: {
        chatRecordsDays:
          asPositiveInteger(retention.chatRecordsDays) ?? DEFAULT_CHAT_RECORD_RETENTION_DAYS,
        reportsDays: asPositiveInteger(retention.reportsDays) ?? DEFAULT_REPORT_RETENTION_DAYS,
        pendingConfirmationsDays:
          asPositiveInteger(retention.pendingConfirmationsDays) ??
          DEFAULT_PENDING_CONFIRMATION_RETENTION_DAYS,
      },
    },
    stores,
    bindings,
  };
}

export function resolveDatabasePath(
  configuredPath: string,
  resolvePluginPath: (input: string) => string,
  workspaceDir?: string,
): string {
  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }
  if (configuredPath.startsWith("~")) {
    return resolvePluginPath(configuredPath);
  }
  if (workspaceDir) {
    return path.resolve(workspaceDir, configuredPath);
  }
  return resolvePluginPath(configuredPath);
}

export function resolveConfiguredWorkspaceDir(config: unknown): string | undefined {
  const root = asRecord(config);
  const agents = asRecord(root?.agents);
  const defaults = asRecord(agents?.defaults);
  return asString(defaults?.workspace);
}
