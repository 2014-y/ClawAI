import { definePluginEntry, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  fetchPaymentSetupStatus,
  readConfig,
  sendFlightAgentMessage,
  sendOutboundText,
} from "./api";
import {
  clearActiveFlightSession,
  listActiveFlightSessions,
  readActiveFlightSession,
  resolveOpenclawId,
  updateActiveFlightSession,
  writeActiveFlightSession,
} from "./state";
import type { A2ATask } from "./types";

const PAYMENT_SETUP_RESUME_POLL_MS = 5_000;

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extractTaskText(task: A2ATask) {
  const parts: string[] = [];
  let action: any | undefined;
  let booking: any | undefined;
  let hasNarrativeText = false;

  for (const artifact of task.artifacts ?? []) {
    for (const part of artifact.parts ?? []) {
      if (part.text) {
        parts.push(part.text);
        hasNarrativeText = true;
      }

      if (!part.data) {
        continue;
      }

      if (part.data.action) {
        action = part.data.action;
        if (!hasNarrativeText && action.type === "payment_setup_required") {
          parts.push(
            [
              "**PAYMENT SETUP REQUIRED**",
              `Add a card here: ${action.setupUrl}`,
              "After setup is complete, continue the booking conversation.",
            ].join("\n")
          );
        }
        if (!hasNarrativeText && action.type === "approval_required") {
          parts.push(
            [
              "**APPROVAL REQUIRED**",
              `Charge ${action.flight?.totalPrice ?? "unknown"} ${action.flight?.currency ?? "USD"} to ${action.paymentMethod?.brand ?? "card"} ending in ${action.paymentMethod?.lastFour}?`,
              "Ask the user for explicit approval, then continue the conversation.",
            ].join("\n")
          );
        }
        if (!hasNarrativeText && action.type === "payment_authentication_required") {
          parts.push(
            [
              "**PAYMENT AUTHENTICATION REQUIRED**",
              `Open this link to complete bank authentication: ${action.authenticationUrl}`,
              "After it succeeds, continue the booking conversation.",
            ].join("\n")
          );
        }
      }

      if (part.data.booking) {
        booking = part.data.booking;
        if (!hasNarrativeText) {
          parts.push(
            [
              "**BOOKING CONFIRMED**",
              `Reference: ${booking.bookingReference}`,
              booking.flightSummary,
              `Total: ${booking.totalCharged} ${booking.currency}`,
            ].filter(Boolean).join("\n")
          );
        }
      }
    }
  }

  if (parts.length === 0) {
    for (const part of task.status?.message?.parts ?? []) {
      if (part.text) {
        parts.push(part.text);
      }
    }
  }

  if (action?.type === "payment_setup_required" && action.setupUrl) {
    return {
      text: [
        "**PAYMENT SETUP REQUIRED**",
        `Add a card here: ${action.setupUrl}`,
        "After setup is complete, continue the booking conversation.",
      ].join("\n"),
      action,
      booking,
    };
  }

  if (action?.type === "payment_authentication_required" && action.authenticationUrl) {
    return {
      text: [
        "**PAYMENT AUTHENTICATION REQUIRED**",
        `Open this link to complete bank authentication: ${action.authenticationUrl}`,
        "After it succeeds, continue the booking conversation.",
      ].join("\n"),
      action,
      booking,
    };
  }

  return {
    text: parts.join("\n\n").trim(),
    action,
    booking,
  };
}

function extractTextParts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTextParts(item));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [
      ...extractTextParts(record.text),
      ...extractTextParts(record.content),
      ...extractTextParts(record.message),
    ];
  }
  return [];
}

function extractLatestFlightContextId(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = extractTextParts(messages[index]).join("\n");
    const match = text.match(/FLIGHT_CONTEXT_ID:\s*([A-Za-z0-9-]+)/);
    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
}

function extractMessageRole(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const role =
    asString(record.role) ??
    asString(record.authorRole) ??
    asString((record.message as Record<string, unknown> | undefined)?.role) ??
    asString((record.sender as Record<string, unknown> | undefined)?.role);
  return role?.toLowerCase();
}

function findLatestMessageTextByRole(messages: unknown, rolePattern: RegExp): string | undefined {
  if (!Array.isArray(messages)) return undefined;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const role = extractMessageRole(message);
    if (!role || !rolePattern.test(role)) {
      continue;
    }

    const text = extractTextParts(message).join("\n").trim();
    if (text) {
      return text;
    }
  }

  return undefined;
}

