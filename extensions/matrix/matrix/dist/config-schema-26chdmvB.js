import { a as resolveMatrixAccountConfig } from "./account-config-BZWN9tGS.js";
import { g as resolveMatrixAccount, h as resolveDefaultMatrixAccountId, p as listMatrixAccountIds } from "./setup-core-0q_2Acbn.js";
import { adaptScopedAccountAccessor, createScopedChannelConfigAdapter } from "openclaw/plugin-sdk/channel-config-helpers";
import { normalizeLowercaseStringOrEmpty } from "openclaw/plugin-sdk/string-coerce-runtime";
import { DEFAULT_ACCOUNT_ID as DEFAULT_ACCOUNT_ID$1 } from "openclaw/plugin-sdk/account-id";
import { resolveAllowlistMatchByCandidates } from "openclaw/plugin-sdk/allow-from";
import { normalizeStringEntries as normalizeStringEntries$1 } from "openclaw/plugin-sdk/string-normalization-runtime";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-primitives";
import { AllowFromListSchema, ContextVisibilityModeSchema, GroupPolicySchema, MarkdownConfigSchema, MentionPatternsPolicySchema, ToolPolicySchema, buildNestedDmConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
import { buildSecretInputSchema } from "openclaw/plugin-sdk/secret-input";
import { z } from "zod";
//#region extensions/matrix/src/matrix/monitor/allowlist.ts
function normalizeAllowList(list) {
	return normalizeStringEntries$1(list);
}
function normalizeMatrixUser(raw) {
	const value = (raw ?? "").trim();
	if (!value) return "";
	if (!value.startsWith("@") || !value.includes(":")) return normalizeLowercaseStringOrEmpty(value);
	const withoutAt = value.slice(1);
	const splitIndex = withoutAt.indexOf(":");
	if (splitIndex === -1) return normalizeLowercaseStringOrEmpty(value);
	const localpart = normalizeLowercaseStringOrEmpty(withoutAt.slice(0, splitIndex));
	const server = normalizeLowercaseStringOrEmpty(withoutAt.slice(splitIndex + 1));
	if (!server) return normalizeLowercaseStringOrEmpty(value);
	return `@${localpart}:${server}`;
}
function normalizeMatrixUserId(raw) {
	const trimmed = (raw ?? "").trim();
	if (!trimmed) return "";
	const lowered = normalizeLowercaseStringOrEmpty(trimmed);
	if (lowered.startsWith("matrix:")) return normalizeMatrixUser(trimmed.slice(7));
	if (lowered.startsWith("user:")) return normalizeMatrixUser(trimmed.slice(5));
	return normalizeMatrixUser(trimmed);
}
function normalizeMatrixAllowListEntry(raw) {
	const trimmed = raw.trim();
	if (!trimmed) return "";
	if (trimmed === "*") return trimmed;
	const lowered = normalizeLowercaseStringOrEmpty(trimmed);
	if (lowered.startsWith("matrix:")) return `matrix:${normalizeMatrixUser(trimmed.slice(7))}`;
	if (lowered.startsWith("user:")) return `user:${normalizeMatrixUser(trimmed.slice(5))}`;
	return normalizeMatrixUser(trimmed);
}
function normalizeMatrixAllowList(list) {
	return normalizeAllowList(list).map((entry) => normalizeMatrixAllowListEntry(entry));
}
function resolveMatrixAllowListMatch(params) {
	const allowList = params.allowList;
	if (allowList.length === 0) return { allowed: false };
	if (allowList.includes("*")) return {
		allowed: true,
		matchKey: "*",
		matchSource: "wildcard"
	};
	const userId = normalizeMatrixUser(params.userId);
	return resolveAllowlistMatchByCandidates({
		allowList,
		candidates: [
			{
				value: userId,
				source: "id"
			},
			{
				value: userId ? `matrix:${userId}` : "",
				source: "prefixed-id"
			},
			{
				value: userId ? `user:${userId}` : "",
				source: "prefixed-user"
			}
		]
	});
}
//#endregion
//#region extensions/matrix/src/config-adapter.ts
const matrixConfigAdapter = createScopedChannelConfigAdapter({
	sectionKey: "matrix",
	listAccountIds: listMatrixAccountIds,
	resolveAccount: adaptScopedAccountAccessor(resolveMatrixAccount),
	resolveAccessorAccount: ({ cfg, accountId }) => resolveMatrixAccountConfig({
		cfg,
		accountId
	}),
	defaultAccountId: resolveDefaultMatrixAccountId,
	clearBaseFields: [
		"name",
		"homeserver",
		"network",
		"proxy",
		"userId",
		"accessToken",
		"password",
		"deviceId",
		"deviceName",
		"avatarUrl",
		"initialSyncLimit"
	],
	resolveAllowFrom: (account) => account.dm?.allowFrom,
	formatAllowFrom: (allowFrom) => normalizeMatrixAllowList(allowFrom)
});
//#endregion
//#region extensions/matrix/src/config-ui-hints.ts
const matrixChannelConfigUiHints = {
	mentionPatterns: {
		label: "Matrix Mention Pattern Policy",
		help: "Scopes configured groupChat mentionPatterns to selected Matrix room IDs. Native Matrix mention evidence still triggers even when regex patterns are denied."
	},
	"mentionPatterns.mode": {
		label: "Matrix Mention Pattern Mode",
		help: "\"allow\" enables configured regex mention patterns unless denyIn matches; \"deny\" disables them unless allowIn matches."
	},
	"mentionPatterns.allowIn": {
		label: "Matrix Mention Pattern Allowlist",
		help: "Matrix room IDs where configured regex mention patterns are enabled when mode is deny."
	},
	"mentionPatterns.denyIn": {
		label: "Matrix Mention Pattern Denylist",
		help: "Matrix room IDs where configured regex mention patterns are disabled. Native mention evidence still triggers."
	},
	allowBots: {
		label: "Matrix Allow Bot Messages",
		help: "Allow messages from other configured Matrix bot accounts to trigger replies (default: false). Set \"mentions\" to require a visible room mention."
	},
	botLoopProtection: {
		label: "Matrix Bot Loop Protection",
		help: "Sliding-window guard for accepted Matrix configured-bot loops. Default is enabled whenever allowBots lets configured bot messages reach dispatch."
	},
	"botLoopProtection.enabled": {
		label: "Matrix Bot Loop Protection Enabled",
		help: "Enable the bot-pair loop guard. Defaults to true when allowBots is true or \"mentions\", and false when configured bot messages are ignored."
	},
	"botLoopProtection.maxEventsPerWindow": {
		label: "Matrix Bot Loop Events per Window",
		help: "Maximum accepted bot-pair messages within the sliding window before suppression starts. Default: 20."
	},
	"botLoopProtection.windowSeconds": {
		label: "Matrix Bot Loop Window Seconds",
		help: "Sliding window length for counting bot-pair messages. Default: 60."
	},
	"botLoopProtection.cooldownSeconds": {
		label: "Matrix Bot Loop Cooldown Seconds",
		help: "How long to suppress the bot pair after it exceeds the budget. Default: 60."
	},
	dangerouslyAllowNameMatching: {
		label: "Matrix Display Name Matching",
		help: "Compatibility opt-in for resolving Matrix display names and joined room names in allowlists. Prefer full @user:server IDs and room IDs or aliases because names are mutable."
	},
	"streaming.progress.label": {
		label: "Matrix Progress Label",
		help: "Initial progress draft title. Use \"auto\" for built-in single-word labels, a custom string, or false to hide the title."
	},
	"streaming.progress.labels": {
		label: "Matrix Progress Label Pool",
		help: "Candidate labels for streaming.progress.label=\"auto\". Leave unset to use OpenClaw built-in progress labels."
	},
	"streaming.progress.maxLines": {
		label: "Matrix Progress Max Lines",
		help: "Maximum number of compact progress lines to keep below the draft label (default: 8)."
	},
	"streaming.progress.maxLineChars": {
		label: "Matrix Progress Max Line Chars",
		help: "Maximum characters per compact progress line before truncation (default: 120). Prose cuts at word boundaries; commands and paths keep useful suffixes."
	},
	"streaming.progress.toolProgress": {
		label: "Matrix Progress Tool Lines",
		help: "Show compact tool/progress lines in progress draft mode (default: true). Set false to keep only the label until final delivery."
	},
	"streaming.progress.commandText": {
		label: "Matrix Progress Command Text",
		help: "Command/exec detail in progress draft lines: \"raw\" preserves released behavior; \"status\" shows only the tool label."
	}
};
//#endregion
//#region extensions/matrix/src/config-schema.ts
const matrixActionSchema = z.object({
	reactions: z.boolean().optional(),
	messages: z.boolean().optional(),
	pins: z.boolean().optional(),
	profile: z.boolean().optional(),
	memberInfo: z.boolean().optional(),
	channelInfo: z.boolean().optional(),
	verification: z.boolean().optional()
}).optional();
const matrixThreadBindingsSchema = z.object({
	enabled: z.boolean().optional(),
	idleHours: z.number().nonnegative().optional(),
	maxAgeHours: z.number().nonnegative().optional(),
	spawnSessions: z.boolean().optional(),
	defaultSpawnContext: z.enum(["isolated", "fork"]).optional(),
	spawnSubagentSessions: z.boolean().optional(),
	spawnAcpSessions: z.boolean().optional()
}).optional();
const matrixExecApprovalsSchema = z.object({
	enabled: z.boolean().optional(),
	approvers: AllowFromListSchema,
	agentFilter: z.array(z.string()).optional(),
	sessionFilter: z.array(z.string()).optional(),
	target: z.enum([
		"dm",
		"channel",
		"both"
	]).optional()
}).optional();
const botLoopProtectionSchema = z.object({
	enabled: z.boolean().optional(),
	maxEventsPerWindow: z.number().int().positive().optional(),
	windowSeconds: z.number().int().positive().optional(),
	cooldownSeconds: z.number().int().positive().optional()
}).strict().optional();
const matrixRoomSchema = z.object({
	account: z.string().optional(),
	enabled: z.boolean().optional(),
	requireMention: z.boolean().optional(),
	allowBots: z.union([z.boolean(), z.literal("mentions")]).optional(),
	botLoopProtection: botLoopProtectionSchema,
	tools: ToolPolicySchema,
	autoReply: z.boolean().optional(),
	users: AllowFromListSchema,
	skills: z.array(z.string()).optional(),
	systemPrompt: z.string().optional()
}).optional();
const matrixNetworkSchema = z.object({ dangerouslyAllowPrivateNetwork: z.boolean().optional() }).strict().optional();
const matrixStreamingSchema = z.object({
	mode: z.enum([
		"partial",
		"quiet",
		"progress",
		"off"
	]).optional(),
	progress: z.object({
		label: z.union([z.string(), z.literal(false)]).optional(),
		labels: z.array(z.string()).optional(),
		maxLines: z.number().int().positive().optional(),
		maxLineChars: z.number().int().positive().optional(),
		toolProgress: z.boolean().optional()
	}).strict().optional(),
	preview: z.object({ toolProgress: z.boolean().optional() }).strict().optional()
}).strict();
const MatrixChannelConfigSchema = buildChannelConfigSchema(z.object({
	name: z.string().optional(),
	enabled: z.boolean().optional(),
	defaultAccount: z.string().optional(),
	accounts: z.record(z.string(), z.unknown()).optional(),
	markdown: MarkdownConfigSchema,
	homeserver: z.string().optional(),
	network: matrixNetworkSchema,
	proxy: z.string().optional(),
	userId: z.string().optional(),
	accessToken: buildSecretInputSchema().optional(),
	password: buildSecretInputSchema().optional(),
	deviceId: z.string().optional(),
	deviceName: z.string().optional(),
	avatarUrl: z.string().optional(),
	initialSyncLimit: z.number().optional(),
	encryption: z.boolean().optional(),
	allowlistOnly: z.boolean().optional(),
	dangerouslyAllowNameMatching: z.boolean().optional(),
	allowBots: z.union([z.boolean(), z.literal("mentions")]).optional(),
	botLoopProtection: botLoopProtectionSchema,
	groupPolicy: GroupPolicySchema.optional(),
	mentionPatterns: MentionPatternsPolicySchema.optional(),
	contextVisibility: ContextVisibilityModeSchema.optional(),
	blockStreaming: z.boolean().optional(),
	streaming: z.union([
		z.enum([
			"partial",
			"quiet",
			"progress",
			"off"
		]),
		z.boolean(),
		matrixStreamingSchema
	]).optional(),
	replyToMode: z.enum([
		"off",
		"first",
		"all",
		"batched"
	]).optional(),
	threadReplies: z.enum([
		"off",
		"inbound",
		"always"
	]).optional(),
	textChunkLimit: z.number().optional(),
	chunkMode: z.enum(["length", "newline"]).optional(),
	responsePrefix: z.string().optional(),
	ackReaction: z.string().optional(),
	ackReactionScope: z.enum([
		"group-mentions",
		"group-all",
		"direct",
		"all",
		"none",
		"off"
	]).optional(),
	reactionNotifications: z.enum(["off", "own"]).optional(),
	threadBindings: matrixThreadBindingsSchema,
	startupVerification: z.enum(["off", "if-unverified"]).optional(),
	startupVerificationCooldownHours: z.number().optional(),
	mediaMaxMb: z.number().optional(),
	historyLimit: z.number().int().min(0).optional(),
	autoJoin: z.enum([
		"always",
		"allowlist",
		"off"
	]).optional(),
	autoJoinAllowlist: AllowFromListSchema,
	groupAllowFrom: AllowFromListSchema,
	dm: buildNestedDmConfigSchema({
		sessionScope: z.enum(["per-user", "per-room"]).optional(),
		threadReplies: z.enum([
			"off",
			"inbound",
			"always"
		]).optional()
	}),
	execApprovals: matrixExecApprovalsSchema,
	groups: z.object({}).catchall(matrixRoomSchema).optional(),
	rooms: z.object({}).catchall(matrixRoomSchema).optional(),
	actions: matrixActionSchema
}), { uiHints: matrixChannelConfigUiHints });
//#endregion
export { normalizeMatrixUserId as a, normalizeMatrixAllowList as i, DEFAULT_ACCOUNT_ID$1 as n, resolveMatrixAllowListMatch as o, matrixConfigAdapter as r, MatrixChannelConfigSchema as t };
