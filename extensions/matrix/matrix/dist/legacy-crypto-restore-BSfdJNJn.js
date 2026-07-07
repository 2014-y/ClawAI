import { t as getMatrixRuntime } from "./runtime-6S3DNFNv.js";
import { C as writeMatrixLegacyCryptoMigrationState, _ as readMatrixLegacyCryptoMigrationState, s as migrateLegacyMatrixLegacyCryptoMigrationFileToStore } from "./crypto-state-store-DK2tcEyP.js";
import { l as resolveMatrixStoragePaths } from "./storage-D3JJ0OzE.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
//#region extensions/matrix/src/matrix/monitor/legacy-crypto-restore.ts
async function resolvePendingMigrationStateRoot(params) {
	const { rootDir } = resolveMatrixStoragePaths({
		homeserver: params.auth.homeserver,
		userId: params.auth.userId,
		accessToken: params.auth.accessToken,
		accountId: params.auth.accountId,
		deviceId: params.auth.deviceId,
		stateDir: params.stateDir
	});
	try {
		migrateLegacyMatrixLegacyCryptoMigrationFileToStore(rootDir);
	} catch {}
	const directValue = readMatrixLegacyCryptoMigrationState(rootDir);
	if (directValue?.restoreStatus === "pending") return {
		storageRootDir: rootDir,
		value: directValue
	};
	const accountStorageDir = path.dirname(rootDir);
	let siblingEntries;
	try {
		siblingEntries = (await fs.readdir(accountStorageDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).filter((entry) => path.join(accountStorageDir, entry) !== rootDir).toSorted((left, right) => left.localeCompare(right));
	} catch {
		return {
			storageRootDir: rootDir,
			value: directValue
		};
	}
	for (const sibling of siblingEntries) {
		const siblingRootDir = path.join(accountStorageDir, sibling);
		try {
			migrateLegacyMatrixLegacyCryptoMigrationFileToStore(siblingRootDir);
		} catch {}
		const value = readMatrixLegacyCryptoMigrationState(siblingRootDir);
		if (value?.restoreStatus === "pending") return {
			storageRootDir: siblingRootDir,
			value
		};
	}
	return {
		storageRootDir: rootDir,
		value: directValue
	};
}
async function maybeRestoreLegacyMatrixBackup(params) {
	const env = params.env ?? process.env;
	const { storageRootDir, value } = await resolvePendingMigrationStateRoot({
		stateDir: params.stateDir ?? getMatrixRuntime().state.resolveStateDir(env, os.homedir),
		auth: params.auth
	});
	if (value?.restoreStatus !== "pending") return { kind: "skipped" };
	const restore = await params.client.restoreRoomKeyBackup();
	const localOnlyKeys = value.roomKeyCounts && value.roomKeyCounts.total > value.roomKeyCounts.backedUp ? value.roomKeyCounts.total - value.roomKeyCounts.backedUp : 0;
	if (restore.success) {
		writeMatrixLegacyCryptoMigrationState({
			storageRootDir,
			state: {
				...value,
				restoreStatus: "completed",
				restoredAt: restore.restoredAt ?? (/* @__PURE__ */ new Date()).toISOString(),
				importedCount: restore.imported,
				totalCount: restore.total,
				lastError: null
			}
		});
		return {
			kind: "restored",
			imported: restore.imported,
			total: restore.total,
			localOnlyKeys
		};
	}
	writeMatrixLegacyCryptoMigrationState({
		storageRootDir,
		state: {
			...value,
			lastError: restore.error ?? "unknown"
		}
	});
	return {
		kind: "failed",
		error: restore.error ?? "unknown",
		localOnlyKeys
	};
}
//#endregion
export { maybeRestoreLegacyMatrixBackup };
