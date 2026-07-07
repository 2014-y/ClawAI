import crypto from "node:crypto";
import type { StoreChatRecord, StructuredStoreRecord } from "./types.js";

const REDACTED_NAME = "[redacted]";

function hashIdentifier(value: string): string {
  return `redacted:${crypto.createHash("sha256").update(value).digest("hex").slice(0, 12)}`;
}

export function redactSensitiveText(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[email]")
    .replace(/https?:\/\/\S+/giu, "[url]")
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/gu, "[phone]")
    .replace(/(?<!\d)\d{17}[\dXx](?!\d)/gu, "[id]");
}

function redactTextValue(value: string | undefined): string | undefined {
  return value ? redactSensitiveText(value) : undefined;
}

function redactStructuredRecord(structured: StructuredStoreRecord): StructuredStoreRecord {
  return {
    ...structured,
    ...(structured.productText ? { productText: redactSensitiveText(structured.productText) } : {}),
    ...(structured.complaintText
      ? { complaintText: redactSensitiveText(structured.complaintText) }
      : {}),
    ...(structured.staffText ? { staffText: redactSensitiveText(structured.staffText) } : {}),
    ...(structured.campaignText
      ? { campaignText: redactSensitiveText(structured.campaignText) }
      : {}),
    ...(structured.inventoryText
      ? { inventoryText: redactSensitiveText(structured.inventoryText) }
      : {}),
  };
}

export function redactStoreChatRecord(record: StoreChatRecord): StoreChatRecord {
  const {
    accountId,
    chatId,
    messageId,
    normalizedText,
    rawText,
    senderId,
    senderName,
    structured,
    ...rest
  } = record;
  const redactedRawText = redactTextValue(rawText);
  return {
    ...rest,
    messageId: hashIdentifier(messageId),
    ...(accountId ? { accountId: hashIdentifier(accountId) } : {}),
    chatId: hashIdentifier(chatId),
    ...(senderId ? { senderId: hashIdentifier(senderId) } : {}),
    ...(senderName ? { senderName: REDACTED_NAME } : {}),
    ...(redactedRawText ? { rawText: redactedRawText } : {}),
    normalizedText: redactSensitiveText(normalizedText),
    structured: redactStructuredRecord(structured),
  };
}
