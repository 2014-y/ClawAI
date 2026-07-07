import { describe, expect, it } from "vitest";
import {
  classifyStoreMessage,
  extractStructuredRecord,
  normalizeStoreMessageText,
} from "./classifier.js";

describe("store report classifier", () => {
  it("classifies daily and weekly report requests", () => {
    expect(classifyStoreMessage("生成今日门店日报")).toMatchObject({
      kind: "report_request",
      reportType: "daily",
    });
    expect(classifyStoreMessage("生成本周门店周报")).toMatchObject({
      kind: "report_request",
      reportType: "weekly",
    });
  });

  it("classifies business records without requiring mentions", () => {
    expect(classifyStoreMessage("今天成交28单，销售额23600")).toMatchObject({
      kind: "business_record",
    });
    expect(classifyStoreMessage("红色羽绒服试穿很多，M码快断了")).toMatchObject({
      kind: "business_record",
    });
  });

  it("ignores ordinary chatter", () => {
    expect(classifyStoreMessage("天气不错")).toMatchObject({ kind: "non_business" });
  });

  it("normalizes leading at mentions", () => {
    expect(normalizeStoreMessageText("@小驿 生成今日门店日报")).toBe("生成今日门店日报");
  });

  it("classifies voice confirmation replies with optional pending ids", () => {
    expect(classifyStoreMessage("确认 #12")).toMatchObject({ kind: "confirmation" });
    expect(classifyStoreMessage("不计入 #12")).toMatchObject({ kind: "confirmation" });
    expect(classifyStoreMessage("改 #12：成交1单，销售额300")).toMatchObject({
      kind: "confirmation",
    });
  });

  it("extracts confirmed numeric sales and fuzzy traffic", () => {
    expect(extractStructuredRecord("今天客流大概40多人")).toMatchObject({
      trafficCount: 40,
      trafficApproximate: true,
    });
    expect(extractStructuredRecord("今天成交28单，销售额23600")).toMatchObject({
      transactionCount: 28,
      salesAmount: 23600,
    });
  });

  it("keeps multiline business fields scoped to their own lines", () => {
    expect(
      extractStructuredRecord(`今天客流大概120人
黑色羽绒服试穿很多，M码快断了
活动反馈一般，顾客觉得满减门槛高
小王请假半天`),
    ).toMatchObject({
      trafficCount: 120,
      productText: "黑色羽绒服试穿很多，M码快断了",
      inventoryText: "黑色羽绒服试穿很多，M码快断了",
      campaignText: "活动反馈一般，顾客觉得满减门槛高",
      staffText: "小王请假半天",
    });
  });
});
