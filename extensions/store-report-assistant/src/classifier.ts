import type { StoreRecordType, StoreReportIntent, StructuredStoreRecord } from "./types.js";

const DAILY_REPORT_PATTERNS = [
  /生成(?:今日|今天)?(?:门店)?日报/u,
  /今日日报/u,
  /今日门店日报/u,
  /汇总(?:今日|今天)(?:门店)?经营记录/u,
  /按场景\s*1\s*生成(?:今日|今天)?(?:门店)?日报/u,
];

const WEEKLY_REPORT_PATTERNS = [
  /生成(?:本周|这周|本星期)?(?:门店)?周报/u,
  /本周(?:门店)?周报/u,
  /汇总(?:本周|这周|本星期)(?:门店)?经营记录/u,
];

const TRAFFIC_PATTERNS = [/客流/u, /顾客/u, /进店/u, /来了/u, /到店/u];
const SALES_PATTERNS = [/成交/u, /销售额/u, /卖了/u, /卖出去/u, /开单/u, /订单/u];
const PRODUCT_PATTERNS = [/试穿/u, /热销/u, /爆款/u, /款/u, /品类/u];
const INVENTORY_PATTERNS = [/断码/u, /缺货/u, /补货/u, /快断/u, /库存/u, /尺码/u];
const COMPLAINT_PATTERNS = [/客诉/u, /投诉/u, /服务态度/u, /不满意/u];
const CAMPAIGN_PATTERNS = [/活动/u, /满减/u, /折扣/u, /优惠/u, /门槛/u];
const STAFF_PATTERNS = [/请假/u, /排班/u, /到岗/u, /导购/u, /新人/u, /小王/u, /小李/u];

