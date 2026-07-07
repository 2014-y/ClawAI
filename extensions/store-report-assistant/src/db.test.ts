import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StoreReportDatabase } from "./db.js";

let tempDir: string;
let db: StoreReportDatabase;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "store-report-db-"));
  db = new StoreReportDatabase(path.join(tempDir, "store_report.sqlite"));
  db.seedConfig({
    databasePath: path.join(tempDir, "store_report.sqlite"),
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
        storeId: "s-001",
        storeName: "测试门店",
        timezone: "Asia/Shanghai",
        source: "manual",
        enabled: true,
      },
    ],
    bindings: [],
  });
});

afterEach(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("store report pending confirmations", () => {
  it("keeps voice records out of reports until confirmed", () => {
    const archived = db.archiveRecord({
      messageId: "voice-1",
      channel: "feishu",
      accountId: "main",
      chatId: "oc_xxx",
      chatType: "group",
      senderId: "ou_1",
      senderName: "店长",
      storeId: "s-001",
      businessDate: "2026-05-09",
      sentAt: "2026-05-09T10:00:00.000Z",
      sourceType: "voice",
      rawText: "又成交1单，卖了300元",
      normalizedText: "又成交1单，卖了300元",
      recordType: "sales",
      structured: { transactionCount: 1, salesAmount: 300 },
      confidence: 0.92,
      confirmed: false,
      needsConfirmation: true,
    });

    expect(archived.recordId).toBeGreaterThan(0);
    expect(db.listRecordsByDate("s-001", "2026-05-09")).toEqual([]);

    const pendingId = db.createPendingConfirmation({
      recordId: archived.recordId ?? 0,
      channel: "feishu",
      accountId: "main",
      chatId: "oc_xxx",
      senderId: "ou_1",
      promptMessageId: "voice-1",
      expiresAt: "2026-05-09T14:00:00.000Z",
    });
    expect(pendingId).toBeGreaterThan(0);

    const pending = db.listPendingConfirmations({
      channel: "feishu",
      accountId: "main",
      chatId: "oc_xxx",
      senderId: "ou_1",
      nowIso: "2026-05-09T11:00:00.000Z",
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.record.normalizedText).toBe("又成交1单，卖了300元");

    db.confirmPendingConfirmation(pendingId);
    expect(db.listRecordsByDate("s-001", "2026-05-09")).toHaveLength(1);
  });

  it("can replace a pending voice transcript before confirmation", () => {
    const archived = db.archiveRecord({
      messageId: "voice-2",
      channel: "feishu",
      chatId: "oc_xxx",
      chatType: "group",
      senderId: "ou_1",
      storeId: "s-001",
      businessDate: "2026-05-09",
      sentAt: "2026-05-09T10:00:00.000Z",
      sourceType: "voice",
      rawText: "成交两单，卖了三百",
      normalizedText: "成交两单，卖了三百",
      recordType: "sales",
      structured: { transactionCount: 2 },
      confidence: 0.92,
      confirmed: false,
      needsConfirmation: true,
    });
    const pendingId = db.createPendingConfirmation({
      recordId: archived.recordId ?? 0,
      channel: "feishu",
      chatId: "oc_xxx",
      senderId: "ou_1",
    });

    db.replacePendingConfirmation(pendingId, {
      rawText: "成交1单，销售额300",
      normalizedText: "成交1单，销售额300",
      recordType: "sales",
      structured: { transactionCount: 1, salesAmount: 300 },
      confidence: 1,
    });

    expect(db.listRecordsByDate("s-001", "2026-05-09")[0]?.structured).toMatchObject({
      transactionCount: 1,
      salesAmount: 300,
    });
    expect(
      db.listPendingConfirmations({
        channel: "feishu",
        chatId: "oc_xxx",
        senderId: "ou_1",
        nowIso: "2026-05-09T11:00:00.000Z",
      }),
    ).toEqual([]);
  });
});

describe("store report cleanup", () => {
  it("deletes records, reports, and stale pending confirmations before retention cutoffs", () => {
    const oldRecord = db.archiveRecord({
      messageId: "old-sales",
      channel: "feishu",
      chatId: "oc_xxx",
      chatType: "group",
      storeId: "s-001",
      businessDate: "2026-01-01",
      sentAt: "2026-01-01T10:00:00.000Z",
      sourceType: "text",
      rawText: "今天成交1单，销售额100元",
      normalizedText: "今天成交1单，销售额100元",
      recordType: "sales",
      structured: { transactionCount: 1, salesAmount: 100 },
      confidence: 0.92,
      confirmed: true,
      needsConfirmation: false,
    });
    db.archiveRecord({
      messageId: "new-sales",
      channel: "feishu",
      chatId: "oc_xxx",
      chatType: "group",
      storeId: "s-001",
      businessDate: "2026-05-09",
      sentAt: "2026-05-09T10:00:00.000Z",
      sourceType: "text",
      rawText: "今天成交2单，销售额200元",
      normalizedText: "今天成交2单，销售额200元",
      recordType: "sales",
      structured: { transactionCount: 2, salesAmount: 200 },
      confidence: 0.92,
      confirmed: true,
      needsConfirmation: false,
    });
    db.createPendingConfirmation({
      recordId: oldRecord.recordId ?? 0,
      channel: "feishu",
      chatId: "oc_xxx",
      expiresAt: "2026-01-02T00:00:00.000Z",
    });
    db.saveDailyReport({
      storeId: "s-001",
      businessDate: "2026-01-01",
      reportText: "old daily",
      missingFields: [],
      sourceRecordCount: 1,
      generatedBy: "test",
    });
    db.saveWeeklyReport({
      storeId: "s-001",
      weekStartDate: "2025-12-29",
      weekEndDate: "2026-01-04",
      reportText: "old weekly",
      missingFields: [],
      sourceRecordCount: 1,
      generatedBy: "test",
    });

    const dryRun = db.cleanup({
      dryRun: true,
      recordBeforeDate: "2026-05-01",
      reportBeforeDate: "2026-05-01",
      pendingBeforeIso: "2026-05-01T00:00:00.000Z",
      nowIso: "2026-05-10T00:00:00.000Z",
    });
    expect(dryRun.deleted).toMatchObject({
      pendingConfirmations: 1,
      chatRecords: 1,
      dailyReports: 1,
      weeklyReports: 1,
    });
    expect(db.listRecordsByDate("s-001", "2026-01-01")).toHaveLength(1);

    const applied = db.cleanup({
      dryRun: false,
      recordBeforeDate: "2026-05-01",
      reportBeforeDate: "2026-05-01",
      pendingBeforeIso: "2026-05-01T00:00:00.000Z",
      nowIso: "2026-05-10T00:00:00.000Z",
    });
    expect(applied.deleted.chatRecords).toBe(1);
    expect(db.listRecordsByDate("s-001", "2026-01-01")).toEqual([]);
    expect(db.listRecordsByDate("s-001", "2026-05-09")).toHaveLength(1);
  });
});