function findLatestMessageText(messages: unknown, skip = 0): string | undefined {
  if (!Array.isArray(messages)) return undefined;

  let seen = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = extractTextParts(messages[index]).join("\n").trim();
    if (!text) {
      continue;
    }
    if (seen < skip) {
      seen += 1;
      continue;
    }
    return text;
  }

  return undefined;
}

function normalizeContinuationMessage(latestUserText: string, latestAssistantText: string): string | undefined {
  const trimmed = latestUserText.trim();
  const normalized = trimmed.toLowerCase();
  const assistantNormalized = latestAssistantText.toLowerCase();

  if (!trimmed) return undefined;

  if (/^(option\s+)?[1-9]$/.test(normalized)) {
    const selection = normalized.match(/[1-9]/)?.[0];
    return `The user selected option ${selection}. Continue the active flight workflow with that choice.`;
  }

  if (/^(book it|go ahead|go ahead and book|proceed|continue)$/.test(normalized)) {
    return "The user gave explicit approval to continue booking the currently selected flight. Continue the active flight workflow now.";
  }

  if (/^(yes|yep|yeah|sure|ok|okay)$/.test(normalized)) {
    return "The user answered yes to the immediately preceding flight-booking question. Continue the active flight workflow and resolve that yes in context.";
  }

  if (/^(no|nope|nah)$/.test(normalized)) {
    if (/\b(frequent flier|frequent flyer|loyalty|oneworld|american airlines|british airways)\b/.test(assistantNormalized)) {
      return "The user does not want to add a frequent flyer or loyalty number. Continue the active flight workflow without one.";
    }

    if (/\b(airport preference|cabin class|business|premium economy|layover|departure time)\b/.test(assistantNormalized)) {
      return "The user does not want to change the current flight preferences. Continue the active flight workflow with the currently selected option.";
    }

    return "The user answered no to the immediately preceding optional flight-booking question. Continue the active flight workflow in context.";
  }

  if (trimmed.length <= 32) {
    return `Treat the user's short reply "${trimmed}" as a continuation of the active flight workflow, not a new topic.`;
  }

  return undefined;
}

function isExplicitTripReset(messageText: string): boolean {
  return /\b(cancel|nevermind|never mind|start over|new trip|different trip)\b/i.test(messageText);
}