const CONFIRMATION_PATTERNS = [
  /^对(?:\s|#|第|[0-9]|条|号)*$/u,
  /^确认(?:\s|#|第|[0-9]|条|号)*$/u,
  /^是的$/u,
  /^没错$/u,
  /^计入(?:\s|#|第|[0-9]|条|号)*$/u,
  /^不计入/u,
  /^忽略/u,
  /^取消/u,
  /^(?:改成|更正为|修正为)\s*[:：]/u,
  /^(?:改|更正|修正)\s*(?:#|第)?\s*[0-9]/u,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function parseChineseSmallNumber(value: string): number | undefined {
  const normalized = value.trim();
  if (/^\d+$/u.test(normalized)) {
    return Number.parseInt(normalized, 10);
  }
  const map = new Map([
    ["一", 1],
    ["二", 2],
    ["两", 2],
    ["三", 3],
    ["四", 4],
    ["五", 5],
    ["六", 6],
    ["七", 7],
    ["八", 8],
    ["九", 9],
    ["十", 10],
  ]);
  return map.get(normalized);
}

function parseMoney(raw: string): number | undefined {
  const normalized = raw.replace(/,/g, "");
  if (!/^\d+(?:\.\d+)?$/u.test(normalized)) {
    return undefined;
  }
  return Number.parseFloat(normalized);
}

function uniqueJoined(values: Array<string | undefined>): string | undefined {
  const unique = [...new Set(values.map((value) => value?.trim()).filter(Boolean))];
  return unique.length ? unique.join("；") : undefined;
}

function splitRecordSegments(text: string): string[] {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [text.trim()].filter(Boolean);
}

function firstNumberBeforeUnit(
  text: string,
  unit: string,
): { value: number; approximate: boolean } | undefined {
  const match = new RegExp(
    `([0-9]+|[一二两三四五六七八九十])\\s*(?:多|来|左右|大概|约)?\\s*(?:${unit})`,
    "u",
  ).exec(text);
  if (!match?.[1]) {
    return undefined;
  }
  const value = parseChineseSmallNumber(match[1]);
  if (value === undefined) {
    return undefined;
  }
  return {
    value,
    approximate: /多|来|左右|大概|约/u.test(match[0]),
  };
}

export function normalizeStoreMessageText(text: string): string {
  return text
    .replace(/<at\s+[^>]+>[^<]*<\/at>/giu, "")
    .replace(/^@\S+\s*/u, "")
    .trim();
}

export function classifyStoreMessage(text: string): StoreReportIntent {
  const normalized = normalizeStoreMessageText(text);
  if (!normalized) {
    return { kind: "non_business", confidence: 1 };
  }
  if (matchesAny(normalized, WEEKLY_REPORT_PATTERNS)) {
    return { kind: "report_request", reportType: "weekly", confidence: 0.98 };
  }
  if (matchesAny(normalized, DAILY_REPORT_PATTERNS)) {
    return { kind: "report_request", reportType: "daily", confidence: 0.98 };
  }
  if (matchesAny(normalized, CONFIRMATION_PATTERNS)) {
    return { kind: "confirmation", confidence: 0.9 };
  }

  const recordTypes = resolveRecordTypes(normalized);
  if (recordTypes.length === 0) {
    return { kind: "non_business", confidence: 0.9 };
  }

  return {
    kind: "business_record",
    recordType: recordTypes.length > 1 ? "mixed" : recordTypes[0],
    confidence: 0.92,
  };
}

export function resolveRecordTypes(text: string): StoreRecordType[] {
  const types: StoreRecordType[] = [];
  if (matchesAny(text, TRAFFIC_PATTERNS)) {
    types.push("traffic");
  }
  if (matchesAny(text, SALES_PATTERNS)) {
    types.push("sales");
  }
  if (matchesAny(text, PRODUCT_PATTERNS)) {
    types.push("product");
  }
  if (matchesAny(text, INVENTORY_PATTERNS)) {
    types.push("inventory");
  }
  if (matchesAny(text, COMPLAINT_PATTERNS)) {
    types.push("complaint");
  }
  if (matchesAny(text, CAMPAIGN_PATTERNS)) {
    types.push("campaign");
  }
  if (matchesAny(text, STAFF_PATTERNS)) {
    types.push("staff");
  }
  return [...new Set(types)];
}

export function extractStructuredRecord(text: string): StructuredStoreRecord {
  const normalized = normalizeStoreMessageText(text);
  const segments = splitRecordSegments(normalized);
  let trafficCount: number | undefined;
  let trafficApproximate = false;
  let transactionCount: number | undefined;
  let salesAmount: number | undefined;
  const productTexts: string[] = [];
  const inventoryTexts: string[] = [];
  const complaintTexts: string[] = [];
  const campaignTexts: string[] = [];
  const staffTexts: string[] = [];

  for (const segment of segments) {
    const traffic = firstNumberBeforeUnit(segment, "人|个顾客|位顾客");
    if (traffic) {
      trafficCount = (trafficCount ?? 0) + traffic.value;
      trafficApproximate ||= traffic.approximate;
    }
    const transactions = firstNumberBeforeUnit(segment, "单");
    if (transactions) {
      transactionCount = (transactionCount ?? 0) + transactions.value;
    }
    const salesMatch =
      /(?:销售额|卖了|卖出去|金额|营业额)[^\d一二两三四五六七八九十]{0,8}([0-9][0-9,]*(?:\.\d+)?)/u.exec(
        segment,
      );
    const segmentSalesAmount = salesMatch?.[1] ? parseMoney(salesMatch[1]) : undefined;
    if (segmentSalesAmount !== undefined) {
      salesAmount = (salesAmount ?? 0) + segmentSalesAmount;
    }
    if (matchesAny(segment, PRODUCT_PATTERNS)) {
      productTexts.push(segment);
    }
    if (matchesAny(segment, INVENTORY_PATTERNS)) {
      inventoryTexts.push(segment);
    }
    if (matchesAny(segment, COMPLAINT_PATTERNS)) {
      complaintTexts.push(segment);
    }
    if (matchesAny(segment, CAMPAIGN_PATTERNS)) {
      campaignTexts.push(segment);
    }
    if (matchesAny(segment, STAFF_PATTERNS)) {
      staffTexts.push(segment);
    }
  }

  return {
    ...(trafficCount !== undefined ? { trafficCount, trafficApproximate } : {}),
    ...(transactionCount !== undefined ? { transactionCount } : {}),
    ...(salesAmount !== undefined ? { salesAmount } : {}),
    ...(uniqueJoined(productTexts) ? { productText: uniqueJoined(productTexts) } : {}),
    ...(uniqueJoined(inventoryTexts) ? { inventoryText: uniqueJoined(inventoryTexts) } : {}),
    ...(uniqueJoined(complaintTexts) ? { complaintText: uniqueJoined(complaintTexts) } : {}),
    ...(uniqueJoined(campaignTexts) ? { campaignText: uniqueJoined(campaignTexts) } : {}),
    ...(uniqueJoined(staffTexts) ? { staffText: uniqueJoined(staffTexts) } : {}),
  };
}
