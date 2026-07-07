import { formatBusinessDate } from "./date.js";

export const STORE_REPORT_CRON_MARKER = "[store-report-assistant cron]";
const STORE_REPORT_CRON_LLM_FALLBACK_INSTRUCTION =
  "如果你是模型并看到了这条消息，说明 store-report-assistant 的 Cron hook 没有接管。本次必须只回复：门店日报 Cron 执行失败：store-report hook 未生效。不要生成日报，不要读取上下文，不要使用记忆或历史聊天。";

export type StoreReportCronReportType = "daily" | "weekly";

export type StoreReportCronWeekMode = "current" | "previous";

export type StoreReportCronPayload = {
  version: 1;
  action: "send_report";
  reportType: StoreReportCronReportType;
  storeId: string;
  channel: string;
  chatId: string;
  accountId?: string;
  timezone?: string;
  weekMode?: StoreReportCronWeekMode;
  llmFallbackInstruction?: string;
};

const WEEKDAY_TO_CRON_DAY = new Map<string, number>([
  ["SUN", 0],
  ["MON", 1],
  ["TUE", 2],
  ["WED", 3],
  ["THU", 4],
  ["FRI", 5],
  ["SAT", 6],
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStoreReportCronReportType(value: unknown): StoreReportCronReportType | undefined {
  return value === "daily" || value === "weekly" ? value : undefined;
}

function asStoreReportCronWeekMode(value: unknown): StoreReportCronWeekMode | undefined {
  return value === "current" || value === "previous" ? value : undefined;
}

function extractLeadingJsonObject(text: string): string | undefined {
  const start = text.search(/\S/u);
  if (start < 0 || text[start] !== "{") {
    return undefined;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return undefined;
}

function parseClockTime(value: string): { hour: number; minute: number } {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/u.exec(value.trim());
  if (!match) {
    throw new Error("时间必须是 HH:mm，例如 21:30");
  }
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

export function buildDailyCronExpression(time: string): string {
  const { hour, minute } = parseClockTime(time);
  return `${minute} ${hour} * * *`;
}

export function buildWeeklyCronExpression(day: string, time: string): string {
  const normalizedDay = day.trim().toUpperCase();
  const cronDay = WEEKDAY_TO_CRON_DAY.get(normalizedDay);
  if (cronDay === undefined) {
    throw new Error("周报日期必须是 SUN/MON/TUE/WED/THU/FRI/SAT");
  }
  const { hour, minute } = parseClockTime(time);
  return `${minute} ${hour} * * ${cronDay}`;
}

export function encodeStoreReportCronMessage(payload: StoreReportCronPayload): string {
  return `${STORE_REPORT_CRON_MARKER}\n${JSON.stringify({
    ...payload,
    llmFallbackInstruction: STORE_REPORT_CRON_LLM_FALLBACK_INSTRUCTION,
  })}`;
}

export function parseStoreReportCronMessage(text: string): StoreReportCronPayload | undefined {
  const markerIndex = text.indexOf(STORE_REPORT_CRON_MARKER);
  if (markerIndex < 0) {
    return undefined;
  }
  const jsonText = extractLeadingJsonObject(
    text.slice(markerIndex + STORE_REPORT_CRON_MARKER.length),
  );
  if (!jsonText) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return undefined;
  }
  const record = asRecord(parsed);
  if (!record || record.version !== 1 || record.action !== "send_report") {
    return undefined;
  }
  const reportType = asStoreReportCronReportType(record.reportType);
  const storeId = asString(record.storeId);
  const channel = asString(record.channel);
  const chatId = asString(record.chatId);
  if (!reportType || !storeId || !channel || !chatId) {
    return undefined;
  }
  return {
    version: 1,
    action: "send_report",
    reportType,
    storeId,
    channel,
    chatId,
    ...(asString(record.accountId) ? { accountId: asString(record.accountId) } : {}),
    ...(asString(record.timezone) ? { timezone: asString(record.timezone) } : {}),
    ...(asStoreReportCronWeekMode(record.weekMode)
      ? { weekMode: asStoreReportCronWeekMode(record.weekMode) }
      : {}),
  };
}

export function shiftBusinessDate(businessDate: string, days: number): string {
  const parsed = new Date(`${businessDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return businessDate;
  }
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function resolveCronAnchorBusinessDate(params: {
  now: Date;
  timezone: string;
  reportType: StoreReportCronReportType;
  weekMode?: StoreReportCronWeekMode;
}): string {
  const today = formatBusinessDate(params.now, params.timezone);
  if (params.reportType !== "weekly") {
    return today;
  }
  return params.weekMode === "current" ? today : shiftBusinessDate(today, -7);
}
