import type {
  GenerateReportInput,
  GenerateReportResult,
  StoreChatRecord,
  StructuredStoreRecord,
} from "./types.js";

type ReportBuckets = {
  trafficTexts: string[];
  salesTexts: string[];
  productTexts: string[];
  inventoryTexts: string[];
  complaintTexts: string[];
  campaignTexts: string[];
  staffTexts: string[];
  trafficApproximate: boolean;
  trafficCount?: number;
  transactionCount: number;
  salesAmount: number;
};

function formatMoney(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(2);
}

function uniqueTexts(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function pushIfPresent(target: string[], value: string | undefined): void {
  if (value?.trim()) {
    target.push(value.trim());
  }
}

function addStructured(
  buckets: ReportBuckets,
  structured: StructuredStoreRecord,
  fallback: string,
): void {
  if (typeof structured.trafficCount === "number") {
    buckets.trafficCount = (buckets.trafficCount ?? 0) + structured.trafficCount;
    buckets.trafficApproximate ||= structured.trafficApproximate === true;
    buckets.trafficTexts.push(fallback);
  }
  if (typeof structured.transactionCount === "number") {
    buckets.transactionCount += structured.transactionCount;
    buckets.salesTexts.push(fallback);
  }
  if (typeof structured.salesAmount === "number") {
    buckets.salesAmount += structured.salesAmount;
    buckets.salesTexts.push(fallback);
  }
  pushIfPresent(buckets.productTexts, structured.productText);
  pushIfPresent(buckets.inventoryTexts, structured.inventoryText);
  pushIfPresent(buckets.complaintTexts, structured.complaintText);
  pushIfPresent(buckets.campaignTexts, structured.campaignText);
  pushIfPresent(buckets.staffTexts, structured.staffText);
}

function bucketRecords(records: StoreChatRecord[]): ReportBuckets {
  const buckets: ReportBuckets = {
    trafficTexts: [],
    salesTexts: [],
    productTexts: [],
    inventoryTexts: [],
    complaintTexts: [],
    campaignTexts: [],
    staffTexts: [],
    trafficApproximate: false,
    transactionCount: 0,
    salesAmount: 0,
  };

  for (const record of records) {
    addStructured(buckets, record.structured, record.normalizedText);
    switch (record.recordType) {
      case "traffic":
        buckets.trafficTexts.push(record.normalizedText);
        break;
      case "sales":
        buckets.salesTexts.push(record.normalizedText);
        break;
      case "product":
        buckets.productTexts.push(record.normalizedText);
        break;
      case "inventory":
        buckets.inventoryTexts.push(record.normalizedText);
        break;
      case "complaint":
        buckets.complaintTexts.push(record.normalizedText);
        break;
      case "campaign":
        buckets.campaignTexts.push(record.normalizedText);
        break;
      case "staff":
        buckets.staffTexts.push(record.normalizedText);
        break;
      case "mixed":
      case undefined:
        break;
    }
  }
  return buckets;
}

function resolveMissingFields(buckets: ReportBuckets): string[] {
  const missing: string[] = [];
  if (buckets.trafficCount === undefined && uniqueTexts(buckets.trafficTexts).length === 0) {
    missing.push("客流");
  }
  if (
    buckets.transactionCount === 0 &&
    buckets.salesAmount === 0 &&
    uniqueTexts(buckets.salesTexts).length === 0
  ) {
    missing.push("成交/销售额");
  }
  if (uniqueTexts(buckets.productTexts).length === 0) {
    missing.push("热销款");
  }
  if (uniqueTexts(buckets.campaignTexts).length === 0) {
    missing.push("活动反馈");
  }
  if (uniqueTexts(buckets.staffTexts).length === 0) {
    missing.push("人员情况");
  }
  return missing;
}

function formatTextList(values: string[], fallback: string): string {
  const unique = uniqueTexts(values);
  return unique.length ? unique.join("；") : fallback;
}

function formatTraffic(buckets: ReportBuckets): string {
  if (buckets.trafficCount !== undefined) {
    return `${buckets.trafficApproximate ? "约 " : ""}${buckets.trafficCount} 人`;
  }
  return formatTextList(buckets.trafficTexts, "缺失");
}

function formatSales(buckets: ReportBuckets): string {
  const parts: string[] = [];
  if (buckets.transactionCount > 0) {
    parts.push(`${buckets.transactionCount} 单`);
  }
  if (buckets.salesAmount > 0) {
    parts.push(`${formatMoney(buckets.salesAmount)} 元`);
  }
  if (parts.length) {
    return parts.join("，");
  }
  return formatTextList(buckets.salesTexts, "缺失");
}

export function generateStoreReport(input: GenerateReportInput): GenerateReportResult {
  const buckets = bucketRecords(input.records);
  const missingFields = resolveMissingFields(buckets);
  const period =
    input.reportType === "daily"
      ? (input.businessDate ?? "未指定日期")
      : `${input.weekStartDate ?? "未指定开始日期"} 至 ${input.weekEndDate ?? "未指定结束日期"}`;
  const title = input.reportType === "daily" ? "今日门店日报" : "本周门店周报";
  const lines = [
    title,
    `门店：${input.storeName}（${input.storeId}）`,
    `周期：${period}`,
    "",
    `客流：${formatTraffic(buckets)}`,
    `成交/销售额：${formatSales(buckets)}`,
    `热销款：${formatTextList(buckets.productTexts, "缺失")}`,
    `异常情况：${formatTextList([...buckets.inventoryTexts, ...buckets.complaintTexts], "暂无已记录异常")}`,
    `活动反馈：${formatTextList(buckets.campaignTexts, "缺失")}`,
    `人员情况：${formatTextList(buckets.staffTexts, "缺失")}`,
    `来源记录：${input.records.length} 条已确认记录`,
  ];

  if (missingFields.length > 0) {
    lines.push("", `需要补充：${missingFields.join("、")}`);
  }

  return {
    reportText: lines.join("\n"),
    missingFields,
    sourceRecordCount: input.records.length,
  };
}