function looksLikeRouteShorthand(messageText: string): boolean {
  const trimmed = messageText.trim();
  if (!/\bto\b/i.test(trimmed)) {
    return false;
  }

  const routeMatch = trimmed.match(
    /(^|\b)([A-Za-z]{3,}|[A-Za-z]{3})\s+to\s+([A-Za-z][A-Za-z\s'-]{2,}|[A-Za-z]{3})(\b|$)/i
  );
  if (!routeMatch) {
    return false;
  }

  const hasDateHint =
    /\b(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b/i.test(trimmed) ||
    /\b\d{4}-\d{2}-\d{2}\b/.test(trimmed) ||
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(trimmed) ||
    /\btoday\b/i.test(trimmed) ||
    /\btomorrow\b/i.test(trimmed);
  const hasTripHint =
    /\bone[ -]?way\b/i.test(trimmed) ||
    /\bround trip\b/i.test(trimmed) ||
    /\breturn(?:ing)?\b/i.test(trimmed) ||
    /\bnonstop\b/i.test(trimmed) ||
    /\bdirect\b/i.test(trimmed);

  return hasDateHint || hasTripHint;
}

function isLikelyNewTripRequest(messageText: string): boolean {
  return (
    /\b(book me a flight|find flights?|search flights?|flight from .+ to .+|from .+ to .+ on)\b/i.test(messageText) ||
    looksLikeRouteShorthand(messageText)
  );
}

export default definePluginEntry({
  id: "waltz-flight-assistant",
  name: "Waltz Flight Assistant",
  description: "Book a flight end to end, in one conversation.",
  register(api: any) {
    const config = readConfig((api.pluginConfig ?? {}) as Record<string, unknown>);
    const stateDir = api.runtime.state.resolveStateDir();
    const openclawIdPromise = resolveOpenclawId(config, stateDir, api.logger);
    const paymentResumeInFlight = new Set<string>();
    api.logger.info(`waltz-flight-assistant stateDir=${stateDir}`);
    api.on("before_dispatch", async (event: any, ctx: any) => {
      const sessionKey = asString(ctx?.sessionKey ?? event?.sessionKey);
      const channelId = asString(ctx?.channelId ?? event?.channel);
      const conversationId = asString(ctx?.conversationId ?? event?.conversationId);
      const accountId = asString(ctx?.accountId ?? event?.accountId);
      if (!sessionKey || !channelId || !conversationId) {
        return;
      }

      await updateActiveFlightSession(
        stateDir,
        sessionKey,
        {
          channelId,
          conversationId,
          accountId,
        },
        api.logger
      );
    });

    api.on("before_prompt_build", async (event: any, ctx: any) => {
      const sessionKey = asString(ctx?.sessionKey);
      if (!sessionKey) {
        return;
      }

      const messages = event?.messages ?? [];
      const latestUserText =
        findLatestMessageTextByRole(messages, /\b(user|human)\b/) ??
        findLatestMessageText(messages, 0) ??
        asString(event?.prompt) ??
        "";
      if (latestUserText && (isExplicitTripReset(latestUserText) || isLikelyNewTripRequest(latestUserText))) {
        await clearActiveFlightSession(stateDir, sessionKey, api.logger);
        api.logger.info(`waltz-flight-assistant cleared active session before prompt build for ${sessionKey}`);
        return;
      }

      const activeSession = await readActiveFlightSession(stateDir, sessionKey, api.logger);
      const activeContextId =
        activeSession?.contextId ?? extractLatestFlightContextId(messages);
      if (!activeContextId) return;

      const latestAssistantText =
        findLatestMessageTextByRole(messages, /\b(assistant|model|agent)\b/) ??
        findLatestMessageText(messages, 1) ??
        "";
      const normalizedFollowUp = latestUserText
        ? normalizeContinuationMessage(latestUserText, latestAssistantText)
        : undefined;
      api.logger.info(
        `waltz-flight-assistant before_prompt_build session=${sessionKey} context=${activeContextId} user="${latestUserText.slice(0, 80)}" normalized=${normalizedFollowUp ? "yes" : "no"}`
      );

      return {
        prependContext: [
          "ACTIVE FLIGHT SESSION",
          `This OpenClaw session has an active hidden flight workflow with context_id "${activeContextId}".`,
          normalizedFollowUp ??
            "Treat the current user message as a continuation of that same flight workflow unless the user explicitly cancels or clearly starts a different trip.",
          `For this turn, call flight_assistant with context_id "${activeContextId}" before replying.`,
          "Do not answer flight follow-ups from memory.",
          "Do not ask the user to restate route, date, option selection, or loyalty number already present in the active workflow.",
        ].join("\n"),
      };
    });

    api.on("before_agent_reply", async (event: any, ctx: any) => {
      const sessionKey = asString(ctx?.sessionKey);
      const cleanedBody = asString(event?.cleanedBody) ?? "";
      if (!sessionKey || !cleanedBody) {
        return;
      }

      if (isExplicitTripReset(cleanedBody) || isLikelyNewTripRequest(cleanedBody)) {
        await clearActiveFlightSession(stateDir, sessionKey, api.logger);
        api.logger.info(
          `waltz-flight-assistant before_agent_reply cleared active session for new trip session=${sessionKey} message="${cleanedBody.slice(0, 120)}"`
        );
        return;
      }

      const activeSession = await readActiveFlightSession(stateDir, sessionKey, api.logger);
      if (!activeSession) {
        return;
      }

      api.logger.info(
        `waltz-flight-assistant before_agent_reply session=${sessionKey} context=${activeSession.contextId} message="${cleanedBody.slice(0, 120)}"`
      );

      try {
        const task = await sendFlightAgentMessage({
          config,
          message: cleanedBody,
          openclawId: await openclawIdPromise,
          contextId: activeSession.contextId,
        });

        const result = extractTaskText(task);
        if (task.contextId) {
          await writeActiveFlightSession(
            stateDir,
            sessionKey,
            {
              contextId: task.contextId,
              awaitingPaymentSetup: result.action?.type === "payment_setup_required",
            },
            api.logger
          );
        }
        if (result.booking) {
          await clearActiveFlightSession(stateDir, sessionKey, api.logger);
        } else if (result.action?.type !== "payment_setup_required") {
          await updateActiveFlightSession(
            stateDir,
            sessionKey,
            { awaitingPaymentSetup: false },
            api.logger
          );
        }

        if (activeSession.channelId && activeSession.conversationId) {
          await sendOutboundText({
            api,
            session: activeSession,
            text: result.text || "Waltz Flight Assistant returned no text.",
          });
          api.logger.info(
            `waltz-flight-assistant before_agent_reply sent outbound text session=${sessionKey} channel=${activeSession.channelId}`
          );
          return {
            handled: true,
            reason: "active-flight-session-outbound",
          };
        }

        return {
          handled: true,
          reason: "active-flight-session",
          reply: {
            text: result.text || "Waltz Flight Assistant returned no text.",
          },
        };
      } catch (error: any) {
        api.logger.warn(
          `waltz-flight-assistant before_agent_reply failed session=${sessionKey}: ${error?.message ?? String(error)}`
        );
        if (activeSession.channelId && activeSession.conversationId) {
          try {
            await sendOutboundText({
              api,
              session: activeSession,
              text: "Waltz Flight Assistant hit an error while continuing your trip. Please try again in a moment.",
            });
            return {
              handled: true,
              reason: "active-flight-session-error-outbound",
            };
          } catch (sendError: any) {
            api.logger.warn(
              `waltz-flight-assistant outbound send failed session=${sessionKey}: ${sendError?.message ?? String(sendError)}`
            );
          }
        }
        return {
          handled: true,
          reason: "active-flight-session-error",
          reply: {
            text: "Waltz Flight Assistant hit an error while continuing your trip. Please try again in a moment.",
            isError: true,
          },
        };
      }
    });

    api.on("before_tool_call", async (event: any, ctx: any) => {
      if (event?.toolName !== "flight_assistant") {
        return;
      }

      const sessionKey = asString(ctx?.sessionKey);
      if (!sessionKey) {
        return;
      }

      const activeSession = await readActiveFlightSession(stateDir, sessionKey, api.logger);
      if (!activeSession) {
        return;
      }

      const params = { ...(event?.params ?? {}) } as Record<string, unknown>;
      const message = asString(params.message) ?? "";
      const explicitReset = isExplicitTripReset(message);
      if (explicitReset) {
        return;
      }

      const newConversation = params.new_conversation === true;
      if (newConversation || !asString(params.context_id)) {
        api.logger.info(
          `waltz-flight-assistant before_tool_call session=${sessionKey} patchedContext=${activeSession.contextId} new=${newConversation ? "yes" : "no"}`
        );
        return {
          params: {
            ...params,
            context_id: activeSession.contextId,
            new_conversation: false,
          },
        };
      }
    });

    api.registerTool((toolCtx: OpenClawPluginToolContext) => ({
      name: "flight_assistant",
      description:
        "Search, book, and retrieve real flight bookings through the hosted Waltz Flight Assistant backend. Use it for flight search, comparison, booking, upcoming-trip recall, stored booking references, and post-booking follow-ups. Reuse context_id from prior calls to continue the same trip. Once a trip has a context_id, send that exact context_id on every later flight_assistant call until the booking succeeds, the user explicitly cancels, or the user starts a different trip. For short follow-ups like '1', '2', 'yes', 'no', 'go ahead', or 'book it', continue the existing trip instead of restarting. Present search results as short numbered options or short bullets, never markdown tables or code blocks.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["message"],
        properties: {
          message: {
            type: "string",
            description: "Natural language request such as 'Find flights from SFO to Tokyo on April 20' or 'What flights do I have coming up?'.",
          },
          context_id: {
            type: "string",
            description: "Conversation context id returned by a previous flight_assistant call.",
          },
          new_conversation: {
            type: "boolean",
            description: "Set true to ignore any prior context and start a new trip.",
          },
        },
      },
      async execute(_toolCallId: string, params: any) {
        const sessionKey = toolCtx.sessionKey;
        const activeSession = sessionKey
          ? await readActiveFlightSession(stateDir, sessionKey, api.logger)
          : undefined;
        const contextId = params.new_conversation
          ? undefined
          : params.context_id ?? activeSession?.contextId;
        api.logger.info(
          `flight_assistant execute session=${sessionKey ?? "none"} context=${contextId ?? "none"} new=${params.new_conversation ? "yes" : "no"} message="${params.message.slice(0, 120)}"`
        );
        const task = await sendFlightAgentMessage({
          config,
          message: params.message,
          openclawId: await openclawIdPromise,
          contextId,
        });

        if (task.contextId && sessionKey) {
          const result = extractTaskText(task);
          await writeActiveFlightSession(
            stateDir,
            sessionKey,
            {
              contextId: task.contextId,
              awaitingPaymentSetup: result.action?.type === "payment_setup_required",
            },
            api.logger
          );
          if (result.booking) {
            await clearActiveFlightSession(stateDir, sessionKey, api.logger);
          } else if (result.action?.type !== "payment_setup_required") {
            await updateActiveFlightSession(
              stateDir,
              sessionKey,
              { awaitingPaymentSetup: false },
              api.logger
            );
          }
          const summary = result.text || "Waltz Flight Assistant returned no text.";

          return {
            content: [{ type: "text", text: summary }],
            details: {
              context_id: task.contextId,
              action: result.action,
              booking: result.booking,
            },
          };
        } else if (params.new_conversation) {
          if (sessionKey) {
            await clearActiveFlightSession(stateDir, sessionKey, api.logger);
          }
        } else {
          api.logger.info(
            `flight_assistant no persisted context session=${sessionKey ?? "none"} taskContext=${task.contextId ?? "none"}`
          );
        }

        const result = extractTaskText(task);
        const summary = result.text || "Waltz Flight Assistant returned no text.";

        return {
          content: [{ type: "text", text: summary }],
          details: {
            context_id: task.contextId,
            action: result.action,
            booking: result.booking,
          },
        };
      },
    }), { name: "flight_assistant" });

    const pollForCompletedPaymentSetup = async () => {
      const sessions = await listActiveFlightSessions(stateDir, api.logger);
      if (sessions.length === 0) {
        return;
      }

      const openclawId = await openclawIdPromise;

      for (const session of sessions) {
        if (
          !session.awaitingPaymentSetup ||
          !session.channelId ||
          !session.conversationId ||
          paymentResumeInFlight.has(session.sessionKey)
        ) {
          continue;
        }

        paymentResumeInFlight.add(session.sessionKey);
        try {
          const status = await fetchPaymentSetupStatus({
            config,
            contextId: session.contextId,
            openclawId,
          });

          if (status.status === "awaiting_payment_setup") {
            continue;
          }

          if (status.status === "no_pending_booking") {
            await updateActiveFlightSession(
              stateDir,
              session.sessionKey,
              { awaitingPaymentSetup: false },
              api.logger
            );
            continue;
          }

          if (status.status !== "ready_to_resume") {
            api.logger.warn(
              `waltz-flight-assistant payment setup poll session=${session.sessionKey} unexpected status=${status.status}`
            );
            continue;
          }

          api.logger.info(
            `waltz-flight-assistant auto-resuming booking after card setup session=${session.sessionKey} context=${session.contextId}`
          );

          const task = await sendFlightAgentMessage({
            config,
            openclawId,
            contextId: session.contextId,
            message:
              "The user has completed Stripe card setup. Continue the active booking workflow now. If a saved card is available, confirm the exact total and ask for explicit approval to charge it. Do not ask the user to repeat traveler, route, or loyalty details already collected.",
          });
          const result = extractTaskText(task);
          const outboundText = result.text || "Your card is saved. Let's continue your booking.";

          await sendOutboundText({
            api,
            session,
            text: outboundText,
          });

          if (result.booking) {
            await clearActiveFlightSession(stateDir, session.sessionKey, api.logger);
            continue;
          }

          await writeActiveFlightSession(
            stateDir,
            session.sessionKey,
            {
              contextId: task.contextId ?? session.contextId,
              channelId: session.channelId,
              conversationId: session.conversationId,
              accountId: session.accountId,
              awaitingPaymentSetup: result.action?.type === "payment_setup_required",
            },
            api.logger
          );
        } catch (error: any) {
          api.logger.warn(
            `waltz-flight-assistant auto-resume failed session=${session.sessionKey}: ${error?.message ?? String(error)}`
          );
        } finally {
          paymentResumeInFlight.delete(session.sessionKey);
        }
      }
    };

    const paymentSetupPoller = setInterval(() => {
      void pollForCompletedPaymentSetup();
    }, PAYMENT_SETUP_RESUME_POLL_MS);
    paymentSetupPoller.unref?.();

    api.on("gateway_stop", () => {
      clearInterval(paymentSetupPoller);
    });
  },
});
