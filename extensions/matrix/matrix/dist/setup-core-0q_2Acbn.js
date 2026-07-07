import { t as __exportAll } from "./rolldown-runtime-8H4AJuhK.js";
import { a as resolveMatrixDefaultOrOnlyAccountId, r as resolveConfiguredMatrixAccountIds, s as resolveMatrixAccountStringValues } from "./account-selection-Bv_ZuOu4.js";
import { a as resolveMatrixAccountConfig, o as resolveMatrixBaseConfig, t as findMatrixAccountConfig } from "./account-config-BZWN9tGS.js";
import { i as resolveScopedMatrixEnvConfig, n as resolveGlobalMatrixEnvConfig, r as resolveMatrixEnvAuthReadiness } from "./env-auth-DIzOApj0.js";
import { i as loadMatrixCredentials, n as credentialsMatchConfig } from "./credentials-read-TzTOQPOM.js";
import { n as resolveMatrixConfigPath$1, r as shouldStoreMatrixAccountAtTopLevel, t as resolveMatrixConfigFieldPath } from "./config-paths-CnREYb1Y.js";
import { normalizeLowercaseStringOrEmpty, normalizeOptionalString } from "openclaw/plugin-sdk/string-coerce-runtime";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { hasConfiguredSecretInput } from "openclaw/plugin-sdk/secret-input-runtime";
import { DEFAULT_ACCOUNT_ID as DEFAULT_ACCOUNT_ID$1, normalizeAccountId as normalizeAccountId$1 } from "openclaw/plugin-sdk/routing";
import { DEFAULT_ACCOUNT_ID as DEFAULT_ACCOUNT_ID$2, addWildcardAllowFrom, applyAccountNameToChannelSection, normalizeAccountId as normalizeAccountId$2, normalizeAllowFromEntries, normalizeSecretInputString, prepareScopedSetupConfig } from "openclaw/plugin-sdk/setup";
import { resolveOptionalIntegerOption } from "openclaw/plugin-sdk/number-runtime";
import { coerceSecretRef as coerceSecretRef$1 } from "openclaw/plugin-sdk/secret-ref-runtime";
//#region extensions/matrix/src/matrix/accounts.ts
function clean(value) {
	return normalizeOptionalString(value) ?? "";
}
function resolveMatrixAccountAuthView(params) {
	const normalizedAccountId = normalizeAccountId(params.accountId);
	const matrix = resolveMatrixBaseConfig(params.cfg);
	const account = findMatrixAccountConfig(params.cfg, normalizedAccountId) ?? {};
	const resolvedStrings = resolveMatrixAccountStringValues({
		accountId: normalizedAccountId,
		account: {
			homeserver: clean(account.homeserver),
			userId: clean(account.userId),
			accessToken: typeof account.accessToken === "string" ? clean(account.accessToken) : "",
			password: typeof account.password === "string" ? clean(account.password) : "",
			deviceId: clean(account.deviceId),
			deviceName: clean(account.deviceName)
		},
		scopedEnv: resolveScopedMatrixEnvConfig(normalizedAccountId, params.env),
		channel: {
			homeserver: clean(matrix.homeserver),
			userId: clean(matrix.userId),
			accessToken: typeof matrix.accessToken === "string" ? clean(matrix.accessToken) : "",
			password: typeof matrix.password === "string" ? clean(matrix.password) : "",
			deviceId: clean(matrix.deviceId),
			deviceName: clean(matrix.deviceName)
		},
		globalEnv: resolveGlobalMatrixEnvConfig(params.env)
	});
	return {
		homeserver: resolvedStrings.homeserver,
		userId: resolvedStrings.userId,
		accessToken: resolvedStrings.accessToken || void 0,
		password: resolvedStrings.password || void 0
	};
}
function resolveMatrixAccountUserId(params) {
	const env = params.env ?? process.env;
	const authView = resolveMatrixAccountAuthView({
		cfg: params.cfg,
		accountId: params.accountId,
		env
	});
	const configuredUserId = authView.userId.trim();
	if (configuredUserId) return configuredUserId;
	const stored = loadMatrixCredentials(env, params.accountId);
	if (!stored) return null;
	if (authView.homeserver && stored.homeserver !== authView.homeserver) return null;
	if (authView.accessToken && stored.accessToken !== authView.accessToken) return null;
	return stored.userId.trim() || null;
}
function listMatrixAccountIds(cfg) {
	const ids = resolveConfiguredMatrixAccountIds(cfg, process.env);
	return ids.length > 0 ? ids : [DEFAULT_ACCOUNT_ID];
}
function resolveDefaultMatrixAccountId(cfg) {
	return normalizeAccountId(resolveMatrixDefaultOrOnlyAccountId(cfg));
}
function resolveConfiguredMatrixBotUserIds(params) {
	const env = params.env ?? process.env;
	const currentAccountId = normalizeAccountId(params.accountId);
	const accountIds = new Set(resolveConfiguredMatrixAccountIds(params.cfg, env));
	if (resolveMatrixAccount({
		cfg: params.cfg,
		accountId: DEFAULT_ACCOUNT_ID,
		env
	}).configured) accountIds.add(DEFAULT_ACCOUNT_ID);
	const ids = /* @__PURE__ */ new Set();
	for (const accountId of accountIds) {
		if (normalizeAccountId(accountId) === currentAccountId) continue;
		if (!resolveMatrixAccount({
			cfg: params.cfg,
			accountId,
			env
		}).configured) continue;
		const userId = resolveMatrixAccountUserId({
			cfg: params.cfg,
			accountId,
			env
		});
		if (userId) ids.add(userId);
	}
	return ids;
}
function resolveMatrixAccount(params) {
	const env = params.env ?? process.env;
	const accountId = normalizeAccountId(params.accountId ?? resolveDefaultMatrixAccountId(params.cfg));
	const matrixBase = resolveMatrixBaseConfig(params.cfg);
	const base = resolveMatrixAccountConfig({
		cfg: params.cfg,
		accountId,
		env
	});
	const explicitAuthConfig = accountId === DEFAULT_ACCOUNT_ID ? base : findMatrixAccountConfig(params.cfg, accountId) ?? {};
	const enabled = base.enabled !== false && matrixBase.enabled !== false;
	const authView = resolveMatrixAccountAuthView({
		cfg: params.cfg,
		accountId,
		env
	});
	const hasHomeserver = Boolean(authView.homeserver);
	const hasUserId = Boolean(authView.userId);
	const hasAccessToken = Boolean(authView.accessToken) || hasConfiguredSecretInput(explicitAuthConfig.accessToken);
	const hasPassword = Boolean(authView.password);
	const hasPasswordAuth = hasUserId && (hasPassword || hasConfiguredSecretInput(explicitAuthConfig.password));
	const stored = loadMatrixCredentials(env, accountId);
	const hasStored = stored && authView.homeserver ? credentialsMatchConfig(stored, {
		homeserver: authView.homeserver,
		userId: authView.userId || ""
	}) : false;
	const configured = hasHomeserver && (hasAccessToken || hasPasswordAuth || hasStored);
	return {
		accountId,
		enabled,
		name: normalizeOptionalString(base.name),
		configured,
		homeserver: authView.homeserver || void 0,
		userId: authView.userId || void 0,
		config: base
	};
}
//#endregion
//#region extensions/matrix/src/setup-contract.ts
const matrixSingleAccountKeysToMove = [
	"deviceId",
	"avatarUrl",
	"initialSyncLimit",
	"encryption",
	"allowlistOnly",
	"dangerouslyAllowNameMatching",
	"allowBots",
	"blockStreaming",
	"replyToMode",
	"threadReplies",
	"textChunkLimit",
	"chunkMode",
	"responsePrefix",
	"ackReaction",
	"ackReactionScope",
	"reactionNotifications",
	"threadBindings",
	"startupVerification",
	"startupVerificationCooldownHours",
	"mediaMaxMb",
	"autoJoin",
	"autoJoinAllowlist",
	"dm",
	"groups",
	"rooms",
	"actions"
];
const matrixNamedAccountPromotionKeys = [
	"name",
	"homeserver",
	"userId",
	"accessToken",
	"password",
	"deviceId",
	"deviceName",
	"avatarUrl",
	"initialSyncLimit",
	"encryption"
];
const singleAccountKeysToMove = [...matrixSingleAccountKeysToMove];
const namedAccountPromotionKeys = [...matrixNamedAccountPromotionKeys];
function resolveSingleAccountPromotionTarget(params) {
	const accounts = typeof params.channel.accounts === "object" && params.channel.accounts ? params.channel.accounts : {};
	const normalizedDefaultAccount = typeof params.channel.defaultAccount === "string" && params.channel.defaultAccount.trim() ? normalizeAccountId$1(params.channel.defaultAccount) : void 0;
	const matchedAccountId = normalizedDefaultAccount ? Object.entries(accounts).find(([accountId, value]) => accountId && value && typeof value === "object" && normalizeAccountId$1(accountId) === normalizedDefaultAccount)?.[0] : void 0;
	if (matchedAccountId) return matchedAccountId;
	if (normalizedDefaultAccount) return DEFAULT_ACCOUNT_ID$1;
	const namedAccounts = Object.entries(accounts).filter(([accountId, value]) => accountId && typeof value === "object" && value);
	if (namedAccounts.length === 1) return namedAccounts[0][0];
	if (namedAccounts.length > 1 && accounts[DEFAULT_ACCOUNT_ID$1] && typeof accounts[DEFAULT_ACCOUNT_ID$1] === "object") return DEFAULT_ACCOUNT_ID$1;
	return DEFAULT_ACCOUNT_ID$1;
}
//#endregion
//#region extensions/matrix/src/matrix/config-update.ts
var config_update_exports = /* @__PURE__ */ __exportAll({
	resolveMatrixConfigFieldPath: () => resolveMatrixConfigFieldPath,
	resolveMatrixConfigPath: () => resolveMatrixConfigPath,
	shouldStoreMatrixAccountAtTopLevel: () => shouldStoreMatrixAccountAtTopLevel,
	updateMatrixAccountConfig: () => updateMatrixAccountConfig
});
const resolveMatrixConfigPath = resolveMatrixConfigPath$1;
function applyNullableStringField(target, key, value) {
	if (value === void 0) return;
	if (value === null) {
		delete target[key];
		return;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		delete target[key];
		return;
	}
	target[key] = trimmed;
}
function applyNullableSecretInputField(target, key, value, defaults) {
	if (value === void 0) return;
	if (value === null) {
		delete target[key];
		return;
	}
	if (typeof value === "string") {
		const normalized = normalizeSecretInputString(value);
		if (normalized) target[key] = normalized;
		else delete target[key];
		return;
	}
	const ref = coerceSecretRef$1(value, defaults);
	if (!ref) throw new Error(`Invalid Matrix ${key} SecretInput.`);
	target[key] = ref;
}
function cloneMatrixDmConfig(dm) {
	if (!dm) return dm;
	return {
		...dm,
		...dm.allowFrom ? { allowFrom: [...dm.allowFrom] } : {}
	};
}
function cloneMatrixRoomMap(rooms) {
	if (!rooms) return rooms;
	const clonedRoomEntries = [];
	for (const [roomId, roomCfg] of Object.entries(rooms)) clonedRoomEntries.push([roomId, roomCfg ? { ...roomCfg } : roomCfg]);
	return Object.fromEntries(clonedRoomEntries);
}
function applyNullableArrayField(target, key, value) {
	if (value === void 0) return;
	if (value === null) {
		delete target[key];
		return;
	}
	target[key] = [...value];
}
function updateMatrixAccountConfig(cfg, accountId, patch) {
	const matrix = cfg.channels?.matrix ?? {};
	const normalizedAccountId = normalizeAccountId(accountId);
	const nextAccount = { ...findMatrixAccountConfig(cfg, normalizedAccountId) ?? (normalizedAccountId === DEFAULT_ACCOUNT_ID ? matrix : {}) };
	if (patch.name !== void 0) if (patch.name === null) delete nextAccount.name;
	else {
		const trimmed = patch.name.trim();
		if (trimmed) nextAccount.name = trimmed;
		else delete nextAccount.name;
	}
	if (typeof patch.enabled === "boolean") nextAccount.enabled = patch.enabled;
	else if (typeof nextAccount.enabled !== "boolean") nextAccount.enabled = true;
	applyNullableStringField(nextAccount, "homeserver", patch.homeserver);
	applyNullableStringField(nextAccount, "proxy", patch.proxy);
	applyNullableStringField(nextAccount, "userId", patch.userId);
	applyNullableSecretInputField(nextAccount, "accessToken", patch.accessToken, cfg.secrets?.defaults);
	applyNullableSecretInputField(nextAccount, "password", patch.password, cfg.secrets?.defaults);
	applyNullableStringField(nextAccount, "deviceId", patch.deviceId);
	applyNullableStringField(nextAccount, "deviceName", patch.deviceName);
	applyNullableStringField(nextAccount, "avatarUrl", patch.avatarUrl);
	if (patch.allowPrivateNetwork !== void 0) {
		const nextNetwork = nextAccount.network && typeof nextAccount.network === "object" ? { ...nextAccount.network } : {};
		if (patch.allowPrivateNetwork === null) delete nextNetwork.dangerouslyAllowPrivateNetwork;
		else nextNetwork.dangerouslyAllowPrivateNetwork = patch.allowPrivateNetwork;
		if (Object.keys(nextNetwork).length > 0) nextAccount.network = nextNetwork;
		else delete nextAccount.network;
	}
	if (patch.initialSyncLimit !== void 0) if (patch.initialSyncLimit === null) delete nextAccount.initialSyncLimit;
	else {
		const initialSyncLimit = resolveOptionalIntegerOption(patch.initialSyncLimit, { min: 0 });
		if (initialSyncLimit === void 0) delete nextAccount.initialSyncLimit;
		else nextAccount.initialSyncLimit = initialSyncLimit;
	}
	if (patch.encryption !== void 0) if (patch.encryption === null) delete nextAccount.encryption;
	else nextAccount.encryption = patch.encryption;
	if (patch.allowBots !== void 0) if (patch.allowBots === null) delete nextAccount.allowBots;
	else nextAccount.allowBots = patch.allowBots;
	if (patch.autoJoin !== void 0) if (patch.autoJoin === null) delete nextAccount.autoJoin;
	else nextAccount.autoJoin = patch.autoJoin;
	applyNullableArrayField(nextAccount, "autoJoinAllowlist", patch.autoJoinAllowlist);
	if (patch.dm !== void 0) if (patch.dm === null) delete nextAccount.dm;
	else nextAccount.dm = cloneMatrixDmConfig({
		...nextAccount.dm,
		...patch.dm
	});
	if (patch.groupPolicy !== void 0) if (patch.groupPolicy === null) delete nextAccount.groupPolicy;
	else nextAccount.groupPolicy = patch.groupPolicy;
	applyNullableArrayField(nextAccount, "groupAllowFrom", patch.groupAllowFrom);
	if (patch.groups !== void 0) if (patch.groups === null) delete nextAccount.groups;
	else nextAccount.groups = cloneMatrixRoomMap(patch.groups);
	if (patch.rooms !== void 0) if (patch.rooms === null) delete nextAccount.rooms;
	else nextAccount.rooms = cloneMatrixRoomMap(patch.rooms);
	const nextAccounts = Object.fromEntries(Object.entries(matrix.accounts ?? {}).filter(([rawAccountId]) => rawAccountId === normalizedAccountId || normalizeAccountId(rawAccountId) !== normalizedAccountId));
	if (shouldStoreMatrixAccountAtTopLevel(cfg, normalizedAccountId)) {
		const { accounts: _ignoredAccounts, defaultAccount } = matrix;
		const { accounts: _ignoredNextAccounts, defaultAccount: _ignoredNextDefaultAccount, ...topLevelAccount } = nextAccount;
		return {
			...cfg,
			channels: {
				...cfg.channels,
				matrix: {
					...defaultAccount ? { defaultAccount } : {},
					enabled: true,
					...topLevelAccount
				}
			}
		};
	}
	return {
		...cfg,
		channels: {
			...cfg.channels,
			matrix: {
				...matrix,
				enabled: true,
				accounts: {
					...nextAccounts,
					[normalizedAccountId]: nextAccount
				}
			}
		}
	};
}
//#endregion
//#region extensions/matrix/src/matrix/profile.ts
var profile_exports = /* @__PURE__ */ __exportAll({
	MATRIX_PROFILE_AVATAR_MAX_BYTES: () => MATRIX_PROFILE_AVATAR_MAX_BYTES,
	isMatrixHttpAvatarUri: () => isMatrixHttpAvatarUri,
	isMatrixMxcUri: () => isMatrixMxcUri,
	isSupportedMatrixAvatarSource: () => isSupportedMatrixAvatarSource,
	syncMatrixOwnProfile: () => syncMatrixOwnProfile
});
const MATRIX_PROFILE_AVATAR_MAX_BYTES = 10 * 1024 * 1024;
function isMatrixMxcUri(value) {
	return normalizeLowercaseStringOrEmpty(normalizeOptionalString(value)).startsWith("mxc://");
}
function isMatrixHttpAvatarUri(value) {
	const normalized = normalizeLowercaseStringOrEmpty(normalizeOptionalString(value));
	return normalized.startsWith("https://") || normalized.startsWith("http://");
}
function isSupportedMatrixAvatarSource(value) {
	return isMatrixMxcUri(value) || isMatrixHttpAvatarUri(value);
}
async function uploadAvatarMedia(params) {
	const media = await params.loadAvatar(params.avatarSource, params.avatarMaxBytes);
	return await params.client.uploadContent(media.buffer, media.contentType, media.fileName || "avatar");
}
async function resolveAvatarUrl(params) {
	const avatarPath = normalizeOptionalString(params.avatarPath) ?? null;
	if (avatarPath) {
		if (!params.loadAvatarFromPath) throw new Error("Matrix avatar path upload requires a media loader.");
		return {
			resolvedAvatarUrl: await uploadAvatarMedia({
				client: params.client,
				avatarSource: avatarPath,
				avatarMaxBytes: params.avatarMaxBytes,
				loadAvatar: params.loadAvatarFromPath
			}),
			uploadedAvatarSource: "path",
			convertedAvatarFromHttp: false
		};
	}
	const avatarUrl = normalizeOptionalString(params.avatarUrl) ?? null;
	if (!avatarUrl) return {
		resolvedAvatarUrl: null,
		uploadedAvatarSource: null,
		convertedAvatarFromHttp: false
	};
	if (isMatrixMxcUri(avatarUrl)) return {
		resolvedAvatarUrl: avatarUrl,
		uploadedAvatarSource: null,
		convertedAvatarFromHttp: false
	};
	if (!isMatrixHttpAvatarUri(avatarUrl)) throw new Error("Matrix avatar URL must be an mxc:// URI or an http(s) URL.");
	if (!params.loadAvatarFromUrl) throw new Error("Matrix avatar URL conversion requires a media loader.");
	return {
		resolvedAvatarUrl: await uploadAvatarMedia({
			client: params.client,
			avatarSource: avatarUrl,
			avatarMaxBytes: params.avatarMaxBytes,
			loadAvatar: params.loadAvatarFromUrl
		}),
		uploadedAvatarSource: "http",
		convertedAvatarFromHttp: true
	};
}
async function syncMatrixOwnProfile(params) {
	const desiredDisplayName = normalizeOptionalString(params.displayName) ?? null;
	const avatar = await resolveAvatarUrl({
		client: params.client,
		avatarUrl: params.avatarUrl ?? null,
		avatarPath: params.avatarPath ?? null,
		avatarMaxBytes: params.avatarMaxBytes ?? 10485760,
		loadAvatarFromUrl: params.loadAvatarFromUrl,
		loadAvatarFromPath: params.loadAvatarFromPath
	});
	const desiredAvatarUrl = avatar.resolvedAvatarUrl;
	if (!desiredDisplayName && !desiredAvatarUrl) return {
		skipped: true,
		displayNameUpdated: false,
		avatarUpdated: false,
		resolvedAvatarUrl: null,
		uploadedAvatarSource: avatar.uploadedAvatarSource,
		convertedAvatarFromHttp: avatar.convertedAvatarFromHttp
	};
	let currentDisplayName;
	let currentAvatarUrl;
	try {
		const currentProfile = await params.client.getUserProfile(params.userId);
		currentDisplayName = normalizeOptionalString(currentProfile.displayname);
		currentAvatarUrl = normalizeOptionalString(currentProfile.avatar_url);
	} catch {}
	let displayNameUpdated = false;
	let avatarUpdated = false;
	if (desiredDisplayName && currentDisplayName !== desiredDisplayName) {
		await params.client.setDisplayName(desiredDisplayName);
		displayNameUpdated = true;
	}
	if (desiredAvatarUrl && currentAvatarUrl !== desiredAvatarUrl) {
		await params.client.setAvatarUrl(desiredAvatarUrl);
		avatarUpdated = true;
	}
	return {
		skipped: false,
		displayNameUpdated,
		avatarUpdated,
		resolvedAvatarUrl: desiredAvatarUrl,
		uploadedAvatarSource: avatar.uploadedAvatarSource,
		convertedAvatarFromHttp: avatar.convertedAvatarFromHttp
	};
}
//#endregion
//#region extensions/matrix/src/setup-config.ts
const channel$1 = "matrix";
const COMMON_SINGLE_ACCOUNT_KEYS_TO_MOVE = new Set([
	"name",
	"enabled",
	"httpPort",
	"webhookPath",
	"webhookUrl",
	"webhookSecret",
	"service",
	"region",
	"homeserver",
	"userId",
	"accessToken",
	"password",
	"deviceName",
	"url",
	"code",
	"dmPolicy",
	"allowFrom",
	"groupPolicy",
	"groupAllowFrom",
	"defaultTo"
]);
const MATRIX_SINGLE_ACCOUNT_KEYS_TO_MOVE = new Set(matrixSingleAccountKeysToMove);
const MATRIX_NAMED_ACCOUNT_PROMOTION_KEYS = new Set(matrixNamedAccountPromotionKeys);
function cloneIfObject(value) {
	if (value && typeof value === "object") return structuredClone(value);
	return value;
}
function resolveSetupAvatarUrl(input) {
	const avatarUrl = input.avatarUrl;
	if (typeof avatarUrl !== "string") return;
	return avatarUrl.trim() || void 0;
}
function resolveExistingMatrixAccountKey(accounts, targetAccountId) {
	const normalizedTargetAccountId = normalizeAccountId$2(targetAccountId);
	return Object.keys(accounts).find((accountId) => normalizeAccountId$2(accountId) === normalizedTargetAccountId) ?? targetAccountId;
}
function moveSingleMatrixAccountConfigToNamedAccount(cfg) {
	const baseConfig = cfg.channels?.[channel$1];
	const base = typeof baseConfig === "object" && baseConfig ? baseConfig : void 0;
	if (!base) return cfg;
	const accounts = typeof base.accounts === "object" && base.accounts ? base.accounts : {};
	const hasNamedAccounts = Object.keys(accounts).some(Boolean);
	const keysToMove = Object.entries(base).filter(([key, value]) => {
		if (key === "accounts" || key === "enabled" || value === void 0) return false;
		if (!COMMON_SINGLE_ACCOUNT_KEYS_TO_MOVE.has(key) && !MATRIX_SINGLE_ACCOUNT_KEYS_TO_MOVE.has(key)) return false;
		if (hasNamedAccounts && !MATRIX_NAMED_ACCOUNT_PROMOTION_KEYS.has(key)) return false;
		return true;
	}).map(([key]) => key);
	if (keysToMove.length === 0) return cfg;
	const resolvedTargetAccountId = resolveExistingMatrixAccountKey(accounts, resolveSingleAccountPromotionTarget({ channel: base }));
	const nextAccount = { ...accounts[resolvedTargetAccountId] };
	for (const key of keysToMove) nextAccount[key] = cloneIfObject(base[key]);
	const nextChannel = { ...base };
	for (const key of keysToMove) delete nextChannel[key];
	return {
		...cfg,
		channels: {
			...cfg.channels,
			[channel$1]: {
				...nextChannel,
				accounts: {
					...accounts,
					[resolvedTargetAccountId]: nextAccount
				}
			}
		}
	};
}
function validateMatrixSetupInput(params) {
	const avatarUrl = resolveSetupAvatarUrl(params.input);
	if (avatarUrl && !isSupportedMatrixAvatarSource(avatarUrl)) return "Matrix avatar URL must be an mxc:// URI or an http(s) URL.";
	if (params.input.useEnv) {
		const envReadiness = resolveMatrixEnvAuthReadiness(params.accountId, process.env);
		return envReadiness.ready ? null : envReadiness.missingMessage;
	}
	if (!params.input.homeserver?.trim()) return "Matrix requires --homeserver";
	const accessToken = params.input.accessToken?.trim();
	const password = normalizeSecretInputString(params.input.password);
	const userId = params.input.userId?.trim();
	if (!accessToken && !password) return "Matrix requires --access-token or --password";
	if (!accessToken) {
		if (!userId) return "Matrix requires --user-id when using --password";
		if (!password) return "Matrix requires --password when using --user-id";
	}
	return null;
}
function applyMatrixSetupAccountConfig(params) {
	const normalizedAccountId = normalizeAccountId$2(params.accountId);
	const next = applyAccountNameToChannelSection({
		cfg: normalizedAccountId !== DEFAULT_ACCOUNT_ID$2 ? moveSingleMatrixAccountConfigToNamedAccount(params.cfg) : params.cfg,
		channelKey: channel$1,
		accountId: normalizedAccountId,
		name: params.input.name
	});
	const avatarUrl = resolveSetupAvatarUrl(params.input);
	if (params.input.useEnv) return updateMatrixAccountConfig(next, normalizedAccountId, {
		enabled: true,
		homeserver: null,
		allowPrivateNetwork: null,
		proxy: null,
		userId: null,
		accessToken: null,
		password: null,
		deviceId: null,
		deviceName: null,
		avatarUrl
	});
	const accessToken = params.input.accessToken?.trim();
	const password = normalizeSecretInputString(params.input.password);
	const userId = params.input.userId?.trim();
	return updateMatrixAccountConfig(next, normalizedAccountId, {
		enabled: true,
		homeserver: params.input.homeserver?.trim(),
		allowPrivateNetwork: typeof params.input.dangerouslyAllowPrivateNetwork === "boolean" ? params.input.dangerouslyAllowPrivateNetwork : typeof params.input.allowPrivateNetwork === "boolean" ? params.input.allowPrivateNetwork : void 0,
		proxy: normalizeOptionalString(params.input.proxy),
		userId: password && !userId ? null : userId,
		accessToken: accessToken || (password ? null : void 0),
		password: password || (accessToken ? null : void 0),
		deviceName: params.input.deviceName?.trim(),
		avatarUrl,
		initialSyncLimit: params.input.initialSyncLimit
	});
}
//#endregion
//#region extensions/matrix/src/setup-dm-policy.ts
function resolveMatrixSetupDmAllowFrom(policy, allowFrom) {
	if (policy === "open") return addWildcardAllowFrom(allowFrom);
	return normalizeAllowFromEntries(allowFrom ?? []).filter((entry) => entry !== "*");
}
//#endregion
//#region extensions/matrix/src/setup-core.ts
const channel = "matrix";
function resolveMatrixSetupAccountId(params) {
	return normalizeAccountId$2(params.accountId?.trim() || params.name?.trim() || DEFAULT_ACCOUNT_ID$2);
}
function resolveMatrixSetupWizardAccountId(cfg, accountId) {
	return normalizeAccountId$2(accountId?.trim() || resolveDefaultMatrixAccountId(cfg) || DEFAULT_ACCOUNT_ID$2);
}
function setMatrixDmPolicy(cfg, policy, accountId) {
	const resolvedAccountId = resolveMatrixSetupWizardAccountId(cfg, accountId);
	const existing = resolveMatrixAccountConfig({
		cfg,
		accountId: resolvedAccountId
	});
	const allowFrom = resolveMatrixSetupDmAllowFrom(policy, existing.dm?.allowFrom);
	return updateMatrixAccountConfig(cfg, resolvedAccountId, { dm: {
		...existing.dm,
		policy,
		allowFrom
	} });
}
function createMatrixSetupWizardProxy(loadWizardModule) {
	let wizardPromise = null;
	const loadWizard = () => {
		wizardPromise ??= loadWizardModule().then((module) => module.matrixSetupWizard);
		return wizardPromise;
	};
	return {
		channel,
		getStatus: async (ctx) => await (await loadWizard()).getStatus(ctx),
		configure: async (ctx) => await (await loadWizard()).configure(ctx),
		configureInteractive: async (ctx) => {
			const wizard = await loadWizard();
			return await (wizard.configureInteractive ?? wizard.configure)(ctx);
		},
		configureWhenConfigured: async (ctx) => {
			const wizard = await loadWizard();
			return await (wizard.configureWhenConfigured ?? wizard.configureInteractive ?? wizard.configure)(ctx);
		},
		afterConfigWritten: async (ctx) => await (await loadWizard()).afterConfigWritten?.(ctx),
		dmPolicy: {
			label: "Matrix",
			channel,
			policyKey: "channels.matrix.dm.policy",
			allowFromKey: "channels.matrix.dm.allowFrom",
			resolveConfigKeys: (cfg, accountId) => {
				const resolvedAccountId = resolveMatrixSetupWizardAccountId(cfg, accountId);
				return {
					policyKey: resolveMatrixConfigFieldPath(cfg, resolvedAccountId, "dm.policy"),
					allowFromKey: resolveMatrixConfigFieldPath(cfg, resolvedAccountId, "dm.allowFrom")
				};
			},
			getCurrent: (cfg, accountId) => resolveMatrixAccountConfig({
				cfg,
				accountId: resolveMatrixSetupWizardAccountId(cfg, accountId)
			}).dm?.policy ?? "pairing",
			setPolicy: (cfg, policy, accountId) => setMatrixDmPolicy(cfg, policy, accountId),
			promptAllowFrom: async (params) => {
				const promptAllowFrom = (await loadWizard()).dmPolicy?.promptAllowFrom;
				return promptAllowFrom ? await promptAllowFrom(params) : params.cfg;
			}
		},
		disable: (cfg) => ({
			...cfg,
			channels: {
				...cfg.channels,
				matrix: {
					...cfg.channels?.matrix,
					enabled: false
				}
			}
		})
	};
}
const matrixSetupAdapter = {
	resolveAccountId: ({ accountId, input }) => resolveMatrixSetupAccountId({
		accountId,
		name: input?.name
	}),
	resolveBindingAccountId: ({ accountId, agentId }) => resolveMatrixSetupAccountId({
		accountId,
		name: agentId
	}),
	applyAccountName: ({ cfg, accountId, name }) => prepareScopedSetupConfig({
		cfg,
		channelKey: channel,
		accountId,
		name
	}),
	validateInput: ({ accountId, input }) => validateMatrixSetupInput({
		accountId,
		input
	}),
	applyAccountConfig: ({ cfg, accountId, input }) => applyMatrixSetupAccountConfig({
		cfg,
		accountId,
		input
	}),
	afterAccountConfigWritten: async ({ previousCfg, cfg, accountId, runtime }) => {
		const { runMatrixSetupBootstrapAfterConfigWrite } = await import("./setup-bootstrap-CF0GimJg.js");
		await runMatrixSetupBootstrapAfterConfigWrite({
			previousCfg,
			cfg,
			accountId,
			runtime
		});
	}
};
//#endregion
export { profile_exports as a, resolveMatrixConfigPath as c, resolveSingleAccountPromotionTarget as d, singleAccountKeysToMove as f, resolveMatrixAccount as g, resolveDefaultMatrixAccountId as h, moveSingleMatrixAccountConfigToNamedAccount as i, updateMatrixAccountConfig as l, resolveConfiguredMatrixBotUserIds as m, matrixSetupAdapter as n, syncMatrixOwnProfile as o, listMatrixAccountIds as p, resolveMatrixSetupDmAllowFrom as r, config_update_exports as s, createMatrixSetupWizardProxy as t, namedAccountPromotionKeys as u };
