import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import type {
  ArchiveStoreRecordInput,
  PendingConfirmationRecord,
  StoreBinding,
  StoreBindingSeed,
  StoreChatRecord,
  StoreReportCleanupInput,
  StoreReportCleanupResult,
  StoreReportPluginConfig,
  StoreSeed,
  StructuredStoreRecord,
} from "./types.js";

type Row = Record<string, unknown>;

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringColumn(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return fallback;
}

function asRow(value: unknown): Row | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : undefined;
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeAccountId(value: string | undefined): string | null {
  return value?.trim() || null;
}

function normalizeEnabled(value: boolean): number {
  return value ? 1 : 0;
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function numberColumn(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0);
}

function readStoreRecord(row: Row): StoreChatRecord {
  const recordType = asString(row.record_type);
  return {
    id: Number(row.id),
    messageId: stringColumn(row.message_id),
    channel: stringColumn(row.channel),
    ...(asString(row.account_id) ? { accountId: asString(row.account_id) } : {}),
    chatId: stringColumn(row.chat_id),
    ...(asString(row.sender_id) ? { senderId: asString(row.sender_id) } : {}),
    ...(asString(row.sender_name) ? { senderName: asString(row.sender_name) } : {}),
    storeId: stringColumn(row.store_id),
    businessDate: stringColumn(row.business_date),
    sentAt: stringColumn(row.sent_at),
    sourceType: stringColumn(row.source_type, "text"),
    ...(asString(row.raw_text) ? { rawText: asString(row.raw_text) } : {}),
    normalizedText: stringColumn(row.normalized_text),
    recordType:
      recordType === "traffic" ||
      recordType === "sales" ||
      recordType === "product" ||
      recordType === "complaint" ||
      recordType === "staff" ||
      recordType === "campaign" ||
      recordType === "inventory" ||
      recordType === "mixed"
        ? recordType
        : undefined,
    structured: parseJsonRecord(row.structured_json) as StructuredStoreRecord,
    confidence: asNumber(row.confidence) ?? 1,
    confirmed: Number(row.confirmed ?? 0) === 1,
  };
}

function readPendingConfirmation(row: Row): PendingConfirmationRecord {
  const pending: PendingConfirmationRecord = {
    id: Number(row.pending_id),
    recordId: Number(row.record_id),
    channel: stringColumn(row.pending_channel),
    chatId: stringColumn(row.pending_chat_id),
    confirmationState:
      row.confirmation_state === "confirmed" ||
      row.confirmation_state === "rejected" ||
      row.confirmation_state === "corrected"
        ? row.confirmation_state
        : "pending",
    createdAt: stringColumn(row.pending_created_at),
    record: readStoreRecord(row),
  };
  const accountId = asString(row.pending_account_id);
  if (accountId) {
    pending.accountId = accountId;
  }
  const senderId = asString(row.pending_sender_id);
  if (senderId) {
    pending.senderId = senderId;
  }
  const promptMessageId = asString(row.prompt_message_id);
  if (promptMessageId) {
    pending.promptMessageId = promptMessageId;
  }
  const expiresAt = asString(row.expires_at);
  if (expiresAt) {
    pending.expiresAt = expiresAt;
  }
  return pending;
}

export class StoreReportDatabase {
  readonly db: DatabaseSync;

  constructor(readonly dbPath: string) {
    ensureParentDir(dbPath);
    this.db = new NodeDatabaseSync(dbPath);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.migrate();
    try {
      fs.chmodSync(dbPath, 0o600);
    } catch {
      // Best-effort hardening; some filesystems do not support chmod.
    }
  }

  close(): void {
    this.db.close();
  }

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS stores (
        store_id TEXT PRIMARY KEY,
        store_name TEXT NOT NULL,
        timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
        source TEXT NOT NULL DEFAULT 'manual',
        external_ref TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS store_bindings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        account_id TEXT,
        chat_id TEXT NOT NULL,
        chat_type TEXT NOT NULL DEFAULT 'group',
        store_id TEXT NOT NULL,
        store_name TEXT,
        timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(store_id) REFERENCES stores(store_id),
        UNIQUE(channel, account_id, chat_id)
      );

