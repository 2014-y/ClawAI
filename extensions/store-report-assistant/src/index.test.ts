import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "../index.js";
import { encodeStoreReportCronMessage } from "./cron.js";

type CapturedHook = (
  event: Record<string, unknown>,
  ctx: Record<string, unknown>,
) => Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;

const originalFetch = globalThis.fetch;

function makeApi(
  workspaceDir: string,
  extraPluginConfig: Record<string, unknown> = {},
): {
  api: OpenClawPluginApi;
  hooks: Map<string, CapturedHook>;
  sentTexts: Array<Record<string, unknown>>;
} {
  const hooks = new Map<string, CapturedHook>();
  const sentTexts: Array<Record<string, unknown>> = [];
  const pluginConfig = {
    database: {
      path: "data/store_report/store_report.sqlite",
    },
    defaultTimezone: "Asia/Shanghai",
    archive: {
      silentBusinessRecords: true,
      ignoreNonBusiness: true,
      dedupeByMessageId: true,
    },
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
    ...extraPluginConfig,
  };
  const config = {
    agents: {
      defaults: {
        workspace: workspaceDir,
      },
    },
    channels: {
      feishu: {
        enabled: true,
        accounts: {
          main: {
            appId: "cli_test",
            appSecret: "secret_test",
          },
        },
      },
    },
    plugins: {
      entries: {
        "store-report-assistant": {
          enabled: true,
          config: pluginConfig,
        },
      },
    },
  };

  return {
    hooks,
    api: {
      config,
      pluginConfig: config.plugins.entries["store-report-assistant"].config,
      runtime: {
        config: {
          loadConfig: () => config,
        },
        channel: {
          outbound: {
            loadAdapter: async () => ({
              sendText: async (payload: Record<string, unknown>) => {
                sentTexts.push(payload);
                return { ok: true };
              },
            }),
          },
        },
      },
      resolvePath: (input: string) => path.resolve(workspaceDir, input),
      on: (hookName: string, handler: CapturedHook) => {
        hooks.set(hookName, handler);
      },
      registerCli: () => {},
      logger: {
        info: () => {},
        warn: () => {},
      },
    } as unknown as OpenClawPluginApi,
    sentTexts,
  };
}

