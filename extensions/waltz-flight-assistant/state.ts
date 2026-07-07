import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import type { ActiveFlightSession, PluginConfig, SessionStateLogger } from "./types";

const ACTIVE_FLIGHT_TTL_MS = 30 * 60 * 1000;

function identityStatePath(stateDir: string) {
  return path.join(stateDir, "waltz-flight-assistant", "openclaw-id.txt");
}

export async function resolveOpenclawId(
  config: PluginConfig,
  stateDir: string,
  logger: SessionStateLogger
) {
  const configured = config.openclawId ?? config.userId;
  if (configured) {
    return configured;
  }

  const filePath = identityStatePath(stateDir);
  try {
    const existing = (await readFile(filePath, "utf8")).trim();
    if (existing) {
      return existing;
    }
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      logger.warn(
        `waltz-flight-assistant failed to read persisted openclawId: ${error?.message ?? String(error)}`
      );
      throw error;
    }
  }

  const generated = `openclaw_${crypto.randomUUID()}`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${generated}\n`, "utf8");
  logger.info(`waltz-flight-assistant created persisted openclawId ${generated}`);
  return generated;
}

function sessionStateRoot(stateDir: string) {
  return path.join(stateDir, "waltz-flight-assistant", "active-sessions");
}

function sessionStatePath(stateDir: string, sessionKey: string) {
  const digest = createHash("sha256").update(sessionKey).digest("hex");
  return path.join(sessionStateRoot(stateDir), `${digest}.json`);
}

export async function readActiveFlightSession(
  stateDir: string,
  sessionKey: string,
  logger: SessionStateLogger,
  options?: { logLoad?: boolean }
): Promise<ActiveFlightSession | undefined> {
  const filePath = sessionStatePath(stateDir, sessionKey);

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as ActiveFlightSession;
    if (!parsed?.contextId || !parsed?.sessionKey) {
      await rm(filePath, { force: true });
      return undefined;
    }
    if (parsed.expiresAt <= Date.now()) {
      await rm(filePath, { force: true });
      return undefined;
    }
    if (options?.logLoad !== false) {
      logger.info(`waltz-flight-assistant loaded active session ${sessionKey} from ${filePath}`);
    }
    return parsed;
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      logger.warn(
        `waltz-flight-assistant failed to read session state for ${sessionKey}: ${error?.message ?? String(error)}`
      );
    }
    return undefined;
  }
}

export async function writeActiveFlightSession(
  stateDir: string,
  sessionKey: string,
  updates: {
    contextId: string;
    channelId?: string;
    conversationId?: string;
    accountId?: string;
    awaitingPaymentSetup?: boolean;
  },
  logger: SessionStateLogger
) {
  const filePath = sessionStatePath(stateDir, sessionKey);

  try {
    await mkdir(sessionStateRoot(stateDir), { recursive: true });
    const existing = await readActiveFlightSession(stateDir, sessionKey, logger, {
      logLoad: false,
    });
    const now = Date.now();
    const payload: ActiveFlightSession = {
      sessionKey,
      contextId: updates.contextId,
      updatedAt: now,
      expiresAt: now + ACTIVE_FLIGHT_TTL_MS,
      channelId: updates.channelId ?? existing?.channelId,
      conversationId: updates.conversationId ?? existing?.conversationId,
      accountId: updates.accountId ?? existing?.accountId,
      awaitingPaymentSetup:
        updates.awaitingPaymentSetup ?? existing?.awaitingPaymentSetup ?? false,
    };
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    logger.info(
      `waltz-flight-assistant wrote active session ${sessionKey} context=${payload.contextId} awaitingPayment=${payload.awaitingPaymentSetup ? "yes" : "no"} path=${filePath}`
    );
  } catch (error: any) {
    logger.warn(
      `waltz-flight-assistant failed to write session state for ${sessionKey}: ${error?.message ?? String(error)}`
    );
  }
}

export async function updateActiveFlightSession(
  stateDir: string,
  sessionKey: string,
  updates: Partial<
    Pick<
      ActiveFlightSession,
      "contextId" | "channelId" | "conversationId" | "accountId" | "awaitingPaymentSetup"
    >
  >,
  logger: SessionStateLogger
) {
  const existing = await readActiveFlightSession(stateDir, sessionKey, logger, {
    logLoad: false,
  });
  const contextId = updates.contextId ?? existing?.contextId;
  if (!contextId) {
    return;
  }

  await writeActiveFlightSession(
    stateDir,
    sessionKey,
    {
      contextId,
      channelId: updates.channelId,
      conversationId: updates.conversationId,
      accountId: updates.accountId,
      awaitingPaymentSetup: updates.awaitingPaymentSetup,
    },
    logger
  );
}

export async function clearActiveFlightSession(
  stateDir: string,
  sessionKey: string,
  logger: SessionStateLogger
) {
  try {
    await rm(sessionStatePath(stateDir, sessionKey), { force: true });
    logger.info(`waltz-flight-assistant cleared active session ${sessionKey}`);
  } catch (error: any) {
    logger.warn(
      `waltz-flight-assistant failed to clear session state for ${sessionKey}: ${error?.message ?? String(error)}`
    );
  }
}

export async function listActiveFlightSessions(
  stateDir: string,
  logger: SessionStateLogger
): Promise<ActiveFlightSession[]> {
  try {
    const fileNames = await readdir(sessionStateRoot(stateDir));
    const sessions = await Promise.all(
      fileNames
        .filter((fileName) => fileName.endsWith(".json"))
        .map(async (fileName) => {
          const filePath = path.join(sessionStateRoot(stateDir), fileName);
          try {
            const raw = await readFile(filePath, "utf8");
            const parsed = JSON.parse(raw) as ActiveFlightSession;
            if (!parsed?.sessionKey || !parsed?.contextId) {
              await rm(filePath, { force: true });
              return undefined;
            }
            if (parsed.expiresAt <= Date.now()) {
              await rm(filePath, { force: true });
              return undefined;
            }
            return parsed;
          } catch (error: any) {
            if (error?.code !== "ENOENT") {
              logger.warn(
                `waltz-flight-assistant failed to read persisted session ${filePath}: ${error?.message ?? String(error)}`
              );
            }
            return undefined;
          }
        })
    );

    return sessions.filter((session): session is ActiveFlightSession => !!session);
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      logger.warn(
        `waltz-flight-assistant failed to list active sessions: ${error?.message ?? String(error)}`
      );
    }
    return [];
  }
}
