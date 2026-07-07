import { t as __exportAll } from "./rolldown-runtime-8H4AJuhK.js";
import { g as readMatrixIdbSnapshotJson, t as MATRIX_IDB_SNAPSHOT_FILENAME, x as writeMatrixIdbSnapshotJson } from "./crypto-state-store-DK2tcEyP.js";
import { n as LogService } from "./logger-D0GCSDQq.js";
import { n as MATRIX_IDB_SNAPSHOT_LOCK_OPTIONS } from "./idb-persistence-lock-DAJ49nZX.js";
import fs from "node:fs";
import path from "node:path";
import { indexedDB } from "fake-indexeddb";
import { withFileLock } from "openclaw/plugin-sdk/file-lock";
//#region extensions/matrix/src/matrix/sdk/idb-persistence.ts
var idb_persistence_exports = /* @__PURE__ */ __exportAll({
	persistIdbToDisk: () => persistIdbToDisk,
	readLegacyMatrixIdbSnapshotState: () => readLegacyMatrixIdbSnapshotState,
	restoreIdbFromDisk: () => restoreIdbFromDisk
});
function isValidIdbIndexSnapshot(value) {
	if (!value || typeof value !== "object") return false;
	const candidate = value;
	return typeof candidate.name === "string" && (typeof candidate.keyPath === "string" || Array.isArray(candidate.keyPath) && candidate.keyPath.every((entry) => typeof entry === "string")) && typeof candidate.multiEntry === "boolean" && typeof candidate.unique === "boolean";
}
function isValidIdbRecordSnapshot(value) {
	if (!value || typeof value !== "object") return false;
	return "key" in value && "value" in value;
}
function isValidIdbStoreSnapshot(value) {
	if (!value || typeof value !== "object") return false;
	const candidate = value;
	const validKeyPath = candidate.keyPath === null || typeof candidate.keyPath === "string" || Array.isArray(candidate.keyPath) && candidate.keyPath.every((entry) => typeof entry === "string");
	return typeof candidate.name === "string" && validKeyPath && typeof candidate.autoIncrement === "boolean" && Array.isArray(candidate.indexes) && candidate.indexes.every((entry) => isValidIdbIndexSnapshot(entry)) && Array.isArray(candidate.records) && candidate.records.every((entry) => isValidIdbRecordSnapshot(entry));
}
function isValidIdbDatabaseSnapshot(value) {
	if (!value || typeof value !== "object") return false;
	const candidate = value;
	return typeof candidate.name === "string" && typeof candidate.version === "number" && Number.isFinite(candidate.version) && candidate.version > 0 && Array.isArray(candidate.stores) && candidate.stores.every((entry) => isValidIdbStoreSnapshot(entry));
}
function parseSnapshotPayload(data) {
	const parsed = JSON.parse(data);
	if (!Array.isArray(parsed) || parsed.length === 0) return null;
	if (!parsed.every((entry) => isValidIdbDatabaseSnapshot(entry))) throw new Error("Malformed IndexedDB snapshot payload");
	return parsed;
}
function idbReq(req) {
	return new Promise((resolve, reject) => {
		req.addEventListener("success", () => resolve(req.result), { once: true });
		req.addEventListener("error", () => reject(toLintErrorObject(req.error, "Non-Error rejection")), { once: true });
	});
}
async function dumpIndexedDatabases(databasePrefix) {
	const idb = indexedDB;
	const dbList = await idb.databases();
	const snapshot = [];
	const expectedPrefix = databasePrefix ? `${databasePrefix}::` : null;
	for (const { name, version } of dbList) {
		if (!name || !version) continue;
		if (expectedPrefix && !name.startsWith(expectedPrefix)) continue;
		const db = await new Promise((resolve, reject) => {
			const r = idb.open(name, version);
			r.addEventListener("success", () => resolve(r.result), { once: true });
			r.addEventListener("error", () => reject(toLintErrorObject(r.error, "Non-Error rejection")), { once: true });
		});
		const stores = [];
		for (const storeName of db.objectStoreNames) {
			const store = db.transaction(storeName, "readonly").objectStore(storeName);
			const storeInfo = {
				name: storeName,
				keyPath: store.keyPath,
				autoIncrement: store.autoIncrement,
				indexes: [],
				records: []
			};
			for (const idxName of store.indexNames) {
				const idx = store.index(idxName);
				storeInfo.indexes.push({
					name: idxName,
					keyPath: idx.keyPath,
					multiEntry: idx.multiEntry,
					unique: idx.unique
				});
			}
			const keys = await idbReq(store.getAllKeys());
			const values = await idbReq(store.getAll());
			storeInfo.records = keys.map((k, i) => ({
				key: k,
				value: values[i]
			}));
			stores.push(storeInfo);
		}
		snapshot.push({
			name,
			version,
			stores
		});
		db.close();
	}
	return snapshot;
}
async function restoreIndexedDatabases(snapshot) {
	const idb = indexedDB;
	for (const dbSnap of snapshot) await new Promise((resolve, reject) => {
		const r = idb.open(dbSnap.name, dbSnap.version);
		r.addEventListener("upgradeneeded", () => {
			const db = r.result;
			for (const storeSnap of dbSnap.stores) {
				const opts = {};
				if (storeSnap.keyPath !== null) opts.keyPath = storeSnap.keyPath;
				if (storeSnap.autoIncrement) opts.autoIncrement = true;
				const store = db.createObjectStore(storeSnap.name, opts);
				for (const idx of storeSnap.indexes) store.createIndex(idx.name, idx.keyPath, {
					unique: idx.unique,
					multiEntry: idx.multiEntry
				});
			}
		});
		r.addEventListener("success", () => {
			(async () => {
				const db = r.result;
				for (const storeSnap of dbSnap.stores) {
					if (storeSnap.records.length === 0) continue;
					const tx = db.transaction(storeSnap.name, "readwrite");
					const store = tx.objectStore(storeSnap.name);
					for (const rec of storeSnap.records) if (storeSnap.keyPath !== null) store.put(rec.value);
					else store.put(rec.value, rec.key);
					await new Promise((res) => {
						tx.addEventListener("complete", () => res(), { once: true });
					});
				}
				db.close();
				resolve();
			})().catch(reject);
		}, { once: true });
		r.addEventListener("error", () => reject(toLintErrorObject(r.error, "Non-Error rejection")), { once: true });
	});
}
function resolveDefaultIdbSnapshotPath() {
	const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || "/tmp", ".openclaw");
	return path.join(stateDir, "matrix", "crypto-idb-snapshot.json");
}
async function restoreIdbFromDisk(snapshotPath) {
	const candidatePaths = snapshotPath ? [snapshotPath] : [resolveDefaultIdbSnapshotPath()];
	for (const resolvedPath of candidatePaths) {
		const storageRootDir = path.dirname(resolvedPath);
		try {
			if (await withFileLock(resolvedPath, MATRIX_IDB_SNAPSHOT_LOCK_OPTIONS, async () => {
				try {
					const storedSnapshotJson = readMatrixIdbSnapshotJson(storageRootDir);
					if (storedSnapshotJson) {
						const snapshot = parseSnapshotPayload(storedSnapshotJson);
						if (snapshot) {
							await restoreIndexedDatabases(snapshot);
							LogService.info("IdbPersistence", `Restored ${snapshot.length} IndexedDB database(s) from Matrix SQLite state`);
							return true;
						}
					}
				} catch (err) {
					LogService.warn("IdbPersistence", "Failed to restore IndexedDB snapshot from SQLite:", err);
				}
				if (!fs.existsSync(resolvedPath)) return false;
				const data = fs.readFileSync(resolvedPath, "utf8");
				const snapshot = parseSnapshotPayload(data);
				if (!snapshot) return false;
				let migratedToSqlite = false;
				try {
					writeMatrixIdbSnapshotJson({
						storageRootDir,
						snapshotJson: data,
						databaseCount: snapshot.length
					});
					archiveLegacyIdbSnapshotFile(resolvedPath);
					migratedToSqlite = true;
				} catch (err) {
					LogService.warn("IdbPersistence", `Failed to migrate IndexedDB snapshot to SQLite from ${resolvedPath}:`, err);
				}
				await restoreIndexedDatabases(snapshot);
				LogService.info("IdbPersistence", migratedToSqlite ? `Migrated and restored ${snapshot.length} IndexedDB database(s) from ${resolvedPath}` : `Restored ${snapshot.length} IndexedDB database(s) from legacy snapshot ${resolvedPath}`);
				return true;
			})) return true;
		} catch (err) {
			LogService.warn("IdbPersistence", `Failed to restore IndexedDB snapshot from ${resolvedPath}:`, err);
			continue;
		}
	}
	return false;
}
async function persistIdbToDisk(params) {
	const snapshotPath = params?.snapshotPath ?? resolveDefaultIdbSnapshotPath();
	try {
		fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
		const persistedCount = await withFileLock(snapshotPath, MATRIX_IDB_SNAPSHOT_LOCK_OPTIONS, async () => {
			const snapshot = await dumpIndexedDatabases(params?.databasePrefix);
			if (snapshot.length === 0) return 0;
			writeMatrixIdbSnapshotJson({
				storageRootDir: path.dirname(snapshotPath),
				snapshotJson: JSON.stringify(snapshot),
				databaseCount: snapshot.length
			});
			archiveLegacyIdbSnapshotFile(snapshotPath);
			return snapshot.length;
		});
		if (persistedCount === 0) return;
		LogService.debug("IdbPersistence", `Persisted ${persistedCount} IndexedDB database(s) to Matrix SQLite state`);
	} catch (err) {
		LogService.warn("IdbPersistence", "Failed to persist IndexedDB snapshot:", err);
	}
}
async function readLegacyMatrixIdbSnapshotState(storageRootDir) {
	const snapshotPath = path.join(storageRootDir, MATRIX_IDB_SNAPSHOT_FILENAME);
	if (!fs.existsSync(snapshotPath)) return null;
	try {
		return await withFileLock(snapshotPath, MATRIX_IDB_SNAPSHOT_LOCK_OPTIONS, async () => {
			return parseSnapshotPayload(fs.readFileSync(snapshotPath, "utf8"));
		});
	} catch {
		return null;
	}
}
function archiveLegacyIdbSnapshotFile(snapshotPath) {
	if (!fs.existsSync(snapshotPath)) return;
	const archivedPath = `${snapshotPath}.migrated`;
	if (fs.existsSync(archivedPath)) return;
	fs.renameSync(snapshotPath, archivedPath);
}
function toLintErrorObject(value, fallbackMessage) {
	if (value instanceof Error) return value;
	if (typeof value === "string") return new Error(value);
	const error = new Error(fallbackMessage, { cause: value });
	if (typeof value === "object" && value !== null || typeof value === "function") Object.assign(error, value);
	return error;
}
//#endregion
export { restoreIdbFromDisk as i, persistIdbToDisk as n, readLegacyMatrixIdbSnapshotState as r, idb_persistence_exports as t };
