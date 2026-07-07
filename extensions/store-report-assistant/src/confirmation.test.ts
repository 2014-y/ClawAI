import { describe, expect, it } from "vitest";
import { parseConfirmationAction } from "./confirmation.js";

describe("store report confirmation parsing", () => {
  it("parses confirmation actions with pending ids", () => {
    expect(parseConfirmationAction("确认 #12")).toEqual({ kind: "confirm", pendingId: 12 });
    expect(parseConfirmationAction("不计入 #12")).toEqual({ kind: "reject", pendingId: 12 });
    expect(parseConfirmationAction("改 #12：成交1单，销售额300")).toEqual({
      kind: "replace",
      pendingId: 12,
      text: "成交1单，销售额300",
    });
  });

  it("parses unnumbered correction for the only pending voice record", () => {
    expect(parseConfirmationAction("改成：又成交1单，卖了300元")).toEqual({
      kind: "replace",
      text: "又成交1单，卖了300元",
    });
  });
});
