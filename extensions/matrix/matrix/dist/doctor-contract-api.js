import { n as normalizeCompatibilityConfig, t as legacyConfigRules } from "./doctor-contract-Dq8OZWHF.js";
import { D as writeMatrixRecoveryKeyStateToStore, S as writeMatrixIdbSnapshotJsonToStore, a as hasMatrixLegacyCryptoMigrationStateInStore, d as openMatrixLegacyCryptoMigrationStoreOptions, f as openMatrixRecoveryKeyStoreOptions, h as readLegacyMatrixRecoveryKeyState, i as hasMatrixIdbSnapshotStateInStore, n as MATRIX_LEGACY_CRYPTO_MIGRATION_FILENAME, o as hasMatrixRecoveryKeyStateInStore, p as readLegacyMatrixLegacyCryptoMigrationState, r as MATRIX_RECOVERY_KEY_FILENAME, t as MATRIX_IDB_SNAPSHOT_FILENAME, u as openMatrixIdbSnapshotStoreOptions, w as writeMatrixLegacyCryptoMigrationStateToStore } from "./crypto-state-store-DK2tcEyP.js";
import { a as openMatrixStorageMetaStoreOptions, i as normalizeMatrixStorageMetadata, n as hasMatrixStorageMetaStateInStore, u as writeMatrixStorageMetaStateToStore } from "./storage-D3JJ0OzE.js";
import { a as readLegacyMatrixSyncCacheState, i as openMatrixSyncCacheStoreOptions, o as writeMatrixSyncCacheStateToStore, r as hasMatrixSyncCacheStateInStore } from "./file-sync-store-ByKRkbHY.js";
import { r as readLegacyMatrixIdbSnapshotState } from "./idb-persistence-BGY1CJ7J.js";
import path from "node:path";
import fs from "node:fs/promises";
//#region extensions/matrix/doctor-contract-api.ts
const MATRIX_SYNC_CACHE_FILENAME = "bot-storage.json";
const MATRIX_STORAGE_META_FILENAME = "storage-meta.json";
async function fileExists(filePath) {
	try {
		return (await fs.stat(filePath)).isFile();
	} catch {
		return false;
	}
}
async function collectLegacyMatrixStateRoots(stateDir, filename) {
	const matrixRoot = path.join(stateDir, "matrix");
	const roots = [];
	async function visit(dir) {
		let entries;
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const entryPath = path.join(dir, entry.name);
			if (entry.isFile() && entry.name === filename) {
				roots.push(dir);
				continue;
			}
			if (entry.isDirectory()) await visit(entryPath);
		}
	}
	await visit(matrixRoot);
	return roots.filter((root) => path.resolve(root) !== path.resolve(matrixRoot)).toSorted();
}
async function collectLegacySyncCacheRoots(stateDir) {
	return collectLegacyMatrixStateRoots(stateDir, MATRIX_SYNC_CACHE_FILENAME);
}
async function readLegacyMatrixStorageMetadata(storageRootDir) {
	try {
		return normalizeMatrixStorageMetadata(JSON.parse(await fs.readFile(path.join(storageRootDir, MATRIX_STORAGE_META_FILENAME), "utf8")));
	} catch {
		return null;
	}
}
async function archiveLegacySyncCache(params) {
	const sourcePath = path.join(params.storageRootDir, MATRIX_SYNC_CACHE_FILENAME);
	const archivedPath = `${sourcePath}.migrated`;
	if (await fileExists(archivedPath)) {
		params.warnings.push(`Left migrated Matrix sync cache in place because ${archivedPath} already exists`);
		return;
	}
	try {
		await fs.rename(sourcePath, archivedPath);
		params.changes.push(`Archived Matrix sync cache legacy source -> ${archivedPath}`);
	} catch (err) {
		params.warnings.push(`Failed archiving Matrix sync cache legacy source: ${String(err)}`);
	}
}
async function archiveLegacyMatrixStateFile(params) {
	const sourcePath = path.join(params.storageRootDir, params.filename);
	const archivedPath = `${sourcePath}.migrated`;
	if (await fileExists(archivedPath)) {
		params.warnings.push(`Left migrated ${params.label} in place because ${archivedPath} already exists`);
		return;
	}
	try {
		await fs.rename(sourcePath, archivedPath);
		params.changes.push(`Archived ${params.label} legacy source -> ${archivedPath}`);
	} catch (err) {
		params.warnings.push(`Failed archiving ${params.label} legacy source: ${String(err)}`);
	}
}
const stateMigrations = [
	{
		id: "matrix-storage-meta-json-to-plugin-state",
		label: "Matrix storage metadata",
		async detectLegacyState(params) {
			const previews = [];
			for (const storageRootDir of await collectLegacyMatrixStateRoots(params.stateDir, MATRIX_STORAGE_META_FILENAME)) {
				if (!await readLegacyMatrixStorageMetadata(storageRootDir)) continue;
				previews.push(`Matrix storage metadata JSON can migrate to SQLite: ${storageRootDir}`);
			}
			return previews.length > 0 ? { preview: previews } : null;
		},
		async migrateLegacyState(params) {
			const changes = [];
			const warnings = [];
			for (const storageRootDir of await collectLegacyMatrixStateRoots(params.stateDir, MATRIX_STORAGE_META_FILENAME)) {
				const payload = await readLegacyMatrixStorageMetadata(storageRootDir);
				if (!payload) continue;
				const store = params.context.openPluginStateKeyedStore(openMatrixStorageMetaStoreOptions(storageRootDir));
				if (await hasMatrixStorageMetaStateInStore({ store })) {
					warnings.push(`Skipped Matrix storage metadata import for ${storageRootDir} because SQLite already has metadata`);
					await archiveLegacyMatrixStateFile({
						storageRootDir,
						filename: MATRIX_STORAGE_META_FILENAME,
						label: "Matrix storage metadata",
						changes,
						warnings
					});
					continue;
				}
				await writeMatrixStorageMetaStateToStore({
					payload,
					store
				});
				changes.push(`Migrated Matrix storage metadata JSON to SQLite for ${storageRootDir}`);
				await archiveLegacyMatrixStateFile({
					storageRootDir,
					filename: MATRIX_STORAGE_META_FILENAME,
					label: "Matrix storage metadata",
					changes,
					warnings
				});
			}
			return {
				changes,
				warnings
			};
		}
	},
	{
		id: "matrix-sync-cache-json-to-plugin-state",
		label: "Matrix sync cache",
		async detectLegacyState(params) {
			const previews = [];
			for (const storageRootDir of await collectLegacySyncCacheRoots(params.stateDir)) {
				if (!await readLegacyMatrixSyncCacheState(storageRootDir)) continue;
				previews.push(`Matrix sync cache JSON can migrate to SQLite: ${storageRootDir}`);
			}
			return previews.length > 0 ? { preview: previews } : null;
		},
		async migrateLegacyState(params) {
			const changes = [];
			const warnings = [];
			for (const storageRootDir of await collectLegacySyncCacheRoots(params.stateDir)) {
				const persisted = await readLegacyMatrixSyncCacheState(storageRootDir);
				if (!persisted) continue;
				const store = params.context.openPluginStateKeyedStore(openMatrixSyncCacheStoreOptions(storageRootDir));
				if (await hasMatrixSyncCacheStateInStore({
					storageRootDir,
					store
				})) {
					warnings.push(`Skipped Matrix sync cache import for ${storageRootDir} because SQLite already has sync cache state`);
					await archiveLegacySyncCache({
						storageRootDir,
						changes,
						warnings
					});
					continue;
				}
				await writeMatrixSyncCacheStateToStore({
					storageRootDir,
					payload: persisted,
					store
				});
				changes.push(`Migrated Matrix sync cache JSON to SQLite for ${storageRootDir}`);
				await archiveLegacySyncCache({
					storageRootDir,
					changes,
					warnings
				});
			}
			return {
				changes,
				warnings
			};
		}
	},
	{
		id: "matrix-recovery-key-json-to-plugin-state",
		label: "Matrix recovery key",
		async detectLegacyState(params) {
			const previews = [];
			for (const storageRootDir of await collectLegacyMatrixStateRoots(params.stateDir, MATRIX_RECOVERY_KEY_FILENAME)) {
				if (!readLegacyMatrixRecoveryKeyState(storageRootDir)) continue;
				previews.push(`Matrix recovery-key JSON can migrate to SQLite: ${storageRootDir}`);
			}
			return previews.length > 0 ? { preview: previews } : null;
		},
		async migrateLegacyState(params) {
			const changes = [];
			const warnings = [];
			for (const storageRootDir of await collectLegacyMatrixStateRoots(params.stateDir, MATRIX_RECOVERY_KEY_FILENAME)) {
				const payload = readLegacyMatrixRecoveryKeyState(storageRootDir);
				if (!payload) continue;
				const store = params.context.openPluginStateKeyedStore(openMatrixRecoveryKeyStoreOptions(storageRootDir));
				if (await hasMatrixRecoveryKeyStateInStore({ store })) {
					warnings.push(`Skipped Matrix recovery-key import for ${storageRootDir} because SQLite already has recovery-key state`);
					await archiveLegacyMatrixStateFile({
						storageRootDir,
						filename: MATRIX_RECOVERY_KEY_FILENAME,
						label: "Matrix recovery key",
						changes,
						warnings
					});
					continue;
				}
				await writeMatrixRecoveryKeyStateToStore({
					payload,
					store
				});
				changes.push(`Migrated Matrix recovery-key JSON to SQLite for ${storageRootDir}`);
				await archiveLegacyMatrixStateFile({
					storageRootDir,
					filename: MATRIX_RECOVERY_KEY_FILENAME,
					label: "Matrix recovery key",
					changes,
					warnings
				});
			}
			return {
				changes,
				warnings
			};
		}
	},
	{
		id: "matrix-idb-snapshot-json-to-plugin-state",
		label: "Matrix IndexedDB snapshot",
		async detectLegacyState(params) {
			const previews = [];
			for (const storageRootDir of await collectLegacyMatrixStateRoots(params.stateDir, MATRIX_IDB_SNAPSHOT_FILENAME)) {
				if (!await readLegacyMatrixIdbSnapshotState(storageRootDir)) continue;
				previews.push(`Matrix IndexedDB snapshot JSON can migrate to SQLite: ${storageRootDir}`);
			}
			return previews.length > 0 ? { preview: previews } : null;
		},
		async migrateLegacyState(params) {
			const changes = [];
			const warnings = [];
			for (const storageRootDir of await collectLegacyMatrixStateRoots(params.stateDir, MATRIX_IDB_SNAPSHOT_FILENAME)) {
				const snapshot = await readLegacyMatrixIdbSnapshotState(storageRootDir);
				if (!snapshot) continue;
				const store = params.context.openPluginStateKeyedStore(openMatrixIdbSnapshotStoreOptions(storageRootDir));
				if (await hasMatrixIdbSnapshotStateInStore({ store })) {
					warnings.push(`Skipped Matrix IndexedDB snapshot import for ${storageRootDir} because SQLite already has snapshot state`);
					await archiveLegacyMatrixStateFile({
						storageRootDir,
						filename: MATRIX_IDB_SNAPSHOT_FILENAME,
						label: "Matrix IndexedDB snapshot",
						changes,
						warnings
					});
					continue;
				}
				await writeMatrixIdbSnapshotJsonToStore({
					snapshotJson: JSON.stringify(snapshot),
					databaseCount: snapshot.length,
					store
				});
				changes.push(`Migrated Matrix IndexedDB snapshot JSON to SQLite for ${storageRootDir}`);
				await archiveLegacyMatrixStateFile({
					storageRootDir,
					filename: MATRIX_IDB_SNAPSHOT_FILENAME,
					label: "Matrix IndexedDB snapshot",
					changes,
					warnings
				});
			}
			return {
				changes,
				warnings
			};
		}
	},
	{
		id: "matrix-legacy-crypto-migration-json-to-plugin-state",
		label: "Matrix legacy crypto migration",
		async detectLegacyState(params) {
			const previews = [];
			for (const storageRootDir of await collectLegacyMatrixStateRoots(params.stateDir, MATRIX_LEGACY_CRYPTO_MIGRATION_FILENAME)) {
				if (!readLegacyMatrixLegacyCryptoMigrationState(storageRootDir)) continue;
				previews.push(`Matrix legacy crypto migration JSON can migrate to SQLite: ${storageRootDir}`);
			}
			return previews.length > 0 ? { preview: previews } : null;
		},
		async migrateLegacyState(params) {
			const changes = [];
			const warnings = [];
			for (const storageRootDir of await collectLegacyMatrixStateRoots(params.stateDir, MATRIX_LEGACY_CRYPTO_MIGRATION_FILENAME)) {
				const state = readLegacyMatrixLegacyCryptoMigrationState(storageRootDir);
				if (!state) continue;
				const store = params.context.openPluginStateKeyedStore(openMatrixLegacyCryptoMigrationStoreOptions(storageRootDir));
				if (await hasMatrixLegacyCryptoMigrationStateInStore({ store })) {
					warnings.push(`Skipped Matrix legacy crypto migration import for ${storageRootDir} because SQLite already has migration state`);
					await archiveLegacyMatrixStateFile({
						storageRootDir,
						filename: MATRIX_LEGACY_CRYPTO_MIGRATION_FILENAME,
						label: "Matrix legacy crypto migration",
						changes,
						warnings
					});
					continue;
				}
				await writeMatrixLegacyCryptoMigrationStateToStore({
					state,
					store
				});
				changes.push(`Migrated Matrix legacy crypto migration JSON to SQLite for ${storageRootDir}`);
				await archiveLegacyMatrixStateFile({
					storageRootDir,
					filename: MATRIX_LEGACY_CRYPTO_MIGRATION_FILENAME,
					label: "Matrix legacy crypto migration",
					changes,
					warnings
				});
			}
			return {
				changes,
				warnings
			};
		}
	}
];
//#endregion
export { legacyConfigRules, normalizeCompatibilityConfig, stateMigrations };
