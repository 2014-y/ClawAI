import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerStoreReportCli } from "./cli.js";
import { encodeStoreReportCronMessage, parseStoreReportCronMessage } from "./cron.js";
import { StoreReportDatabase } from "./db.js";

type Action = (...args: unknown[]) => unknown;

class TestCommand {
  readonly children = new Map<string, TestCommand>();
  actionFn: Action | undefined;

  command(name: string): TestCommand {
    const command = new TestCommand();
    this.children.set(name, command);
    return command;
  }

  description(): this {
    return this;
  }

  option(): this {
    return this;
  }

  requiredOption(): this {
    return this;
  }

  action(fn: Action): this {
    this.actionFn = fn;
    return this;
  }

  get(...pathParts: string[]): TestCommand {
    const [part, ...rest] = pathParts;
    if (!part) {
      return this;
    }
    const next = this.children.get(part);
    if (!next) {
      throw new Error(`Missing command ${pathParts.join(" ")}`);
    }
    return next.get(...rest);
  }
}

function makeApi(workspaceDir: string, sendText = vi.fn()): OpenClawPluginApi {
  const config = {
    agents: {
      defaults: {
        workspace: workspaceDir,
      },
    },
    channels: {
      feishu: {
        enabled: true,
        groupPolicy: "open",
        requireMention: false,
        accounts: {
          main: {
            appId: "cli_test",
            appSecret: "secret_test",
            groupPolicy: "open",
            requireMention: false,
          },
        },
      },
    },
    plugins: {
      entries: {
        "store-report-assistant": {
          enabled: true,
          config: {
            database: {
              path: "data/store_report/store_report.sqlite",
            },
            defaultTimezone: "Asia/Shanghai",
            stores: [
              {
                storeId: "TEST-001",
                storeName: "测试门店",
                timezone: "Asia/Shanghai",
              },
            ],
            bindings: [
              {
                channel: "feishu",
                accountId: "main",
                chatId: "oc_test",
                chatType: "group",
                storeId: "TEST-001",
                storeName: "测试门店",
                enabled: true,
              },
            ],
          },
        },
      },
    },
  };
  return {
    config,
    pluginConfig: config.plugins.entries["store-report-assistant"].config,
    runtime: {
      config: {
        loadConfig: () => config,
      },
      channel: {
        outbound: {
          loadAdapter: async () => ({ sendText }),
        },
      },
    },
    resolvePath: (input: string) => path.resolve(workspaceDir, input),
  } as unknown as OpenClawPluginApi;
}

function seedSalesRecord(workspaceDir: string): void {
  const db = new StoreReportDatabase(
    path.join(workspaceDir, "data/store_report/store_report.sqlite"),
  );
  try {
    db.seedConfig({
      databasePath: "data/store_report/store_report.sqlite",
      defaultTimezone: "Asia/Shanghai",
      archive: {
        silentBusinessRecords: true,
        ignoreNonBusiness: true,
        dedupeByMessageId: true,
      },
      reports: {
        dailyTime: "21:30",
        weeklyDay: "MON",
        weeklyTime: "09:30",
      },
      voice: {
        enabled: true,
        transcriptSource: "auto",
        minConfidence: 0.8,
        confirmationTtlMinutes: 240,
        requireConfirmationWhenConfidenceMissing: true,
        download: {
          maxMb: 30,
        },
        stt: {
          mode: "disabled",
          timeoutSeconds: 180,
          headers: {},
          responseTextPath: "text",
          backend: "whisper-cpp",
          language: "zh",
        },
      },
      privacy: {
        storeRawText: false,
        redactExportsByDefault: false,
        retention: {
          chatRecordsDays: 180,
          reportsDays: 365,
          pendingConfirmationsDays: 7,
        },
      },
      stores: [
        {
          storeId: "TEST-001",
          storeName: "测试门店",
          timezone: "Asia/Shanghai",
          source: "manual",
          enabled: true,
        },
      ],
      bindings: [
        {
          channel: "feishu",
          accountId: "main",
          chatId: "oc_test",
          chatType: "group",
          storeId: "TEST-001",
          storeName: "测试门店",
          timezone: "Asia/Shanghai",
          enabled: true,
        },
      ],
    });
    db.archiveRecord({
      messageId: "om_sales",
      channel: "feishu",
      accountId: "main",
      chatId: "oc_test",
      chatType: "group",
      senderId: "ou_1",
      storeId: "TEST-001",
      businessDate: "2026-05-09",
      sentAt: "2026-05-09T12:00:00.000Z",
      sourceType: "text",
      rawText: "今天成交2单，销售额200元",
      normalizedText: "今天成交2单，销售额200元",
      recordType: "sales",
      structured: {
        transactionCount: 2,
        salesAmount: 200,
      },
      confidence: 0.92,
      confirmed: true,
      needsConfirmation: false,
    });
  } finally {
    db.close();
  }
}

