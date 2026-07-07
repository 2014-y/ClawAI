import type { A2ATask, ActiveFlightSession, PluginConfig } from "./types";

export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_STATUS_TIMEOUT_MS = 30_000;

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

export function readConfig(
  raw: Record<string, unknown> | undefined
): Required<Pick<PluginConfig, "requestTimeoutMs">> & PluginConfig {
  const baseUrl = asString(raw?.baseUrl);
  return {
    baseUrl: baseUrl ? normalizeBaseUrl(baseUrl) : undefined,
    authToken: asString(raw?.authToken),
    openclawId: asString(raw?.openclawId),
    userId: asString(raw?.userId),
    requestTimeoutMs: asNumber(raw?.requestTimeoutMs) ?? DEFAULT_REQUEST_TIMEOUT_MS,
  };
}

function requireBaseUrl(config: PluginConfig): string {
  if (!config.baseUrl) {
    throw new Error(
      "Waltz Flight Assistant plugin is missing plugins.entries.waltz-flight-assistant.config.baseUrl"
    );
  }

  return config.baseUrl;
}

function buildHeaders(config: PluginConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {}),
  };
}

async function parseJsonResponse(response: Response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Waltz Flight Assistant returned invalid JSON: ${text.slice(0, 500)}`);
  }
}

export async function fetchPaymentSetupStatus(params: {
  config: PluginConfig;
  contextId: string;
  openclawId: string;
}) {
  const timeoutMs = Math.min(
    params.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    DEFAULT_STATUS_TIMEOUT_MS
  );
  const url = new URL(`${requireBaseUrl(params.config)}/api/payments/setup/status`);
  url.searchParams.set("context_id", params.contextId);
  url.searchParams.set("openclaw_id", params.openclawId);

  const response = await fetch(url, {
    headers: buildHeaders(params.config),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(
      `Payment setup status check failed: ${payload?.error ?? payload?.status ?? response.status}`
    );
  }

  return payload as {
    status: string;
    paymentMethod?: {
      brand?: string | null;
      lastFour?: string;
      expMonth?: number | null;
      expYear?: number | null;
    };
  };
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const message =
    "message" in error && typeof (error as any).message === "string"
      ? (error as any).message
      : "";
  const name =
    "name" in error && typeof (error as any).name === "string"
      ? (error as any).name
      : "";

  return (
    name === "TimeoutError" ||
    name === "AbortError" ||
    message.includes("aborted due to timeout")
  );
}

export async function sendOutboundText(params: {
  api: any;
  session: ActiveFlightSession;
  text: string;
}) {
  if (!params.session.channelId || !params.session.conversationId) {
    throw new Error("Active flight session is missing channel route data");
  }

  const adapter = await params.api.runtime.channel.outbound.loadAdapter(params.session.channelId);
  const send = adapter?.sendText;
  if (!send) {
    throw new Error(`Outbound adapter unavailable for channel ${params.session.channelId}`);
  }

  await send({
    cfg: params.api.config,
    to: params.session.conversationId,
    text: params.text,
    ...(params.session.accountId ? { accountId: params.session.accountId } : {}),
  });
}

export async function sendFlightAgentMessage(params: {
  config: PluginConfig;
  message: string;
  openclawId: string;
  contextId?: string;
}) {
  const timeoutMs = params.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const rpcBody = {
    jsonrpc: "2.0",
    id: 1,
    method: "SendMessage",
    params: {
      message: {
        messageId: crypto.randomUUID(),
        role: "ROLE_USER",
        parts: [{ text: params.message }],
        metadata: {
          openclawId: params.openclawId,
        },
        ...(params.contextId ? { contextId: params.contextId } : {}),
      },
      metadata: {
        openclawId: params.openclawId,
      },
      ...(params.contextId ? { contextId: params.contextId } : {}),
    },
  };

  let response: Response;
  try {
    response = await fetch(`${requireBaseUrl(params.config)}/a2a`, {
      method: "POST",
      headers: buildHeaders(params.config),
      body: JSON.stringify(rpcBody),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new Error(
        `Waltz Flight Assistant timed out after ${Math.round(timeoutMs / 1000)} seconds. The backend may still be processing the booking, so check the active trip before retrying.`
      );
    }
    throw error;
  }

  const payload = await parseJsonResponse(response);
  if (payload.error) {
    throw new Error(`Waltz Flight Assistant error: ${payload.error.message ?? "unknown error"}`);
  }

  const task: A2ATask | undefined = payload.result?.task;
  if (!task) {
    throw new Error("Waltz Flight Assistant did not return a task payload");
  }

  return task;
}