describe("store report plugin hooks", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("archives bound group records before dispatch and generates reports from sqlite", async () => {
    const workspaceDir = mkdtempSync(path.join(tmpdir(), "store-report-plugin-"));
    tempDirs.push(workspaceDir);
    const { api, hooks } = makeApi(workspaceDir);

    plugin.register(api);
    const messageReceived = hooks.get("message_received");
    const beforeDispatch = hooks.get("before_dispatch");
    expect(messageReceived).toBeDefined();
    expect(beforeDispatch).toBeDefined();

    const ctx = {
      channelId: "feishu",
      accountId: "main",
      conversationId: "oc_test",
      messageId: "om_test_sales",
      senderId: "ou_store_manager",
    };

    await expect(
      messageReceived?.(
        {
          content: "今天成交28单，销售额23600",
          channel: "feishu",
          isGroup: true,
          messageId: "om_test_sales",
          senderId: "ou_store_manager",
          timestamp: Date.UTC(2026, 4, 9, 12, 0, 0),
        },
        ctx,
      ),
    ).resolves.toBeUndefined();

    await expect(
      beforeDispatch?.(
        {
          content: "生成今日门店日报",
          channel: "feishu",
          isGroup: true,
          senderId: "ou_store_manager",
          timestamp: Date.UTC(2026, 4, 9, 12, 1, 0),
        },
        ctx,
      ),
    ).resolves.toMatchObject({
      handled: true,
      text: expect.stringContaining("成交/销售额：28 单，23600 元"),
    });
  });

  it("uses the message timestamp as the business date when archiving records", async () => {
    const workspaceDir = mkdtempSync(path.join(tmpdir(), "store-report-plugin-"));
    tempDirs.push(workspaceDir);
    const { api, hooks } = makeApi(workspaceDir);

    plugin.register(api);
    const messageReceived = hooks.get("message_received");

    await messageReceived?.(
      {
        content: "今天成交28单，销售额23600",
        channel: "feishu",
        isGroup: true,
        messageId: "om_timestamp_sales",
        senderId: "ou_store_manager",
        timestamp: Date.UTC(2026, 4, 9, 10, 40, 17),
      },
      {
        channelId: "feishu",
        accountId: "main",
        conversationId: "oc_test",
        messageId: "om_timestamp_sales",
        senderId: "ou_store_manager",
      },
    );

    const beforeDispatch = hooks.get("before_dispatch");
    await expect(
      beforeDispatch?.(
        {
          content: "生成今日门店日报",
          channel: "feishu",
          isGroup: true,
          senderId: "ou_store_manager",
          timestamp: Date.UTC(2026, 4, 10, 12, 0, 0),
        },
        {
          channelId: "feishu",
          accountId: "main",
          conversationId: "oc_test",
          senderId: "ou_store_manager",
        },
      ),
    ).resolves.toMatchObject({
      handled: true,
      text: expect.stringContaining("来源记录：0 条已确认记录"),
    });

    await expect(
      beforeDispatch?.(
        {
          content: "生成今日门店日报",
          channel: "feishu",
          isGroup: true,
          senderId: "ou_store_manager",
          timestamp: Date.UTC(2026, 4, 9, 12, 0, 0),
        },
        {
          channelId: "feishu",
          accountId: "main",
          conversationId: "oc_test",
          senderId: "ou_store_manager",
        },
      ),
    ).resolves.toMatchObject({
      handled: true,
      text: expect.stringContaining("成交/销售额：28 单，23600 元"),
    });
  });

  it("claims store report cron prompts before the agent runs", async () => {
    const workspaceDir = mkdtempSync(path.join(tmpdir(), "store-report-plugin-"));
    tempDirs.push(workspaceDir);
    const { api, hooks } = makeApi(workspaceDir);

    plugin.register(api);
    const messageReceived = hooks.get("message_received");
    const beforeAgentReply = hooks.get("before_agent_reply");
    expect(beforeAgentReply).toBeDefined();

    const ctx = {
      channelId: "feishu",
      accountId: "main",
      conversationId: "oc_test",
      messageId: "om_test_sales",
      senderId: "ou_store_manager",
    };

    await messageReceived?.(
      {
        content: "今天成交28单，销售额23600",
        channel: "feishu",
        isGroup: true,
        messageId: "om_test_sales",
        senderId: "ou_store_manager",
      },
      ctx,
    );

    const result = beforeAgentReply?.(
      {
        cleanedBody: encodeStoreReportCronMessage({
          version: 1,
          action: "send_report",
          reportType: "daily",
          storeId: "TEST-001",
          channel: "feishu",
          accountId: "main",
          chatId: "oc_test",
          timezone: "Asia/Shanghai",
        }),
      },
      {
        trigger: "cron",
        jobId: "job_store_report_daily",
      },
    );
    expect(result).toMatchObject({
      handled: true,
      reply: {
        text: expect.stringContaining("成交/销售额：28 单，23600 元"),
      },
    });
  });

  it("does not swallow non-business messages in bound groups", async () => {
    const workspaceDir = mkdtempSync(path.join(tmpdir(), "store-report-plugin-"));
    tempDirs.push(workspaceDir);
    const { api, hooks } = makeApi(workspaceDir);

    plugin.register(api);
    const beforeDispatch = hooks.get("before_dispatch");

    await expect(
      beforeDispatch?.(
        {
          content: "天气怎么样",
          channel: "feishu",
          isGroup: true,
          senderId: "ou_store_manager",
          timestamp: Date.UTC(2026, 4, 9, 12, 2, 0),
        },
        {
          channelId: "feishu",
          accountId: "main",
          conversationId: "oc_test",
          senderId: "ou_store_manager",
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("keeps report requests owned by before_dispatch to avoid duplicate replies", async () => {
    const workspaceDir = mkdtempSync(path.join(tmpdir(), "store-report-plugin-"));
    tempDirs.push(workspaceDir);
    const { api, hooks, sentTexts } = makeApi(workspaceDir);

    plugin.register(api);
    const messageReceived = hooks.get("message_received");
    const beforeDispatch = hooks.get("before_dispatch");
    const ctx = {
      channelId: "feishu",
      accountId: "main",
      conversationId: "oc_test",
      senderId: "ou_store_manager",
    };

    await messageReceived?.(
      {
        content: "今天成交1单，销售额200元",
        channel: "feishu",
        isGroup: true,
        messageId: "om_report_record",
        senderId: "ou_store_manager",
        timestamp: Date.UTC(2026, 4, 9, 12, 0, 0),
      },
      ctx,
    );
    await messageReceived?.(
      {
        content: "生成今日门店日报",
        channel: "feishu",
        isGroup: true,
        messageId: "om_report_request_received",
        senderId: "ou_store_manager",
        timestamp: Date.UTC(2026, 4, 9, 12, 1, 0),
      },
      ctx,
    );

    expect(sentTexts).toHaveLength(0);
    await expect(
      beforeDispatch?.(
        {
          content: "生成今日门店日报",
          channel: "feishu",
          isGroup: true,
          messageId: "om_report_request_dispatch",
          senderId: "ou_store_manager",
          timestamp: Date.UTC(2026, 4, 9, 12, 2, 0),
        },
        ctx,
      ),
    ).resolves.toMatchObject({
      handled: true,
      text: expect.stringContaining("成交/销售额：1 单，200 元"),
    });
  });

  it("archives voice records from uppercase Transcript fields", async () => {
    const workspaceDir = mkdtempSync(path.join(tmpdir(), "store-report-plugin-"));
    tempDirs.push(workspaceDir);
    const { api, hooks } = makeApi(workspaceDir);

    plugin.register(api);
    const inboundClaim = hooks.get("inbound_claim");
    const beforeDispatch = hooks.get("before_dispatch");

    await expect(
      inboundClaim?.(
        {
          Transcript: "今天成交1单，销售额300元",
          channel: "feishu",
          isGroup: true,
          messageId: "om_voice_transcript",
          senderId: "ou_store_manager",
          metadata: {
            transcriptConfidence: 0.95,
          },
          timestamp: Date.UTC(2026, 4, 9, 12, 4, 0),
        },
        {
          channelId: "feishu",
          accountId: "main",
          conversationId: "oc_test",
          messageId: "om_voice_transcript",
          senderId: "ou_store_manager",
        },
      ),
    ).resolves.toMatchObject({ handled: true });

    await expect(
      beforeDispatch?.(
        {
          content: "生成今日门店日报",
          channel: "feishu",
          isGroup: true,
          senderId: "ou_store_manager",
          timestamp: Date.UTC(2026, 4, 9, 12, 5, 0),
        },
        {
          channelId: "feishu",
          accountId: "main",
          conversationId: "oc_test",
          senderId: "ou_store_manager",
        },
      ),
    ).resolves.toMatchObject({
      handled: true,
      text: expect.stringContaining("成交/销售额：1 单，300 元"),
    });
  });

  it("keeps confirmations owned by before_dispatch to avoid double-consuming pending voice", async () => {
    const workspaceDir = mkdtempSync(path.join(tmpdir(), "store-report-plugin-"));
    tempDirs.push(workspaceDir);
    const { api, hooks, sentTexts } = makeApi(workspaceDir);

    plugin.register(api);
    const messageReceived = hooks.get("message_received");
    const beforeDispatch = hooks.get("before_dispatch");
    const ctx = {
      channelId: "feishu",
      accountId: "main",
      conversationId: "oc_test",
      senderId: "ou_store_manager",
    };

    await messageReceived?.(
      {
        Transcript: "今天成交1单，销售额300元",
        channel: "feishu",
        isGroup: true,
        messageId: "om_voice_pending",
        senderId: "ou_store_manager",
        metadata: {
          transcriptConfidence: 0.5,
        },
        timestamp: Date.UTC(2026, 4, 9, 12, 4, 0),
      },
      ctx,
    );
    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]?.text).toContain("确认 #1");

    await messageReceived?.(
      {
        content: "确认 #1",
        channel: "feishu",
        isGroup: true,
        messageId: "om_voice_confirm_received",
        senderId: "ou_store_manager",
        timestamp: Date.UTC(2026, 4, 9, 12, 5, 0),
      },
      ctx,
    );
    expect(sentTexts).toHaveLength(1);

    await expect(
      beforeDispatch?.(
        {
          content: "确认 #1",
          channel: "feishu",
          isGroup: true,
          messageId: "om_voice_confirm_dispatch",
          senderId: "ou_store_manager",
          timestamp: Date.UTC(2026, 4, 9, 12, 6, 0),
        },
        ctx,
      ),
    ).resolves.toMatchObject({
      handled: true,
      text: expect.stringContaining("已确认并计入日报"),
    });
  });

  it("downloads Feishu voice and transcribes it with custom-http STT", async () => {
    const workspaceDir = mkdtempSync(path.join(tmpdir(), "store-report-plugin-"));
    tempDirs.push(workspaceDir);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, tenant_access_token: "tenant-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              item: {
                body: {
                  content: JSON.stringify({ file_key: "file_audio" }),
                },
              },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(Buffer.from("fake-audio"), {
          status: 200,
          headers: { "content-type": "audio/ogg" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: "今天成交2单，销售额300元", confidence: 0.91 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { api, hooks } = makeApi(workspaceDir, {
      voice: {
        enabled: true,
        transcriptSource: "plugin-stt",
        minConfidence: 0.8,
        confirmationTtlMinutes: 240,
        requireConfirmationWhenConfidenceMissing: true,
        download: { maxMb: 30 },
        stt: {
          mode: "custom-http",
          endpoint: "https://stt.example.test/transcribe",
          timeoutSeconds: 60,
          headers: {},
          responseTextPath: "text",
          responseConfidencePath: "confidence",
          backend: "whisper-cpp",
          language: "zh",
        },
      },
    });

    plugin.register(api);
    const inboundClaim = hooks.get("inbound_claim");
    const beforeDispatch = hooks.get("before_dispatch");

    await expect(
      inboundClaim?.(
        {
          content: "<media:audio>",
          channel: "feishu",
          isGroup: true,
          messageId: "om_voice_file",
          senderId: "ou_store_manager",
          timestamp: Date.UTC(2026, 4, 9, 12, 6, 0),
        },
        {
          channelId: "feishu",
          accountId: "main",
          conversationId: "oc_test",
          messageId: "om_voice_file",
          senderId: "ou_store_manager",
        },
      ),
    ).resolves.toMatchObject({ handled: true });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    await expect(
      beforeDispatch?.(
        {
          content: "生成今日门店日报",
          channel: "feishu",
          isGroup: true,
          senderId: "ou_store_manager",
          timestamp: Date.UTC(2026, 4, 9, 12, 7, 0),
        },
        {
          channelId: "feishu",
          accountId: "main",
          conversationId: "oc_test",
          senderId: "ou_store_manager",
        },
      ),
    ).resolves.toMatchObject({
      handled: true,
      text: expect.stringContaining("成交/销售额：2 单，300 元"),
    });
  });

  it("treats raw Feishu audio payload JSON as voice in auto STT mode", async () => {
    const workspaceDir = mkdtempSync(path.join(tmpdir(), "store-report-plugin-"));
    tempDirs.push(workspaceDir);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, tenant_access_token: "tenant-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, data: { item: { body: { content: "{}" } } } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(Buffer.from("fake-audio"), {
          status: 200,
          headers: { "content-type": "audio/ogg" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: "今天成交3单，销售额450元", confidence: 0.94 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { api, hooks } = makeApi(workspaceDir, {
      voice: {
        enabled: true,
        transcriptSource: "auto",
        minConfidence: 0.8,
        confirmationTtlMinutes: 240,
        requireConfirmationWhenConfidenceMissing: true,
        download: { maxMb: 30 },
        stt: {
          mode: "custom-http",
          endpoint: "https://stt.example.test/transcribe",
          timeoutSeconds: 60,
          headers: {},
          responseTextPath: "text",
          responseConfidencePath: "confidence",
          backend: "whisper-cpp",
          language: "zh",
        },
      },
    });

    plugin.register(api);
    const inboundClaim = hooks.get("inbound_claim");
    const beforeDispatch = hooks.get("before_dispatch");

    await expect(
      inboundClaim?.(
        {
          content: JSON.stringify({ file_key: "file_audio_payload", duration: 5000 }),
          channel: "feishu",
          isGroup: true,
          messageId: "om_voice_file_json",
          senderId: "ou_store_manager",
          timestamp: Date.UTC(2026, 4, 9, 12, 8, 0),
        },
        {
          channelId: "feishu",
          accountId: "main",
          conversationId: "oc_test",
          messageId: "om_voice_file_json",
          senderId: "ou_store_manager",
        },
      ),
    ).resolves.toMatchObject({ handled: true });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    await expect(
      beforeDispatch?.(
        {
          content: "生成今日门店日报",
          channel: "feishu",
          isGroup: true,
          senderId: "ou_store_manager",
          timestamp: Date.UTC(2026, 4, 9, 12, 9, 0),
        },
        {
          channelId: "feishu",
          accountId: "main",
          conversationId: "oc_test",
          senderId: "ou_store_manager",
        },
      ),
    ).resolves.toMatchObject({
      handled: true,
      text: expect.stringContaining("成交/销售额：3 单，450 元"),
    });
  });

  it("suppresses untranscribed voice placeholders before generic agent dispatch", async () => {
    const workspaceDir = mkdtempSync(path.join(tmpdir(), "store-report-plugin-"));
    tempDirs.push(workspaceDir);
    const { api, hooks } = makeApi(workspaceDir);

    plugin.register(api);
    const beforeDispatch = hooks.get("before_dispatch");

    await expect(
      beforeDispatch?.(
        {
          content: JSON.stringify({ file_key: "file_audio_payload", duration: 5000 }),
          channel: "feishu",
          isGroup: true,
          messageId: "om_voice_suppress",
          senderId: "ou_store_manager",
          timestamp: Date.UTC(2026, 4, 9, 12, 10, 0),
        },
        {
          channelId: "feishu",
          accountId: "main",
          conversationId: "oc_test",
          messageId: "om_voice_suppress",
          senderId: "ou_store_manager",
        },
      ),
    ).resolves.toMatchObject({
      handled: true,
    });
  });

  it("explains explicitly addressed confirmations when no voice item is pending", async () => {
    const workspaceDir = mkdtempSync(path.join(tmpdir(), "store-report-plugin-"));
    tempDirs.push(workspaceDir);
    const { api, hooks } = makeApi(workspaceDir);

    plugin.register(api);
    const beforeDispatch = hooks.get("before_dispatch");

    await expect(
      beforeDispatch?.(
        {
          content: "@小驿 对",
          channel: "feishu",
          isGroup: true,
          senderId: "ou_store_manager",
          timestamp: Date.UTC(2026, 4, 9, 12, 3, 0),
        },
        {
          channelId: "feishu",
          accountId: "main",
          conversationId: "oc_test",
          senderId: "ou_store_manager",
        },
      ),
    ).resolves.toMatchObject({
      handled: true,
      text: expect.stringContaining("没有找到待确认语音"),
    });
  });
});
