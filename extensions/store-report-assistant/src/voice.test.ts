import { describe, expect, it } from "vitest";
import { isVoicePlaceholderText } from "./voice.js";

describe("store report voice helpers", () => {
  it("recognizes Feishu audio placeholders with filenames", () => {
    expect(isVoicePlaceholderText("<media:audio> (voice.ogg)")).toBe(true);
    expect(isVoicePlaceholderText("[语音] (voice.ogg)")).toBe(true);
  });

  it("recognizes raw Feishu audio payload JSON without treating ordinary files as voice", () => {
    expect(isVoicePlaceholderText(JSON.stringify({ file_key: "file_audio", duration: 5000 }))).toBe(
      true,
    );
    expect(
      isVoicePlaceholderText(JSON.stringify({ file_key: "file_doc", file_name: "report.pdf" })),
    ).toBe(false);
  });
});
