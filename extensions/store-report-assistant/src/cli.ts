import fs from "node:fs";
import path from "node:path";
import { stdin as processStdin, stdout as processStdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { callGatewayFromCli } from "openclaw/plugin-sdk/browser-node-runtime";
import { resolveLivePluginConfigObject } from "openclaw/plugin-sdk/config-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  resolveConfiguredWorkspaceDir,
  resolveDatabasePath,
  resolveStoreReportConfig,
} from "./config.js";
import {
  buildDailyCronExpression,
  buildWeeklyCronExpression,
  encodeStoreReportCronMessage,
  type StoreReportCronReportType,
  type StoreReportCronWeekMode,
} from "./cron.js";
import { formatBusinessDate, isoTimestampFromMillis, resolveIsoWeekRange } from "./date.js";
import { StoreReportDatabase } from "./db.js";
import { redactStoreChatRecord } from "./privacy.js";
import { generateStoreReport } from "./report-service.js";
import type {
  StoreBinding,
  StoreBindingSeed,
  StoreChatRecord,
  StoreReportPluginConfig,
  StoreSeed,
} from "./types.js";
import { buildVoiceDiagnoseChecks, buildVoiceStatus } from "./voice.js";

type CommandAction = (...args: unknown[]) => unknown;

type CommandLike = {
  command(name: string): CommandLike;
  description(text: string): CommandLike;
  option(flags: string, description: string, defaultValue?: string): CommandLike;
  requiredOption(flags: string, description: string): CommandLike;
  action(fn: CommandAction): CommandLike;
};

type RegisterStoreReportCliParams = {
  program: CommandLike;
  api: OpenClawPluginApi;
  callGateway?: GatewayCaller;
  prompt?: PromptFn;
};

type GatewayCaller = (
  method: string,
  options: Record<string, unknown>,
  params?: unknown,
) => Promise<unknown>;

type PromptFn = (question: string, defaultValue?: string) => Promise<string>;

type DiagnoseCheck = { name: string; status: "ok" | "warn" | "fail"; message: string };

type RuntimeChannelId = Parameters<
  OpenClawPluginApi["runtime"]["channel"]["outbound"]["loadAdapter"]
>[0];

type GeneratedCliReport = {
  reportType: "daily" | "weekly";
  storeId: string;
  storeName: string;
  reportText: string;
  missingFields: string[];
  sourceRecordCount: number;
  businessDate?: string;
  weekStartDate?: string;
  weekEndDate?: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asPositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return Math.floor(value);
  }
  if (typeof value === "string" && /^\d+$/u.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return parsed >= 1 ? parsed : undefined;
  }
  return undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: unknown): string[] {
  return asArray(value).filter((entry): entry is string => typeof entry === "string");
}

function hasConfigValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return value !== undefined && value !== null;
}

function defaultPrompt(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: processStdin, output: processStdout });
  const suffix = defaultValue ? ` (${defaultValue})` : "";
  return rl
    .question(`${question}${suffix}: `)
    .then((answer) => {
      const trimmed = answer.trim();
      return trimmed || defaultValue || "";
    })
    .finally(() => {
      rl.close();
    });
}

function normalizeYesNo(value: string, defaultValue: boolean): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  return ["y", "yes", "true", "1", "是", "对", "好"].includes(normalized);
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
}

function readStoresCsv(filePath: string, defaultTimezone: string): StoreSeed[] {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines: string[] = [];
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed) {
      lines.push(trimmed);
    }
  }
  const [headerLine, ...rows] = lines;
  if (!headerLine) {
    return [];
  }
  const headers = parseCsvLine(headerLine);
  return rows
    .map((line): StoreSeed | undefined => {
      const values = parseCsvLine(line);
      const record = Object.fromEntries(
        headers.map((header, index) => [header, values[index] ?? ""]),
      );
      const storeId = record.store_id || record.storeId;
      const storeName = record.store_name || record.storeName;
      if (!storeId || !storeName) {
        return undefined;
      }
      const store: StoreSeed = {
        storeId,
        storeName,
        timezone: record.timezone || defaultTimezone,
        source: "import",
        enabled: true,
      };
      const externalRef = record.external_ref || record.externalRef;
      if (externalRef) {
        store.externalRef = externalRef;
      }
      return store;
    })
    .filter((store): store is StoreSeed => store !== undefined);
}

