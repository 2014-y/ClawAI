import { t as __exportAll } from "./rolldown-runtime-8H4AJuhK.js";
import { a as resolveMatrixDefaultOrOnlyAccountId, n as requiresExplicitMatrixDefaultAccount, s as resolveMatrixAccountStringValues } from "./account-selection-Bv_ZuOu4.js";
import { t as getMatrixScopedEnvVarNames } from "./env-vars-KzaYveuy.js";
import { o as resolveMatrixBaseConfig, r as listNormalizedMatrixAccountIds, t as findMatrixAccountConfig } from "./account-config-BZWN9tGS.js";
import { i as resolveScopedMatrixEnvConfig, n as resolveGlobalMatrixEnvConfig } from "./env-auth-DIzOApj0.js";
import { t as resolveMatrixConfigFieldPath } from "./config-paths-CnREYb1Y.js";
import { t as resolveValidatedMatrixHomeserverUrl } from "./url-validation-GRHde6lq.js";
import { s as repairCurrentTokenStorageMetaDeviceId } from "./storage-D3JJ0OzE.js";
import { n as LogService } from "./logger-D0GCSDQq.js";
import { DEFAULT_ACCOUNT_ID as DEFAULT_ACCOUNT_ID$1, normalizeAccountId as normalizeAccountId$1, normalizeOptionalAccountId, normalizeOptionalAccountId as normalizeOptionalAccountId$1 } from "openclaw/plugin-sdk/account-id";
import { coerceSecretRef, normalizeResolvedSecretInputString } from "openclaw/plugin-sdk/secret-input-runtime";
import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
import { isPrivateNetworkOptInEnabled, ssrfPolicyFromDangerouslyAllowPrivateNetwork as ssrfPolicyFromDangerouslyAllowPrivateNetwork$1 } from "openclaw/plugin-sdk/ssrf-runtime";
import { resolveOptionalIntegerOption } from "openclaw/plugin-sdk/number-runtime";
import { requireRuntimeConfig } from "openclaw/plugin-sdk/plugin-config-runtime";
import { retryAsync } from "openclaw/plugin-sdk/retry-runtime";
//#region extensions/matrix/src/matrix/client/config.ts
let matrixAuthClientDepsPromise;
let matrixCredentialsReadDepsPromise;
let matrixCredentialsWriteRuntimePromise;
let matrixSecretInputDepsPromise;
const MATRIX_AUTH_REQUEST_RETRY_RE = /\b(fetch failed|econnreset|econnrefused|enotfound|etimedout|ehostunreach|enetunreach|eai_again|und_err_|socket hang up|network|headers timeout|body timeout|connect timeout)\b/i;
async function loadMatrixAuthClientDeps() {
	matrixAuthClientDepsPromise ??= Promise.all([import("./sdk-DLlal_yG.js"), import("./logging-QH-48Gr6.js")]).then(([sdkModule, loggingModule]) => ({
		MatrixClient: sdkModule.MatrixClient,
		ensureMatrixSdkLoggingConfigured: loggingModule.ensureMatrixSdkLoggingConfigured
	}));
	return await matrixAuthClientDepsPromise;
}
async function loadMatrixCredentialsReadDeps() {
	matrixCredentialsReadDepsPromise ??= import("./credentials-read-TzTOQPOM.js").then((n) => n.r).then((credentialsReadModule) => ({
		loadMatrixCredentials: credentialsReadModule.loadMatrixCredentials,
		credentialsMatchConfig: credentialsReadModule.credentialsMatchConfig
	}));
	return await matrixCredentialsReadDepsPromise;
}
async function loadMatrixCredentialsWriteRuntime() {
	matrixCredentialsWriteRuntimePromise ??= import("./credentials-write.runtime-cZhhyGAZ.js");
	return await matrixCredentialsWriteRuntimePromise;
}
async function loadMatrixSecretInputDeps() {
	matrixSecretInputDepsPromise ??= import("./config-secret-input.runtime-CwsP3--c.js").then((runtime) => ({ resolveConfiguredSecretInputString: runtime.resolveConfiguredSecretInputString }));
	return await matrixSecretInputDepsPromise;
}
function shouldRetryMatrixAuthRequest(err) {
	return MATRIX_AUTH_REQUEST_RETRY_RE.test(formatErrorMessage(err));
}
function isAbortSignalTriggered(signal) {
	return signal?.aborted === true;
}
function credentialsMatchBackfillAuthLineage(params) {
	if (!params.stored) return true;
	return params.stored.homeserver === params.auth.homeserver && params.stored.userId === params.auth.userId && params.stored.accessToken === params.auth.accessToken;
}
async function retryMatrixAuthRequest(label, run) {
	return await retryAsync(run, {
		attempts: 3,
		minDelayMs: 250,
		maxDelayMs: 1500,
		jitter: .1,
		label,
		shouldRetry: (err) => shouldRetryMatrixAuthRequest(err)
	});
}
async function fetchMatrixWhoamiIdentity(params) {
	const { MatrixClient, ensureMatrixSdkLoggingConfigured } = await loadMatrixAuthClientDeps();
	ensureMatrixSdkLoggingConfigured();
	const tempClient = new MatrixClient(params.homeserver, params.accessToken, {
		userId: params.userId,
		ssrfPolicy: params.ssrfPolicy,
		dispatcherPolicy: params.dispatcherPolicy
	});
	return await retryMatrixAuthRequest("matrix auth whoami", async () => {
		return await tempClient.doRequest("GET", "/_matrix/client/v3/account/whoami");
	});
}
function readEnvSecretRefFallback(params) {
	const ref = coerceSecretRef(params.value, params.config?.secrets?.defaults);
	if (!ref || ref.source !== "env" || !params.env) return;
	const providerConfig = params.config?.secrets?.providers?.[ref.provider];
	if (providerConfig) {
		if (providerConfig.source !== "env") throw new Error(`Secret provider "${ref.provider}" has source "${providerConfig.source}" but ref requests "env".`);
		if (providerConfig.allowlist && !providerConfig.allowlist.includes(ref.id)) throw new Error(`Environment variable "${ref.id}" is not allowlisted in secrets.providers.${ref.provider}.allowlist.`);
	} else if (ref.provider !== (params.config?.secrets?.defaults?.env?.trim() || "default")) throw new Error(`Secret provider "${ref.provider}" is not configured (ref: ${ref.source}:${ref.provider}:${ref.id}).`);
	const resolved = params.env[ref.id];
	if (typeof resolved !== "string") return;
	const trimmed = resolved.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
function clean(value, path, opts) {
	const ref = coerceSecretRef(value, opts?.config?.secrets?.defaults);
	if (opts?.suppressSecretRef && ref) return "";
	return normalizeResolvedSecretInputString({
		value: opts?.allowEnvSecretRefFallback ? ref?.source === "env" ? readEnvSecretRefFallback({
			value,
			env: opts.env,
			config: opts.config
		}) ?? value : ref ? "" : value : value,
		path,
		defaults: opts?.config?.secrets?.defaults
	}) ?? "";
}
function resolveMatrixBaseConfigFieldPath(field) {
	return `channels.matrix.${field}`;
}
function shouldAllowEnvSecretRefFallback(field) {
	return field === "accessToken" || field === "password";
}
function hasConfiguredSecretInputValue(value, cfg) {
	return typeof value === "string" && value.trim().length > 0 || Boolean(coerceSecretRef(value, cfg.secrets?.defaults));
}
function hasConfiguredMatrixAccessTokenSource(params) {
	const normalizedAccountId = normalizeAccountId$1(params.accountId);
	const account = findMatrixAccountConfig(params.cfg, normalizedAccountId) ?? {};
	const scopedAccessTokenVar = getMatrixScopedEnvVarNames(normalizedAccountId).accessToken;
	if (hasConfiguredSecretInputValue(account.accessToken, params.cfg) || clean(params.env[scopedAccessTokenVar], scopedAccessTokenVar).length > 0) return true;
	if (normalizedAccountId !== DEFAULT_ACCOUNT_ID$1) return false;
	return hasConfiguredSecretInputValue(resolveMatrixBaseConfig(params.cfg).accessToken, params.cfg) || clean(params.env.MATRIX_ACCESS_TOKEN, "MATRIX_ACCESS_TOKEN").length > 0;
}
function resolveConfiguredMatrixAuthInput(params) {
	const normalizedAccountId = normalizeAccountId$1(params.accountId);
	const accountValue = (findMatrixAccountConfig(params.cfg, normalizedAccountId) ?? {})[params.field];
	if (accountValue !== void 0) return {
		value: accountValue,
		path: resolveMatrixConfigFieldPath(params.cfg, normalizedAccountId, params.field)
	};
	const scopedKeys = getMatrixScopedEnvVarNames(normalizedAccountId);
	const scopedValue = resolveScopedMatrixEnvConfig(normalizedAccountId, params.env)[params.field];
	if (scopedValue !== void 0) return {
		value: scopedValue,
		path: params.field === "accessToken" ? scopedKeys.accessToken : scopedKeys.password
	};
	if (normalizedAccountId !== DEFAULT_ACCOUNT_ID$1) return;
	const baseValue = resolveMatrixBaseConfig(params.cfg)[params.field];
	if (baseValue !== void 0) return {
		value: baseValue,
		path: resolveMatrixBaseConfigFieldPath(params.field)
	};
	const globalValue = params.field === "accessToken" ? params.env.MATRIX_ACCESS_TOKEN : params.env.MATRIX_PASSWORD;
	if (globalValue !== void 0) return {
		value: globalValue,
		path: params.field === "accessToken" ? "MATRIX_ACCESS_TOKEN" : "MATRIX_PASSWORD"
	};
}
async function resolveConfiguredMatrixAuthSecretInput(params) {
	const configured = resolveConfiguredMatrixAuthInput(params);
	if (!configured) return;
	if (!coerceSecretRef(configured.value, params.cfg.secrets?.defaults)) return normalizeResolvedSecretInputString({
		value: configured.value,
		path: configured.path,
		defaults: params.cfg.secrets?.defaults
	});
	const { resolveConfiguredSecretInputString } = await loadMatrixSecretInputDeps();
	const resolved = await resolveConfiguredSecretInputString({
		config: params.cfg,
		env: params.env,
		value: configured.value,
		path: configured.path,
		unresolvedReasonStyle: "detailed"
	});
	if (resolved.value !== void 0) return resolved.value;
	throw new Error(resolved.unresolvedRefReason ?? `${configured.path} SecretRef could not be resolved.`);
}
function readMatrixBaseConfigField(matrix, field, opts) {
	return clean(matrix[field], resolveMatrixBaseConfigFieldPath(field), {
		env: opts?.env,
		config: opts?.config,
		allowEnvSecretRefFallback: shouldAllowEnvSecretRefFallback(field),
		suppressSecretRef: opts?.suppressSecretRef
	});
}
function readMatrixAccountConfigField(cfg, accountId, account, field, opts) {
	return clean(account[field], resolveMatrixConfigFieldPath(cfg, accountId, field), {
		env: opts?.env,
		config: opts?.config,
		allowEnvSecretRefFallback: shouldAllowEnvSecretRefFallback(field),
		suppressSecretRef: opts?.suppressSecretRef
	});
}
function clampMatrixInitialSyncLimit(value) {
	return resolveOptionalIntegerOption(value, { min: 0 });
}
function buildMatrixNetworkFields(params) {
	const dispatcherPolicy = params.dispatcherPolicy ?? (params.proxy ? {
		mode: "explicit-proxy",
		proxyUrl: params.proxy
	} : void 0);
	if (!params.allowPrivateNetwork && !dispatcherPolicy) return {};
	return {
		...params.allowPrivateNetwork ? {
			allowPrivateNetwork: true,
			ssrfPolicy: ssrfPolicyFromDangerouslyAllowPrivateNetwork$1(true)
		} : {},
		...dispatcherPolicy ? { dispatcherPolicy } : {}
	};
}
function hasScopedMatrixEnvConfig(accountId, env) {
	const scoped = resolveScopedMatrixEnvConfig(accountId, env);
	return Boolean(scoped.homeserver || scoped.userId || scoped.accessToken || scoped.password || scoped.deviceId || scoped.deviceName);
}
function resolveMatrixConfigForAccount(cfg, accountId, env = process.env) {
	const matrix = resolveMatrixBaseConfig(cfg);
	const account = findMatrixAccountConfig(cfg, accountId) ?? {};
	const normalizedAccountId = normalizeAccountId$1(accountId);
	const suppressInactivePasswordSecretRef = hasConfiguredMatrixAccessTokenSource({
		cfg,
		env,
		accountId: normalizedAccountId
	});
	const fieldReadOptions = {
		env,
		config: cfg
	};
	const scopedEnv = resolveScopedMatrixEnvConfig(normalizedAccountId, env);
	const globalEnv = resolveGlobalMatrixEnvConfig(env);
	const accountField = (field) => readMatrixAccountConfigField(cfg, normalizedAccountId, account, field, {
		...fieldReadOptions,
		suppressSecretRef: field === "password" ? suppressInactivePasswordSecretRef : void 0
	});
	const resolvedStrings = resolveMatrixAccountStringValues({
		accountId: normalizedAccountId,
		account: {
			homeserver: accountField("homeserver"),
			userId: accountField("userId"),
			accessToken: accountField("accessToken"),
			password: accountField("password"),
			deviceId: accountField("deviceId"),
			deviceName: accountField("deviceName")
		},
		scopedEnv,
		channel: {
			homeserver: readMatrixBaseConfigField(matrix, "homeserver", fieldReadOptions),
			userId: readMatrixBaseConfigField(matrix, "userId", fieldReadOptions),
			accessToken: readMatrixBaseConfigField(matrix, "accessToken", fieldReadOptions),
			password: readMatrixBaseConfigField(matrix, "password", {
				...fieldReadOptions,
				suppressSecretRef: suppressInactivePasswordSecretRef
			}),
			deviceId: readMatrixBaseConfigField(matrix, "deviceId", fieldReadOptions),
			deviceName: readMatrixBaseConfigField(matrix, "deviceName", fieldReadOptions)
		},
		globalEnv
	});
	const initialSyncLimit = clampMatrixInitialSyncLimit(account.initialSyncLimit) ?? clampMatrixInitialSyncLimit(matrix.initialSyncLimit);
	const encryption = typeof account.encryption === "boolean" ? account.encryption : matrix.encryption ?? false;
	const allowPrivateNetwork = isPrivateNetworkOptInEnabled(account) || isPrivateNetworkOptInEnabled(matrix) ? true : void 0;
	return {
		homeserver: resolvedStrings.homeserver,
		userId: resolvedStrings.userId,
		accessToken: resolvedStrings.accessToken || void 0,
		password: resolvedStrings.password || void 0,
		deviceId: resolvedStrings.deviceId || void 0,
		deviceName: resolvedStrings.deviceName || void 0,
		initialSyncLimit,
		encryption,
		...buildMatrixNetworkFields({
			allowPrivateNetwork,
			proxy: account.proxy ?? matrix.proxy
		})
	};
}
function resolveImplicitMatrixAccountId(cfg, env = process.env) {
	if (requiresExplicitMatrixDefaultAccount(cfg, env)) return null;
	return normalizeAccountId$1(resolveMatrixDefaultOrOnlyAccountId(cfg, env));
}
function resolveMatrixAuthContext(params) {
	const cfg = requireRuntimeConfig(params.cfg, "Matrix auth context");
	const env = params?.env ?? process.env;
	const explicitAccountId = normalizeOptionalAccountId$1(params?.accountId);
	const effectiveAccountId = explicitAccountId ?? resolveImplicitMatrixAccountId(cfg, env);
	if (!effectiveAccountId) throw new Error("Multiple Matrix accounts are configured and channels.matrix.defaultAccount is not set. Set \"channels.matrix.defaultAccount\" to the intended account or pass --account <id>.");
	if (explicitAccountId && explicitAccountId !== DEFAULT_ACCOUNT_ID$1 && !listNormalizedMatrixAccountIds(cfg).includes(explicitAccountId) && !hasScopedMatrixEnvConfig(explicitAccountId, env)) throw new Error(`Matrix account "${explicitAccountId}" is not configured. Add channels.matrix.accounts.${explicitAccountId} or define scoped ${getMatrixScopedEnvVarNames(explicitAccountId).accessToken.replace(/_ACCESS_TOKEN$/, "")}_* variables.`);
	return {
		cfg,
		env,
		accountId: effectiveAccountId,
		resolved: resolveMatrixConfigForAccount(cfg, effectiveAccountId, env)
	};
}
async function resolveMatrixAuth(params) {
	if (!params?.cfg) throw new Error("Matrix auth requires a resolved runtime config. Load and resolve config at the command or gateway boundary, then pass cfg through the runtime path.");
	const { cfg, env, accountId, resolved } = resolveMatrixAuthContext({
		cfg: params.cfg,
		env: params.env,
		accountId: params.accountId
	});
	const accessToken = await resolveConfiguredMatrixAuthSecretInput({
		cfg,
		env,
		accountId,
		field: "accessToken"
	}) ?? resolved.accessToken;
	const tokenAuthPassword = resolved.password;
	const homeserver = await resolveValidatedMatrixHomeserverUrl(resolved.homeserver, { dangerouslyAllowPrivateNetwork: resolved.allowPrivateNetwork });
	const { loadMatrixCredentials, credentialsMatchConfig } = await loadMatrixCredentialsReadDeps();
	const cached = loadMatrixCredentials(env, accountId);
	const cachedCredentials = cached && credentialsMatchConfig(cached, {
		homeserver,
		userId: resolved.userId || "",
		accessToken
	}) ? cached : null;
	if (accessToken) {
		let userId = resolved.userId;
		const hasMatchingCachedToken = cachedCredentials?.accessToken === accessToken;
		let knownDeviceId = hasMatchingCachedToken ? cachedCredentials?.deviceId || resolved.deviceId : resolved.deviceId;
		if (!userId) {
			const whoami = await fetchMatrixWhoamiIdentity({
				homeserver,
				accessToken,
				userId,
				ssrfPolicy: resolved.ssrfPolicy,
				dispatcherPolicy: resolved.dispatcherPolicy
			});
			const fetchedUserId = whoami.user_id?.trim();
			if (!fetchedUserId) throw new Error("Matrix whoami did not return user_id");
			userId = fetchedUserId;
			knownDeviceId = knownDeviceId || whoami.device_id?.trim() || resolved.deviceId;
		}
		if (!cachedCredentials || !hasMatchingCachedToken || cachedCredentials.userId !== userId || (cachedCredentials.deviceId || void 0) !== knownDeviceId) {
			const { saveMatrixCredentials } = await loadMatrixCredentialsWriteRuntime();
			await saveMatrixCredentials({
				homeserver,
				userId,
				accessToken,
				deviceId: knownDeviceId
			}, env, accountId);
		} else if (hasMatchingCachedToken) {
			const { touchMatrixCredentials } = await loadMatrixCredentialsWriteRuntime();
			await touchMatrixCredentials(env, accountId);
		}
		return {
			accountId,
			homeserver,
			userId,
			accessToken,
			password: tokenAuthPassword,
			deviceId: knownDeviceId,
			deviceName: resolved.deviceName,
			initialSyncLimit: resolved.initialSyncLimit,
			encryption: resolved.encryption,
			...buildMatrixNetworkFields({
				allowPrivateNetwork: resolved.allowPrivateNetwork,
				dispatcherPolicy: resolved.dispatcherPolicy
			})
		};
	}
	if (cachedCredentials) {
		const { touchMatrixCredentials } = await loadMatrixCredentialsWriteRuntime();
		await touchMatrixCredentials(env, accountId);
		return {
			accountId,
			homeserver: cachedCredentials.homeserver,
			userId: cachedCredentials.userId,
			accessToken: cachedCredentials.accessToken,
			password: tokenAuthPassword,
			deviceId: cachedCredentials.deviceId || resolved.deviceId,
			deviceName: resolved.deviceName,
			initialSyncLimit: resolved.initialSyncLimit,
			encryption: resolved.encryption,
			...buildMatrixNetworkFields({
				allowPrivateNetwork: resolved.allowPrivateNetwork,
				dispatcherPolicy: resolved.dispatcherPolicy
			})
		};
	}
	if (!resolved.userId) throw new Error("Matrix userId is required when no access token is configured (matrix.userId)");
	const password = await resolveConfiguredMatrixAuthSecretInput({
		cfg,
		env,
		accountId,
		field: "password"
	}) ?? resolved.password;
	if (!password) throw new Error("Matrix password is required when no access token is configured (matrix.password)");
	const { MatrixClient, ensureMatrixSdkLoggingConfigured } = await loadMatrixAuthClientDeps();
	ensureMatrixSdkLoggingConfigured();
	const loginClient = new MatrixClient(homeserver, "", {
		ssrfPolicy: resolved.ssrfPolicy,
		dispatcherPolicy: resolved.dispatcherPolicy
	});
	const login = await retryMatrixAuthRequest("matrix auth login", async () => {
		return await loginClient.doRequest("POST", "/_matrix/client/v3/login", void 0, {
			type: "m.login.password",
			identifier: {
				type: "m.id.user",
				user: resolved.userId
			},
			password,
			device_id: resolved.deviceId,
			initial_device_display_name: resolved.deviceName ?? "OpenClaw Gateway"
		});
	});
	const loginAccessToken = login.access_token?.trim();
	if (!loginAccessToken) throw new Error("Matrix login did not return an access token");
	const auth = {
		accountId,
		homeserver,
		userId: login.user_id ?? resolved.userId,
		accessToken: loginAccessToken,
		password,
		deviceId: login.device_id ?? resolved.deviceId,
		deviceName: resolved.deviceName,
		initialSyncLimit: resolved.initialSyncLimit,
		encryption: resolved.encryption,
		...buildMatrixNetworkFields({
			allowPrivateNetwork: resolved.allowPrivateNetwork,
			dispatcherPolicy: resolved.dispatcherPolicy
		})
	};
	const { saveMatrixCredentials } = await loadMatrixCredentialsWriteRuntime();
	await saveMatrixCredentials({
		homeserver: auth.homeserver,
		userId: auth.userId,
		accessToken: auth.accessToken,
		deviceId: auth.deviceId
	}, env, accountId);
	return auth;
}
async function backfillMatrixAuthDeviceIdAfterStartup(params) {
	const knownDeviceId = params.auth.deviceId?.trim();
	if (knownDeviceId) return knownDeviceId;
	if (isAbortSignalTriggered(params.abortSignal)) return;
	const deviceId = (await fetchMatrixWhoamiIdentity({
		homeserver: params.auth.homeserver,
		accessToken: params.auth.accessToken,
		userId: params.auth.userId,
		ssrfPolicy: params.auth.ssrfPolicy,
		dispatcherPolicy: params.auth.dispatcherPolicy
	})).device_id?.trim();
	if (!deviceId) return;
	if (isAbortSignalTriggered(params.abortSignal)) return;
	const env = params.env ?? process.env;
	const { loadMatrixCredentials } = await loadMatrixCredentialsReadDeps();
	if (!credentialsMatchBackfillAuthLineage({
		stored: loadMatrixCredentials(env, params.auth.accountId),
		auth: params.auth
	})) return;
	if (!repairCurrentTokenStorageMetaDeviceId({
		homeserver: params.auth.homeserver,
		userId: params.auth.userId,
		accessToken: params.auth.accessToken,
		accountId: params.auth.accountId,
		deviceId,
		env: params.env
	})) throw new Error("Matrix deviceId backfill failed to repair current-token storage metadata");
	if (isAbortSignalTriggered(params.abortSignal)) return;
	return await (await loadMatrixCredentialsWriteRuntime()).saveBackfilledMatrixDeviceId({
		homeserver: params.auth.homeserver,
		userId: params.auth.userId,
		accessToken: params.auth.accessToken,
		deviceId
	}, env, params.auth.accountId) === "saved" ? deviceId : void 0;
}
//#endregion
//#region extensions/matrix/src/matrix/startup-abort.ts
function createMatrixStartupAbortError() {
	const error = /* @__PURE__ */ new Error("Matrix startup aborted");
	error.name = "AbortError";
	return error;
}
function throwIfMatrixStartupAborted(abortSignal) {
	if (abortSignal?.aborted === true) throw createMatrixStartupAbortError();
}
function isMatrixStartupAbortError(error) {
	return error instanceof Error && error.name === "AbortError";
}
async function awaitMatrixStartupWithAbort(promise, abortSignal) {
	if (!abortSignal) return await promise;
	if (abortSignal.aborted) throw createMatrixStartupAbortError();
	return await new Promise((resolve, reject) => {
		const onAbort = () => {
			abortSignal.removeEventListener("abort", onAbort);
			reject(createMatrixStartupAbortError());
		};
		abortSignal.addEventListener("abort", onAbort, { once: true });
		promise.then((value) => {
			abortSignal.removeEventListener("abort", onAbort);
			resolve(value);
		}, (error) => {
			abortSignal.removeEventListener("abort", onAbort);
			reject(toLintErrorObject(error, "Non-Error rejection"));
		});
	});
}
function toLintErrorObject(value, fallbackMessage) {
	if (value instanceof Error) return value;
	if (typeof value === "string") return new Error(value);
	const error = new Error(fallbackMessage, { cause: value });
	if (typeof value === "object" && value !== null || typeof value === "function") Object.assign(error, value);
	return error;
}
//#endregion
//#region extensions/matrix/src/matrix/client/shared.ts
var shared_exports = /* @__PURE__ */ __exportAll({
	acquireSharedMatrixClient: () => acquireSharedMatrixClient,
	releaseSharedClientInstance: () => releaseSharedClientInstance,
	removeSharedClientInstance: () => removeSharedClientInstance,
	resolveSharedMatrixClient: () => resolveSharedMatrixClient,
	stopSharedClient: () => stopSharedClient,
	stopSharedClientForAccount: () => stopSharedClientForAccount,
	stopSharedClientInstance: () => stopSharedClientInstance
});
let matrixCreateClientDepsPromise;
async function loadMatrixCreateClientDeps() {
	matrixCreateClientDepsPromise ??= import("./create-client-CA759SO2.js").then((n) => n.n).then((runtime) => ({ createMatrixClient: runtime.createMatrixClient }));
	return await matrixCreateClientDepsPromise;
}
const sharedClientStates = /* @__PURE__ */ new Map();
const sharedClientPromises = /* @__PURE__ */ new Map();
function serializeDispatcherPolicyKey(auth) {
	return JSON.stringify(auth.dispatcherPolicy ?? null);
}
function buildSharedClientKey(auth) {
	return [
		auth.homeserver,
		auth.userId,
		auth.accessToken,
		auth.encryption ? "e2ee" : "plain",
		auth.allowPrivateNetwork ? "private-net" : "strict-net",
		serializeDispatcherPolicyKey(auth),
		auth.accountId
	].join("|");
}
async function createSharedMatrixClient(params) {
	const { createMatrixClient } = await loadMatrixCreateClientDeps();
	return {
		client: await createMatrixClient({
			homeserver: params.auth.homeserver,
			userId: params.auth.userId,
			accessToken: params.auth.accessToken,
			password: params.auth.password,
			deviceId: params.auth.deviceId,
			encryption: params.auth.encryption,
			localTimeoutMs: params.timeoutMs,
			initialSyncLimit: params.auth.initialSyncLimit,
			accountId: params.auth.accountId,
			allowPrivateNetwork: params.auth.allowPrivateNetwork,
			ssrfPolicy: params.auth.ssrfPolicy,
			dispatcherPolicy: params.auth.dispatcherPolicy
		}),
		key: buildSharedClientKey(params.auth),
		started: false,
		cryptoReady: false,
		startPromise: null,
		leases: 0
	};
}
function findSharedClientStateByInstance(client) {
	for (const state of sharedClientStates.values()) if (state.client === client) return state;
	return null;
}
function deleteSharedClientState(state) {
	sharedClientStates.delete(state.key);
	sharedClientPromises.delete(state.key);
}
async function ensureSharedClientStarted(params) {
	const waitForStart = async (startPromise) => {
		await awaitMatrixStartupWithAbort(startPromise, params.abortSignal);
	};
	if (params.state.started) return;
	if (params.state.startPromise) {
		await waitForStart(params.state.startPromise);
		return;
	}
	const guardedStart = (async () => {
		const client = params.state.client;
		if (params.encryption && !params.state.cryptoReady) try {
			const joinedRooms = await client.getJoinedRooms();
			if (client.crypto) {
				await client.crypto.prepare(joinedRooms);
				params.state.cryptoReady = true;
			}
		} catch (err) {
			LogService.warn("MatrixClientLite", "Failed to prepare crypto:", err);
		}
		await client.start({ abortSignal: params.abortSignal });
		params.state.started = true;
	})().finally(() => {
		if (params.state.startPromise === guardedStart) params.state.startPromise = null;
	});
	params.state.startPromise = guardedStart;
	await waitForStart(guardedStart);
}
async function resolveSharedMatrixClientState(params = {}) {
	const requestedAccountId = normalizeOptionalAccountId(params.accountId);
	if (params.auth && requestedAccountId && requestedAccountId !== params.auth.accountId) throw new Error(`Matrix shared client account mismatch: requested ${requestedAccountId}, auth resolved ${params.auth.accountId}`);
	const authContext = (() => {
		if (params.auth) return null;
		if (!params.cfg) throw new Error("Matrix shared client requires a resolved runtime config. Load and resolve config at the command or gateway boundary, then pass cfg through the runtime path.");
		return resolveMatrixAuthContext({
			cfg: params.cfg,
			env: params.env,
			accountId: params.accountId
		});
	})();
	const auth = params.auth ?? await resolveMatrixAuth({
		cfg: authContext?.cfg ?? params.cfg,
		env: authContext?.env ?? params.env,
		accountId: authContext?.accountId
	});
	const key = buildSharedClientKey(auth);
	const shouldStart = params.startClient !== false;
	const existingState = sharedClientStates.get(key);
	if (existingState) {
		if (shouldStart) await ensureSharedClientStarted({
			state: existingState,
			encryption: auth.encryption,
			abortSignal: params.abortSignal
		});
		return existingState;
	}
	const existingPromise = sharedClientPromises.get(key);
	if (existingPromise) {
		const pending = await existingPromise;
		if (shouldStart) await ensureSharedClientStarted({
			state: pending,
			encryption: auth.encryption,
			abortSignal: params.abortSignal
		});
		return pending;
	}
	const creationPromise = createSharedMatrixClient({
		auth,
		timeoutMs: params.timeoutMs
	});
	sharedClientPromises.set(key, creationPromise);
	try {
		const created = await creationPromise;
		sharedClientStates.set(key, created);
		if (shouldStart) await ensureSharedClientStarted({
			state: created,
			encryption: auth.encryption,
			abortSignal: params.abortSignal
		});
		return created;
	} finally {
		sharedClientPromises.delete(key);
	}
}
async function resolveSharedMatrixClient(params = {}) {
	return (await resolveSharedMatrixClientState(params)).client;
}
async function acquireSharedMatrixClient(params = {}) {
	const state = await resolveSharedMatrixClientState(params);
	state.leases += 1;
	return state.client;
}
function stopSharedClient() {
	for (const state of sharedClientStates.values()) state.client.stop();
	sharedClientStates.clear();
	sharedClientPromises.clear();
}
function stopSharedClientForAccount(auth) {
	const key = buildSharedClientKey(auth);
	const state = sharedClientStates.get(key);
	if (!state) return;
	state.client.stop();
	deleteSharedClientState(state);
}
function removeSharedClientInstance(client) {
	const state = findSharedClientStateByInstance(client);
	if (!state) return false;
	deleteSharedClientState(state);
	return true;
}
function stopSharedClientInstance(client) {
	if (!removeSharedClientInstance(client)) return;
	client.stop();
}
async function releaseSharedClientInstance(client, mode = "stop") {
	const state = findSharedClientStateByInstance(client);
	if (!state) return false;
	state.leases = Math.max(0, state.leases - 1);
	if (state.leases > 0) return false;
	deleteSharedClientState(state);
	if (mode === "persist") await client.stopAndPersist();
	else if (mode === "discard") client.stopWithoutPersist();
	else client.stop();
	return true;
}
//#endregion
export { shared_exports as a, createMatrixStartupAbortError as c, backfillMatrixAuthDeviceIdAfterStartup as d, resolveMatrixAuth as f, resolveSharedMatrixClient as i, isMatrixStartupAbortError as l, resolveMatrixConfigForAccount as m, releaseSharedClientInstance as n, stopSharedClientForAccount as o, resolveMatrixAuthContext as p, removeSharedClientInstance as r, stopSharedClientInstance as s, acquireSharedMatrixClient as t, throwIfMatrixStartupAborted as u };
