import { a as resolveMatrixDefaultOrOnlyAccountId, n as requiresExplicitMatrixDefaultAccount, o as isRecord } from "./account-selection-Bv_ZuOu4.js";
import { t as getMatrixRuntime } from "./runtime-6S3DNFNv.js";
import { n as resolveMatrixAccountStorageRoot, s as resolveMatrixLegacyFlatStoragePaths } from "./storage-paths-BWo_ZEMC.js";
import { O as resolveMatrixSqliteStateEnv, b as scoreMatrixCryptoStateInStore, g as readMatrixIdbSnapshotJson, l as migrateLegacyMatrixRecoveryKeyFileToStore, n as MATRIX_LEGACY_CRYPTO_MIGRATION_FILENAME, r as MATRIX_RECOVERY_KEY_FILENAME, s as migrateLegacyMatrixLegacyCryptoMigrationFileToStore, t as MATRIX_IDB_SNAPSHOT_FILENAME, x as writeMatrixIdbSnapshotJson } from "./crypto-state-store-DK2tcEyP.js";
import { normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadJsonFile } from "openclaw/plugin-sdk/json-store";
//#region extensions/matrix/src/matrix/client/storage.ts
const DEFAULT_ACCOUNT_KEY = "default";
const STORAGE_META_FILENAME = "storage-meta.json";
const THREAD_BINDINGS_FILENAME = "thread-bindings.json";
const STORAGE_META_NAMESPACE = "storage-meta";
const STORAGE_META_STATE_KEY = "current";
const STORAGE_META_MAX_ENTRIES = 10;
function openMatrixStorageMetaStoreOptions(storageRootDir) {
	return {
		namespace: STORAGE_META_NAMESPACE,
		maxEntries: STORAGE_META_MAX_ENTRIES,
		env: resolveMatrixSqliteStateEnv({ stateDir: storageRootDir })
	};
}
function openStorageMetaStore(rootDir) {
	return getMatrixRuntime().state.openSyncKeyedStore(openMatrixStorageMetaStoreOptions(rootDir));
}
function resolveLegacyStoragePaths(env = process.env) {
	return resolveMatrixLegacyFlatStoragePaths(getMatrixRuntime().state.resolveStateDir(env, os.homedir));
}
function assertLegacyMigrationAccountSelection(params) {
	const cfg = getMatrixRuntime().config.current();
	if (!cfg.channels?.matrix || typeof cfg.channels.matrix !== "object") return;
	if (requiresExplicitMatrixDefaultAccount(cfg)) throw new Error("Legacy Matrix client storage cannot be migrated automatically because multiple Matrix accounts are configured and channels.matrix.defaultAccount is not set.");
	const selectedAccountId = normalizeAccountId(resolveMatrixDefaultOrOnlyAccountId(cfg));
	const currentAccountId = normalizeAccountId(params.accountKey);
	if (selectedAccountId !== currentAccountId) throw new Error(`Legacy Matrix client storage targets account "${selectedAccountId}", but the current client is starting account "${currentAccountId}". Start the selected account first so flat legacy storage is not migrated into the wrong account directory.`);
}
function scoreStorageRoot(rootDir) {
	let score = 0;
	const metadata = readStoredRootMetadata(rootDir);
	if (Object.keys(metadata).length > 0) score += 1;
	if (metadata.currentTokenStateClaimed === true) score += 8;
	if (fs.existsSync(path.join(rootDir, "crypto"))) score += 8;
	if (fs.existsSync(path.join(rootDir, THREAD_BINDINGS_FILENAME))) score += 4;
	if (fs.existsSync(path.join(rootDir, "legacy-crypto-migration.json"))) score += 3;
	if (fs.existsSync(path.join(rootDir, "recovery-key.json"))) score += 2;
	if (fs.existsSync(path.join(rootDir, "crypto-idb-snapshot.json"))) score += 2;
	score += scoreMatrixCryptoStateInStore(rootDir);
	return score;
}
function resolveStorageRootMtimeMs(rootDir) {
	try {
		return fs.statSync(rootDir).mtimeMs;
	} catch {
		return 0;
	}
}
function normalizeMatrixStorageMetadata(value) {
	if (!isRecord(value)) return null;
	const metadata = {};
	if (typeof value.homeserver === "string" && value.homeserver.trim()) metadata.homeserver = value.homeserver.trim();
	if (typeof value.userId === "string" && value.userId.trim()) metadata.userId = value.userId.trim();
	if (typeof value.accountId === "string" && value.accountId.trim()) metadata.accountId = value.accountId.trim();
	if (typeof value.accessTokenHash === "string" && value.accessTokenHash.trim()) metadata.accessTokenHash = value.accessTokenHash.trim();
	if (typeof value.deviceId === "string" && value.deviceId.trim()) metadata.deviceId = value.deviceId.trim();
	if (value.currentTokenStateClaimed === true) metadata.currentTokenStateClaimed = true;
	if (typeof value.createdAt === "string" && value.createdAt.trim()) metadata.createdAt = value.createdAt.trim();
	return Object.keys(metadata).length > 0 ? metadata : null;
}
async function hasMatrixStorageMetaStateInStore(params) {
	return normalizeMatrixStorageMetadata(await params.store.lookup(STORAGE_META_STATE_KEY)) !== null;
}
async function writeMatrixStorageMetaStateToStore(params) {
	await params.store.register(STORAGE_META_STATE_KEY, params.payload);
}
function readStoredRootMetadata(rootDir) {
	if (fs.existsSync(path.join(rootDir, "state", "openclaw.sqlite"))) try {
		const stored = normalizeMatrixStorageMetadata(openStorageMetaStore(rootDir).lookup(STORAGE_META_STATE_KEY));
		if (stored) return stored;
	} catch {}
	return normalizeMatrixStorageMetadata(loadJsonFile(path.join(rootDir, STORAGE_META_FILENAME))) ?? {};
}
function isCompatibleStorageRoot(params) {
	const metadata = readStoredRootMetadata(params.candidateRootDir);
	if (metadata.homeserver && metadata.homeserver !== params.homeserver) return false;
	if (metadata.userId && metadata.userId !== params.userId) return false;
	if (metadata.accountId && normalizeAccountId(metadata.accountId) !== normalizeAccountId(params.accountKey)) return false;
	if (params.deviceId && metadata.deviceId && metadata.deviceId.trim() && metadata.deviceId.trim() !== params.deviceId.trim()) return false;
	if (params.requireExplicitDeviceMatch && params.deviceId && (!metadata.deviceId || metadata.deviceId.trim() !== params.deviceId.trim())) return false;
	return true;
}
function resolvePreferredMatrixStorageRoot(params) {
	const parentDir = path.dirname(params.canonicalRootDir);
	const bestCurrentScore = scoreStorageRoot(params.canonicalRootDir);
	let best = {
		rootDir: params.canonicalRootDir,
		tokenHash: params.canonicalTokenHash,
		score: bestCurrentScore,
		mtimeMs: resolveStorageRootMtimeMs(params.canonicalRootDir)
	};
	if (!params.deviceId?.trim()) return {
		rootDir: best.rootDir,
		tokenHash: best.tokenHash
	};
	const canonicalMetadata = readStoredRootMetadata(params.canonicalRootDir);
	if (canonicalMetadata.accessTokenHash === params.canonicalTokenHash && canonicalMetadata.deviceId?.trim() === params.deviceId.trim() && canonicalMetadata.currentTokenStateClaimed === true) return {
		rootDir: best.rootDir,
		tokenHash: best.tokenHash
	};
	let siblingEntries;
	try {
		siblingEntries = fs.readdirSync(parentDir, { withFileTypes: true });
	} catch {
		return {
			rootDir: best.rootDir,
			tokenHash: best.tokenHash
		};
	}
	for (const entry of siblingEntries) {
		if (!entry.isDirectory()) continue;
		if (entry.name === params.canonicalTokenHash) continue;
		const candidateRootDir = path.join(parentDir, entry.name);
		if (!isCompatibleStorageRoot({
			candidateRootDir,
			homeserver: params.homeserver,
			userId: params.userId,
			accountKey: params.accountKey,
			deviceId: params.deviceId,
			requireExplicitDeviceMatch: Boolean(params.deviceId)
		})) continue;
		const candidateScore = scoreStorageRoot(candidateRootDir);
		if (candidateScore <= 0) continue;
		const candidateMtimeMs = resolveStorageRootMtimeMs(candidateRootDir);
		if (candidateScore > best.score || best.rootDir !== params.canonicalRootDir && candidateScore === best.score && candidateMtimeMs > best.mtimeMs) best = {
			rootDir: candidateRootDir,
			tokenHash: entry.name,
			score: candidateScore,
			mtimeMs: candidateMtimeMs
		};
	}
	return {
		rootDir: best.rootDir,
		tokenHash: best.tokenHash
	};
}
function resolveMatrixStoragePaths(params) {
	const env = params.env ?? process.env;
	const canonical = resolveMatrixAccountStorageRoot({
		stateDir: params.stateDir ?? getMatrixRuntime().state.resolveStateDir(env, os.homedir),
		homeserver: params.homeserver,
		userId: params.userId,
		accessToken: params.accessToken,
		accountId: params.accountId
	});
	const { rootDir, tokenHash } = resolvePreferredMatrixStorageRoot({
		canonicalRootDir: canonical.rootDir,
		canonicalTokenHash: canonical.tokenHash,
		homeserver: params.homeserver,
		userId: params.userId,
		accountKey: canonical.accountKey,
		deviceId: params.deviceId
	});
	return {
		rootDir,
		storagePath: path.join(rootDir, "bot-storage.json"),
		cryptoPath: path.join(rootDir, "crypto"),
		recoveryKeyPath: path.join(rootDir, MATRIX_RECOVERY_KEY_FILENAME),
		idbSnapshotPath: path.join(rootDir, MATRIX_IDB_SNAPSHOT_FILENAME),
		accountKey: canonical.accountKey,
		tokenHash
	};
}
function resolveMatrixStateFilePath(params) {
	const storagePaths = resolveMatrixStoragePaths({
		homeserver: params.auth.homeserver,
		userId: params.auth.userId,
		accessToken: params.auth.accessToken,
		accountId: params.accountId ?? params.auth.accountId,
		deviceId: params.auth.deviceId,
		env: params.env,
		stateDir: params.stateDir
	});
	return path.join(storagePaths.rootDir, params.filename);
}
async function maybeMigrateLegacyStorage(params) {
	const legacy = resolveLegacyStoragePaths(params.env);
	const hasFlatLegacyStorageFile = fs.existsSync(legacy.storagePath);
	const hasAccountScopedLegacyStorageFile = fs.existsSync(params.storagePaths.storagePath);
	const syncCache = hasFlatLegacyStorageFile || hasAccountScopedLegacyStorageFile ? await import("./file-sync-store-ByKRkbHY.js").then((n) => n.n) : null;
	const hasFlatLegacyStorage = hasFlatLegacyStorageFile && await syncCache?.readLegacyMatrixSyncCacheState(legacy.rootDir) !== null;
	const hasAccountScopedLegacyStorage = hasAccountScopedLegacyStorageFile && await syncCache?.readLegacyMatrixSyncCacheState(params.storagePaths.rootDir) !== null;
	const hasLegacyCrypto = fs.existsSync(legacy.cryptoPath);
	const hasAccountScopedRecoveryKey = fs.existsSync(params.storagePaths.recoveryKeyPath);
	const hasAccountScopedIdbSnapshot = fs.existsSync(params.storagePaths.idbSnapshotPath);
	const hasAccountScopedLegacyCryptoMigration = fs.existsSync(path.join(params.storagePaths.rootDir, MATRIX_LEGACY_CRYPTO_MIGRATION_FILENAME));
	if (!hasFlatLegacyStorage && !hasAccountScopedLegacyStorage && !hasLegacyCrypto && !hasAccountScopedRecoveryKey && !hasAccountScopedIdbSnapshot && !hasAccountScopedLegacyCryptoMigration) return;
	const hasTargetCrypto = fs.existsSync(params.storagePaths.cryptoPath);
	const shouldMigrateCrypto = hasLegacyCrypto && !hasTargetCrypto;
	if (!hasFlatLegacyStorage && !hasAccountScopedLegacyStorage && !shouldMigrateCrypto && !hasAccountScopedRecoveryKey && !hasAccountScopedIdbSnapshot && !hasAccountScopedLegacyCryptoMigration) return;
	if (hasFlatLegacyStorage || hasLegacyCrypto) assertLegacyMigrationAccountSelection({ accountKey: params.storagePaths.accountKey });
	const logger = getMatrixRuntime().logging.getChildLogger({ module: "matrix-storage" });
	const { maybeCreateMatrixMigrationSnapshot } = await import("./migration-snapshot.runtime-VGD4QfeS.js");
	await maybeCreateMatrixMigrationSnapshot({
		trigger: "matrix-client-fallback",
		env: params.env,
		log: logger
	});
	fs.mkdirSync(params.storagePaths.rootDir, { recursive: true });
	const moved = [];
	const pendingArchives = [];
	const skippedExistingTargets = [];
	try {
		if (hasAccountScopedLegacyStorage) await migrateLegacySyncCacheToSqlite({
			sourceRootDir: params.storagePaths.rootDir,
			sourcePath: params.storagePaths.storagePath,
			targetRootDir: params.storagePaths.rootDir,
			label: "account sync cache",
			moved,
			pendingArchives
		});
		if (hasFlatLegacyStorage) await migrateLegacySyncCacheToSqlite({
			sourceRootDir: legacy.rootDir,
			sourcePath: legacy.storagePath,
			targetRootDir: params.storagePaths.rootDir,
			label: "flat sync cache",
			moved,
			pendingArchives
		});
		if (shouldMigrateCrypto) moveLegacyStoragePathOrThrow({
			sourcePath: legacy.cryptoPath,
			targetPath: params.storagePaths.cryptoPath,
			label: "crypto store",
			moved
		});
		else if (hasLegacyCrypto) skippedExistingTargets.push(`- crypto store remains at ${legacy.cryptoPath} because ${params.storagePaths.cryptoPath} already exists`);
		if (hasAccountScopedRecoveryKey) {
			migrateLegacyMatrixRecoveryKeyFileToStore(params.storagePaths.rootDir);
			moved.push({
				sourcePath: params.storagePaths.recoveryKeyPath,
				targetPath: `${params.storagePaths.rootDir} SQLite recovery key state`,
				label: "recovery key"
			});
		}
		if (hasAccountScopedLegacyCryptoMigration) {
			migrateLegacyMatrixLegacyCryptoMigrationFileToStore(params.storagePaths.rootDir);
			moved.push({
				sourcePath: path.join(params.storagePaths.rootDir, MATRIX_LEGACY_CRYPTO_MIGRATION_FILENAME),
				targetPath: `${params.storagePaths.rootDir} SQLite legacy crypto migration state`,
				label: "legacy crypto migration"
			});
		}
		if (hasAccountScopedIdbSnapshot) await migrateLegacyIdbSnapshotToSqlite({
			storageRootDir: params.storagePaths.rootDir,
			snapshotPath: params.storagePaths.idbSnapshotPath,
			moved,
			pendingArchives
		});
	} catch (err) {
		const rollbackError = rollbackLegacyMoves(moved);
		throw new Error(rollbackError ? `Failed migrating legacy Matrix client storage: ${String(err)}. Rollback also failed: ${rollbackError}` : `Failed migrating legacy Matrix client storage: ${String(err)}`, { cause: err });
	}
	for (const archive of pendingArchives) archiveLegacyStoragePath({
		...archive,
		skippedExistingTargets
	});
	if (moved.length > 0) logger.info(`matrix: migrated legacy client storage into ${params.storagePaths.rootDir}\n${moved.map((entry) => `- ${entry.label}: ${entry.sourcePath} -> ${entry.targetPath}`).join("\n")}`);
	if (skippedExistingTargets.length > 0) logger.warn?.(`matrix: legacy client storage still exists in the flat path because some account-scoped targets already existed.\n${skippedExistingTargets.join("\n")}`);
}
async function migrateLegacyIdbSnapshotToSqlite(params) {
	if (readMatrixIdbSnapshotJson(params.storageRootDir)) {
		params.pendingArchives.push({
			sourcePath: params.snapshotPath,
			label: "IndexedDB snapshot"
		});
		return;
	}
	const { readLegacyMatrixIdbSnapshotState } = await import("./idb-persistence-BGY1CJ7J.js").then((n) => n.t);
	const snapshot = await readLegacyMatrixIdbSnapshotState(params.storageRootDir);
	if (!snapshot) return;
	writeMatrixIdbSnapshotJson({
		storageRootDir: params.storageRootDir,
		snapshotJson: JSON.stringify(snapshot),
		databaseCount: snapshot.length
	});
	params.moved.push({
		sourcePath: params.snapshotPath,
		targetPath: `${params.storageRootDir} SQLite IndexedDB snapshot state`,
		label: "IndexedDB snapshot"
	});
	params.pendingArchives.push({
		sourcePath: params.snapshotPath,
		label: "IndexedDB snapshot"
	});
}
async function migrateLegacySyncCacheToSqlite(params) {
	const syncCache = await import("./file-sync-store-ByKRkbHY.js").then((n) => n.n);
	const persisted = await syncCache.readLegacyMatrixSyncCacheState(params.sourceRootDir);
	if (!persisted) return;
	const store = getMatrixRuntime().state.openKeyedStore(syncCache.openMatrixSyncCacheStoreOptions(params.targetRootDir));
	if (!await syncCache.hasMatrixSyncCacheStateInStore({
		storageRootDir: params.targetRootDir,
		store
	})) {
		await syncCache.writeMatrixSyncCacheStateToStore({
			storageRootDir: params.targetRootDir,
			payload: persisted,
			store
		});
		claimCurrentTokenStorageState({ rootDir: params.targetRootDir });
		params.moved.push({
			sourcePath: params.sourcePath,
			targetPath: `${params.targetRootDir} SQLite sync cache`,
			label: params.label
		});
	}
	params.pendingArchives.push({
		sourcePath: params.sourcePath,
		label: params.label
	});
}
function archiveLegacyStoragePath(params) {
	const archivedLegacyStoragePath = `${params.sourcePath}.migrated`;
	if (fs.existsSync(archivedLegacyStoragePath)) {
		params.skippedExistingTargets.push(`- ${params.label} remains at ${params.sourcePath} because ${archivedLegacyStoragePath} already exists`);
		return;
	}
	fs.renameSync(params.sourcePath, archivedLegacyStoragePath);
}
function moveLegacyStoragePathOrThrow(params) {
	if (!fs.existsSync(params.sourcePath)) return;
	if (fs.existsSync(params.targetPath)) throw new Error(`legacy Matrix ${params.label} target already exists (${params.targetPath}); refusing to overwrite it automatically`);
	fs.renameSync(params.sourcePath, params.targetPath);
	params.moved.push({
		sourcePath: params.sourcePath,
		targetPath: params.targetPath,
		label: params.label
	});
}
function rollbackLegacyMoves(moved) {
	for (const entry of moved.toReversed()) try {
		if (!fs.existsSync(entry.targetPath) || fs.existsSync(entry.sourcePath)) continue;
		fs.renameSync(entry.targetPath, entry.sourcePath);
	} catch (err) {
		return `${entry.label} (${entry.targetPath} -> ${entry.sourcePath}): ${String(err)}`;
	}
	return null;
}
function writeStoredRootMetadata(rootDir, payload) {
	try {
		const normalized = normalizeMatrixStorageMetadata(payload);
		if (!normalized) return false;
		openStorageMetaStore(rootDir).register(STORAGE_META_STATE_KEY, normalized);
		return true;
	} catch {
		return false;
	}
}
function writeStorageMeta(params) {
	const existing = readStoredRootMetadata(params.storagePaths.rootDir);
	return writeStoredRootMetadata(params.storagePaths.rootDir, {
		homeserver: params.homeserver,
		userId: params.userId,
		accountId: params.accountId ?? DEFAULT_ACCOUNT_KEY,
		accessTokenHash: params.storagePaths.tokenHash,
		deviceId: params.deviceId ?? null,
		currentTokenStateClaimed: params.currentTokenStateClaimed ?? existing.currentTokenStateClaimed === true,
		createdAt: existing.createdAt ?? (/* @__PURE__ */ new Date()).toISOString()
	});
}
function claimCurrentTokenStorageState(params) {
	const metadata = readStoredRootMetadata(params.rootDir);
	if (!metadata.accessTokenHash?.trim()) return false;
	return writeStoredRootMetadata(params.rootDir, {
		homeserver: metadata.homeserver,
		userId: metadata.userId,
		accountId: metadata.accountId ?? DEFAULT_ACCOUNT_KEY,
		accessTokenHash: metadata.accessTokenHash,
		deviceId: metadata.deviceId ?? null,
		currentTokenStateClaimed: true,
		createdAt: metadata.createdAt ?? (/* @__PURE__ */ new Date()).toISOString()
	});
}
function recordCurrentStorageMetaDeviceId(params) {
	const deviceId = params.deviceId.trim();
	if (!deviceId) return false;
	const metadata = readStoredRootMetadata(params.rootDir);
	if (!metadata.accessTokenHash?.trim()) return false;
	return writeStoredRootMetadata(params.rootDir, {
		homeserver: metadata.homeserver,
		userId: metadata.userId,
		accountId: metadata.accountId ?? DEFAULT_ACCOUNT_KEY,
		accessTokenHash: metadata.accessTokenHash,
		deviceId,
		currentTokenStateClaimed: metadata.currentTokenStateClaimed === true,
		createdAt: metadata.createdAt ?? (/* @__PURE__ */ new Date()).toISOString()
	});
}
function repairCurrentTokenStorageMetaDeviceId(params) {
	return writeStorageMeta({
		storagePaths: resolveMatrixStoragePaths({
			homeserver: params.homeserver,
			userId: params.userId,
			accessToken: params.accessToken,
			accountId: params.accountId,
			env: params.env,
			stateDir: params.stateDir
		}),
		homeserver: params.homeserver,
		userId: params.userId,
		accountId: params.accountId,
		deviceId: params.deviceId
	});
}
//#endregion
export { openMatrixStorageMetaStoreOptions as a, resolveMatrixStateFilePath as c, writeStorageMeta as d, normalizeMatrixStorageMetadata as i, resolveMatrixStoragePaths as l, hasMatrixStorageMetaStateInStore as n, recordCurrentStorageMetaDeviceId as o, maybeMigrateLegacyStorage as r, repairCurrentTokenStorageMetaDeviceId as s, claimCurrentTokenStorageState as t, writeMatrixStorageMetaStateToStore as u };
