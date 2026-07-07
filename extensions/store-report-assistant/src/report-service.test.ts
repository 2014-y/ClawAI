import { describe, expect, it } from "vitest";
import { generateStoreReport } from "./report-service.js";
import type { StoreChatRecord } from "./types.js";

function record(
  id: number,
  text: string,
  structured: StoreChatRecord["structured"],
): StoreChatRecord {
  return {
    id,
    messageId: `m-${id}`,
    channel: "feishu",
    chatId: "oc_xxx",
    storeId: "shanghai-001",
    businessDate: "2026-05-09",
    sentAt: `2026-05-09T10:0${id}:00.000Z`,
    sourceType: "text",
    normalizedText: text,
    recordType: "mixed",
    structured,
    confidence: 1,
    confirmed: true,
  };
}

describe("store report generation", () => {
  it("uses supplied records and marks missing fields", () => {
    const result = generateStoreReport({
      reportType: "daily",
      storeId: "shanghai-001",
      storeName: "上海一店",
      businessDate: "2026-05-09",
      records: [
        record(1, "今天客流大概40多人", { trafficCount: 40, trafficApproximate: true }),
        record(2, "今天成交28单，销售额23600", {
          transactionCount: 28,
          salesAmount: 23600,
        }),
        record(3, "红色羽绒服试穿很多，M码快断了", {
          productText: "红色羽绒服试穿很多，M码快断了",
          inventoryText: "红色羽绒服试穿很多，M码快断了",
        }),
      ],
    });

    expect(result.reportText).toContain("客流：约 40 人");
    expect(result.reportText).toContain("成交/销售额：28 单，23600 元");
    expect(result.reportText).toContain("需要补充：活动反馈、人员情况");
    expect(result.sourceRecordCount).toBe(3);
  });
});
