/**
 * Flower pack catalog — auto-loads /flower/index.json for OpenCut Effects tab.
 * Preview quality must never rescale FlowerStyle; packs stay at designFontSize.
 */
import {
	FLOWER_PUBLIC_ASSET_PREFIX,
	FLOWER_PRESETS,
	JIANYING_7645_PACK_ID,
	createJianying7645FlowerStyle,
	flowerPublicUrl,
	normalizeFillContent,
	normalizeFlowerStyle,
	remapFlowerStyleTexturePathsForOpenCut,
	rescaleFlowerStyleForFontSize,
	type FlowerPresetDef,
	type FlowerStyle,
} from "@/vfxpack/flower-style";

export type FlowerPackManifestEntry = {
	id: string;
	name: string;
	dir: string;
	cover?: string | null;
	preview?: string | null;
	style?: string | null;
	designFontSize?: number;
	/** Optional built-in factory when flowerStyle.json is absent. */
	builtin?: string | null;
};

export type FlowerPackCatalogFile = {
	version: number;
	packs: FlowerPackManifestEntry[];
};

export type LoadedFlowerPackPreset = FlowerPresetDef & {
	preview?: string | null;
	dir: string;
};

const INDEX_URL = `${FLOWER_PUBLIC_ASSET_PREFIX}/index.json`;

/** Ensure texture paths under a pack dir resolve to /flower/<dir>/<file>. */
function bindStyleToPackDir(style: unknown, dir: string): FlowerStyle {
	const s = normalizeFlowerStyle(style);
	const rewrite = (content: unknown) => {
		const c = normalizeFillContent(content);
		if (c.renderType !== "texture" || !c.texture?.path) return c;
		let path = c.texture.path;
		if (
			path.startsWith("http") ||
			path.startsWith("blob:") ||
			path.startsWith("data:") ||
			path.startsWith("/")
		) {
			return c;
		}
		// bare filename or relative → public URL for this pack
		const file = path.split("/").pop() || path;
		path = flowerPublicUrl(dir, file);
		return { ...c, texture: { ...c.texture, path } };
	};
	const walkLayer = <T extends { content: unknown; strokes?: Array<{ content: unknown }> }>(
		layer: T,
	): T => {
		const next = { ...layer, content: rewrite(layer.content) };
		if (Array.isArray(layer.strokes)) {
			next.strokes = layer.strokes.map((st) => ({
				...st,
				content: rewrite(st.content),
			}));
		}
		return next;
	};
	s.fill = { ...s.fill, content: rewrite(s.fill.content) };
	s.strokes = (s.strokes || []).map((st) => ({ ...st, content: rewrite(st.content) }));
	s.shadows = (s.shadows || []).map(walkLayer);
	s.innerShadows = (s.innerShadows || []).map(walkLayer);
	return remapFlowerStyleTexturePathsForOpenCut(s);
}



let _cache: LoadedFlowerPackPreset[] | null = null;
let _inflight: Promise<LoadedFlowerPackPreset[]> | null = null;

function builtinCreate(builtin: string | null | undefined): ((fontSize?: number) => FlowerStyle) | null {
	if (builtin === "jianying7645") return createJianying7645FlowerStyle;
	return null;
}

function fallbackBuiltinPresets(): LoadedFlowerPackPreset[] {
	return FLOWER_PRESETS.map((p) => ({
		...p,
		preview: null,
		dir: p.id === JIANYING_7645_PACK_ID ? "7645" : p.id,
	}));
}

async function fetchJson<T>(url: string): Promise<T | null> {
	try {
		const res = await fetch(url, { cache: "no-cache" });
		if (!res.ok) return null;
		return (await res.json()) as T;
	} catch {
		return null;
	}
}

function makeCreateFromStyle(
	style: FlowerStyle,
	designFontSize: number,
): (fontSize?: number) => FlowerStyle {
	const design = normalizeFlowerStyle(style);
	const base = designFontSize > 0 ? designFontSize : 48;
	return (fontSize?: number) => {
		const fs = Number(fontSize) > 0 ? Number(fontSize) : base;
		if (Math.abs(fs - base) < 0.01) return normalizeFlowerStyle(design);
		return rescaleFlowerStyleForFontSize(design, base, fs);
	};
}

async function entryToPreset(entry: FlowerPackManifestEntry): Promise<LoadedFlowerPackPreset | null> {
	const id = String(entry.id || "").trim();
	const dir = String(entry.dir || "").trim().replace(/^\/+|\/+$/g, "");
	if (!id || !dir) return null;
	const designFontSize =
		Number(entry.designFontSize) > 0 ? Number(entry.designFontSize) : 48;
	const coverFile = entry.cover || "cover_icon.png";
	const cover = flowerPublicUrl(dir, coverFile);
	const previewFile = entry.preview;
	const preview =
		previewFile && String(previewFile).trim()
			? flowerPublicUrl(dir, String(previewFile).trim())
			: null;

	let create = builtinCreate(entry.builtin);
	const styleFile = entry.style || "flowerStyle.json";
	const styleUrl = flowerPublicUrl(dir, styleFile);
	const rawStyle = await fetchJson<unknown>(styleUrl);
	if (rawStyle && typeof rawStyle === "object") {
		create = makeCreateFromStyle(bindStyleToPackDir(rawStyle, dir), designFontSize);
	}
	if (!create) {
		// Last resort: empty solid if neither builtin nor style file
		if (id === JIANYING_7645_PACK_ID) create = createJianying7645FlowerStyle;
		else return null;
	}

	return {
		id,
		name: String(entry.name || id),
		cover,
		preview,
		dir,
		designFontSize,
		create,
	};
}

/** Load /flower/index.json (once). Falls back to built-in FLOWER_PRESETS. */
export async function loadFlowerPackCatalog(): Promise<LoadedFlowerPackPreset[]> {
	if (_cache) return _cache;
	if (_inflight) return _inflight;
	_inflight = (async () => {
		const file = await fetchJson<FlowerPackCatalogFile>(INDEX_URL);
		if (!file || !Array.isArray(file.packs) || file.packs.length === 0) {
			_cache = fallbackBuiltinPresets();
			return _cache;
		}
		const out: LoadedFlowerPackPreset[] = [];
		const seen = new Set<string>();
		for (const entry of file.packs) {
			const preset = await entryToPreset(entry);
			if (!preset || seen.has(preset.id)) continue;
			seen.add(preset.id);
			out.push(preset);
		}
		_cache = out.length > 0 ? out : fallbackBuiltinPresets();
		return _cache;
	})().finally(() => {
		_inflight = null;
	});
	return _inflight;
}

/** Sync snapshot (builtins until catalog finishes loading). */
export function getFlowerPackPresetsSnapshot(): LoadedFlowerPackPreset[] {
	return _cache ?? fallbackBuiltinPresets();
}

export function getFlowerPackPreset(id: string | null | undefined): LoadedFlowerPackPreset | null {
	if (!id) return null;
	const list = getFlowerPackPresetsSnapshot();
	return list.find((p) => p.id === id) || null;
}

/** Force re-fetch (after dropping a new pack into public/flower). */
export function invalidateFlowerPackCatalog() {
	_cache = null;
	_inflight = null;
}
