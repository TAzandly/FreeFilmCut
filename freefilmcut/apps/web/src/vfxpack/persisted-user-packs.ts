/**
 * Persist user-imported .vfxpack files across refresh/restart.
 * Same sourceFileName or pack id → overwrite. Restored on editor startup.
 */
import { loadVfxPackFromFile } from "@/vfxpack/load-pack";
import { usePackRegistry } from "@/vfxpack/pack-registry";
import type { LoadedVfxPack } from "@/vfxpack/types";
import { OPFSAdapter } from "@/services/storage/opfs-adapter";

const OPFS_DIR = "user-vfxpacks";
const INDEX_KEY = "_index.json";
const IDB_NAME = "freefilmcut-user-vfxpacks";
const IDB_STORE = "packs";
const IDB_INDEX_KEY = "__index__";

export type PersistedUserPackMeta = {
	id: string;
	fileName: string;
	storageKey: string;
	displayName: string;
	type: string;
	updatedAt: number;
};

type PersistedIndex = {
	version: 1;
	packs: PersistedUserPackMeta[];
};

function emptyIndex(): PersistedIndex {
	return { version: 1, packs: [] };
}

function sanitizeStorageKey(fileName: string): string {
	const base = String(fileName || "pack.vfxpack").trim() || "pack.vfxpack";
	const safe = base.replace(/[^\w.\-()+@]+/g, "_");
	return safe.toLowerCase().endsWith(".vfxpack") ? safe : `${safe}.vfxpack`;
}

function useOpfs(): boolean {
	return typeof window !== "undefined" && OPFSAdapter.isSupported();
}

async function readIndexOpfs(adapter: OPFSAdapter): Promise<PersistedIndex> {
	const file = await adapter.get(INDEX_KEY);
	if (!file) return emptyIndex();
	try {
		const json = JSON.parse(await file.text()) as PersistedIndex;
		if (!json || !Array.isArray(json.packs)) return emptyIndex();
		return { version: 1, packs: json.packs };
	} catch {
		return emptyIndex();
	}
}

async function writeIndexOpfs(
	adapter: OPFSAdapter,
	index: PersistedIndex,
): Promise<void> {
	const blob = new Blob([JSON.stringify(index)], { type: "application/json" });
	const file = new File([blob], INDEX_KEY, { type: "application/json" });
	await adapter.set({ key: INDEX_KEY, value: file });
}

function openIdb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(IDB_NAME, 1);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(IDB_STORE)) {
				db.createObjectStore(IDB_STORE, { keyPath: "key" });
			}
		};
	});
}

async function idbGet<T>(key: string): Promise<T | null> {
	const db = await openIdb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(IDB_STORE, "readonly");
		const req = tx.objectStore(IDB_STORE).get(key);
		req.onerror = () => reject(req.error);
		req.onsuccess = () => resolve((req.result?.value as T) ?? null);
	});
}

async function idbSet(key: string, value: unknown): Promise<void> {
	const db = await openIdb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(IDB_STORE, "readwrite");
		const req = tx.objectStore(IDB_STORE).put({ key, value });
		req.onerror = () => reject(req.error);
		req.onsuccess = () => resolve();
	});
}

async function idbRemove(key: string): Promise<void> {
	const db = await openIdb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(IDB_STORE, "readwrite");
		const req = tx.objectStore(IDB_STORE).delete(key);
		req.onerror = () => reject(req.error);
		req.onsuccess = () => resolve();
	});
}

async function readIndexIdb(): Promise<PersistedIndex> {
	const json = await idbGet<PersistedIndex>(IDB_INDEX_KEY);
	if (!json || !Array.isArray(json.packs)) return emptyIndex();
	return { version: 1, packs: json.packs };
}

async function writeIndexIdb(index: PersistedIndex): Promise<void> {
	await idbSet(IDB_INDEX_KEY, index);
}

function pruneIndexForPack({
	index,
	id,
	fileName,
}: {
	index: PersistedIndex;
	id: string;
	fileName: string;
}): { next: PersistedIndex; removedKeys: string[] } {
	const fileKey = fileName.trim().toLowerCase();
	const removedKeys: string[] = [];
	const packs = index.packs.filter((entry) => {
		const sameId = entry.id === id;
		const sameName =
			fileKey.length > 0 &&
			entry.fileName.trim().toLowerCase() === fileKey;
		if (sameId || sameName) {
			removedKeys.push(entry.storageKey);
			return false;
		}
		return true;
	});
	return { next: { version: 1, packs }, removedKeys };
}

/**
 * Save imported pack bytes. Overwrites prior entry with same file name or pack id.
 */
