import { t as __exportAll } from "./rolldown-runtime-8H4AJuhK.js";
import { t as getMatrixScopedEnvVarNames } from "./env-vars-KzaYveuy.js";
import { i as resolveScopedMatrixEnvConfig, r as resolveMatrixEnvAuthReadiness, t as hasReadyMatrixEnvAuth } from "./env-auth-DIzOApj0.js";
import { n as validateMatrixHomeserverUrl, t as resolveValidatedMatrixHomeserverUrl } from "./url-validation-GRHde6lq.js";
import { t as isBunRuntime } from "./runtime-BefyhPWv.js";
import { d as backfillMatrixAuthDeviceIdAfterStartup, f as resolveMatrixAuth, i as resolveSharedMatrixClient, m as resolveMatrixConfigForAccount, n as releaseSharedClientInstance, o as stopSharedClientForAccount, p as resolveMatrixAuthContext, r as removeSharedClientInstance, s as stopSharedClientInstance, t as acquireSharedMatrixClient } from "./shared-eJVQiO9S.js";
import { t as createMatrixClient } from "./create-client-CA759SO2.js";
//#region extensions/matrix/src/matrix/client.ts
var client_exports = /* @__PURE__ */ __exportAll({
	acquireSharedMatrixClient: () => acquireSharedMatrixClient,
	backfillMatrixAuthDeviceIdAfterStartup: () => backfillMatrixAuthDeviceIdAfterStartup,
	createMatrixClient: () => createMatrixClient,
	getMatrixScopedEnvVarNames: () => getMatrixScopedEnvVarNames,
	hasReadyMatrixEnvAuth: () => hasReadyMatrixEnvAuth,
	isBunRuntime: () => isBunRuntime,
	releaseSharedClientInstance: () => releaseSharedClientInstance,
	removeSharedClientInstance: () => removeSharedClientInstance,
	resolveMatrixAuth: () => resolveMatrixAuth,
	resolveMatrixAuthContext: () => resolveMatrixAuthContext,
	resolveMatrixConfigForAccount: () => resolveMatrixConfigForAccount,
	resolveMatrixEnvAuthReadiness: () => resolveMatrixEnvAuthReadiness,
	resolveScopedMatrixEnvConfig: () => resolveScopedMatrixEnvConfig,
	resolveSharedMatrixClient: () => resolveSharedMatrixClient,
	resolveValidatedMatrixHomeserverUrl: () => resolveValidatedMatrixHomeserverUrl,
	stopSharedClientForAccount: () => stopSharedClientForAccount,
	stopSharedClientInstance: () => stopSharedClientInstance,
	validateMatrixHomeserverUrl: () => validateMatrixHomeserverUrl
});
//#endregion
export { client_exports as t };
