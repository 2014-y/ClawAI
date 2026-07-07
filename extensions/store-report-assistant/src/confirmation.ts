export type ConfirmationAction =
  | { kind: "confirm"; pendingId?: number }
  | { kind: "reject"; pendingId?: number }
  | { kind: "replace"; pendingId?: number; text: string }
  | { kind: "none" };

function parsePendingId(text: string): number | undefined {
  const match = /(?:#|第)?\s*([0-9]{1,9})\s*(?:条|号)?/u.exec(text);
  if (!match?.[1]) {
    return undefined;
  }
  const value = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function parseConfirmationAction(text: string): ConfirmationAction {
  const normalized = text.trim();
  if (!normalized) {
    return { kind: "none" };
  }

  const replacementMatch = /^(?:改成|更正为|修正为)\s*[:：]\s*(.+)$/u.exec(normalized);
  if (replacementMatch?.[1]?.trim()) {
    return { kind: "replace", text: replacementMatch[1].trim() };
  }

  const replacementWithIdMatch =
    /^(?:改|更正|修正)\s*(?:#|第)?\s*([0-9]{1,9})\s*(?:条|号)?\s*[:：]\s*(.+)$/u.exec(normalized);
  if (replacementWithIdMatch?.[1] && replacementWithIdMatch[2]?.trim()) {
    return {
      kind: "replace",
      pendingId: Number.parseInt(replacementWithIdMatch[1], 10),
      text: replacementWithIdMatch[2].trim(),
    };
  }

  if (/^(?:不计入|忽略|取消)(?:\s|#|第|[0-9]|条|号)*$/u.test(normalized)) {
    return { kind: "reject", pendingId: parsePendingId(normalized) };
  }

  if (/^(?:对|确认|是的|没错|计入)(?:\s|#|第|[0-9]|条|号)*$/u.test(normalized)) {
    return { kind: "confirm", pendingId: parsePendingId(normalized) };
  }

  return { kind: "none" };
}
