import { n as requiresExplicitMatrixDefaultAccount } from "./account-selection-Bv_ZuOu4.js";
import { a as resolveMatrixAccountConfig } from "./account-config-BZWN9tGS.js";
import { d as resolveSingleAccountPromotionTarget, f as singleAccountKeysToMove, g as resolveMatrixAccount, h as resolveDefaultMatrixAccountId, n as matrixSetupAdapter, p as listMatrixAccountIds, t as createMatrixSetupWizardProxy, u as namedAccountPromotionKeys } from "./setup-core-0q_2Acbn.js";
import { a as normalizeMatrixUserId, n as DEFAULT_ACCOUNT_ID$2, r as matrixConfigAdapter, t as MatrixChannelConfigSchema } from "./config-schema-26chdmvB.js";
import { t as normalizeMatrixApproverId } from "./approval-ids-BxDWGGtc.js";
import { a as resolveMatrixTargetIdentity, i as resolveMatrixDirectUserId, n as normalizeMatrixMessagingTarget, r as normalizeMatrixResolvableTarget } from "./target-ids-B-5aQxwn.js";
import { t as formatMatrixErrorMessage } from "./errors-C47hvAF8.js";
import { n as normalizeCompatibilityConfig, t as legacyConfigRules } from "./doctor-contract-Dq8OZWHF.js";
import { d as setMatrixThreadBindingIdleTimeoutBySessionKey, p as setMatrixThreadBindingMaxAgeBySessionKey } from "./thread-bindings-shared-CKnY4LSd.js";
import { n as collectRuntimeConfigAssignments, r as secretTargetRegistryEntries } from "./secret-contract-DTgQyQxc.js";
import { i as autoPrepareLegacyMatrixCrypto, o as autoMigrateLegacyMatrixState, r as resolveMatrixMigrationStatus } from "./matrix-migration.runtime-dvxE3e5l.js";
import { t as maybeCreateMatrixMigrationSnapshot } from "./migration-snapshot-backup-YcCrSjbE.js";
import { n as resolveMatrixInboundConversation } from "./thread-binding-api-DRbBZlhS.js";
import { describeAccountSnapshot } from "openclaw/plugin-sdk/account-helpers";
import { adaptScopedAccountAccessor, createScopedDmSecurityResolver } from "openclaw/plugin-sdk/channel-config-helpers";
import { buildChannelOutboundSessionRoute, buildThreadAwareOutboundSessionRoute, createChatChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import { createChannelMessageAdapterFromOutbound, createReplyPrefixOptions, createRuntimeOutboundDelegates, createTypingCallbacks, logTypingFailure } from "openclaw/plugin-sdk/channel-outbound";
import { createAllowlistProviderOpenWarningCollector, projectAccountConfigWarningCollector } from "openclaw/plugin-sdk/channel-policy";
import { createScopedAccountReplyToModeResolver } from "openclaw/plugin-sdk/conversation-runtime";
import { createChannelDirectoryAdapter, createResolvedDirectoryEntriesLister, createRuntimeDirectoryLiveAdapter } from "openclaw/plugin-sdk/directory-runtime";
import { createLazyRuntimeNamedExport } from "openclaw/plugin-sdk/lazy-runtime";
import { buildProbeChannelStatusSummary, collectStatusIssuesFromLastError, createComputedAccountStatusAdapter, createDefaultChannelRuntimeState } from "openclaw/plugin-sdk/status-helpers";
import { normalizeLowercaseStringOrEmpty, normalizeOptionalString, normalizeOptionalStringifiedId } from "openclaw/plugin-sdk/string-coerce-runtime";
import { chunkTextForOutbound } from "openclaw/plugin-sdk/text-chunking";
import { ToolAuthorizationError, createActionGate, readPositiveIntegerParam, readStringParam } from "openclaw/plugin-sdk/channel-actions";
import { extractToolSend } from "openclaw/plugin-sdk/tool-send";
import { Type } from "typebox";
import { normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { createApproverRestrictedNativeApprovalCapability, createChannelApprovalCapability, splitChannelApprovalCapability } from "openclaw/plugin-sdk/approval-delivery-runtime";
import { createLazyChannelApprovalNativeRuntimeAdapter } from "openclaw/plugin-sdk/approval-handler-adapter-runtime";
import { createChannelNativeOriginTargetResolver, resolveApprovalRequestChannelAccountId, resolveApprovalRequestSessionConversation } from "openclaw/plugin-sdk/approval-native-runtime";
import { createResolvedApproverActionAuthAdapter, resolveApprovalApprovers } from "openclaw/plugin-sdk/approval-auth-runtime";
import { addAllowlistUserEntriesFromConfigEntry, buildAllowlistResolutionSummary, canonicalizeAllowlistWithResolvedIds, patchAllowlistUsersInConfigEntries, summarizeMapping } from "openclaw/plugin-sdk/allow-from";
import { createChannelExecApprovalProfile, getExecApprovalReplyMetadata, isChannelExecApprovalClientEnabledFromConfig, isChannelExecApprovalTargetRecipient, matchesApprovalRequestFilters } from "openclaw/plugin-sdk/approval-client-runtime";
import { normalizeAccountId as normalizeAccountId$1, parseThreadSessionSuffix } from "openclaw/plugin-sdk/routing";
import { createPairingPrefixStripper } from "openclaw/plugin-sdk/channel-pairing";
import { PAIRING_APPROVED_MESSAGE } from "openclaw/plugin-sdk/channel-status";
import { formatLocationText, logInboundDrop, toLocationContext } from "openclaw/plugin-sdk/channel-inbound";
import { getAgentScopedMediaLocalRoots } from "openclaw/plugin-sdk/agent-media-payload";
import { buildChannelKeyCandidates, resolveChannelEntryMatch } from "openclaw/plugin-sdk/channel-targets";
import { loadSessionStore, resolveSessionStoreEntry, resolveStorePath } from "openclaw/plugin-sdk/session-store-runtime";
//#region extensions/matrix/src/actions.ts
const MATRIX_PLUGIN_HANDLED_ACTIONS = new Set([
	"send",
	"poll-vote",
	"react",
	"reactions",
	"read",
	"edit",
	"delete",
	"pin",
	"unpin",
	"list-pins",
	"set-profile",
	"member-info",
	"channel-info",
	"permissions"
]);
const MATRIX_PROFILE_MEDIA_PROPERTIES = {
	avatarUrl: Type.Optional(Type.String({ description: "Profile avatar URL for Matrix self-profile update actions. Matrix accepts mxc:// and http(s) URLs." })),
	avatar_url: Type.Optional(Type.String({ description: "snake_case alias of avatarUrl for Matrix self-profile update actions. Matrix accepts mxc:// and http(s) URLs." })),
	avatarPath: Type.Optional(Type.String({ description: "Local avatar file path for Matrix self-profile update actions. Matrix uploads this file and sets the resulting MXC URI." })),
	avatar_path: Type.Optional(Type.String({ description: "snake_case alias of avatarPath for Matrix self-profile update actions. Matrix uploads this file and sets the resulting MXC URI." }))
};
const MATRIX_PROFILE_MEDIA_SOURCE_PARAMS = Object.freeze(["avatarUrl", "avatarPath"]);
function createMatrixExposedActions(params) {
	const actions = new Set(["poll", "poll-vote"]);
	if (params.gate("messages")) {
		actions.add("send");
		actions.add("read");
		actions.add("edit");
		actions.add("delete");
	}
	if (params.gate("reactions")) {
		actions.add("react");
		actions.add("reactions");
	}
	if (params.gate("pins")) {
		actions.add("pin");
		actions.add("unpin");
		actions.add("list-pins");
	}
	if (params.gate("profile") && params.senderIsOwner === true) actions.add("set-profile");
	if (params.gate("memberInfo")) actions.add("member-info");
	if (params.gate("channelInfo")) actions.add("channel-info");
	if (params.encryptionEnabled && params.gate("verification")) actions.add("permissions");
	return actions;
}
function buildMatrixProfileToolSchema() {
	return {
		actions: ["set-profile"],
		properties: {
			displayName: Type.Optional(Type.String({ description: "Profile display name for Matrix self-profile update actions." })),
			display_name: Type.Optional(Type.String({ description: "snake_case alias of displayName for Matrix self-profile update actions." })),
			...MATRIX_PROFILE_MEDIA_PROPERTIES
		}
	};
}
const matrixMessageActions = {
	describeMessageTool: ({ cfg, accountId, senderIsOwner }) => {
		const resolvedCfg = cfg;
		if (!accountId && requiresExplicitMatrixDefaultAccount(resolvedCfg)) return {
			actions: [],
			capabilities: []
		};
		const account = resolveMatrixAccount({
			cfg: resolvedCfg,
			accountId: accountId ?? resolveDefaultMatrixAccountId(resolvedCfg)
		});
		if (!account.enabled || !account.configured) return {
			actions: [],
			capabilities: []
		};
		const actions = createMatrixExposedActions({
			gate: createActionGate(account.config.actions),
			encryptionEnabled: account.config.encryption === true,
			senderIsOwner
		});
		const listedActions = Array.from(actions);
		return {
			actions: listedActions,
			capabilities: [],
			schema: listedActions.includes("set-profile") ? buildMatrixProfileToolSchema() : null,
			mediaSourceParams: listedActions.includes("set-profile") ? { "set-profile": MATRIX_PROFILE_MEDIA_SOURCE_PARAMS } : null
		};
	},
	supportsAction: ({ action }) => MATRIX_PLUGIN_HANDLED_ACTIONS.has(action),
	extractToolSend: ({ args }) => {
		return extractToolSend(args, "sendMessage");
	},
	handleAction: async (ctx) => {
		const { handleMatrixAction } = await import("./tool-actions.runtime-Ce4n5hC2.js");
		const { action, params, cfg, accountId, mediaLocalRoots } = ctx;
		const dispatch = async (actionParams) => await handleMatrixAction({
			...actionParams,
			...accountId ? { accountId } : {}
		}, cfg, { mediaLocalRoots });
		const resolveRoomId = () => readStringParam(params, "roomId") ?? readStringParam(params, "channelId") ?? readStringParam(params, "to", { required: true });
		if (action === "send") {
			const to = readStringParam(params, "to", { required: true });
			const mediaUrl = readStringParam(params, "media", { trim: false }) ?? readStringParam(params, "mediaUrl", { trim: false }) ?? readStringParam(params, "filePath", { trim: false }) ?? readStringParam(params, "path", { trim: false });
			const content = readStringParam(params, "message", {
				required: !mediaUrl,
				allowEmpty: true
			});
			const replyTo = readStringParam(params, "replyTo");
			const threadId = readStringParam(params, "threadId");
			const audioAsVoice = typeof params.asVoice === "boolean" ? params.asVoice : typeof params.audioAsVoice === "boolean" ? params.audioAsVoice : void 0;
			return await dispatch({
				action: "sendMessage",
				to,
				content,
				mediaUrl: mediaUrl ?? void 0,
				replyToId: replyTo ?? void 0,
				threadId: threadId ?? void 0,
				audioAsVoice
			});
		}
		if (action === "poll-vote") return await dispatch({
			...params,
			action: "pollVote"
		});
		if (action === "react") {
			const messageId = readStringParam(params, "messageId", { required: true });
			const emoji = readStringParam(params, "emoji", { allowEmpty: true });
			const remove = typeof params.remove === "boolean" ? params.remove : void 0;
			return await dispatch({
				action: "react",
				roomId: resolveRoomId(),
				messageId,
				emoji,
				remove
			});
		}
		if (action === "reactions") {
			const messageId = readStringParam(params, "messageId", { required: true });
			const limit = readPositiveIntegerParam(params, "limit", { message: "limit must be a positive integer." });
			return await dispatch({
				action: "reactions",
				roomId: resolveRoomId(),
				messageId,
				limit
			});
		}
		if (action === "read") {
			const limit = readPositiveIntegerParam(params, "limit", { message: "limit must be a positive integer." });
			return await dispatch({
				action: "readMessages",
				roomId: resolveRoomId(),
				limit,
				before: readStringParam(params, "before"),
				after: readStringParam(params, "after"),
				threadId: readStringParam(params, "threadId")
			});
		}
		if (action === "edit") {
			const messageId = readStringParam(params, "messageId", { required: true });
			const content = readStringParam(params, "message", { required: true });
			return await dispatch({
				action: "editMessage",
				roomId: resolveRoomId(),
				messageId,
				content
			});
		}
		if (action === "delete") {
			const messageId = readStringParam(params, "messageId", { required: true });
			return await dispatch({
				action: "deleteMessage",
				roomId: resolveRoomId(),
				messageId
			});
		}
		if (action === "pin" || action === "unpin" || action === "list-pins") {
			const messageId = action === "list-pins" ? void 0 : readStringParam(params, "messageId", { required: true });
			return await dispatch({
				action: action === "pin" ? "pinMessage" : action === "unpin" ? "unpinMessage" : "listPins",
				roomId: resolveRoomId(),
				messageId
			});
		}
		if (action === "set-profile") {
			if (ctx.senderIsOwner !== true) throw new ToolAuthorizationError("Matrix profile updates require owner access.");
			const avatarPath = readStringParam(params, "avatarPath") ?? readStringParam(params, "path") ?? readStringParam(params, "filePath");
			return await dispatch({
				action: "setProfile",
				displayName: readStringParam(params, "displayName") ?? readStringParam(params, "name"),
				avatarUrl: readStringParam(params, "avatarUrl"),
				avatarPath
			});
		}
		if (action === "member-info") return await dispatch({
			action: "memberInfo",
			userId: readStringParam(params, "userId", { required: true }),
			roomId: readStringParam(params, "roomId") ?? readStringParam(params, "channelId")
		});
		if (action === "channel-info") return await dispatch({
			action: "channelInfo",
			roomId: resolveRoomId()
		});
		if (action === "permissions") {
			const operation = normalizeLowercaseStringOrEmpty(readStringParam(params, "operation") ?? readStringParam(params, "mode") ?? "verification-list");
			const operationToAction = {
				"encryption-status": "encryptionStatus",
				"verification-status": "verificationStatus",
				"verification-bootstrap": "verificationBootstrap",
				"verification-recovery-key": "verificationRecoveryKey",
				"verification-backup-status": "verificationBackupStatus",
				"verification-backup-restore": "verificationBackupRestore",
				"verification-list": "verificationList",
				"verification-request": "verificationRequest",
				"verification-accept": "verificationAccept",
				"verification-cancel": "verificationCancel",
				"verification-start": "verificationStart",
				"verification-generate-qr": "verificationGenerateQr",
				"verification-scan-qr": "verificationScanQr",
				"verification-sas": "verificationSas",
				"verification-confirm": "verificationConfirm",
				"verification-mismatch": "verificationMismatch",
				"verification-confirm-qr": "verificationConfirmQr"
			};
			const resolvedAction = operationToAction[operation];
			if (!resolvedAction) throw new Error(`Unsupported Matrix permissions operation: ${operation}. Supported values: ${Object.keys(operationToAction).join(", ")}`);
			return await dispatch({
				...params,
				action: resolvedAction
			});
		}
		throw new Error(`Action ${action} is not supported for provider matrix.`);
	}
};
//#endregion
//#region extensions/matrix/src/approval-auth.ts
function getMatrixApprovalAuthApprovers(params) {
	return resolveApprovalApprovers({
		allowFrom: resolveMatrixAccount(params).config.dm?.allowFrom,
		normalizeApprover: normalizeMatrixApproverId
	});
}
const matrixApprovalAuth = createResolvedApproverActionAuthAdapter({
	channelLabel: "Matrix",
	resolveApprovers: ({ cfg, accountId }) => getMatrixApprovalAuthApprovers({
		cfg,
		accountId
	}),
	normalizeSenderId: (value) => normalizeMatrixApproverId(value)
});
//#endregion
//#region extensions/matrix/src/exec-approvals.ts
function normalizeMatrixExecApproverId(value) {
	const normalized = normalizeMatrixApproverId(value);
	return normalized === "*" ? void 0 : normalized;
}
function resolveMatrixExecApprovalConfig(params) {
	const account = resolveMatrixAccount(params);
	const config = account.config.execApprovals;
	if (!config) return;
	return {
		...config,
		enabled: account.enabled && account.configured ? config.enabled : false
	};
}
function countMatrixExecApprovalEligibleAccounts(params) {
	return listMatrixAccountIds(params.cfg).filter((accountId) => {
		const account = resolveMatrixAccount({
			cfg: params.cfg,
			accountId
		});
		if (!account.enabled || !account.configured) return false;
		const config = resolveMatrixExecApprovalConfig({
			cfg: params.cfg,
			accountId
		});
		const filters = config?.enabled ? {
			agentFilter: config.agentFilter,
			sessionFilter: config.sessionFilter
		} : {
			agentFilter: void 0,
			sessionFilter: void 0
		};
		return isChannelExecApprovalClientEnabledFromConfig({
			enabled: config?.enabled,
			approverCount: getMatrixApprovalApprovers({
				cfg: params.cfg,
				accountId,
				approvalKind: params.approvalKind
			}).length
		}) && matchesApprovalRequestFilters({
			request: params.request.request,
			agentFilter: filters.agentFilter,
			sessionFilter: filters.sessionFilter
		});
	}).length;
}
function matchesMatrixRequestAccount(params) {
	const turnSourceChannel = normalizeLowercaseStringOrEmpty(params.request.request.turnSourceChannel);
	const boundAccountId = resolveApprovalRequestChannelAccountId({
		cfg: params.cfg,
		request: params.request,
		channel: "matrix"
	});
	if (turnSourceChannel && turnSourceChannel !== "matrix" && !boundAccountId) return countMatrixExecApprovalEligibleAccounts({
		cfg: params.cfg,
		request: params.request,
		approvalKind: params.approvalKind
	}) <= 1;
	return !boundAccountId || !params.accountId || normalizeAccountId$1(boundAccountId) === normalizeAccountId$1(params.accountId);
}
function getMatrixExecApprovalApprovers(params) {
	const account = resolveMatrixAccount(params).config;
	return resolveApprovalApprovers({
		explicit: account.execApprovals?.approvers,
		allowFrom: account.dm?.allowFrom,
		normalizeApprover: normalizeMatrixExecApproverId
	});
}
function resolveMatrixApprovalKind(request) {
	return request.id.startsWith("plugin:") ? "plugin" : "exec";
}
function getMatrixApprovalApprovers(params) {
	if (params.approvalKind === "plugin") return getMatrixApprovalAuthApprovers({
		cfg: params.cfg,
		accountId: params.accountId
	});
	return getMatrixExecApprovalApprovers(params);
}
function isMatrixExecApprovalTargetRecipient(params) {
	return isChannelExecApprovalTargetRecipient({
		...params,
		channel: "matrix",
		normalizeSenderId: normalizeMatrixApproverId,
		matchTarget: ({ target, normalizedSenderId }) => normalizeMatrixApproverId(target.to) === normalizedSenderId
	});
}
const matrixExecApprovalProfile = createChannelExecApprovalProfile({
	resolveConfig: resolveMatrixExecApprovalConfig,
	resolveApprovers: getMatrixExecApprovalApprovers,
	normalizeSenderId: normalizeMatrixApproverId,
	isTargetRecipient: isMatrixExecApprovalTargetRecipient,
	matchesRequestAccount: (params) => matchesMatrixRequestAccount({
		...params,
		approvalKind: "exec"
	})
});
const isMatrixExecApprovalClientEnabled = matrixExecApprovalProfile.isClientEnabled;
matrixExecApprovalProfile.isApprover;
const isMatrixExecApprovalAuthorizedSender = matrixExecApprovalProfile.isAuthorizedSender;
const resolveMatrixExecApprovalTarget = matrixExecApprovalProfile.resolveTarget;
matrixExecApprovalProfile.shouldHandleRequest;
function isMatrixApprovalClientEnabled(params) {
	if (params.approvalKind === "exec") return isMatrixExecApprovalClientEnabled(params);
	return isChannelExecApprovalClientEnabledFromConfig({
		enabled: resolveMatrixExecApprovalConfig(params)?.enabled,
		approverCount: getMatrixApprovalApprovers(params).length
	});
}
function isMatrixAnyApprovalClientEnabled(params) {
	return isMatrixApprovalClientEnabled({
		...params,
		approvalKind: "exec"
	}) || isMatrixApprovalClientEnabled({
		...params,
		approvalKind: "plugin"
	});
}
function shouldHandleMatrixApprovalRequest(params) {
	const approvalKind = resolveMatrixApprovalKind(params.request);
	if (!matchesMatrixRequestAccount({
		...params,
		approvalKind
	})) return false;
	const config = resolveMatrixExecApprovalConfig(params);
	if (!isChannelExecApprovalClientEnabledFromConfig({
		enabled: config?.enabled,
		approverCount: getMatrixApprovalApprovers({
			...params,
			approvalKind
		}).length
	})) return false;
	return matchesApprovalRequestFilters({
		request: params.request.request,
		agentFilter: config?.agentFilter,
		sessionFilter: config?.sessionFilter
	});
}
function buildFilterCheckRequest(params) {
	if (params.metadata.approvalKind === "plugin") return {
		id: params.metadata.approvalId,
		request: {
			title: "Plugin Approval Required",
			description: "",
			agentId: params.metadata.agentId ?? null,
			sessionKey: params.metadata.sessionKey ?? null
		},
		createdAtMs: 0,
		expiresAtMs: 0
	};
	return {
		id: params.metadata.approvalId,
		request: {
			command: "",
			agentId: params.metadata.agentId ?? null,
			sessionKey: params.metadata.sessionKey ?? null
		},
		createdAtMs: 0,
		expiresAtMs: 0
	};
}
function shouldSuppressLocalMatrixExecApprovalPrompt(params) {
	if (!matrixExecApprovalProfile.shouldSuppressLocalPrompt(params)) return false;
	const metadata = getExecApprovalReplyMetadata(params.payload);
	if (!metadata) return false;
	const request = buildFilterCheckRequest({ metadata });
	return shouldHandleMatrixApprovalRequest({
		cfg: params.cfg,
		accountId: params.accountId,
		request
	});
}
//#endregion
//#region extensions/matrix/src/approval-native.ts
function normalizeComparableTarget(value) {
	const target = resolveMatrixTargetIdentity(value);
	if (!target) return normalizeLowercaseStringOrEmpty(value);
	if (target.kind === "user") return `user:${normalizeMatrixUserId(target.id)}`;
	return `${normalizeLowercaseStringOrEmpty(target.kind)}:${target.id}`;
}
function resolveMatrixNativeTarget(raw) {
	const target = resolveMatrixTargetIdentity(raw);
	if (!target) return null;
	return target.kind === "user" ? `user:${target.id}` : `room:${target.id}`;
}
function resolveTurnSourceMatrixOriginTarget(request) {
	const turnSourceChannel = normalizeLowercaseStringOrEmpty(request.request.turnSourceChannel);
	const target = resolveMatrixNativeTarget(request.request.turnSourceTo?.trim() || "");
	if (turnSourceChannel !== "matrix" || !target) return null;
	return {
		to: target,
		threadId: normalizeOptionalStringifiedId(request.request.turnSourceThreadId)
	};
}
function resolveSessionMatrixOriginTarget(sessionTarget) {
	const target = resolveMatrixNativeTarget(sessionTarget.to);
	if (!target) return null;
	return {
		to: target,
		threadId: normalizeOptionalStringifiedId(sessionTarget.threadId)
	};
}
function normalizeMatrixOriginTarget(target) {
	return {
		...target,
		to: normalizeComparableTarget(target.to)
	};
}
function hasMatrixPluginApprovers(params) {
	return getMatrixApprovalAuthApprovers(params).length > 0;
}
function availabilityState(enabled) {
	return enabled ? { kind: "enabled" } : { kind: "disabled" };
}
function hasMatrixApprovalApprovers(params) {
	return getMatrixApprovalApprovers({
		cfg: params.cfg,
		accountId: params.accountId,
		approvalKind: params.approvalKind
	}).length > 0;
}
function hasAnyMatrixApprovalApprovers(params) {
	return getMatrixExecApprovalApprovers(params).length > 0 || getMatrixApprovalAuthApprovers(params).length > 0;
}
function isMatrixPluginAuthorizedSender(params) {
	const normalizedSenderId = params.senderId ? normalizeMatrixApproverId(params.senderId) : void 0;
	if (!normalizedSenderId) return false;
	return getMatrixApprovalAuthApprovers(params).includes(normalizedSenderId);
}
function resolveSuppressionAccountId(params) {
	return params.target.accountId?.trim() || params.request.request.turnSourceAccountId?.trim() || void 0;
}
const resolveMatrixOriginTarget = createChannelNativeOriginTargetResolver({
	channel: "matrix",
	shouldHandleRequest: ({ cfg, accountId, request }) => shouldHandleMatrixApprovalRequest({
		cfg,
		accountId,
		request
	}),
	resolveTurnSourceTarget: resolveTurnSourceMatrixOriginTarget,
	resolveSessionTarget: resolveSessionMatrixOriginTarget,
	normalizeTargetForMatch: normalizeMatrixOriginTarget,
	resolveFallbackTarget: (request) => {
		const sessionConversation = resolveApprovalRequestSessionConversation({
			request,
			channel: "matrix"
		});
		if (!sessionConversation) return null;
		const target = resolveMatrixNativeTarget(sessionConversation.id);
		if (!target) return null;
		return {
			to: target,
			threadId: normalizeOptionalStringifiedId(sessionConversation.threadId)
		};
	}
});
function resolveMatrixApproverDmTargets(params) {
	if (!shouldHandleMatrixApprovalRequest(params)) return [];
	return getMatrixApprovalApprovers(params).map((approver) => {
		const normalized = normalizeMatrixUserId(approver);
		return normalized ? { to: `user:${normalized}` } : null;
	}).filter((target) => target !== null);
}
const matrixNativeApprovalCapability = createApproverRestrictedNativeApprovalCapability({
	channel: "matrix",
	channelLabel: "Matrix",
	describeExecApprovalSetup: ({ accountId }) => {
		const prefix = accountId && accountId !== "default" ? `channels.matrix.accounts.${accountId}` : "channels.matrix";
		return `Approve it from the Web UI or terminal UI for now. Matrix supports native exec approvals for this account. Configure \`${prefix}.execApprovals.approvers\` or \`${prefix}.dm.allowFrom\`; leave \`${prefix}.execApprovals.enabled\` unset/\`auto\` or set it to \`true\`.`;
	},
	listAccountIds: listMatrixAccountIds,
	hasApprovers: ({ cfg, accountId }) => hasAnyMatrixApprovalApprovers({
		cfg,
		accountId
	}),
	isExecAuthorizedSender: ({ cfg, accountId, senderId }) => isMatrixExecApprovalAuthorizedSender({
		cfg,
		accountId,
		senderId
	}),
	isPluginAuthorizedSender: ({ cfg, accountId, senderId }) => isMatrixPluginAuthorizedSender({
		cfg,
		accountId,
		senderId
	}),
	isNativeDeliveryEnabled: ({ cfg, accountId }) => isMatrixExecApprovalClientEnabled({
		cfg,
		accountId
	}),
	resolveNativeDeliveryMode: ({ cfg, accountId }) => resolveMatrixExecApprovalTarget({
		cfg,
		accountId
	}),
	requireMatchingTurnSourceChannel: true,
	resolveSuppressionAccountId,
	resolveOriginTarget: resolveMatrixOriginTarget,
	resolveApproverDmTargets: resolveMatrixApproverDmTargets,
	notifyOriginWhenDmOnly: true,
	nativeRuntime: createLazyChannelApprovalNativeRuntimeAdapter({
		eventKinds: ["exec", "plugin"],
		isConfigured: ({ cfg, accountId }) => isMatrixAnyApprovalClientEnabled({
			cfg,
			accountId
		}),
		shouldHandle: ({ cfg, accountId, request }) => shouldHandleMatrixApprovalRequest({
			cfg,
			accountId,
			request
		}),
		load: async () => (await import("./approval-handler.runtime-DRcJ4T3S.js")).matrixApprovalNativeRuntime
	})
});
const splitMatrixApprovalCapability = splitChannelApprovalCapability(matrixNativeApprovalCapability);
const matrixBaseNativeApprovalAdapter = splitMatrixApprovalCapability.native;
const matrixBaseDeliveryAdapter = splitMatrixApprovalCapability.delivery;
const matrixDeliveryAdapter = matrixBaseDeliveryAdapter && {
	...matrixBaseDeliveryAdapter,
	shouldSuppressForwardingFallback: (params) => {
		const accountId = resolveSuppressionAccountId(params);
		if (!hasMatrixApprovalApprovers({
			cfg: params.cfg,
			accountId,
			approvalKind: params.approvalKind
		})) return false;
		return matrixBaseDeliveryAdapter.shouldSuppressForwardingFallback?.(params) ?? false;
	}
};
const matrixNativeAdapter = matrixBaseNativeApprovalAdapter && {
	describeDeliveryCapabilities: (params) => {
		const capabilities = matrixBaseNativeApprovalAdapter.describeDeliveryCapabilities(params);
		const hasApprovers = hasMatrixApprovalApprovers({
			cfg: params.cfg,
			accountId: params.accountId,
			approvalKind: params.approvalKind
		});
		const clientEnabled = isMatrixApprovalClientEnabled({
			cfg: params.cfg,
			accountId: params.accountId,
			approvalKind: params.approvalKind
		});
		return {
			...capabilities,
			enabled: capabilities.enabled && hasApprovers && clientEnabled
		};
	},
	resolveOriginTarget: matrixBaseNativeApprovalAdapter.resolveOriginTarget,
	resolveApproverDmTargets: matrixBaseNativeApprovalAdapter.resolveApproverDmTargets
};
const matrixApprovalCapability = createChannelApprovalCapability({
	authorizeActorAction: (params) => {
		if (params.approvalKind !== "plugin") return matrixNativeApprovalCapability.authorizeActorAction?.(params) ?? { authorized: true };
		if (!hasMatrixPluginApprovers({
			cfg: params.cfg,
			accountId: params.accountId
		})) return {
			authorized: false,
			reason: "❌ Matrix plugin approvals are not enabled for this bot account."
		};
		return matrixApprovalAuth.authorizeActorAction(params);
	},
	getActionAvailabilityState: (params) => {
		if (params.approvalKind === "plugin") return availabilityState(hasMatrixPluginApprovers({
			cfg: params.cfg,
			accountId: params.accountId
		}));
		return matrixNativeApprovalCapability.getActionAvailabilityState?.(params) ?? { kind: "disabled" };
	},
	getExecInitiatingSurfaceState: (params) => matrixNativeApprovalCapability.getExecInitiatingSurfaceState?.(params) ?? { kind: "disabled" },
	describeExecApprovalSetup: matrixNativeApprovalCapability.describeExecApprovalSetup,
	delivery: matrixDeliveryAdapter,
	nativeRuntime: matrixNativeApprovalCapability.nativeRuntime,
	native: matrixNativeAdapter,
	render: matrixNativeApprovalCapability.render
});
//#endregion
//#region extensions/matrix/src/channel-account-paths.ts
function createMatrixProbeAccount(params) {
	return async ({ account, timeoutMs, cfg }) => {
		try {
			const auth = await params.resolveMatrixAuth({
				cfg,
				accountId: account.accountId
			});
			return await params.probeMatrix({
				homeserver: auth.homeserver,
				accessToken: auth.accessToken,
				userId: auth.userId,
				deviceId: auth.deviceId,
				timeoutMs: timeoutMs ?? 5e3,
				accountId: account.accountId,
				allowPrivateNetwork: auth.allowPrivateNetwork,
				ssrfPolicy: auth.ssrfPolicy,
				dispatcherPolicy: auth.dispatcherPolicy
			});
		} catch (err) {
			return {
				ok: false,
				error: formatMatrixErrorMessage(err),
				elapsedMs: 0
			};
		}
	};
}
function createMatrixPairingText(sendMessageMatrix) {
	return {
		idLabel: "matrixUserId",
		message: PAIRING_APPROVED_MESSAGE,
		normalizeAllowEntry: createPairingPrefixStripper(/^matrix:/i),
		notify: async ({ id, message, cfg, accountId }) => {
			await sendMessageMatrix(`user:${id}`, message, {
				cfg,
				...accountId ? { accountId } : {}
			});
		}
	};
}
//#endregion
//#region extensions/matrix/src/matrix/monitor/rooms.ts
function readLegacyRoomAllowAlias(room) {
	const rawRoom = room;
	return typeof rawRoom?.allow === "boolean" ? rawRoom.allow : void 0;
}
function resolveMatrixRoomConfig(params) {
	const rooms = params.rooms ?? {};
	const allowlistConfigured = Object.keys(rooms).length > 0;
	const { entry: matched, key: matchedKey, wildcardEntry, wildcardKey } = resolveChannelEntryMatch({
		entries: rooms,
		keys: buildChannelKeyCandidates(params.roomId, `room:${params.roomId}`, ...params.aliases),
		wildcardKey: "*"
	});
	const resolved = matched ?? wildcardEntry;
	const legacyAllow = readLegacyRoomAllowAlias(resolved);
	return {
		allowed: resolved ? resolved.enabled !== false && legacyAllow !== false : false,
		allowlistConfigured,
		config: resolved,
		matchKey: matchedKey ?? wildcardKey,
		matchSource: matched ? "direct" : wildcardEntry ? "wildcard" : void 0
	};
}
//#endregion
//#region extensions/matrix/src/group-mentions.ts
function resolveMatrixRoomConfigForGroup(params) {
	const roomId = normalizeMatrixResolvableTarget(params.groupId?.trim() ?? "");
	const groupChannel = params.groupChannel?.trim() ?? "";
	const aliases = groupChannel ? [normalizeMatrixResolvableTarget(groupChannel)] : [];
	const cfg = params.cfg;
	const matrixConfig = resolveMatrixAccountConfig({
		cfg,
		accountId: params.accountId
	});
	return resolveMatrixRoomConfig({
		rooms: matrixConfig.groups ?? matrixConfig.rooms,
		roomId,
		aliases
	}).config;
}
function resolveMatrixGroupRequireMention(params) {
	const resolved = resolveMatrixRoomConfigForGroup(params);
	if (resolved) {
		if (resolved.autoReply === true) return false;
		if (resolved.autoReply === false) return true;
		if (typeof resolved.requireMention === "boolean") return resolved.requireMention;
	}
	return true;
}
function resolveMatrixGroupToolPolicy(params) {
	return resolveMatrixRoomConfigForGroup(params)?.tools;
}
//#endregion
//#region extensions/matrix/src/resolver.ts
const loadMatrixChannelRuntime$1 = createLazyRuntimeNamedExport(() => import("./resolver.runtime-8XXfvmpi.js"), "matrixResolverRuntime");
const matrixResolverAdapter = { resolveTargets: async ({ cfg, accountId, inputs, kind, runtime }) => (await loadMatrixChannelRuntime$1()).resolveMatrixTargets({
	cfg,
	accountId,
	inputs,
	kind,
	runtime
}) };
//#endregion
//#region extensions/matrix/src/matrix/session-store-metadata.ts
function trimMaybeString(value) {
	if (typeof value !== "string") return;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
function resolveMatrixRoomTargetId(value) {
	const trimmed = trimMaybeString(value);
	if (!trimmed) return;
	const target = resolveMatrixTargetIdentity(trimmed);
	return target?.kind === "room" && target.id.startsWith("!") ? target.id : void 0;
}
function resolveMatrixSessionAccountId(value) {
	const trimmed = trimMaybeString(value);
	return trimmed ? normalizeAccountId(trimmed) : void 0;
}
function resolveMatrixStoredRoomId(params) {
	return resolveMatrixRoomTargetId(params.deliveryTo) ?? resolveMatrixRoomTargetId(params.lastTo) ?? resolveMatrixRoomTargetId(params.originNativeChannelId) ?? resolveMatrixRoomTargetId(params.originTo);
}
function resolveMatrixStoredSessionMeta(entry) {
	if (!entry) return null;
	const channel = trimMaybeString(entry.deliveryContext?.channel) ?? trimMaybeString(entry.lastChannel) ?? trimMaybeString(entry.origin?.provider);
	const accountId = resolveMatrixSessionAccountId(entry.deliveryContext?.accountId ?? entry.lastAccountId ?? entry.origin?.accountId) ?? void 0;
	const roomId = resolveMatrixStoredRoomId({
		deliveryTo: entry.deliveryContext?.to,
		lastTo: entry.lastTo,
		originNativeChannelId: entry.origin?.nativeChannelId,
		originTo: entry.origin?.to
	});
	const chatType = trimMaybeString(entry.origin?.chatType) ?? trimMaybeString(entry.chatType) ?? void 0;
	const directUserId = chatType === "direct" ? trimMaybeString(entry.origin?.nativeDirectUserId) ?? resolveMatrixDirectUserId({
		from: trimMaybeString(entry.origin?.from),
		to: (roomId ? `room:${roomId}` : void 0) ?? trimMaybeString(entry.deliveryContext?.to) ?? trimMaybeString(entry.lastTo) ?? trimMaybeString(entry.origin?.to),
		chatType
	}) : void 0;
	if (!channel && !accountId && !roomId && !directUserId) return null;
	return {
		...channel ? { channel } : {},
		...accountId ? { accountId } : {},
		...roomId ? { roomId } : {},
		...directUserId ? { directUserId } : {}
	};
}
//#endregion
//#region extensions/matrix/src/session-route.ts
function resolveEffectiveMatrixAccountId(params) {
	return normalizeAccountId(params.accountId ?? resolveDefaultMatrixAccountId(params.cfg));
}
function resolveMatrixDmSessionScope(params) {
	return resolveMatrixAccountConfig({
		cfg: params.cfg,
		accountId: params.accountId
	}).dm?.sessionScope ?? "per-user";
}
function resolveMatrixCurrentDmRoomId(params) {
	const sessionKey = parseThreadSessionSuffix(params.currentSessionKey).baseSessionKey ?? params.currentSessionKey?.trim();
	if (!sessionKey) return;
	try {
		const existing = resolveSessionStoreEntry({
			store: loadSessionStore(resolveStorePath(params.cfg.session?.store, { agentId: params.agentId })),
			sessionKey
		}).existing;
		const currentSession = resolveMatrixStoredSessionMeta(existing);
		if (!currentSession) return;
		if (currentSession.accountId && currentSession.accountId !== params.accountId) return;
		if (!currentSession.directUserId || currentSession.directUserId !== params.targetUserId) return;
		return currentSession.roomId;
	} catch {
		return;
	}
}
function resolveMatrixOutboundSessionRoute(params) {
	const target = resolveMatrixTargetIdentity(params.resolvedTarget?.to ?? params.target) ?? resolveMatrixTargetIdentity(params.target);
	if (!target) return null;
	const effectiveAccountId = resolveEffectiveMatrixAccountId(params);
	const roomScopedDmId = target.kind === "user" && resolveMatrixDmSessionScope({
		cfg: params.cfg,
		accountId: effectiveAccountId
	}) === "per-room" ? resolveMatrixCurrentDmRoomId({
		cfg: params.cfg,
		agentId: params.agentId,
		accountId: effectiveAccountId,
		currentSessionKey: params.currentSessionKey,
		targetUserId: target.id
	}) : void 0;
	const peer = roomScopedDmId !== void 0 ? {
		kind: "channel",
		id: roomScopedDmId
	} : {
		kind: target.kind === "user" ? "direct" : "channel",
		id: target.id
	};
	const chatType = target.kind === "user" ? "direct" : "channel";
	const from = target.kind === "user" ? `matrix:${target.id}` : `matrix:channel:${target.id}`;
	const to = `room:${roomScopedDmId ?? target.id}`;
	return buildThreadAwareOutboundSessionRoute({
		route: buildChannelOutboundSessionRoute({
			cfg: params.cfg,
			agentId: params.agentId,
			channel: "matrix",
			accountId: effectiveAccountId,
			peer,
			chatType,
			from,
			to
		}),
		replyToId: params.replyToId,
		threadId: params.threadId,
		currentSessionKey: params.currentSessionKey,
		normalizeThreadId: (threadId) => threadId,
		canRecoverCurrentThread: ({ route }) => route.peer.kind !== "direct" || (params.cfg.session?.dmScope ?? "main") !== "main"
	});
}
//#endregion
//#region extensions/matrix/src/startup-maintenance.ts
function logWarningOnlyMatrixMigrationReasons(params) {
	if (params.status.legacyState && "warning" in params.status.legacyState) params.log.warn?.(`matrix: ${params.status.legacyState.warning}`);
	if (params.status.legacyCrypto.warnings.length > 0) params.log.warn?.(`matrix: legacy encrypted-state warnings:\n${params.status.legacyCrypto.warnings.map((entry) => `- ${entry}`).join("\n")}`);
}
async function runBestEffortMatrixMigrationStep(params) {
	try {
		await params.run();
	} catch (err) {
		params.log.warn?.(`${params.logPrefix?.trim() || "gateway"}: ${params.label} failed during Matrix migration; continuing startup: ${String(err)}`);
	}
}
async function runMatrixStartupMaintenance(params) {
	const env = params.env ?? process.env;
	const createSnapshot = params.deps?.maybeCreateMatrixMigrationSnapshot ?? maybeCreateMatrixMigrationSnapshot;
	const migrateLegacyState = params.deps?.autoMigrateLegacyMatrixState ?? autoMigrateLegacyMatrixState;
	const prepareLegacyCrypto = params.deps?.autoPrepareLegacyMatrixCrypto ?? autoPrepareLegacyMatrixCrypto;
	const trigger = params.trigger?.trim() || "gateway-startup";
	const logPrefix = params.logPrefix?.trim() || "gateway";
	const migrationStatus = resolveMatrixMigrationStatus({
		cfg: params.cfg,
		env
	});
	if (!migrationStatus.pending) return;
	if (!migrationStatus.actionable) {
		params.log.info?.("matrix: migration remains in a warning-only state; no pre-migration snapshot was needed yet");
		logWarningOnlyMatrixMigrationReasons({
			status: migrationStatus,
			log: params.log
		});
		return;
	}
	try {
		await createSnapshot({
			trigger,
			env,
			log: params.log
		});
	} catch (err) {
		params.log.warn?.(`${logPrefix}: failed creating a Matrix migration snapshot; skipping Matrix migration for now: ${String(err)}`);
		return;
	}
	await runBestEffortMatrixMigrationStep({
		label: "legacy Matrix state migration",
		log: params.log,
		logPrefix,
		run: () => migrateLegacyState({
			cfg: params.cfg,
			env,
			log: params.log
		})
	});
	await runBestEffortMatrixMigrationStep({
		label: "legacy Matrix encrypted-state preparation",
		log: params.log,
		logPrefix,
		run: () => prepareLegacyCrypto({
			cfg: params.cfg,
			env,
			log: params.log
		})
	});
}
//#endregion
//#region extensions/matrix/src/channel.ts
let matrixStartupLock = Promise.resolve();
const loadMatrixSetupWizard = createLazyRuntimeNamedExport(() => import("./setup-surface-CZYAUrKQ.js").then((n) => n.t), "matrixSetupWizard");
const loadMatrixChannelRuntime = createLazyRuntimeNamedExport(() => import("./channel.runtime-BJ1lzNTU.js"), "matrixChannelRuntime");
let matrixDoctorModulePromise = null;
const loadMatrixDoctorModule = async () => {
	matrixDoctorModulePromise ??= import("./doctor-BwpkOBwr.js");
	return await matrixDoctorModulePromise;
};
const meta = {
	id: "matrix",
	label: "Matrix",
	selectionLabel: "Matrix (plugin)",
	docsPath: "/channels/matrix",
	docsLabel: "matrix",
	blurb: "open protocol; configure a homeserver + access token.",
	order: 70,
	markdownCapable: true,
	quickstartAllowFrom: true
};
function buildMatrixTrafficStatusSummary(snapshot) {
	return {
		lastInboundAt: snapshot?.lastInboundAt ?? null,
		lastOutboundAt: snapshot?.lastOutboundAt ?? null
	};
}
const matrixDoctor = {
	dmAllowFromMode: "nestedOnly",
	groupModel: "sender",
	groupAllowFromFallbackToAllowFrom: false,
	warnOnEmptyGroupSenderAllowlist: true,
	legacyConfigRules,
	normalizeCompatibilityConfig,
	runConfigSequence: async ({ cfg, env, shouldRepair }) => await (await loadMatrixDoctorModule()).runMatrixDoctorSequence({
		cfg,
		env,
		shouldRepair
	}),
	cleanStaleConfig: async ({ cfg }) => await (await loadMatrixDoctorModule()).cleanStaleMatrixPluginConfig(cfg)
};
const listMatrixDirectoryPeersFromConfig = createResolvedDirectoryEntriesLister({
	kind: "user",
	resolveAccount: adaptScopedAccountAccessor(resolveMatrixAccount),
	resolveSources: (account) => [
		account.config.dm?.allowFrom ?? [],
		account.config.groupAllowFrom ?? [],
		...Object.values(account.config.groups ?? account.config.rooms ?? {}).map((room) => room.users ?? [])
	],
	normalizeId: (entry) => {
		const raw = entry.replace(/^matrix:/i, "").trim();
		if (!raw || raw === "*") return null;
		const cleaned = normalizeLowercaseStringOrEmpty(raw).startsWith("user:") ? raw.slice(5).trim() : raw;
		return cleaned.startsWith("@") ? `user:${cleaned}` : cleaned;
	}
});
const listMatrixDirectoryGroupsFromConfig = createResolvedDirectoryEntriesLister({
	kind: "group",
	resolveAccount: adaptScopedAccountAccessor(resolveMatrixAccount),
	resolveSources: (account) => [Object.keys(account.config.groups ?? account.config.rooms ?? {})],
	normalizeId: (entry) => {
		const raw = entry.replace(/^matrix:/i, "").trim();
		if (!raw || raw === "*") return null;
		const lowered = normalizeLowercaseStringOrEmpty(raw);
		if (lowered.startsWith("room:") || lowered.startsWith("channel:")) return raw;
		return raw.startsWith("!") ? `room:${raw}` : raw;
	}
});
function projectMatrixConversationBinding(binding) {
	return {
		boundAt: binding.boundAt,
		lastActivityAt: typeof binding.metadata?.lastActivityAt === "number" ? binding.metadata.lastActivityAt : binding.boundAt,
		idleTimeoutMs: typeof binding.metadata?.idleTimeoutMs === "number" ? binding.metadata.idleTimeoutMs : void 0,
		maxAgeMs: typeof binding.metadata?.maxAgeMs === "number" ? binding.metadata.maxAgeMs : void 0
	};
}
const resolveMatrixDmPolicy = createScopedDmSecurityResolver({
	channelKey: "matrix",
	resolvePolicy: (account) => account.config.dm?.policy,
	resolveAllowFrom: (account) => account.config.dm?.allowFrom,
	allowFromPathSuffix: "dm.",
	normalizeEntry: (raw) => normalizeMatrixUserId(raw)
});
const collectMatrixSecurityWarnings = createAllowlistProviderOpenWarningCollector({
	providerConfigPresent: (cfg) => cfg.channels?.matrix !== void 0,
	resolveGroupPolicy: (account) => account.config.groupPolicy,
	buildOpenWarning: {
		surface: "Matrix rooms",
		openBehavior: "allows any room to trigger (mention-gated)",
		remediation: "Set channels.matrix.groupPolicy=\"allowlist\" + channels.matrix.groups (and optionally channels.matrix.groupAllowFrom) to restrict rooms"
	}
});
function resolveMatrixAccountConfigPath(accountId, field) {
	return accountId === DEFAULT_ACCOUNT_ID$2 ? `channels.matrix.${field}` : `channels.matrix.accounts.${accountId}.${field}`;
}
function collectMatrixSecurityWarningsForAccount(params) {
	const warnings = collectMatrixSecurityWarnings(params);
	if (params.account.accountId !== DEFAULT_ACCOUNT_ID$2) {
		const groupPolicyPath = resolveMatrixAccountConfigPath(params.account.accountId, "groupPolicy");
		const groupsPath = resolveMatrixAccountConfigPath(params.account.accountId, "groups");
		const groupAllowFromPath = resolveMatrixAccountConfigPath(params.account.accountId, "groupAllowFrom");
		return warnings.map((warning) => warning.replace("channels.matrix.groupPolicy", groupPolicyPath).replace("channels.matrix.groups", groupsPath).replace("channels.matrix.groupAllowFrom", groupAllowFromPath));
	}
	if (params.account.config.autoJoin !== "always") return warnings;
	const autoJoinPath = resolveMatrixAccountConfigPath(params.account.accountId, "autoJoin");
	const autoJoinAllowlistPath = resolveMatrixAccountConfigPath(params.account.accountId, "autoJoinAllowlist");
	return [...warnings, `- Matrix invites: autoJoin="always" joins any invited room before message policy applies. Set ${autoJoinPath}="allowlist" + ${autoJoinAllowlistPath} (or ${autoJoinPath}="off") to restrict joins.`];
}
function normalizeMatrixAcpConversationId(conversationId) {
	const target = resolveMatrixTargetIdentity(conversationId);
	if (!target || target.kind !== "room") return null;
	return { conversationId: target.id };
}
function matchMatrixAcpConversation(params) {
	const binding = normalizeMatrixAcpConversationId(params.bindingConversationId);
	if (!binding) return null;
	if (binding.conversationId === params.conversationId) return {
		conversationId: params.conversationId,
		matchPriority: 2
	};
	if (params.parentConversationId && params.parentConversationId !== params.conversationId && binding.conversationId === params.parentConversationId) return {
		conversationId: params.parentConversationId,
		matchPriority: 1
	};
	return null;
}
function resolveMatrixCommandConversation(params) {
	const parentConversationId = [
		params.originatingTo,
		params.commandTo,
		params.fallbackTo
	].map((candidate) => {
		const trimmed = candidate?.trim();
		if (!trimmed) return;
		const target = resolveMatrixTargetIdentity(trimmed);
		return target?.kind === "room" ? target.id : void 0;
	}).find((candidate) => Boolean(candidate));
	if (params.threadId) return {
		conversationId: params.threadId,
		...parentConversationId ? { parentConversationId } : {}
	};
	return parentConversationId ? { conversationId: parentConversationId } : null;
}
function resolveMatrixDeliveryTarget(params) {
	const parentConversationId = params.parentConversationId?.trim();
	if (parentConversationId && parentConversationId !== params.conversationId.trim()) {
		const parentTarget = resolveMatrixTargetIdentity(parentConversationId);
		if (parentTarget?.kind === "room") return {
			to: `room:${parentTarget.id}`,
			threadId: params.conversationId.trim()
		};
	}
	const conversationTarget = resolveMatrixTargetIdentity(params.conversationId);
	if (conversationTarget?.kind === "room") return { to: `room:${conversationTarget.id}` };
	return null;
}
const matrixChannelOutbound = {
	deliveryMode: "direct",
	chunker: chunkTextForOutbound,
	chunkerMode: "markdown",
	textChunkLimit: 4e3,
	deliveryCapabilities: { durableFinal: {
		text: true,
		media: true,
		replyTo: true,
		thread: true,
		messageSendingHooks: true
	} },
	presentationCapabilities: {
		supported: true,
		buttons: true,
		selects: true,
		context: true,
		divider: true,
		limits: { text: {
			markdownDialect: "markdown",
			supportsEdit: true
		} }
	},
	shouldSuppressLocalPayloadPrompt: ({ cfg, accountId, payload }) => shouldSuppressLocalMatrixExecApprovalPrompt({
		cfg,
		accountId,
		payload
	}),
	...createRuntimeOutboundDelegates({
		getRuntime: loadMatrixChannelRuntime,
		renderPresentation: {
			resolve: (runtime) => runtime.matrixOutbound.renderPresentation,
			unavailableMessage: "Matrix outbound presentation rendering is unavailable"
		},
		sendPayload: {
			resolve: (runtime) => runtime.matrixOutbound.sendPayload,
			unavailableMessage: "Matrix outbound payload delivery is unavailable"
		},
		sendText: {
			resolve: (runtime) => runtime.matrixOutbound.sendText,
			unavailableMessage: "Matrix outbound text delivery is unavailable"
		},
		sendMedia: {
			resolve: (runtime) => runtime.matrixOutbound.sendMedia,
			unavailableMessage: "Matrix outbound media delivery is unavailable"
		},
		sendPoll: {
			resolve: (runtime) => runtime.matrixOutbound.sendPoll,
			unavailableMessage: "Matrix outbound poll delivery is unavailable"
		}
	})
};
const matrixMessageAdapter = createChannelMessageAdapterFromOutbound({
	id: "matrix",
	outbound: matrixChannelOutbound,
	live: {
		capabilities: {
			draftPreview: true,
			previewFinalization: true,
			progressUpdates: true,
			quietFinalization: true
		},
		finalizer: { capabilities: {
			finalEdit: true,
			normalFallback: true,
			discardPending: true,
			previewReceipt: true
		} }
	}
});
const matrixPlugin = createChatChannelPlugin({
	base: {
		id: "matrix",
		meta,
		setupWizard: createMatrixSetupWizardProxy(async () => ({ matrixSetupWizard: await loadMatrixSetupWizard() })),
		capabilities: {
			chatTypes: [
				"direct",
				"group",
				"thread"
			],
			polls: true,
			reactions: true,
			threads: true,
			media: true,
			tts: { voice: { synthesisTarget: "voice-note" } }
		},
		reload: { configPrefixes: ["channels.matrix"] },
		configSchema: MatrixChannelConfigSchema,
		config: {
			...matrixConfigAdapter,
			isConfigured: (account) => account.configured,
			describeAccount: (account) => describeAccountSnapshot({
				account,
				configured: account.configured,
				extra: { baseUrl: account.homeserver }
			})
		},
		approvalCapability: matrixApprovalCapability,
		groups: {
			resolveRequireMention: resolveMatrixGroupRequireMention,
			resolveToolPolicy: resolveMatrixGroupToolPolicy
		},
		conversationBindings: {
			supportsCurrentConversationBinding: true,
			defaultTopLevelPlacement: "child",
			setIdleTimeoutBySessionKey: ({ targetSessionKey, accountId, idleTimeoutMs }) => setMatrixThreadBindingIdleTimeoutBySessionKey({
				targetSessionKey,
				accountId: accountId ?? "",
				idleTimeoutMs
			}).map(projectMatrixConversationBinding),
			setMaxAgeBySessionKey: ({ targetSessionKey, accountId, maxAgeMs }) => setMatrixThreadBindingMaxAgeBySessionKey({
				targetSessionKey,
				accountId: accountId ?? "",
				maxAgeMs
			}).map(projectMatrixConversationBinding)
		},
		messaging: {
			defaultMarkdownTableMode: "bullets",
			targetPrefixes: ["matrix"],
			normalizeTarget: normalizeMatrixMessagingTarget,
			resolveInboundConversation: ({ to, conversationId, threadId }) => resolveMatrixInboundConversation({
				to,
				conversationId,
				threadId
			}),
			resolveDeliveryTarget: ({ conversationId, parentConversationId }) => resolveMatrixDeliveryTarget({
				conversationId,
				parentConversationId
			}),
			resolveOutboundSessionRoute: (params) => resolveMatrixOutboundSessionRoute(params),
			targetResolver: {
				looksLikeId: (raw) => {
					const trimmed = raw.trim();
					if (!trimmed) return false;
					if (/^(matrix:)?[!#@]/i.test(trimmed)) return true;
					return trimmed.includes(":");
				},
				hint: "<room|alias|user>"
			}
		},
		directory: createChannelDirectoryAdapter({
			listPeers: async (params) => {
				return (await listMatrixDirectoryPeersFromConfig(params)).map((entry) => {
					const raw = entry.id.startsWith("user:") ? entry.id.slice(5) : entry.id;
					return !raw.startsWith("@") || !raw.includes(":") ? Object.assign({}, entry, { name: `incomplete id; expected @user:server` }) : entry;
				});
			},
			listGroups: async (params) => await listMatrixDirectoryGroupsFromConfig(params),
			...createRuntimeDirectoryLiveAdapter({
				getRuntime: loadMatrixChannelRuntime,
				listPeersLive: (runtime) => runtime.listMatrixDirectoryPeersLive,
				listGroupsLive: (runtime) => runtime.listMatrixDirectoryGroupsLive
			})
		}),
		resolver: matrixResolverAdapter,
		actions: matrixMessageActions,
		message: matrixMessageAdapter,
		secrets: {
			secretTargetRegistryEntries,
			collectRuntimeConfigAssignments
		},
		setup: {
			...matrixSetupAdapter,
			singleAccountKeysToMove,
			namedAccountPromotionKeys,
			resolveSingleAccountPromotionTarget
		},
		bindings: {
			compileConfiguredBinding: ({ conversationId }) => normalizeMatrixAcpConversationId(conversationId),
			matchInboundConversation: ({ compiledBinding, conversationId, parentConversationId }) => matchMatrixAcpConversation({
				bindingConversationId: compiledBinding.conversationId,
				conversationId,
				parentConversationId
			}),
			resolveCommandConversation: ({ threadId, originatingTo, commandTo, fallbackTo }) => resolveMatrixCommandConversation({
				threadId,
				originatingTo,
				commandTo,
				fallbackTo
			})
		},
		status: createComputedAccountStatusAdapter({
			defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID$2),
			collectStatusIssues: (accounts) => collectStatusIssuesFromLastError("matrix", accounts),
			buildChannelSummary: ({ snapshot }) => buildProbeChannelStatusSummary(snapshot, { baseUrl: snapshot.baseUrl ?? null }),
			probeAccount: async ({ account, timeoutMs, cfg }) => await createMatrixProbeAccount({
				resolveMatrixAuth: async ({ cfg: cfgLocal, accountId }) => (await loadMatrixChannelRuntime()).resolveMatrixAuth({
					cfg: cfgLocal,
					accountId
				}),
				probeMatrix: async (params) => await (await loadMatrixChannelRuntime()).probeMatrix(params)
			})({
				account,
				timeoutMs,
				cfg
			}),
			resolveAccountSnapshot: ({ account, runtime }) => ({
				accountId: account.accountId,
				name: account.name,
				enabled: account.enabled,
				configured: account.configured,
				extra: {
					baseUrl: account.homeserver,
					lastProbeAt: runtime?.lastProbeAt ?? null,
					...buildMatrixTrafficStatusSummary(runtime)
				}
			})
		}),
		gateway: { startAccount: async (ctx) => {
			const account = ctx.account;
			ctx.setStatus({
				accountId: account.accountId,
				baseUrl: account.homeserver
			});
			ctx.log?.info(`[${account.accountId}] starting provider (${account.homeserver ?? "matrix"})`);
			const previousLock = matrixStartupLock;
			let releaseLock = () => {};
			matrixStartupLock = new Promise((resolve) => {
				releaseLock = resolve;
			});
			await previousLock;
			let monitorMatrixProvider;
			try {
				monitorMatrixProvider = (await import("./monitor-uKuCaVCL.js")).monitorMatrixProvider;
			} finally {
				releaseLock();
			}
			return monitorMatrixProvider({
				runtime: ctx.runtime,
				channelRuntime: ctx.channelRuntime,
				abortSignal: ctx.abortSignal,
				mediaMaxMb: account.config.mediaMaxMb,
				initialSyncLimit: account.config.initialSyncLimit,
				replyToMode: account.config.replyToMode,
				accountId: account.accountId,
				setStatus: ctx.setStatus
			});
		} },
		doctor: matrixDoctor,
		lifecycle: { runStartupMaintenance: runMatrixStartupMaintenance },
		heartbeat: {
			sendTyping: async ({ cfg, to, accountId }) => {
				await (await loadMatrixChannelRuntime()).sendTypingMatrix(to, true, {
					cfg,
					...accountId ? { accountId } : {}
				});
			},
			clearTyping: async ({ cfg, to, accountId }) => {
				await (await loadMatrixChannelRuntime()).sendTypingMatrix(to, false, {
					cfg,
					...accountId ? { accountId } : {}
				});
			}
		}
	},
	security: {
		resolveDmPolicy: resolveMatrixDmPolicy,
		collectWarnings: projectAccountConfigWarningCollector((cfg) => cfg, collectMatrixSecurityWarningsForAccount)
	},
	pairing: { text: createMatrixPairingText(async (to, message, options) => await (await loadMatrixChannelRuntime()).sendMessageMatrix(to, message, options)) },
	threading: {
		resolveReplyToMode: createScopedAccountReplyToModeResolver({
			resolveAccount: adaptScopedAccountAccessor(resolveMatrixAccountConfig),
			resolveReplyToMode: (account) => account.replyToMode
		}),
		buildToolContext: ({ context, hasRepliedRef }) => {
			const currentTarget = context.To;
			return {
				currentChannelId: normalizeOptionalString(currentTarget),
				currentThreadTs: context.MessageThreadId != null ? String(context.MessageThreadId) : void 0,
				currentDirectUserId: resolveMatrixDirectUserId({
					from: context.From,
					to: context.To,
					chatType: context.ChatType
				}),
				hasRepliedRef
			};
		}
	},
	outbound: matrixChannelOutbound
});
//#endregion
export { shouldHandleMatrixApprovalRequest as _, buildAllowlistResolutionSummary as a, createTypingCallbacks as c, logInboundDrop as d, logTypingFailure as f, isMatrixAnyApprovalClientEnabled as g, toLocationContext as h, addAllowlistUserEntriesFromConfigEntry as i, formatLocationText as l, summarizeMapping as m, resolveMatrixStoredSessionMeta as n, canonicalizeAllowlistWithResolvedIds as o, patchAllowlistUsersInConfigEntries as p, resolveMatrixRoomConfig as r, createReplyPrefixOptions as s, matrixPlugin as t, getAgentScopedMediaLocalRoots as u };