function openCliDatabase(api: OpenClawPluginApi): {
  db: StoreReportDatabase;
  config: ReturnType<typeof resolveStoreReportConfig>;
} {
  const currentConfig = api.runtime.config?.loadConfig?.() ?? api.config;
  void currentConfig;
  const config = resolveStoreReportConfig(
    resolveLivePluginConfigObject(
      api.runtime.config?.loadConfig,
      "store-report-assistant",
      api.pluginConfig,
    ),
  );
  const db = new StoreReportDatabase(
    resolveDatabasePath(
      config.databasePath,
      api.resolvePath,
      resolveConfiguredWorkspaceDir(currentConfig),
    ),
  );
  db.seedConfig(config);
  return { db, config };
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function writeTextOutput(text: string, filePath: string | undefined): void {
  if (!filePath) {
    console.log(text);
    return;
  }
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
  console.log(`已写入 ${filePath}`);
}

function formatRecordsForExport(
  records: StoreChatRecord[],
  format: string,
  redact: boolean,
): string {
  const exportRecords = redact ? records.map(redactStoreChatRecord) : records;
  if (format === "json") {
    return JSON.stringify(exportRecords, null, 2);
  }
  if (format !== "jsonl") {
    throw new Error("--format 仅支持 jsonl 或 json");
  }
  return exportRecords.map((record) => JSON.stringify(record)).join("\n");
}

function dateDaysAgo(days: number, timezone: string): string {
  return formatBusinessDate(new Date(Date.now() - days * DAY_MS), timezone);
}

function isoDaysAgo(days: number): string {
  return isoTimestampFromMillis(Date.now() - days * DAY_MS);
}

function findStoreName(db: StoreReportDatabase, storeId: string): string {
  return db.listStores().find((entry) => entry.storeId === storeId)?.storeName ?? storeId;
}

function generateAndSaveCliReport(params: {
  db: StoreReportDatabase;
  config: StoreReportPluginConfig;
  storeId: string;
  options: Record<string, unknown>;
  generatedBy: string;
  binding?: StoreBinding;
}): GeneratedCliReport {
  const storeName = findStoreName(params.db, params.storeId);
  const weekDate = asString(params.options.week);
  if (weekDate) {
    const week = resolveIsoWeekRange(weekDate);
    const records = params.db.listRecordsByRange(
      params.storeId,
      week.weekStartDate,
      week.weekEndDate,
    );
    const result = generateStoreReport({
      reportType: "weekly",
      storeId: params.storeId,
      storeName,
      weekStartDate: week.weekStartDate,
      weekEndDate: week.weekEndDate,
      records,
    });
    params.db.saveWeeklyReport({
      storeId: params.storeId,
      weekStartDate: week.weekStartDate,
      weekEndDate: week.weekEndDate,
      channel: params.binding?.channel,
      chatId: params.binding?.chatId,
      reportText: result.reportText,
      missingFields: result.missingFields,
      sourceRecordCount: result.sourceRecordCount,
      generatedBy: params.generatedBy,
    });
    return {
      reportType: "weekly",
      storeId: params.storeId,
      storeName,
      weekStartDate: week.weekStartDate,
      weekEndDate: week.weekEndDate,
      ...result,
    };
  }

  const businessDate =
    asString(params.options.date) ?? formatBusinessDate(new Date(), params.config.defaultTimezone);
  const records = params.db.listRecordsByDate(params.storeId, businessDate);
  const result = generateStoreReport({
    reportType: "daily",
    storeId: params.storeId,
    storeName,
    businessDate,
    records,
  });
  params.db.saveDailyReport({
    storeId: params.storeId,
    businessDate,
    channel: params.binding?.channel,
    chatId: params.binding?.chatId,
    reportText: result.reportText,
    missingFields: result.missingFields,
    sourceRecordCount: result.sourceRecordCount,
    generatedBy: params.generatedBy,
  });
  return {
    reportType: "daily",
    storeId: params.storeId,
    storeName,
    businessDate,
    ...result,
  };
}

function resolveTargetBindings(params: {
  db: StoreReportDatabase;
  storeId: string;
  options: Record<string, unknown>;
}): StoreBinding[] {
  const channel = asString(params.options.channel);
  const accountId = asString(params.options.account);
  const chatId = asString(params.options.chat);
  const bindings = params.db.listBindings().filter((binding) => {
    if (binding.storeId !== params.storeId) {
      return false;
    }
    if (channel && binding.channel !== channel) {
      return false;
    }
    if (accountId && binding.accountId !== accountId) {
      return false;
    }
    return !(chatId && binding.chatId !== chatId);
  });
  if (bindings.length === 0) {
    throw new Error(
      "没有找到可发送的门店群绑定。请先运行 bindings add，或检查 --channel/--account/--chat。",
    );
  }
  return bindings;
}

async function sendReportToBinding(params: {
  api: OpenClawPluginApi;
  binding: StoreBinding;
  report: GeneratedCliReport;
}): Promise<void> {
  const adapter = await params.api.runtime.channel.outbound.loadAdapter(
    params.binding.channel as RuntimeChannelId,
  );
  if (!adapter?.sendText) {
    throw new Error(`渠道 ${params.binding.channel} 不支持发送文本，无法回发报告。`);
  }
  const currentConfig = params.api.runtime.config?.loadConfig?.() ?? params.api.config;
  await adapter.sendText({
    cfg: currentConfig,
    to: params.binding.chatId,
    text: params.report.reportText,
    accountId: params.binding.accountId,
  });
}

function buildDiagnoseChecks(params: {
  db: StoreReportDatabase;
  config: StoreReportPluginConfig;
}): DiagnoseCheck[] {
  const stores = params.db.listStores();
  const bindings = params.db.listBindings();
  const today = formatBusinessDate(new Date(), params.config.defaultTimezone);
  const todayRecordCount = stores.reduce(
    (total, store) => total + params.db.listRecordsByDate(store.storeId, today).length,
    0,
  );
  const nowIso = isoTimestampFromMillis(Date.now());
  const pendingCount = bindings.reduce(
    (total, binding) =>
      total +
      params.db.listPendingConfirmations({
        channel: binding.channel,
        accountId: binding.accountId,
        chatId: binding.chatId,
        nowIso,
      }).length,
    0,
  );
  const checks: DiagnoseCheck[] = [
    {
      name: "database",
      status: "ok",
      message: params.db.dbPath,
    },
    {
      name: "stores",
      status: stores.length > 0 ? "ok" : "fail",
      message: stores.length > 0 ? `${stores.length} 个门店` : "没有门店主数据",
    },
    {
      name: "bindings",
      status: bindings.length > 0 ? "ok" : "fail",
      message: bindings.length > 0 ? `${bindings.length} 个群绑定` : "没有门店群绑定",
    },
    {
      name: "recordsToday",
      status: todayRecordCount > 0 ? "ok" : "warn",
      message:
        todayRecordCount > 0 ? `今天 ${todayRecordCount} 条已确认记录` : "今天还没有已确认记录",
    },
    {
      name: "pendingVoice",
      status: pendingCount > 0 ? "warn" : "ok",
      message: pendingCount > 0 ? `${pendingCount} 条待确认语音` : "没有待确认语音",
    },
  ];
  if (!params.config.voice.enabled) {
    checks.push({
      name: "voice",
      status: "warn",
      message: "语音处理已关闭",
    });
  }
  checks.push(...buildVoiceDiagnoseChecks(params.config));
  return checks;
}

function resolveCronReportTypes(value: unknown): StoreReportCronReportType[] {
  const normalized = (asString(value) ?? "both").toLowerCase();
  if (normalized === "daily") {
    return ["daily"];
  }
  if (normalized === "weekly") {
    return ["weekly"];
  }
  if (normalized === "both") {
    return ["daily", "weekly"];
  }
  throw new Error("--only 仅支持 daily、weekly 或 both");
}

function resolveCronWeekMode(value: unknown): StoreReportCronWeekMode {
  const normalized = (asString(value) ?? "previous").toLowerCase();
  if (normalized === "current" || normalized === "previous") {
    return normalized;
  }
  throw new Error("--weekly-period 仅支持 current 或 previous");
}

function buildStoreReportCronJobName(params: {
  reportType: StoreReportCronReportType;
  storeId: string;
  channel: string;
  chatId: string;
}): string {
  return `store-report:${params.reportType}:${params.storeId}:${params.channel}:${params.chatId}`;
}

function buildStoreReportCronJobParams(params: {
  binding: StoreBinding;
  reportType: StoreReportCronReportType;
  config: StoreReportPluginConfig;
  options: Record<string, unknown>;
}): Record<string, unknown> {
  const timezone = asString(params.options.timezone) ?? params.binding.timezone;
  const dailyTime = asString(params.options.dailyTime) ?? params.config.reports.dailyTime;
  const weeklyDay = asString(params.options.weeklyDay) ?? params.config.reports.weeklyDay;
  const weeklyTime = asString(params.options.weeklyTime) ?? params.config.reports.weeklyTime;
  const weekMode = resolveCronWeekMode(params.options.weeklyPeriod);
  const schedule =
    params.reportType === "daily"
      ? {
          kind: "cron",
          expr: buildDailyCronExpression(dailyTime),
          tz: timezone,
        }
      : {
          kind: "cron",
          expr: buildWeeklyCronExpression(weeklyDay, weeklyTime),
          tz: timezone,
        };
  const name = buildStoreReportCronJobName({
    reportType: params.reportType,
    storeId: params.binding.storeId,
    channel: params.binding.channel,
    chatId: params.binding.chatId,
  });
  const payload = {
    version: 1,
    action: "send_report",
    reportType: params.reportType,
    storeId: params.binding.storeId,
    channel: params.binding.channel,
    ...(params.binding.accountId ? { accountId: params.binding.accountId } : {}),
    chatId: params.binding.chatId,
    timezone,
    ...(params.reportType === "weekly" ? { weekMode } : {}),
  } as const;
  const agentId = asString(params.options.agent);
  return {
    name,
    description:
      params.reportType === "daily"
        ? `Generate and send daily store report for ${params.binding.storeName}`
        : `Generate and send weekly store report for ${params.binding.storeName}`,
    enabled: asBoolean(params.options.disabled) !== true,
    ...(agentId ? { agentId } : {}),
    schedule,
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: {
      kind: "agentTurn",
      message: encodeStoreReportCronMessage(payload),
      lightContext: true,
    },
    delivery: {
      mode: "announce",
      channel: params.binding.channel,
      ...(params.binding.accountId ? { accountId: params.binding.accountId } : {}),
      to: params.binding.chatId,
      bestEffort: true,
    },
  };
}

function extractGatewayJobs(response: unknown): Array<{ id?: string; name?: string }> {
  const record = asRecord(response);
  const jobs = Array.isArray(record.jobs) ? record.jobs : [];
  return jobs.filter((entry): entry is { id?: string; name?: string } => {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const job = entry as Record<string, unknown>;
    return typeof job.id === "string" || typeof job.name === "string";
  });
}

async function upsertCronJob(params: {
  callGateway: GatewayCaller;
  options: Record<string, unknown>;
  job: Record<string, unknown>;
}): Promise<{ action: "created" | "updated"; id?: string; name: string }> {
  const name = asString(params.job.name);
  if (!name) {
    throw new Error("Cron job name is required");
  }
  const listResponse = await params.callGateway("cron.list", params.options, {
    includeDisabled: true,
    query: name,
  });
  const existing = extractGatewayJobs(listResponse).find((job) => job.name === name);
  if (existing?.id) {
    await params.callGateway("cron.update", params.options, {
      id: existing.id,
      patch: params.job,
    });
    return { action: "updated", id: existing.id, name };
  }
  const addResponse = await params.callGateway("cron.add", params.options, params.job);
  const id =
    asString(asRecord(addResponse)?.id) ?? asString(asRecord(asRecord(addResponse)?.job)?.id);
  return { action: "created", ...(id ? { id } : {}), name };
}

function firstConfiguredFeishuAccountId(config: unknown): string | undefined {
  const channels = asRecord(asRecord(config).channels);
  const feishu = asRecord(channels.feishu);
  if (!feishu) {
    return undefined;
  }
  const explicit = asString(feishu.defaultAccount);
  if (explicit) {
    return explicit;
  }
  const accounts = asRecord(feishu.accounts);
  const [first] = Object.keys(accounts);
  return first;
}

async function collectInteractiveSetupOptions(params: {
  options: Record<string, unknown>;
  db: StoreReportDatabase;
  config: StoreReportPluginConfig;
  currentConfig: unknown;
  prompt: PromptFn;
}): Promise<Record<string, unknown>> {
  const [firstStore] = params.db.listStores();
  const [firstBinding] = params.db.listBindings();
  const channel = await params.prompt("渠道", asString(params.options.channel) ?? "feishu");
  const accountDefault =
    asString(params.options.account) ??
    firstBinding?.accountId ??
    firstConfiguredFeishuAccountId(params.currentConfig);
  const account = await params.prompt("账号 ID，留空表示默认账号", accountDefault);
  const chat = await params.prompt(
    "群聊 chatId",
    asString(params.options.chat) ?? firstBinding?.chatId,
  );
  const store = await params.prompt(
    "门店 ID",
    asString(params.options.store) ?? firstStore?.storeId,
  );
  const storeName = await params.prompt(
    "门店名称",
    asString(params.options.storeName) ?? firstStore?.storeName,
  );
  const timezone = await params.prompt(
    "门店时区",
    asString(params.options.timezone) ?? firstStore?.timezone ?? params.config.defaultTimezone,
  );
  const dailyTime = await params.prompt(
    "日报发送时间 HH:mm",
    asString(params.options.dailyTime) ?? params.config.reports.dailyTime,
  );
  const weeklyDay = await params.prompt(
    "周报发送星期 SUN/MON/TUE/WED/THU/FRI/SAT",
    asString(params.options.weeklyDay) ?? params.config.reports.weeklyDay,
  );
  const weeklyTime = await params.prompt(
    "周报发送时间 HH:mm",
    asString(params.options.weeklyTime) ?? params.config.reports.weeklyTime,
  );
  const installCronAnswer = await params.prompt("是否创建日报/周报 Cron? Y/n", "Y");
  return {
    ...params.options,
    channel,
    ...(account ? { account } : {}),
    chat,
    store,
    storeName,
    timezone,
    dailyTime,
    weeklyDay,
    weeklyTime,
    installCron: normalizeYesNo(installCronAnswer, true),
  };
}

function resolveFeishuConfig(config: unknown): {
  section?: Record<string, unknown>;
  account?: Record<string, unknown>;
  accountId?: string;
} {
  const channels = asRecord(asRecord(config).channels);
  const section = asRecord(channels.feishu);
  if (!section) {
    return {};
  }
  const accountId = firstConfiguredFeishuAccountId(config) ?? "default";
  const accounts = asRecord(section.accounts);
  return {
    section,
    account: asRecord(accounts[accountId]) ?? (accountId === "default" ? section : undefined),
    accountId,
  };
}

function resolveFeishuAccountConfig(
  config: unknown,
  accountId?: string,
): {
  section?: Record<string, unknown>;
  account?: Record<string, unknown>;
  accountId?: string;
} {
  const base = resolveFeishuConfig(config);
  if (!base.section || !accountId) {
    return base;
  }
  const accounts = asRecord(base.section.accounts);
  return {
    section: base.section,
    account: asRecord(accounts[accountId]) ?? (accountId === "default" ? base.section : undefined),
    accountId,
  };
}

function resolveGroupEntry(params: {
  section?: Record<string, unknown>;
  account?: Record<string, unknown>;
  chatId: string;
}): Record<string, unknown> | undefined {
  const accountGroups = asRecord(params.account?.groups);
  const sectionGroups = asRecord(params.section?.groups);
  return (
    asRecord(accountGroups[params.chatId]) ??
    asRecord(sectionGroups[params.chatId]) ??
    asRecord(accountGroups["*"]) ??
    asRecord(sectionGroups["*"])
  );
}

function checkFeishuConfigForBinding(config: unknown, binding: StoreBinding): DiagnoseCheck[] {
  const { section, account, accountId } = resolveFeishuAccountConfig(config, binding.accountId);
  const checks: DiagnoseCheck[] = [];
  if (!section) {
    return [
      {
        name: "feishu.config",
        status: "fail",
        message: "channels.feishu 未配置",
      },
    ];
  }
  checks.push({
    name: "feishu.config",
    status: "ok",
    message: `账号 ${binding.accountId ?? accountId ?? "default"} 已找到配置`,
  });
  checks.push({
    name: "feishu.credentials",
    status: hasConfigValue(account?.appId) && hasConfigValue(account?.appSecret) ? "ok" : "fail",
    message:
      hasConfigValue(account?.appId) && hasConfigValue(account?.appSecret)
        ? "appId/appSecret 已配置"
        : "缺少 appId 或 appSecret",
  });
  const groupPolicy =
    asString(account?.groupPolicy) ?? asString(section.groupPolicy) ?? "allowlist";
  const accountAllow = asStringArray(account?.groupAllowFrom);
  const sectionAllow = asStringArray(section.groupAllowFrom);
  const groupAllowFrom = accountAllow.length > 0 ? accountAllow : sectionAllow;
  const groupEntry = resolveGroupEntry({ section, account, chatId: binding.chatId });
  const groupEnabled = asBoolean(groupEntry?.enabled) ?? true;
  const groupAllowed =
    groupPolicy === "open" ||
    groupAllowFrom.includes("*") ||
    groupAllowFrom.includes(binding.chatId) ||
    groupEntry !== undefined;
  checks.push({
    name: "feishu.groupAccess",
    status: groupPolicy === "disabled" || !groupEnabled || !groupAllowed ? "fail" : "ok",
    message:
      groupPolicy === "disabled"
        ? "群消息策略已禁用"
        : !groupEnabled
          ? `群 ${binding.chatId} 已禁用`
          : groupAllowed
            ? `群 ${binding.chatId} 已允许`
            : `群 ${binding.chatId} 不在 groupAllowFrom/groups 中`,
  });
  const requireMention =
    asBoolean(groupEntry?.requireMention) ??
    asBoolean(account?.requireMention) ??
    asBoolean(section.requireMention) ??
    true;
  checks.push({
    name: "feishu.requireMention",
    status: requireMention ? "warn" : "ok",
    message: requireMention
      ? "该群仍要求 @ 才进入 Agent；无 @ 静默归档可能无法触发"
      : "该群不要求 @，可测试无 @ 经营记录归档",
  });
  return checks;
}

function findChannelAccountSnapshot(params: {
  status: unknown;
  channel: string;
  accountId?: string;
}): Record<string, unknown> | undefined {
  const channelAccounts = asRecord(asRecord(params.status).channelAccounts);
  const accounts = asArray(channelAccounts[params.channel]).filter(
    (entry): entry is Record<string, unknown> => asRecord(entry) !== undefined,
  );
  if (accounts.length === 0) {
    return undefined;
  }
  if (!params.accountId) {
    return accounts[0];
  }
  return accounts.find((entry) => asString(entry.accountId) === params.accountId);
}

function checksFromChannelSnapshot(snapshot: Record<string, unknown> | undefined): DiagnoseCheck[] {
  if (!snapshot) {
    return [
      {
        name: "feishu.gatewayStatus",
        status: "warn",
        message: "Gateway channels.status 未返回该账号状态",
      },
    ];
  }
  const checks: DiagnoseCheck[] = [
    {
      name: "feishu.accountConfigured",
      status: asBoolean(snapshot.configured) === false ? "fail" : "ok",
      message: asBoolean(snapshot.configured) === false ? "渠道账号未配置完整" : "渠道账号配置完整",
    },
  ];
  if (typeof snapshot.running === "boolean") {
    checks.push({
      name: "feishu.running",
      status: snapshot.running ? "ok" : "warn",
      message: snapshot.running ? "飞书通道正在运行" : "飞书通道未运行",
    });
  }
  if (typeof snapshot.connected === "boolean") {
    checks.push({
      name: "feishu.connected",
      status: snapshot.connected ? "ok" : "warn",
      message: snapshot.connected ? "飞书长连接已连接" : "飞书长连接未连接",
    });
  }
  const probe = asRecord(snapshot.probe);
  if (Object.keys(probe).length > 0) {
    checks.push({
      name: "feishu.probe",
      status: asBoolean(probe.ok) === true ? "ok" : "fail",
      message:
        asBoolean(probe.ok) === true
          ? `API 探测成功${asString(probe.botOpenId) ? `，bot=${asString(probe.botOpenId)}` : ""}`
          : (asString(probe.error) ?? "API 探测失败"),
    });
  }
  if (typeof snapshot.lastInboundAt === "number") {
    checks.push({
      name: "feishu.inboundActivity",
      status: "ok",
      message: "已有入站消息记录",
    });
  } else {
    checks.push({
      name: "feishu.inboundActivity",
      status: "warn",
      message: "未看到入站消息记录；请在群里发一条测试经营记录",
    });
  }
  if (typeof snapshot.lastError === "string" && snapshot.lastError) {
    checks.push({
      name: "feishu.lastError",
      status: "warn",
      message: snapshot.lastError,
    });
  }
  return checks;
}

async function buildPermissionChecks(params: {
  api: OpenClawPluginApi;
  db: StoreReportDatabase;
  callGateway: GatewayCaller;
  options: Record<string, unknown>;
}): Promise<DiagnoseCheck[]> {
  const currentConfig = params.api.runtime.config?.loadConfig?.() ?? params.api.config;
  const channel = asString(params.options.channel) ?? "feishu";
  const accountId = asString(params.options.account);
  const chatId = asString(params.options.chat);
  const bindings = params.db.listBindings().filter((binding) => {
    if (binding.channel !== channel) {
      return false;
    }
    if (accountId && binding.accountId !== accountId) {
      return false;
    }
    return !(chatId && binding.chatId !== chatId);
  });
  const checks: DiagnoseCheck[] = [];
  if (bindings.length === 0) {
    checks.push({
      name: "storeReport.binding",
      status: "fail",
      message: `没有找到 ${channel}${chatId ? `/${chatId}` : ""} 的门店群绑定`,
    });
  }
  for (const binding of bindings) {
    checks.push(...checkFeishuConfigForBinding(currentConfig, binding));
  }

  let statusPayload: unknown;
  try {
    statusPayload = await params.callGateway("channels.status", params.options, {
      probe: true,
      timeoutMs: Number(asString(params.options.timeout) ?? 30_000),
    });
    checks.push({
      name: "gateway.channelsStatus",
      status: "ok",
      message: "channels.status 可访问",
    });
  } catch (err) {
    checks.push({
      name: "gateway.channelsStatus",
      status: "warn",
      message: `无法调用 channels.status：${err instanceof Error ? err.message : String(err)}`,
    });
  }
  if (statusPayload) {
    const targetAccountId =
      accountId ?? bindings[0]?.accountId ?? firstConfiguredFeishuAccountId(currentConfig);
    checks.push(
      ...checksFromChannelSnapshot(
        findChannelAccountSnapshot({
          status: statusPayload,
          channel,
          accountId: targetAccountId,
        }),
      ),
    );
  }

  if (asBoolean(params.options.sendTest) === true) {
    for (const binding of bindings) {
      try {
        const adapter = await params.api.runtime.channel.outbound.loadAdapter(
          binding.channel as RuntimeChannelId,
        );
        if (!adapter?.sendText) {
          checks.push({
            name: "feishu.sendText",
            status: "fail",
            message: `渠道 ${binding.channel} 不支持发送文本`,
          });
          continue;
        }
        await adapter.sendText({
          cfg: currentConfig,
          to: binding.chatId,
          accountId: binding.accountId,
          text: `门店日报助手权限检查：${new Date().toISOString()}`,
        });
        checks.push({
          name: "feishu.sendText",
          status: "ok",
          message: `已向 ${binding.chatId} 发送测试消息`,
        });
      } catch (err) {
        checks.push({
          name: "feishu.sendText",
          status: "fail",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } else {
    checks.push({
      name: "feishu.sendText",
      status: "warn",
      message: "未发送测试消息；如需验证发群权限，追加 --send-test",
    });
  }
  return checks;
}

function addStoreCommands(root: CommandLike, api: OpenClawPluginApi): void {
  const stores = root.command("stores").description("Manage store master data");
  stores
    .command("import")
    .description("Import store master data from CSV")
    .requiredOption("--file <path>", "CSV file with store_id,store_name,timezone")
    .action((opts: unknown) => {
      const options = asRecord(opts);
      const file = asString(options.file);
      if (!file) {
        throw new Error("--file is required");
      }
      const { db, config } = openCliDatabase(api);
      try {
        const imported = readStoresCsv(file, config.defaultTimezone);
        for (const store of imported) {
          db.upsertStore(store);
        }
        console.log(`已导入 ${imported.length} 个门店`);
      } finally {
        db.close();
      }
    });

  stores
    .command("list")
    .description("List store master data")
    .action(() => {
      const { db } = openCliDatabase(api);
      try {
        printJson(db.listStores());
      } finally {
        db.close();
      }
    });
}

function addBindingCommands(root: CommandLike, api: OpenClawPluginApi): void {
  const bindings = root.command("bindings").description("Manage store group bindings");
  bindings
    .command("list")
    .description("List store group bindings")
    .action(() => {
      const { db } = openCliDatabase(api);
      try {
        printJson(db.listBindings());
      } finally {
        db.close();
      }
    });

  bindings
    .command("add")
    .description("Bind a channel chat to a store")
    .requiredOption("--channel <id>", "Channel id, such as feishu")
    .option("--account <id>", "Channel account id")
    .requiredOption("--chat <id>", "Channel chat id")
    .requiredOption("--store <id>", "Store id")
    .option("--store-name <name>", "Store name")
    .option("--timezone <zone>", "Store timezone")
    .action((opts: unknown) => {
      const options = asRecord(opts);
      const channel = asString(options.channel);
      const chatId = asString(options.chat);
      const storeId = asString(options.store);
      if (!channel || !chatId || !storeId) {
        throw new Error("--channel, --chat, and --store are required");
      }
      const { db, config } = openCliDatabase(api);
      try {
        const storeName = asString(options.storeName);
        const existingStore = db.listStores().find((entry) => entry.storeId === storeId);
        if (!existingStore && !storeName) {
          throw new Error("门店不存在。请先导入 stores.csv，或在绑定时传 --store-name。");
        }
        if (storeName) {
          db.upsertStore({
            storeId,
            storeName,
            timezone: asString(options.timezone) ?? config.defaultTimezone,
            source: "manual",
            enabled: true,
          });
        }
        const binding: StoreBindingSeed = {
          channel,
          ...(asString(options.account) ? { accountId: asString(options.account) } : {}),
          chatId,
          chatType: "group",
          storeId,
          ...(storeName ? { storeName } : {}),
          timezone: asString(options.timezone) ?? config.defaultTimezone,
          enabled: true,
        };
        db.upsertBinding(binding);
        console.log(`已绑定 ${channel}/${chatId} -> ${storeId}`);
      } finally {
        db.close();
      }
    });
}

function addRecordCommands(root: CommandLike, api: OpenClawPluginApi): void {
  const records = root.command("records").description("Inspect archived store records");
  records
    .command("list")
    .description("List records for a store and date")
    .requiredOption("--store <id>", "Store id")
    .option("--date <yyyy-mm-dd>", "Business date")
    .action((opts: unknown) => {
      const options = asRecord(opts);
      const storeId = asString(options.store);
      if (!storeId) {
        throw new Error("--store is required");
      }
      const { db, config } = openCliDatabase(api);
      try {
        const date =
          asString(options.date) ?? formatBusinessDate(new Date(), config.defaultTimezone);
        printJson(db.listRecordsByDate(storeId, date));
      } finally {
        db.close();
      }
    });

  records
    .command("export")
    .description("Export records for a store and date")
    .requiredOption("--store <id>", "Store id")
    .option("--date <yyyy-mm-dd>", "Business date")
    .option("--format <jsonl|json>", "Export format", "jsonl")
    .option("--file <path>", "Write export to a file instead of stdout")
    .option("--redact", "Redact message ids, chat ids, sender ids, and common PII")
    .option(
      "--include-sensitive",
      "Export original sensitive fields even when config redacts by default",
    )
    .action((opts: unknown) => {
      const options = asRecord(opts);
      const storeId = asString(options.store);
      if (!storeId) {
        throw new Error("--store is required");
      }
      const { db, config } = openCliDatabase(api);
      try {
        const date =
          asString(options.date) ?? formatBusinessDate(new Date(), config.defaultTimezone);
        const redact =
          asBoolean(options.includeSensitive) === true
            ? false
            : (asBoolean(options.redact) ?? config.privacy.redactExportsByDefault);
        const exported = formatRecordsForExport(
          db.listRecordsByDate(storeId, date),
          asString(options.format) ?? "jsonl",
          redact,
        );
        writeTextOutput(exported, asString(options.file));
      } finally {
        db.close();
      }
    });
}

function addCleanupCommand(root: CommandLike, api: OpenClawPluginApi): void {
  root
    .command("cleanup")
    .description("Clean up archived records and generated reports by retention policy")
    .option("--before-date <yyyy-mm-dd>", "Delete chat records and reports before this date")
    .option("--records-days <days>", "Override chat record retention days")
    .option("--reports-days <days>", "Override report retention days")
    .option("--pending-days <days>", "Override pending confirmation retention days")
    .option("--dry-run", "Only show what would be deleted")
    .option("--yes", "Apply deletion; without this flag cleanup runs as a dry run")
    .action((opts: unknown) => {
      const options = asRecord(opts);
      const { db, config } = openCliDatabase(api);
      try {
        const recordDays =
          asPositiveInteger(options.recordsDays) ?? config.privacy.retention.chatRecordsDays;
        const reportDays =
          asPositiveInteger(options.reportsDays) ?? config.privacy.retention.reportsDays;
        const pendingDays =
          asPositiveInteger(options.pendingDays) ??
          config.privacy.retention.pendingConfirmationsDays;
        const explicitBeforeDate = asString(options.beforeDate);
        const dryRun = asBoolean(options.dryRun) === true || asBoolean(options.yes) !== true;
        const result = db.cleanup({
          dryRun,
          recordBeforeDate: explicitBeforeDate ?? dateDaysAgo(recordDays, config.defaultTimezone),
          reportBeforeDate: explicitBeforeDate ?? dateDaysAgo(reportDays, config.defaultTimezone),
          pendingBeforeIso: isoDaysAgo(pendingDays),
          nowIso: isoTimestampFromMillis(Date.now()),
        });
        printJson({
          ok: true,
          applied: !dryRun,
          retention: {
            chatRecordsDays: recordDays,
            reportsDays: reportDays,
            pendingConfirmationsDays: pendingDays,
          },
          ...result,
          nextSteps: dryRun ? ["确认结果无误后追加 --yes 执行清理。"] : [],
        });
      } finally {
        db.close();
      }
    });
}

function addReportCommands(root: CommandLike, api: OpenClawPluginApi): void {
  const report = root.command("report").description("Generate store reports");
  report
    .command("generate")
    .description("Generate a daily or weekly report")
    .requiredOption("--store <id>", "Store id")
    .option("--date <yyyy-mm-dd>", "Business date for a daily report")
    .option("--week <yyyy-mm-dd>", "Any date in the target ISO week")
    .action((opts: unknown) => {
      const options = asRecord(opts);
      const storeId = asString(options.store);
      if (!storeId) {
        throw new Error("--store is required");
      }
      const { db, config } = openCliDatabase(api);
      try {
        console.log(
          generateAndSaveCliReport({
            db,
            config,
            storeId,
            options,
            generatedBy: "cli",
          }).reportText,
        );
      } finally {
        db.close();
      }
    });

  report
    .command("send")
    .description("Generate and send a daily or weekly report to bound store groups")
    .requiredOption("--store <id>", "Store id")
    .option("--date <yyyy-mm-dd>", "Business date for a daily report")
    .option("--week <yyyy-mm-dd>", "Any date in the target ISO week")
    .option("--channel <id>", "Only send through this channel")
    .option("--account <id>", "Only send through this account id")
    .option("--chat <id>", "Only send to this chat id")
    .action(async (opts: unknown) => {
      const options = asRecord(opts);
      const storeId = asString(options.store);
      if (!storeId) {
        throw new Error("--store is required");
      }
      const { db, config } = openCliDatabase(api);
      try {
        const bindings = resolveTargetBindings({ db, storeId, options });
        let sent = 0;
        for (const binding of bindings) {
          const generated = generateAndSaveCliReport({
            db,
            config,
            storeId,
            options,
            generatedBy: "cli-send",
            binding,
          });
          await sendReportToBinding({ api, binding, report: generated });
          sent += 1;
        }
        console.log(`已发送 ${sent} 个群`);
      } finally {
        db.close();
      }
    });
}

function addCronCommands(
  root: CommandLike,
  api: OpenClawPluginApi,
  callGateway: GatewayCaller,
): void {
  const cron = root.command("cron").description("Install store report cron jobs");
  cron
    .command("install")
    .description("Create or update automatic daily and weekly report cron jobs")
    .requiredOption("--store <id>", "Store id")
    .option("--channel <id>", "Only install jobs for this channel")
    .option("--account <id>", "Only install jobs for this account id")
    .option("--chat <id>", "Only install jobs for this chat id")
    .option("--only <daily|weekly|both>", "Which report jobs to install", "both")
    .option("--daily-time <HH:mm>", "Daily report time")
    .option("--weekly-day <SUN|MON|TUE|WED|THU|FRI|SAT>", "Weekly report day")
    .option("--weekly-time <HH:mm>", "Weekly report time")
    .option("--weekly-period <previous|current>", "Weekly report period", "previous")
    .option("--timezone <iana>", "Cron timezone")
    .option("--agent <id>", "Agent id for cron execution")
    .option("--disabled", "Create or update cron jobs as disabled")
    .option("--url <url>", "Gateway WebSocket URL")
    .option("--token <token>", "Gateway token")
    .option("--timeout <ms>", "Gateway timeout in ms", "30000")
    .action(async (opts: unknown) => {
      const options = asRecord(opts);
      const storeId = asString(options.store);
      if (!storeId) {
        throw new Error("--store is required");
      }
      const { db, config } = openCliDatabase(api);
      try {
        const bindings = resolveTargetBindings({ db, storeId, options });
        const reportTypes = resolveCronReportTypes(options.only);
        const results: Array<{ action: "created" | "updated"; id?: string; name: string }> = [];
        for (const binding of bindings) {
          for (const reportType of reportTypes) {
            const job = buildStoreReportCronJobParams({
              binding,
              reportType,
              config,
              options,
            });
            results.push(await upsertCronJob({ callGateway, options, job }));
          }
        }
        printJson({
          ok: true,
          jobs: results,
          nextSteps: [
            "运行 openclaw cron list 查看任务。",
            "运行 openclaw cron run <job-id> 手动触发验收。",
            "运行 openclaw cron runs --id <job-id> 查看发送结果。",
          ],
        });
      } finally {
        db.close();
      }
    });
}

function addSetupCommand(
  root: CommandLike,
  api: OpenClawPluginApi,
  callGateway: GatewayCaller,
  prompt: PromptFn,
): void {
  root
    .command("setup")
    .description("Initialize store report assistant with one store and one chat binding")
    .option("--interactive", "Prompt for store, chat, and report schedule")
    .option("--channel <id>", "Channel id, such as feishu")
    .option("--account <id>", "Channel account id")
    .option("--chat <id>", "Channel chat id")
    .option("--store <id>", "Store id")
    .option("--store-name <name>", "Store name")
    .option("--timezone <zone>", "Store timezone")
    .option("--install-cron", "Create or update daily and weekly cron jobs")
    .option("--only <daily|weekly|both>", "Which cron jobs to install", "both")
    .option("--daily-time <HH:mm>", "Daily report time")
    .option("--weekly-day <SUN|MON|TUE|WED|THU|FRI|SAT>", "Weekly report day")
    .option("--weekly-time <HH:mm>", "Weekly report time")
    .option("--weekly-period <previous|current>", "Weekly report period", "previous")
    .option("--url <url>", "Gateway WebSocket URL for cron install")
    .option("--token <token>", "Gateway token for cron install")
    .option("--timeout <ms>", "Gateway timeout in ms", "30000")
    .action(async (opts: unknown) => {
      const initialOptions = asRecord(opts);
      const { db, config } = openCliDatabase(api);
      try {
        const options =
          asBoolean(initialOptions.interactive) === true
            ? await collectInteractiveSetupOptions({
                options: initialOptions,
                db,
                config,
                currentConfig: api.runtime.config?.loadConfig?.() ?? api.config,
                prompt,
              })
            : initialOptions;
        const channel = asString(options.channel);
        const chatId = asString(options.chat);
        const storeId = asString(options.store);
        const storeName = asString(options.storeName);
        if (!channel || !chatId || !storeId || !storeName) {
          throw new Error(
            "--channel, --chat, --store, and --store-name are required unless --interactive is used",
          );
        }
        const timezone = asString(options.timezone) ?? config.defaultTimezone;
        db.upsertStore({
          storeId,
          storeName,
          timezone,
          source: "manual",
          enabled: true,
        });
        db.upsertBinding({
          channel,
          ...(asString(options.account) ? { accountId: asString(options.account) } : {}),
          chatId,
          chatType: "group",
          storeId,
          storeName,
          timezone,
          enabled: true,
        });
        const cronResults: Array<{ action: "created" | "updated"; id?: string; name: string }> = [];
        if (asBoolean(options.installCron) === true) {
          const [binding] = resolveTargetBindings({
            db,
            storeId,
            options: {
              channel,
              ...(asString(options.account) ? { account: asString(options.account) } : {}),
              chat: chatId,
            },
          });
          for (const reportType of resolveCronReportTypes(options.only)) {
            cronResults.push(
              await upsertCronJob({
                callGateway,
                options,
                job: buildStoreReportCronJobParams({
                  binding,
                  reportType,
                  config,
                  options,
                }),
              }),
            );
          }
        }
        printJson({
          ok: true,
          databasePath: db.dbPath,
          storeId,
          storeName,
          channel,
          accountId: asString(options.account),
          chatId,
          cronJobs: cronResults,
          nextSteps: [
            "重启 Gateway 让运行时加载最新插件。",
            "在群里发送一条经营记录。",
            `运行 openclaw store-report records list --store ${storeId} 检查归档。`,
            "运行 openclaw store-report diagnose --permissions 检查飞书配置和运行状态。",
            "在群里发送“生成今日门店日报”测试报告。",
          ],
        });
      } finally {
        db.close();
      }
    });
}

function addDiagnoseCommand(
  root: CommandLike,
  api: OpenClawPluginApi,
  callGateway: GatewayCaller,
): void {
  root
    .command("diagnose")
    .description("Diagnose store report assistant setup")
    .option("--permissions", "Run channel permission and delivery checks")
    .option("--voice", "Include voice/STT checks")
    .option("--channel <id>", "Only diagnose this channel", "feishu")
    .option("--account <id>", "Only diagnose this account id")
    .option("--chat <id>", "Only diagnose this chat id")
    .option("--send-test", "Send a short test message to bound chats")
    .option("--url <url>", "Gateway WebSocket URL")
    .option("--token <token>", "Gateway token")
    .option("--timeout <ms>", "Gateway timeout in ms", "30000")
    .action(async (opts: unknown) => {
      const options = asRecord(opts);
      const { db, config } = openCliDatabase(api);
      try {
        const checks = buildDiagnoseChecks({ db, config });
        if (asBoolean(options.permissions) === true) {
          checks.push(...(await buildPermissionChecks({ api, db, callGateway, options })));
        }
        const hasFailures = checks.some((check) => check.status === "fail");
        const hasWarnings = checks.some((check) => check.status === "warn");
        printJson({
          ok: !hasFailures,
          status: hasFailures ? "fail" : hasWarnings ? "warn" : "ok",
          databasePath: db.dbPath,
          stores: db.listStores().length,
          bindings: db.listBindings().length,
          permissionsChecked: asBoolean(options.permissions) === true,
          checks,
        });
      } finally {
        db.close();
      }
    });
}

export function registerStoreReportCli({
  program,
  api,
  callGateway = callGatewayFromCli,
  prompt = defaultPrompt,
}: RegisterStoreReportCliParams): void {
  const root = program.command("store-report").description("Manage store daily and weekly reports");
  root
    .command("status")
    .description("Show store report assistant status")
    .action(() => {
      const { db, config } = openCliDatabase(api);
      try {
        printJson({
          plugin: "enabled",
          databasePath: db.dbPath,
          stores: db.listStores().length,
          bindings: db.listBindings().length,
          dailyTime: config.reports.dailyTime,
          weeklyDay: config.reports.weeklyDay,
          weeklyTime: config.reports.weeklyTime,
          retention: config.privacy.retention,
          storeRawText: config.privacy.storeRawText,
          redactExportsByDefault: config.privacy.redactExportsByDefault,
          voice: buildVoiceStatus(config),
        });
      } finally {
        db.close();
      }
    });
  addSetupCommand(root, api, callGateway, prompt);
  addDiagnoseCommand(root, api, callGateway);
  addStoreCommands(root, api);
  addBindingCommands(root, api);
  addRecordCommands(root, api);
  addReportCommands(root, api);
  addCronCommands(root, api, callGateway);
  addCleanupCommand(root, api);
}
