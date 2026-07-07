export const STORE_REPORT_PLUGIN_ID = "store-report-assistant";

export type StoreReportArchiveConfig = {
  silentBusinessRecords: boolean;
  ignoreNonBusiness: boolean;
  dedupeByMessageId: boolean;
};

export type StoreReportReportsConfig = {
  dailyTime: string;
  weeklyDay: string;
  weeklyTime: string;
};

export type StoreReportVoiceConfig = {
  enabled: boolean;
  transcriptSource: "auto" | "event-only" | "plugin-stt" | "off";
  minConfidence: number;
  confirmationTtlMinutes: number;
  requireConfirmationWhenConfidenceMissing: boolean;
  download: {
    maxMb: number;
  };
  stt: {
    mode: "openclaw-media" | "custom-http" | "local-whisper" | "disabled";
    timeoutSeconds: number;
    endpoint?: string;
    headers: Record<string, string>;
    auth?: {
      mode: "bearer" | "header";
      tokenRef?: string;
      headerName?: string;
      prefix?: string;
    };
    responseTextPath: string;
    responseConfidencePath?: string;
    backend: "whisper-cpp" | "openai-whisper";
    executable?: string;
    model?: string;
    language: string;
  };
};

export type StoreReportRetentionConfig = {
  chatRecordsDays: number;
  reportsDays: number;
  pendingConfirmationsDays: number;
};

export type StoreReportPrivacyConfig = {
  storeRawText: boolean;
  redactExportsByDefault: boolean;
  retention: StoreReportRetentionConfig;
};

export type StoreReportPluginConfig = {
  databasePath: string;
  defaultTimezone: string;
  archive: StoreReportArchiveConfig;
  reports: StoreReportReportsConfig;
  voice: StoreReportVoiceConfig;
  privacy: StoreReportPrivacyConfig;
  stores: StoreSeed[];
  bindings: StoreBindingSeed[];
};

export type StoreSeed = {
  storeId: string;
  storeName: string;
  timezone: string;
  source: "manual" | "import" | "local" | "external";
  externalRef?: string;
  enabled: boolean;
};

export type StoreBindingSeed = {
  channel: string;
  accountId?: string;
  chatId: string;
  chatType: "group" | "direct";
  storeId: string;
  storeName?: string;
  timezone?: string;
  enabled: boolean;
};

export type StoreBinding = {
  channel: string;
  accountId?: string;
  chatId: string;
  chatType: "group" | "direct";
  storeId: string;
  storeName: string;
  timezone: string;
};

export type StoreReportIntent =
  | { kind: "business_record"; recordType: StoreRecordType; confidence: number }
  | { kind: "report_request"; reportType: "daily" | "weekly"; confidence: number }
  | { kind: "confirmation"; confidence: number }
  | { kind: "non_business"; confidence: number };

export type StoreRecordType =
  | "traffic"
  | "sales"
  | "product"
  | "complaint"
  | "staff"
  | "campaign"
  | "inventory"
  | "mixed";

export type StructuredStoreRecord = {
  trafficCount?: number;
  trafficApproximate?: boolean;
  transactionCount?: number;
  salesAmount?: number;
  productText?: string;
  complaintText?: string;
  staffText?: string;
  campaignText?: string;
  inventoryText?: string;
};

export type ArchiveStoreRecordInput = {
  messageId: string;
  channel: string;
  accountId?: string;
  chatId: string;
  chatType: "group" | "direct";
  senderId?: string;
  senderName?: string;
  storeId: string;
  businessDate: string;
  sentAt: string;
  sourceType: "text" | "voice" | "image_ocr" | "manual";
  rawText: string;
  normalizedText: string;
  recordType: StoreRecordType;
  structured: StructuredStoreRecord;
  confidence: number;
  confirmed: boolean;
  needsConfirmation: boolean;
};

export type StoreChatRecord = {
  id: number;
  messageId: string;
  channel: string;
  accountId?: string;
  chatId: string;
  senderId?: string;
  senderName?: string;
  storeId: string;
  businessDate: string;
  sentAt: string;
  sourceType: string;
  rawText?: string;
  normalizedText: string;
  recordType: StoreRecordType | undefined;
  structured: StructuredStoreRecord;
  confidence: number;
  confirmed: boolean;
};

export type PendingConfirmationState = "pending" | "confirmed" | "rejected" | "corrected";

export type PendingConfirmationRecord = {
  id: number;
  recordId: number;
  channel: string;
  accountId?: string;
  chatId: string;
  senderId?: string;
  promptMessageId?: string;
  confirmationState: PendingConfirmationState;
  expiresAt?: string;
  createdAt: string;
  record: StoreChatRecord;
};

export type StoreReportCleanupInput = {
  recordBeforeDate: string;
  reportBeforeDate: string;
  pendingBeforeIso: string;
  nowIso: string;
  dryRun: boolean;
};

export type StoreReportCleanupResult = {
  dryRun: boolean;
  recordBeforeDate: string;
  reportBeforeDate: string;
  pendingBeforeIso: string;
  nowIso: string;
  deleted: {
    pendingConfirmations: number;
    chatRecords: number;
    dailyReports: number;
    weeklyReports: number;
  };
};

export type GenerateReportInput = {
  reportType: "daily" | "weekly";
  storeId: string;
  storeName: string;
  businessDate?: string;
  weekStartDate?: string;
  weekEndDate?: string;
  records: StoreChatRecord[];
};

export type GenerateReportResult = {
  reportText: string;
  missingFields: string[];
  sourceRecordCount: number;
};