      CREATE TABLE IF NOT EXISTS chat_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        account_id TEXT,
        chat_id TEXT NOT NULL,
        chat_type TEXT NOT NULL DEFAULT 'group',
        sender_id TEXT,
        sender_name TEXT,
        sender_role TEXT,
        store_id TEXT NOT NULL,
        business_date TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        source_type TEXT NOT NULL,
        raw_text TEXT,
        normalized_text TEXT NOT NULL,
        record_type TEXT,
        structured_json TEXT,
        confidence REAL NOT NULL DEFAULT 1,
        needs_confirmation INTEGER NOT NULL DEFAULT 0,
        confirmed INTEGER NOT NULL DEFAULT 1,
        superseded_by INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(channel, account_id, message_id)
      );

      CREATE TABLE IF NOT EXISTS daily_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id TEXT NOT NULL,
        business_date TEXT NOT NULL,
        channel TEXT,
        chat_id TEXT,
        report_text TEXT NOT NULL,
        report_json TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        missing_fields_json TEXT,
        generated_by TEXT NOT NULL,
        source_record_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(store_id, business_date, status)
      );

      CREATE TABLE IF NOT EXISTS weekly_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id TEXT NOT NULL,
        week_start_date TEXT NOT NULL,
        week_end_date TEXT NOT NULL,
        channel TEXT,
        chat_id TEXT,
        report_text TEXT NOT NULL,
        report_json TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        missing_fields_json TEXT,
        generated_by TEXT NOT NULL,
        source_record_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(store_id, week_start_date, status)
      );

      CREATE TABLE IF NOT EXISTS pending_confirmations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        record_id INTEGER NOT NULL,
        channel TEXT NOT NULL,
        account_id TEXT,
        chat_id TEXT NOT NULL,
        sender_id TEXT,
        prompt_message_id TEXT,
        confirmation_state TEXT NOT NULL DEFAULT 'pending',
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(record_id) REFERENCES chat_records(id)
      );

      CREATE INDEX IF NOT EXISTS idx_stores_enabled
        ON stores(enabled, store_name);
      CREATE INDEX IF NOT EXISTS idx_chat_records_store_date
        ON chat_records(store_id, business_date, confirmed, sent_at);
      CREATE INDEX IF NOT EXISTS idx_chat_records_chat_date
        ON chat_records(channel, account_id, chat_id, business_date, sent_at);
      CREATE INDEX IF NOT EXISTS idx_pending_confirmations_sender
        ON pending_confirmations(channel, account_id, chat_id, sender_id, confirmation_state);
      CREATE INDEX IF NOT EXISTS idx_weekly_reports_store_week
        ON weekly_reports(store_id, week_start_date, status);
    `);
  }

  seedConfig(config: StoreReportPluginConfig): void {
    for (const store of config.stores) {
      this.upsertStore(store);
    }
    for (const binding of config.bindings) {
      const store = config.stores.find((entry) => entry.storeId === binding.storeId);
      if (!store && binding.storeName) {
        this.upsertStore({
          storeId: binding.storeId,
          storeName: binding.storeName,
          timezone: binding.timezone ?? config.defaultTimezone,
          source: "manual",
          enabled: true,
        });
      }
      this.upsertBinding(binding);
    }
  }

  upsertStore(store: StoreSeed): void {
    this.db
      .prepare(
        `
        INSERT INTO stores (store_id, store_name, timezone, source, external_ref, enabled, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(store_id) DO UPDATE SET
          store_name = excluded.store_name,
          timezone = excluded.timezone,
          source = excluded.source,
          external_ref = excluded.external_ref,
          enabled = excluded.enabled,
          updated_at = CURRENT_TIMESTAMP
      `,
      )
      .run(
        store.storeId,
        store.storeName,
        store.timezone,
        store.source,
        store.externalRef ?? null,
        normalizeEnabled(store.enabled),
      );
  }

  upsertBinding(binding: StoreBindingSeed): void {
    this.db
      .prepare(
        `
        INSERT INTO store_bindings
          (channel, account_id, chat_id, chat_type, store_id, store_name, timezone, enabled, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(channel, account_id, chat_id) DO UPDATE SET
          chat_type = excluded.chat_type,
          store_id = excluded.store_id,
          store_name = excluded.store_name,
          timezone = excluded.timezone,
          enabled = excluded.enabled,
          updated_at = CURRENT_TIMESTAMP
      `,
      )
      .run(
        binding.channel,
        normalizeAccountId(binding.accountId),
        binding.chatId,
        binding.chatType,
        binding.storeId,
        binding.storeName ?? null,
        binding.timezone ?? "Asia/Shanghai",
        normalizeEnabled(binding.enabled),
      );
  }

  listStores(): StoreSeed[] {
    const rows = this.db
      .prepare(
        `
        SELECT store_id, store_name, timezone, source, external_ref, enabled
        FROM stores
        ORDER BY store_id ASC
      `,
      )
      .all() as unknown[];
    return rows.map((entry) => {
      const row = asRow(entry) ?? {};
      const store: StoreSeed = {
        storeId: stringColumn(row.store_id),
        storeName: stringColumn(row.store_name),
        timezone: stringColumn(row.timezone, "Asia/Shanghai"),
        source:
          row.source === "import" || row.source === "local" || row.source === "external"
            ? row.source
            : "manual",
        enabled: Number(row.enabled ?? 0) === 1,
      };
      const externalRef = asString(row.external_ref);
      if (externalRef) {
        store.externalRef = externalRef;
      }
      return store;
    });
  }

  listBindings(): StoreBinding[] {
    const rows = this.db
      .prepare(
        `
        SELECT
          b.channel,
          b.account_id,
          b.chat_id,
          b.chat_type,
          b.store_id,
          COALESCE(s.store_name, b.store_name, b.store_id) AS store_name,
          COALESCE(s.timezone, b.timezone, 'Asia/Shanghai') AS timezone
        FROM store_bindings b
        LEFT JOIN stores s ON s.store_id = b.store_id
        WHERE b.enabled = 1
        ORDER BY b.channel ASC, b.chat_id ASC
      `,
      )
      .all() as unknown[];
    return rows.map((entry) => {
      const row = asRow(entry) ?? {};
      const binding: StoreBinding = {
        channel: stringColumn(row.channel),
        chatId: stringColumn(row.chat_id),
        chatType: row.chat_type === "direct" ? "direct" : "group",
        storeId: stringColumn(row.store_id),
        storeName: stringColumn(row.store_name, stringColumn(row.store_id)),
        timezone: stringColumn(row.timezone, "Asia/Shanghai"),
      };
      const accountId = asString(row.account_id);
      if (accountId) {
        binding.accountId = accountId;
      }
      return binding;
    });
  }

  resolveBinding(params: {
    channel: string;
    accountId?: string;
    chatId: string;
    defaultTimezone: string;
  }): StoreBinding | undefined {
    const accountId = normalizeAccountId(params.accountId);
    const row = asRow(
      this.db
        .prepare(
          `
          SELECT
            b.channel,
            b.account_id,
            b.chat_id,
            b.chat_type,
            b.store_id,
            COALESCE(s.store_name, b.store_name, b.store_id) AS store_name,
            COALESCE(s.timezone, b.timezone, ?) AS timezone
          FROM store_bindings b
          LEFT JOIN stores s ON s.store_id = b.store_id
          WHERE b.enabled = 1
            AND b.channel = ?
            AND b.chat_id = ?
            AND (b.account_id = ? OR b.account_id IS NULL OR ? IS NULL)
          ORDER BY CASE WHEN b.account_id = ? THEN 0 ELSE 1 END
          LIMIT 1
        `,
        )
        .get(
          params.defaultTimezone,
          params.channel,
          params.chatId,
          accountId,
          accountId,
          accountId,
        ),
    );
    if (!row) {
      return undefined;
    }
    return {
      channel: stringColumn(row.channel, params.channel),
      ...(asString(row.account_id) ? { accountId: asString(row.account_id) } : {}),
      chatId: stringColumn(row.chat_id, params.chatId),
      chatType: row.chat_type === "direct" ? "direct" : "group",
      storeId: stringColumn(row.store_id),
      storeName: stringColumn(row.store_name, stringColumn(row.store_id)),
      timezone: stringColumn(row.timezone, params.defaultTimezone),
    };
  }

  archiveRecord(input: ArchiveStoreRecordInput): { archived: boolean; recordId?: number } {
    const result = this.db
      .prepare(
        `
        INSERT OR IGNORE INTO chat_records
          (
            message_id, channel, account_id, chat_id, chat_type, sender_id, sender_name,
            store_id, business_date, sent_at, source_type, raw_text, normalized_text,
            record_type, structured_json, confidence, needs_confirmation, confirmed
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        input.messageId,
        input.channel,
        normalizeAccountId(input.accountId),
        input.chatId,
        input.chatType,
        input.senderId ?? null,
        input.senderName ?? null,
        input.storeId,
        input.businessDate,
        input.sentAt,
        input.sourceType,
        input.rawText,
        input.normalizedText,
        input.recordType,
        stringifyJson(input.structured),
        input.confidence,
        input.needsConfirmation ? 1 : 0,
        input.confirmed ? 1 : 0,
      ) as { changes?: number | bigint };
    const archived = Number(result.changes ?? 0) > 0;
    const insertId = (result as { lastInsertRowid?: number | bigint }).lastInsertRowid;
    return {
      archived,
      ...(archived && insertId !== undefined ? { recordId: Number(insertId) } : {}),
    };
  }

  createPendingConfirmation(params: {
    recordId: number;
    channel: string;
    accountId?: string;
    chatId: string;
    senderId?: string;
    promptMessageId?: string;
    expiresAt?: string;
  }): number {
    const result = this.db
      .prepare(
        `
        INSERT INTO pending_confirmations
          (
            record_id, channel, account_id, chat_id, sender_id, prompt_message_id,
            confirmation_state, expires_at, updated_at
          )
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP)
      `,
      )
      .run(
        params.recordId,
        params.channel,
        normalizeAccountId(params.accountId),
        params.chatId,
        params.senderId ?? null,
        params.promptMessageId ?? null,
        params.expiresAt ?? null,
      ) as { lastInsertRowid?: number | bigint };
    return Number(result.lastInsertRowid ?? 0);
  }

  listPendingConfirmations(params: {
    channel: string;
    accountId?: string;
    chatId: string;
    senderId?: string;
    nowIso: string;
    limit?: number;
  }): PendingConfirmationRecord[] {
    const accountId = normalizeAccountId(params.accountId);
    const rows = this.db
      .prepare(
        `
        SELECT
          p.id AS pending_id,
          p.record_id,
          p.channel AS pending_channel,
          p.account_id AS pending_account_id,
          p.chat_id AS pending_chat_id,
          p.sender_id AS pending_sender_id,
          p.prompt_message_id,
          p.confirmation_state,
          p.expires_at,
          p.created_at AS pending_created_at,
          r.*
        FROM pending_confirmations p
        JOIN chat_records r ON r.id = p.record_id
        WHERE p.confirmation_state = 'pending'
          AND p.channel = ?
          AND p.chat_id = ?
          AND (p.account_id = ? OR p.account_id IS NULL OR ? IS NULL)
          AND (? IS NULL OR p.sender_id = ? OR p.sender_id IS NULL)
          AND (p.expires_at IS NULL OR p.expires_at > ?)
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT ?
      `,
      )
      .all(
        params.channel,
        params.chatId,
        accountId,
        accountId,
        params.senderId ?? null,
        params.senderId ?? null,
        params.nowIso,
        params.limit ?? 5,
      ) as unknown[];
    return rows.map((row) => readPendingConfirmation(asRow(row) ?? {}));
  }

  findPendingConfirmation(params: {
    pendingId: number;
    channel: string;
    accountId?: string;
    chatId: string;
    senderId?: string;
    nowIso: string;
  }): PendingConfirmationRecord | undefined {
    const accountId = normalizeAccountId(params.accountId);
    const row = asRow(
      this.db
        .prepare(
          `
          SELECT
            p.id AS pending_id,
            p.record_id,
            p.channel AS pending_channel,
            p.account_id AS pending_account_id,
            p.chat_id AS pending_chat_id,
            p.sender_id AS pending_sender_id,
            p.prompt_message_id,
            p.confirmation_state,
            p.expires_at,
            p.created_at AS pending_created_at,
            r.*
          FROM pending_confirmations p
          JOIN chat_records r ON r.id = p.record_id
          WHERE p.id = ?
            AND p.confirmation_state = 'pending'
            AND p.channel = ?
            AND p.chat_id = ?
            AND (p.account_id = ? OR p.account_id IS NULL OR ? IS NULL)
            AND (? IS NULL OR p.sender_id = ? OR p.sender_id IS NULL)
            AND (p.expires_at IS NULL OR p.expires_at > ?)
          LIMIT 1
        `,
        )
        .get(
          params.pendingId,
          params.channel,
          params.chatId,
          accountId,
          accountId,
          params.senderId ?? null,
          params.senderId ?? null,
          params.nowIso,
        ),
    );
    return row ? readPendingConfirmation(row) : undefined;
  }

  confirmPendingConfirmation(pendingId: number): void {
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `
          UPDATE chat_records
          SET confirmed = 1, needs_confirmation = 0, updated_at = CURRENT_TIMESTAMP
          WHERE id = (SELECT record_id FROM pending_confirmations WHERE id = ?)
        `,
        )
        .run(pendingId);
      this.updatePendingConfirmationState(pendingId, "confirmed");
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  rejectPendingConfirmation(pendingId: number): void {
    this.updatePendingConfirmationState(pendingId, "rejected");
  }

  replacePendingConfirmation(
    pendingId: number,
    params: {
      rawText: string;
      normalizedText: string;
      recordType: string;
      structured: StructuredStoreRecord;
      confidence: number;
    },
  ): void {
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `
          UPDATE chat_records
          SET
            raw_text = ?,
            normalized_text = ?,
            record_type = ?,
            structured_json = ?,
            confidence = ?,
            confirmed = 1,
            needs_confirmation = 0,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = (SELECT record_id FROM pending_confirmations WHERE id = ?)
        `,
        )
        .run(
          params.rawText,
          params.normalizedText,
          params.recordType,
          stringifyJson(params.structured),
          params.confidence,
          pendingId,
        );
      this.updatePendingConfirmationState(pendingId, "corrected");
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  private updatePendingConfirmationState(pendingId: number, state: string): void {
    this.db
      .prepare(
        `
        UPDATE pending_confirmations
        SET confirmation_state = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      )
      .run(state, pendingId);
  }

  listRecordsByDate(storeId: string, businessDate: string): StoreChatRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM chat_records
        WHERE store_id = ?
          AND business_date = ?
          AND confirmed = 1
        ORDER BY sent_at ASC, id ASC
      `,
      )
      .all(storeId, businessDate) as unknown[];
    return rows.map((row) => readStoreRecord(asRow(row) ?? {}));
  }

  listRecordsByRange(storeId: string, startDate: string, endDate: string): StoreChatRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM chat_records
        WHERE store_id = ?
          AND business_date >= ?
          AND business_date <= ?
          AND confirmed = 1
        ORDER BY business_date ASC, sent_at ASC, id ASC
      `,
      )
      .all(storeId, startDate, endDate) as unknown[];
    return rows.map((row) => readStoreRecord(asRow(row) ?? {}));
  }

  saveDailyReport(params: {
    storeId: string;
    businessDate: string;
    channel?: string;
    chatId?: string;
    reportText: string;
    missingFields: string[];
    sourceRecordCount: number;
    generatedBy: string;
  }): void {
    this.db
      .prepare(
        `
        INSERT INTO daily_reports
          (
            store_id, business_date, channel, chat_id, report_text, report_json, status,
            missing_fields_json, generated_by, source_record_count, updated_at
          )
        VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(store_id, business_date, status) DO UPDATE SET
          channel = excluded.channel,
          chat_id = excluded.chat_id,
          report_text = excluded.report_text,
          report_json = excluded.report_json,
          missing_fields_json = excluded.missing_fields_json,
          generated_by = excluded.generated_by,
          source_record_count = excluded.source_record_count,
          updated_at = CURRENT_TIMESTAMP
      `,
      )
      .run(
        params.storeId,
        params.businessDate,
        params.channel ?? null,
        params.chatId ?? null,
        params.reportText,
        stringifyJson({ reportText: params.reportText }),
        stringifyJson(params.missingFields),
        params.generatedBy,
        params.sourceRecordCount,
      );
  }

  saveWeeklyReport(params: {
    storeId: string;
    weekStartDate: string;
    weekEndDate: string;
    channel?: string;
    chatId?: string;
    reportText: string;
    missingFields: string[];
    sourceRecordCount: number;
    generatedBy: string;
  }): void {
    this.db
      .prepare(
        `
        INSERT INTO weekly_reports
          (
            store_id, week_start_date, week_end_date, channel, chat_id, report_text, report_json,
            status, missing_fields_json, generated_by, source_record_count, updated_at
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(store_id, week_start_date, status) DO UPDATE SET
          week_end_date = excluded.week_end_date,
          channel = excluded.channel,
          chat_id = excluded.chat_id,
          report_text = excluded.report_text,
          report_json = excluded.report_json,
          missing_fields_json = excluded.missing_fields_json,
          generated_by = excluded.generated_by,
          source_record_count = excluded.source_record_count,
          updated_at = CURRENT_TIMESTAMP
      `,
      )
      .run(
        params.storeId,
        params.weekStartDate,
        params.weekEndDate,
        params.channel ?? null,
        params.chatId ?? null,
        params.reportText,
        stringifyJson({ reportText: params.reportText }),
        stringifyJson(params.missingFields),
        params.generatedBy,
        params.sourceRecordCount,
      );
  }

  private countRows(sql: string, ...params: SQLInputValue[]): number {
    const row = asRow(this.db.prepare(sql).get(...params)) ?? {};
    return numberColumn(row.count);
  }

  private deleteRows(sql: string, ...params: SQLInputValue[]): number {
    const result = this.db.prepare(sql).run(...params) as { changes?: number | bigint };
    return Number(result.changes ?? 0);
  }

  cleanup(input: StoreReportCleanupInput): StoreReportCleanupResult {
    const pendingWhere = `
      WHERE (expires_at IS NOT NULL AND datetime(expires_at) < datetime(?))
        OR datetime(created_at) < datetime(?)
        OR record_id IN (
          SELECT id FROM chat_records WHERE business_date < ?
        )
    `;
    const pendingParams = [input.nowIso, input.pendingBeforeIso, input.recordBeforeDate] as const;
    const counts = {
      pendingConfirmations: this.countRows(
        `SELECT COUNT(*) AS count FROM pending_confirmations ${pendingWhere}`,
        ...pendingParams,
      ),
      chatRecords: this.countRows(
        "SELECT COUNT(*) AS count FROM chat_records WHERE business_date < ?",
        input.recordBeforeDate,
      ),
      dailyReports: this.countRows(
        "SELECT COUNT(*) AS count FROM daily_reports WHERE business_date < ?",
        input.reportBeforeDate,
      ),
      weeklyReports: this.countRows(
        "SELECT COUNT(*) AS count FROM weekly_reports WHERE week_end_date < ?",
        input.reportBeforeDate,
      ),
    };

    if (!input.dryRun) {
      this.db.exec("BEGIN");
      try {
        counts.pendingConfirmations = this.deleteRows(
          `DELETE FROM pending_confirmations ${pendingWhere}`,
          ...pendingParams,
        );
        counts.chatRecords = this.deleteRows(
          "DELETE FROM chat_records WHERE business_date < ?",
          input.recordBeforeDate,
        );
        counts.dailyReports = this.deleteRows(
          "DELETE FROM daily_reports WHERE business_date < ?",
          input.reportBeforeDate,
        );
        counts.weeklyReports = this.deleteRows(
          "DELETE FROM weekly_reports WHERE week_end_date < ?",
          input.reportBeforeDate,
        );
        this.db.exec("COMMIT");
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
    }

    return {
      dryRun: input.dryRun,
      recordBeforeDate: input.recordBeforeDate,
      reportBeforeDate: input.reportBeforeDate,
      pendingBeforeIso: input.pendingBeforeIso,
      nowIso: input.nowIso,
      deleted: counts,
    };
  }
}