export async function persistUserVfxPackFile({
	file,
	pack,
}: {
	file: File;
	pack: LoadedVfxPack;
}): Promise<void> {
	if (typeof window === "undefined") return;

	const fileName = pack.sourceFileName || file.name || `${pack.id}.vfxpack`;
	const storageKey = sanitizeStorageKey(fileName);
	const meta: PersistedUserPackMeta = {
		id: pack.id,
		fileName,
		storageKey,
		displayName: pack.displayName || pack.id,
		type: String(pack.type || ""),
		updatedAt: Date.now(),
	};

	if (useOpfs()) {
		const adapter = new OPFSAdapter(OPFS_DIR);
		const index = await readIndexOpfs(adapter);
		const { next, removedKeys } = pruneIndexForPack({
			index,
			id: pack.id,
			fileName,
		});
		for (const key of removedKeys) {
			if (key !== storageKey) await adapter.remove(key);
		}
		const saved = new File([file], storageKey, {
			type: file.type || "application/zip",
		});
		await adapter.set({ key: storageKey, value: saved });
		next.packs.push(meta);
		await writeIndexOpfs(adapter, next);
		return;
	}

	if (!("indexedDB" in window)) return;
	const index = await readIndexIdb();
	const { next, removedKeys } = pruneIndexForPack({
		index,
		id: pack.id,
		fileName,
	});
	for (const key of removedKeys) {
		if (key !== storageKey) await idbRemove(key);
	}
	const buffer = await file.arrayBuffer();
	await idbSet(storageKey, {
		meta,
		bytes: buffer,
	});
	next.packs.push(meta);
	await writeIndexIdb(next);
}

export async function removePersistedUserVfxPack({
	packId,
}: {
	packId: string;
}): Promise<void> {
	if (typeof window === "undefined") return;

	if (useOpfs()) {
		const adapter = new OPFSAdapter(OPFS_DIR);
		const index = await readIndexOpfs(adapter);
		const keep: PersistedUserPackMeta[] = [];
		for (const entry of index.packs) {
			if (entry.id === packId) {
				await adapter.remove(entry.storageKey);
			} else {
				keep.push(entry);
			}
		}
		await writeIndexOpfs(adapter, { version: 1, packs: keep });
		return;
	}

	if (!("indexedDB" in window)) return;
	const index = await readIndexIdb();
	const keep: PersistedUserPackMeta[] = [];
	for (const entry of index.packs) {
		if (entry.id === packId) {
			await idbRemove(entry.storageKey);
		} else {
			keep.push(entry);
		}
	}
	await writeIndexIdb({ version: 1, packs: keep });
}

async function loadFileFromStorage({
	storageKey,
	fileName,
}: {
	storageKey: string;
	fileName: string;
}): Promise<File | null> {
	if (useOpfs()) {
		const adapter = new OPFSAdapter(OPFS_DIR);
		const file = await adapter.get(storageKey);
		if (!file) return null;
		return new File([file], fileName || storageKey, {
			type: "application/zip",
		});
	}
	if (!("indexedDB" in window)) return null;
	const row = await idbGet<{
		meta?: PersistedUserPackMeta;
		bytes?: ArrayBuffer;
	}>(storageKey);
	if (!row?.bytes) return null;
	return new File([row.bytes], fileName || storageKey, {
		type: "application/zip",
	});
}

let loadStarted = false;

/** Restore persisted user packs into the registry (once per page load). */
export function loadPersistedUserVfxPacks(): void {
	if (loadStarted || typeof window === "undefined") return;
	loadStarted = true;
	void (async () => {
		try {
			const index = useOpfs()
				? await readIndexOpfs(new OPFSAdapter(OPFS_DIR))
				: "indexedDB" in window
					? await readIndexIdb()
					: emptyIndex();

			for (const entry of index.packs) {
				try {
					const file = await loadFileFromStorage({
						storageKey: entry.storageKey,
						fileName: entry.fileName,
					});
					if (!file) {
						console.warn(
							"[FreeFilmCut] persisted vfxpack missing bytes",
							entry.fileName,
						);
						continue;
					}
					const pack = await loadVfxPackFromFile({ file });
					// Face FX temporarily hidden in the NLE — skip restoring into the library.
					const packType = String(pack.type || "")
						.trim()
						.toLowerCase();
					if (packType === "face-fx") continue;
					// Keep the user-facing file name for replace-by-name on re-import.
					pack.sourceFileName = entry.fileName || pack.sourceFileName;
					usePackRegistry.getState().registerPack(pack);
				} catch (error) {
					console.warn(
						"[FreeFilmCut] failed to restore user vfxpack",
						entry.fileName,
						error,
					);
				}
			}
		} catch (error) {
			console.warn("[FreeFilmCut] loadPersistedUserVfxPacks failed", error);
		}
	})();
}