describe("store report cli", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exports records as jsonl", async () => {
    const workspaceDir = mkdtempSync(path.join(tmpdir(), "store-report-cli-"));
    tempDirs.push(workspaceDir);
    seedSalesRecord(workspaceDir);
    const program = new TestCommand();
    registerStoreReportCli({ program, api: makeApi(workspaceDir) });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await program.get("store-report", "records", "export").actionFn?.({
      store: "TEST-001",
      date: "2026-05-09",
      format: "jsonl",
    });

    expect(log).toHaveBeenCalledWith(expect.stringContaining("今天成交2单，销售额200元"));
  });

  it("can redact exported records", async () => {
    const workspaceDir = mkdtempSync(path.join(tmpdir(), "store-report-cli-"));
    tempDirs.push(workspaceDir);
    seedSalesRecord(workspaceDir);
    const program = new TestCommand();
    registerStoreReportCli({ program, api: makeApi(workspaceDir) });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await program.get("store-report", "records", "export").actionFn?.({
      store: "TEST-001",
      date: "2026-05-09",
      format: "json",
      redact: true,
    });

    const payload = JSON.parse(String(log.mock.calls[0]?.[0])) as Array<{
      messageId?: string;
      chatId?: string;
      senderId?: string;
      normalizedText?: string;
    }>;
    expect(payload[0]).toMatchObject({
      messageId: expect.stringMatching(/^redacted:/u),
      chatId: expect.stringMatching(/^redacted:/u),
      senderId: expect.stringMatching(/^redacted:/u),
      normalizedText: "今天成交2单，销售额200元",
    });
  });

  it("cleans up old records only after confirmation", async () => {
    const workspaceDir = mkdtempSync(path.join(tmpdir(), "store-report-cli-"));
    tempDirs.push(workspaceDir);
    seedSalesRecord(workspaceDir);
    const db = new StoreReportDatabase(
      path.join(workspaceDir, "data/store_report/store_report.sqlite"),
    );
    try {
      db.archiveRecord({
        messageId: "om_old",
        channel: "feishu",
        accountId: "main",
        chatId: "oc_test",
        chatType: "group",
        senderId: "ou_1",
        storeId: "TEST-001",
        businessDate: "2026-01-01",
        sentAt: "2026-01-01T12:00:00.000Z",
        sourceType: "text",
        rawText: "今天成交1单，销售额100元",
        normalizedText: "今天成交1单，销售额100元",
        recordType: "sales",
        structured: {
          transactionCount: 1,
          salesAmount: 100,
        },
        confidence: 0.92,
        confirmed: true,
        needsConfirmation: false,
      });
    } finally {
      db.close();
    }
    const program = new TestCommand();
    registerStoreReportCli({ program, api: makeApi(workspaceDir) });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await program.get("store-report", "cleanup").actionFn?.({
      beforeDate: "2026-05-01",
    });
    const dryRun = JSON.parse(String(log.mock.calls[0]?.[0])) as {
      applied?: boolean;
      deleted?: { chatRecords?: number };
    };
    expect(dryRun.applied).toBe(false);
    expect(dryRun.deleted?.chatRecords).toBe(1);

    await program.get("store-report", "cleanup").actionFn?.({
      beforeDate: "2026-05-01",
      yes: true,
    });
    const applied = JSON.parse(String(log.mock.calls[1]?.[0])) as {
      applied?: boolean;
      deleted?: { chatRecords?: number };
    };
    expect(applied.applied).toBe(true);
    expect(applied.deleted?.chatRecords).toBe(1);
  });

  it("generates and sends reports to the bound chat", async () => {
    const workspaceDir = mkdtempSync(path.join(tmpdir(), "store-report-cli-"));
    tempDirs.push(workspaceDir);
    seedSalesRecord(workspaceDir);
    const sendText = vi.fn();
    const program = new TestCommand();
    registerStoreReportCli({ program, api: makeApi(workspaceDir, sendText) });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await program.get("store-report", "report", "send").actionFn?.({
      store: "TEST-001",
      date: "2026-05-09",
      channel: "feishu",
      account: "main",
      chat: "oc_test",
    });

    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "oc_test",
        accountId: "main",
        text: expect.stringContaining("成交/销售额：2 单，200 元"),
      }),
    );
  });

  it("installs daily cron jobs for the bound chat", async () => {
    const workspaceDir = mkdtempSync(path.join(tmpdir(), "store-report-cli-"));
    tempDirs.push(workspaceDir);
    seedSalesRecord(workspaceDir);
    const callGateway = vi.fn(async (method: string, _options: unknown, params: unknown) => {
      if (method === "cron.list") {
        return { jobs: [] };
      }
      if (method === "cron.add") {
        return { id: "cron_daily_1", params };
      }
      throw new Error(`unexpected gateway method ${method}`);
    });
    const program = new TestCommand();
    registerStoreReportCli({ program, api: makeApi(workspaceDir), callGateway });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await program.get("store-report", "cron", "install").actionFn?.({
      store: "TEST-001",
      channel: "feishu",
      account: "main",
      chat: "oc_test",
      only: "daily",
      dailyTime: "21:45",
      timezone: "Asia/Shanghai",
    });

    const addCall = callGateway.mock.calls.find(([method]) => method === "cron.add");
    expect(addCall).toBeDefined();
    const params = addCall?.[2] as Record<string, unknown>;
    expect(params).toMatchObject({
      name: "store-report:daily:TEST-001:feishu:oc_test",
      schedule: {
        kind: "cron",
        expr: "45 21 * * *",
        tz: "Asia/Shanghai",
      },
      sessionTarget: "isolated",
      delivery: {
        mode: "announce",
        channel: "feishu",
        accountId: "main",
        to: "oc_test",
      },
    });
    const payload = params.payload as { message?: string };
    expect(parseStoreReportCronMessage(payload.message ?? "")).toMatchObject({
      action: "send_report",
      reportType: "daily",
      storeId: "TEST-001",
      channel: "feishu",
      accountId: "main",
      chatId: "oc_test",
    });
  });

  it("runs interactive setup and installs report cron jobs", async () => {
    const workspaceDir = mkdtempSync(path.join(tmpdir(), "store-report-cli-"));
    tempDirs.push(workspaceDir);
    const callGateway = vi.fn(async (method: string, _options: unknown, params: unknown) => {
      if (method === "cron.list") {
        return { jobs: [] };
      }
      if (method === "cron.add") {
        return { id: `cron_${(params as { name?: string }).name ?? "job"}`, params };
      }
      throw new Error(`unexpected gateway method ${method}`);
    });
    const answers = [
      "feishu",
      "main",
      "oc_interactive",
      "NEW-001",
      "新门店",
      "Asia/Shanghai",
      "20:30",
      "SUN",
      "10:00",
      "Y",
    ];
    const prompt = vi.fn(async () => answers.shift() ?? "");
    const program = new TestCommand();
    registerStoreReportCli({ program, api: makeApi(workspaceDir), callGateway, prompt });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await program.get("store-report", "setup").actionFn?.({
      interactive: true,
    });

    const db = new StoreReportDatabase(
      path.join(workspaceDir, "data/store_report/store_report.sqlite"),
    );
    try {
      expect(db.listStores()).toEqual(
        expect.arrayContaining([expect.objectContaining({ storeId: "NEW-001" })]),
      );
      expect(db.listBindings()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            channel: "feishu",
            accountId: "main",
            chatId: "oc_interactive",
            storeId: "NEW-001",
          }),
        ]),
      );
    } finally {
      db.close();
    }
    expect(callGateway.mock.calls.filter(([method]) => method === "cron.add")).toHaveLength(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"cronJobs"'));
  });

  it("diagnoses Feishu permissions and can send a test message", async () => {
    const workspaceDir = mkdtempSync(path.join(tmpdir(), "store-report-cli-"));
    tempDirs.push(workspaceDir);
    seedSalesRecord(workspaceDir);
    const sendText = vi.fn(async () => ({ ok: true, messageId: "om_test" }));
    const callGateway = vi.fn(async (method: string) => {
      if (method === "channels.status") {
        return {
          channelAccounts: {
            feishu: [
              {
                accountId: "main",
                configured: true,
                running: true,
                connected: true,
                lastInboundAt: Date.now(),
                probe: {
                  ok: true,
                  botOpenId: "ou_bot",
                },
              },
            ],
          },
        };
      }
      throw new Error(`unexpected gateway method ${method}`);
    });
    const program = new TestCommand();
    registerStoreReportCli({ program, api: makeApi(workspaceDir, sendText), callGateway });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await program.get("store-report", "diagnose").actionFn?.({
      permissions: true,
      channel: "feishu",
      account: "main",
      chat: "oc_test",
      sendTest: true,
      timeout: "30000",
    });

    expect(callGateway).toHaveBeenCalledWith(
      "channels.status",
      expect.any(Object),
      expect.objectContaining({ probe: true }),
    );
    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "oc_test",
        accountId: "main",
        text: expect.stringContaining("门店日报助手权限检查"),
      }),
    );
    const payload = JSON.parse(String(log.mock.calls[0]?.[0])) as {
      permissionsChecked?: boolean;
      checks?: Array<{ name: string; status: string }>;
    };
    expect(payload.permissionsChecked).toBe(true);
    expect(payload.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "feishu.probe", status: "ok" }),
        expect.objectContaining({ name: "feishu.sendText", status: "ok" }),
      ]),
    );
  });

  it("parses cron messages after the runtime cron prefix and appended instructions", () => {
    const encoded = encodeStoreReportCronMessage({
      version: 1,
      action: "send_report",
      reportType: "daily",
      storeId: "TEST-001",
      channel: "feishu",
      accountId: "main",
      chatId: "oc_test",
    });

    expect(
      parseStoreReportCronMessage(
        `[cron:job-1 store-report:daily:TEST-001:feishu:oc_test] ${encoded}\n当前时间：2026-05-10 21:30`,
      ),
    ).toMatchObject({
      action: "send_report",
      reportType: "daily",
      storeId: "TEST-001",
      chatId: "oc_test",
    });
  });
});
