/**
 * Flower pack catalog — auto-loads /flower/index.json for OpenCut Effects tab.
 * Primary source: Editor-exported `.vfxpack` (art-text) listed in index.json
 * (string array, same as other public/vfxpacks libraries). Folder flowerStyle.json
 * remains a fallback for already-unpacked packs.
 * Preview quality must never rescale FlowerStyle; packs stay at designFontSize.
 *
 * fcc-tl-flower-42: Media RT LinearSRGB (match editor fcc-ui-207; fix GIF sticker dark/red).
 * fcc-tl-flower-41: Effects default Default (no parens)/100; pack UIText.text never used for clip content.
 * fcc-tl-flower-39: load .vfxpack (+ MediaPlayer->RT for flowerStyle rt: fills); no sync unpack required.
 */
import { unzipSync } from "fflate";
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
	type FillContent,
	type FlowerPresetDef,
	type FlowerStyle,
	type ShadowLayer,
	type StrokeLayer,
} from "@/vfxpack/flower-style";
import type { LoadedVfxPack, VfxManifest, VfxSceneFile } from "@/vfxpack/types";
import { usePackRegistry } from "@/vfxpack/pack-registry";

/** Cache-bust for /flower/index.json + pack fetches (hard-refresh after drops). */
export const FLOWER_CATALOG_REV = 46;

export type FlowerPackManifestEntry = {
	id: string;
	name: string;
	/** Sidecar folder under /flower for cover + static texture URLs. */
	dir: string;
	cover?: string | null;
	preview?: string | null;
	/** Legacy extracted style file (fallback when vfxpack missing). */
	style?: string | null;
	/** Preferred: Editor-exported pack body under /flower/. */
	vfxpack?: string | null;
	designFontSize?: number;
	designCanvasHeight?: number;
	/** Optional built-in factory when flowerStyle.json / vfxpack is absent. */
	builtin?: string | null;
};

export type FlowerPackCatalogFile = {
	version: number;
	packs: FlowerPackManifestEntry[];
};

export type LoadedFlowerPackPreset = FlowerPresetDef & {
	preview?: string | null;
	dir: string;
	vfxpack?: string | null;
	/** GIF/seq/video players that blit into flowerStyle `rt:<uuid>` fills. */
	mediaPlayers?: Array<Record<string, unknown>> | null;
};

const INDEX_URL = `${FLOWER_PUBLIC_ASSET_PREFIX}/index.json?v=flower-${FLOWER_CATALOG_REV}`;

function normalizeZipPath(p: string): string {
	return String(p || "")
		.replace(/\\/g, "/")
		.replace(/^\.\//, "");
}

function stripPackPrefix(p: string): string {
	const n = normalizeZipPath(p);
	if (n === "pack" || n.startsWith("pack/")) return n.slice("pack/".length);
	return n;
}

function decodeUtf8(bytes: Uint8Array): string {
	return new TextDecoder("utf-8").decode(bytes);
}

function mimeForPath(p: string): string {
	const lower = String(p || "").toLowerCase();
	if (lower.endsWith(".png")) return "image/png";
	if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
	if (lower.endsWith(".webp")) return "image/webp";
	if (lower.endsWith(".gif")) return "image/gif";
	if (lower.endsWith(".svg")) return "image/svg+xml";
	if (lower.endsWith(".bmp")) return "image/bmp";
	return "application/octet-stream";
}

function blobUrlFromBytes(bytes: Uint8Array, pathHint: string): string {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return URL.createObjectURL(
		new Blob([copy], { type: mimeForPath(pathHint) }),
	);
}

/** Walk fill / strokes / shadows / stack and rewrite texture paths. */
function mapFlowerStyleTextures(
	style: FlowerStyle,
	rewrite: (content: FillContent) => FillContent,
): FlowerStyle {
	const s = normalizeFlowerStyle(style);
	const walkLayer = <T extends { content: FillContent; strokes?: StrokeLayer[] }>(
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
	s.strokes = (s.strokes || []).map((st) => ({
		...st,
		content: rewrite(st.content),
	}));
	s.shadows = (s.shadows || []).map((sh) => walkLayer(sh as ShadowLayer));
	s.innerShadows = (s.innerShadows || []).map((sh) => walkLayer(sh as ShadowLayer));
	if (Array.isArray(s.stack)) {
		s.stack = s.stack.map((e) => {
			if (!e || e.kind === "face") return e;
			if (e.kind === "stroke") return { ...e, content: rewrite(e.content) };
			return walkLayer(e as typeof e & { content: FillContent });
		}) as FlowerStyle["stack"];
	}
	// Re-derive buckets from stack so they stay in sync with rewritten paths.
	return normalizeFlowerStyle(s);
}

/** Ensure texture paths under a pack dir resolve to /flower/<dir>/<file>. */
export function bindStyleToPackDir(style: unknown, dir: string): FlowerStyle {
	const rewrite = (content: unknown): FillContent => {
		const c = normalizeFillContent(content);
		if (c.renderType !== "texture" || !c.texture?.path) return c;
		let path = c.texture.path;
		if (
			path.startsWith("http") ||
			path.startsWith("blob:") ||
			path.startsWith("data:") ||
			path.startsWith("/") ||
			path.startsWith("rt:")
		) {
			return c;
		}
		// assets/flower/<dir>/file → /flower/<dir>/file
		const m = path
			.replace(/\\/g, "/")
			.match(/(?:assets\/)?flower\/([^/]+)\/(.+)$/i);
		if (m) {
			path = flowerPublicUrl(m[1], m[2]);
			return { ...c, texture: { ...c.texture, path } };
		}
		// bare filename or relative → public URL for this pack
		const file = path.split("/").pop() || path;
		path = flowerPublicUrl(dir, file);
		return { ...c, texture: { ...c.texture, path } };
	};
	return remapFlowerStyleTexturePathsForOpenCut(
		mapFlowerStyleTextures(normalizeFlowerStyle(style), rewrite),
	);
}

function findFlowerUiHits(node: unknown, hits: Record<string, unknown>[]): void {
	if (!node || typeof node !== "object") return;
	const obj = node as Record<string, unknown>;
	const ud = obj.userData as Record<string, unknown> | undefined;
	const fcc = ud?.fccUI as Record<string, unknown> | undefined;
	if (fcc && fcc.type === "text" && fcc.flowerStyle) {
		hits.push(fcc);
	} else {
		const ui = obj.ui as Record<string, unknown> | undefined;
		if (ui && ui.type === "text" && ui.flowerStyle) hits.push(ui);
		else if (obj.flowerStyle && typeof obj.flowerStyle === "object") {
			hits.push({
				flowerStyle: obj.flowerStyle,
				fontSize: obj.fontSize,
				flowerBaseFontSize: obj.flowerBaseFontSize,
				// Pack UIText.text intentionally ignored for clip content (see FLOWER_EFFECT_DEFAULT_CONTENT).
				text: obj.text,
			});
		}
	}
	if (Array.isArray(node)) {
		for (const child of node) findFlowerUiHits(child, hits);
		return;
	}
	for (const key of Object.keys(obj)) {
		if (key === "flowerStyle") continue;
		findFlowerUiHits(obj[key], hits);
	}
}

type ExtractedArtText = {
	style: FlowerStyle;
	designFontSize: number;
	/** Pack scene resolution height (Editor canvas px); for OpenCut fontSize mapping. */
	designCanvasHeight?: number;
	textureUrlByBasename: Map<string, string>;
	packId?: string;
	packName?: string;
	coverUrl?: string | null;
	previewUrl?: string | null;
	/** Object URLs created from zip bytes — revoke on catalog invalidate. */
	blobUrls: string[];
	mediaPlayers: Array<Record<string, unknown>>;
};

function findZipBytesByBasename(
	files: Map<string, Uint8Array>,
	base: string,
): { path: string; bytes: Uint8Array } | null {
	const want = String(base || "").replace(/\\/g, "/").split("/").pop() || "";
	if (!want) return null;
	for (const [k, bytes] of files) {
		const leaf = k.split("/").pop() || "";
		if (leaf === want) return { path: k, bytes };
	}
	return null;
}

function findZipBytesByRel(
	files: Map<string, Uint8Array>,
	rel: string,
): { path: string; bytes: Uint8Array } | null {
	const n = normalizeZipPath(rel);
	if (files.has(n)) return { path: n, bytes: files.get(n)! };
	const leaf = n.split("/").pop() || n;
	for (const [k, bytes] of files) {
		if (k === n || k.endsWith("/" + leaf) || stripPackPrefix(k) === n) {
			return { path: k, bytes };
		}
	}
	return null;
}

/**
 * Parse an Editor art-text `.vfxpack` zip and pull the authoritative flowerStyle
 * from scene.json (same Troika stack the editor preview uses).
 * File textures become blob: URLs from the zip (no on-disk unpack required).
 */
﻿function listKeysNoPackPrefix(files: Map<string, Uint8Array>): string[] {
	const keys = new Set<string>();
	for (const k of files.keys()) {
		keys.add(stripPackPrefix(k));
	}
	return [...keys];
}

function findPackedMediaPath(
	fileKeys: string[],
	uuid: string | undefined,
	kind: string,
	fileName: string | undefined,
): string {
	const prefix = (uuid || "").slice(0, 8).toLowerCase();
	const pools =
		kind === "gif"
			? fileKeys.filter((f) => f.startsWith("media/"))
			: kind === "imageSequence"
				? fileKeys.filter((f) => f.startsWith("sequences/"))
				: fileKeys.filter((f) => f.startsWith("videos/") || f.startsWith("media/"));
	if (prefix) {
		if (kind === "imageSequence") {
			const folderHits = pools
				.filter((f) => f.toLowerCase().includes(prefix))
				.map((f) => {
					const parts = f.split("/");
					return parts.length >= 2 ? parts[0] + "/" + parts[1] + "/" : f;
				});
			if (folderHits[0]) return folderHits[0];
		} else {
			const hit = pools.find((f) => f.toLowerCase().includes(prefix));
			if (hit) return hit;
		}
	}
	if (fileName) {
		const base = String(fileName)
			.split(/[/\\]/)
			.pop()!
			.replace(/\.[^.]+$/, "")
			.toLowerCase();
		if (base.length >= 3) {
			const hit = pools.find((f) => f.toLowerCase().includes(base.slice(0, 12)));
			if (hit) {
				if (kind === "imageSequence") {
					const parts = hit.split("/");
					return parts.length >= 2 ? parts[0] + "/" + parts[1] + "/" : hit;
				}
				return hit;
			}
		}
	}
	return "";
}

type RtSpec = { width: number; height: number; wrapMode: string };

function collectFlowerMediaFromScene(
	scene: unknown,
	files: Map<string, Uint8Array>,
): {
	mediaPlayers: Array<Record<string, unknown>>;
	rtByUuid: Map<string, RtSpec>;
} {
	const fileKeys = listKeysNoPackPrefix(files);
	const mediaPlayers: Array<Record<string, unknown>> = [];
	const rtByUuid = new Map<string, RtSpec>();

	const walk = (node: unknown) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const n of node) walk(n);
			return;
		}
		const n = node as Record<string, unknown>;
		const uuid = typeof n.uuid === "string" ? n.uuid : "";
		const ud = (n.userData || {}) as Record<string, unknown>;
		const rtSpec = ud.fccRenderTexture as
			| { width?: number; height?: number; wrapMode?: string }
			| undefined;
		const kindNode = String(n.kind || "");
		if (uuid && (rtSpec || kindNode === "renderTexture")) {
			const wrapRaw = typeof rtSpec?.wrapMode === "string" ? rtSpec.wrapMode : "repeat";
			rtByUuid.set(uuid, {
				width: Math.min(4096, Math.max(16, Math.round(Number(rtSpec?.width) || 512))),
				height: Math.min(4096, Math.max(16, Math.round(Number(rtSpec?.height) || 512))),
				wrapMode:
					wrapRaw === "repeat" || wrapRaw === "mirroredRepeat" || wrapRaw === "clamp"
						? wrapRaw
						: "repeat",
			});
		}
		const fromUd = (ud.fccVideoPlayer || {}) as Record<string, unknown>;
		const fromVideo = (n.video || {}) as Record<string, unknown>;
		const vp =
			ud.fccVideoPlayer || n.video
				? ({ ...fromVideo, ...fromUd } as Record<string, unknown>)
				: undefined;
		if (vp && uuid) {
			const kind = String(vp.kind || "video");
			const packPath =
				(typeof vp.path === "string" && String(vp.path)) ||
				(typeof fromVideo.path === "string" && String(fromVideo.path)) ||
				findPackedMediaPath(
					fileKeys,
					uuid,
					kind,
					typeof vp.fileName === "string" ? vp.fileName : undefined,
				);
			const targetUuid =
				typeof vp.targetUuid === "string" && vp.targetUuid ? vp.targetUuid : "";
			const out: Record<string, unknown> = {
				uuid,
				name: typeof n.name === "string" ? n.name : "MediaPlayer",
				kind,
				path: packPath,
				packPath,
				targetUuid,
				fileName: vp.fileName,
				loop: vp.loop !== false,
				muted: vp.muted === true,
				volume: Number.isFinite(Number(vp.volume)) ? Number(vp.volume) : 1,
				playbackRate:
					Number.isFinite(Number(vp.playbackRate)) && Number(vp.playbackRate) > 0
						? Number(vp.playbackRate)
						: 1,
				...(vp.autoplay !== undefined ? { autoplay: vp.autoplay === true } : {}),
				sequenceFps: Number(vp.sequenceFps) || 30,
				sequenceStart: Number(vp.sequenceStart) || 0,
				sequenceEnd: Number.isFinite(Number(vp.sequenceEnd))
					? Number(vp.sequenceEnd)
					: -1,
			};
			if (kind === "imageSequence") {
				const seqDir = String(packPath || vp.sequenceDir || "")
					.replace(/\\/g, "/")
					.replace(/\/$/, "");
				out.sequenceDir = seqDir ? seqDir + "/" : "";
				out.path = out.sequenceDir || out.path;
				out.packPath = out.path;
			}
			mediaPlayers.push(out);
		}
		if (n.children) walk(n.children);
		if (n.nodes) walk(n.nodes);
	};

	const roots =
		(scene as { nodes?: unknown[] })?.nodes ||
		((scene as { object?: unknown }).object
			? [(scene as { object: unknown }).object]
			: []);
	walk(roots);

	for (const mp of mediaPlayers) {
		const tu = typeof mp.targetUuid === "string" ? mp.targetUuid : "";
		const rt = tu ? rtByUuid.get(tu) : undefined;
		if (rt) {
			mp.rtWidth = rt.width;
			mp.rtHeight = rt.height;
			mp.rtWrapMode = rt.wrapMode;
		}
	}
	return { mediaPlayers, rtByUuid };
}

function registerArtTextPackFromZip({
	manifest,
	scene,
	files,
	sourceFileName,
	blobUrls,
}: {
	manifest: Record<string, unknown>;
	scene: unknown;
	files: Map<string, Uint8Array>;
	sourceFileName: string;
	blobUrls: string[];
}): LoadedVfxPack | null {
	const id =
		typeof manifest.id === "string" && manifest.id.trim()
			? manifest.id.trim()
			: "";
	if (!id) return null;
	const packFiles = new Map<string, Uint8Array>();
	for (const [k, bytes] of files) {
		const rel = stripPackPrefix(k);
		if (!rel || rel.endsWith("/")) continue;
		if (!packFiles.has(rel)) packFiles.set(rel, bytes);
	}
	const objectUrls = new Map<string, string>();
	for (const [path, bytes] of packFiles) {
		const lower = path.toLowerCase();
		const isMedia =
			/\.(png|jpe?g|webp|gif|bmp|mp4|webm|mov)$/i.test(lower) ||
			lower.startsWith("media/") ||
			lower.startsWith("videos/") ||
			lower.startsWith("sequences/");
		if (!isMedia) continue;
		if (objectUrls.has(path)) continue;
		const url = blobUrlFromBytes(bytes, path);
		blobUrls.push(url);
		objectUrls.set(path, url);
	}
	const pack: LoadedVfxPack = {
		id,
		displayName:
			(typeof manifest.displayName === "string" && manifest.displayName) ||
			(typeof manifest.name === "string" && manifest.name) ||
			id,
		type: String(manifest.type || "art-text"),
		scope: String(manifest.scope || "stack"),
		manifest: manifest as unknown as VfxManifest,
		scene: (scene as VfxSceneFile) || null,
		files: packFiles,
		objectUrls,
		sourceFileName,
	};
	usePackRegistry.getState().registerPack(pack);
	return pack;
}


export async function extractFlowerStyleFromVfxpackBytes({
	bytes,
	packDir,
}: {
	bytes: Uint8Array;
	packDir: string;
}): Promise<ExtractedArtText | null> {
	let unzipped: Record<string, Uint8Array>;
	try {
		unzipped = unzipSync(bytes);
	} catch {
		return null;
	}
	const files = new Map<string, Uint8Array>();
	for (const [raw, data] of Object.entries(unzipped)) {
		const rel = stripPackPrefix(raw);
		if (!rel || rel.endsWith("/")) continue;
		files.set(normalizeZipPath(rel), data);
		files.set(normalizeZipPath(raw), data);
	}
	const manifestKey =
		[...files.keys()].find(
			(k) => k === "manifest.json" || k.endsWith("/manifest.json"),
		) || null;
	if (!manifestKey) return null;
	let manifest: Record<string, unknown>;
	try {
		manifest = JSON.parse(decodeUtf8(files.get(manifestKey)!)) as Record<
			string,
			unknown
		>;
	} catch {
		return null;
	}
	const packType = String(manifest.type || "").toLowerCase();
	if (packType && packType !== "art-text" && packType !== "flower") {
		return null;
	}
	const entry = manifest.entry as { scene?: string } | undefined;
	const assets = manifest.assets as { scene?: string } | undefined;
	const sceneRel = entry?.scene || assets?.scene || "scene.json";
	const sceneKey =
		[...files.keys()].find(
			(k) =>
				k === normalizeZipPath(sceneRel) ||
				k.endsWith("/" + String(sceneRel).split("/").pop()),
		) || null;
	if (!sceneKey) return null;
	let scene: unknown;
	try {
		scene = JSON.parse(decodeUtf8(files.get(sceneKey)!));
	} catch {
		return null;
	}
	const hits: Record<string, unknown>[] = [];
	findFlowerUiHits(scene, hits);
	if (hits.length === 0) return null;
	const ui = hits[0]!;
	const rawStyle = ui.flowerStyle;
	if (!rawStyle || typeof rawStyle !== "object") return null;
	const designFontSize =
		Number(ui.flowerBaseFontSize) > 0
			? Number(ui.flowerBaseFontSize)
			: Number(ui.fontSize) > 0
				? Number(ui.fontSize)
				: 48;

	const resH = Number(
		(scene as { resolution?: { height?: number } })?.resolution?.height,
	);
	const designCanvasHeight = resH > 0 ? resH : 0;

	const blobUrls: string[] = [];

	const stemOf = (s: string) =>
		String(s || "")
			.replace(/\\/g, "/")
			.split("/")
			.pop()!
			.replace(/\.(png|jpe?g|webp|gif|bmp)$/i, "");

	/** Map a texture path/fileName to a stable pack-relative key (textures/…). */
	const packRelFor = (path: string, fileName?: string): string | null => {
		const candidates = [
			fileName,
			path.replace(/\\/g, "/").split("/").pop() || "",
		].filter(Boolean) as string[];
		for (const [zipPath] of files) {
			const norm = zipPath.replace(/\\/g, "/");
			if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(norm)) continue;
			const leaf = norm.split("/").pop() || norm;
			const stem = stemOf(leaf);
			for (const base of candidates) {
				const bs = stemOf(base);
				if (
					leaf === base ||
					stem === bs ||
					leaf.endsWith("_" + base) ||
					leaf.endsWith("_" + bs) ||
					stem.endsWith("_" + bs)
				) {
					// Prefer textures/… without pack/ prefix for objectUrls lookup.
					const rel = stripPackPrefix(norm);
					return rel.startsWith("textures/") ? rel : `textures/${leaf}`;
				}
			}
		}
		return null;
	};

	const rewrite = (content: FillContent): FillContent => {
		const c = normalizeFillContent(content);
		if (c.renderType !== "texture" || !c.texture?.path) return c;
		const path = c.texture.path;
		const fileName =
			typeof c.texture.fileName === "string" ? c.texture.fileName : "";
		if (path.startsWith("rt:")) return c;
		// Keep pack-relative textures/… (resolved via registered art-text pack objectUrls).
		// Do NOT bake ephemeral blob: into flowerStyle — those break after catalog reload.
		const packRel = packRelFor(path, fileName);
		if (packRel) {
			return {
				...c,
				texture: {
					...c.texture,
					path: packRel,
					fileName: packRel.split("/").pop() || fileName,
				},
			};
		}
		if (
			path.startsWith("http") ||
			path.startsWith("blob:") ||
			path.startsWith("data:") ||
			path.startsWith("/")
		) {
			// Last resort: if we still have a zip blob for this leaf, prefer pack-rel above;
			// otherwise leave absolute URL as-is.
			return c;
		}
		const base = path.replace(/\\/g, "/").split("/").pop() || path;
		const fallback = packDir ? flowerPublicUrl(packDir, base) : path;
		return { ...c, texture: { ...c.texture, path: fallback } };
	};

	const style = remapFlowerStyleTexturePathsForOpenCut(
		mapFlowerStyleTextures(normalizeFlowerStyle(rawStyle), rewrite),
	);

	const previewMeta = manifest.preview as
		| { poster?: string; hover?: string }
		| undefined;
	const coverCandidates = [
		previewMeta?.poster,
		"preview/poster.png",
		"preview/cover_icon.png",
		"cover_icon.png",
		"poster.png",
	].filter(Boolean) as string[];
	const hoverCandidates = [
		previewMeta?.hover,
		"preview/hover.gif",
		"preview.gif",
		"hover.gif",
	].filter(Boolean) as string[];

	let coverUrl: string | null = null;
	for (const rel of coverCandidates) {
		const hit = findZipBytesByRel(files, rel);
		if (!hit) continue;
		coverUrl = blobUrlFromBytes(hit.bytes, hit.path);
		blobUrls.push(coverUrl);
		break;
	}
	let previewUrl: string | null = null;
	for (const rel of hoverCandidates) {
		const hit = findZipBytesByRel(files, rel);
		if (!hit) continue;
		previewUrl = blobUrlFromBytes(hit.bytes, hit.path);
		blobUrls.push(previewUrl);
		break;
	}

	const { mediaPlayers } = collectFlowerMediaFromScene(scene, files);
	registerArtTextPackFromZip({
		manifest,
		scene,
		files,
		sourceFileName: `flower:${packDir || "pack"}.vfxpack`,
		blobUrls,
	});

	const packId =
		typeof manifest.id === "string" && manifest.id.trim()
			? manifest.id.trim()
			: undefined;
	const packNameRaw =
		(typeof manifest.displayName === "string" && manifest.displayName) ||
		(typeof manifest.name === "string" && manifest.name) ||
		"";
	const packName = packNameRaw.trim() || undefined;

	return {
		style,
		designFontSize,
		designCanvasHeight,
		textureUrlByBasename: new Map<string, string>(),
		packId,
		packName,
		coverUrl,
		previewUrl,
		blobUrls,
		mediaPlayers,
	};
}

let _cache: LoadedFlowerPackPreset[] | null = null;
let _inflight: Promise<LoadedFlowerPackPreset[]> | null = null;
let _ownedBlobUrls: string[] = [];

function trackBlobUrls(urls: string[] | undefined | null) {
	if (!urls || urls.length === 0) return;
	for (const u of urls) {
		if (u && u.startsWith("blob:")) _ownedBlobUrls.push(u);
	}
}

function revokeOwnedBlobUrls() {
	for (const u of _ownedBlobUrls) {
		try {
			URL.revokeObjectURL(u);
		} catch {
			/* ignore */
		}
	}
	_ownedBlobUrls = [];
}

function builtinCreate(
	builtin: string | null | undefined,
): ((fontSize?: number) => FlowerStyle) | null {
	if (builtin === "jianying7645") return createJianying7645FlowerStyle;
	return null;
}

function fallbackBuiltinPresets(): LoadedFlowerPackPreset[] {
	return FLOWER_PRESETS.map((p) => ({
		...p,
		preview: null,
		dir: p.id === JIANYING_7645_PACK_ID ? "7645" : p.id,
		vfxpack: null,
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

async function fetchBytes(url: string): Promise<Uint8Array | null> {
	try {
		const res = await fetch(url, { cache: "no-cache" });
		if (!res.ok) return null;
		return new Uint8Array(await res.arrayBuffer());
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

function slugFromVfxpackName(fileName: string): string {
	return String(fileName || "")
		.replace(/\.vfxpack$/i, "")
		.trim()
		.replace(/[^\w.-]+/g, "_")
		.replace(/^_+|_+$/g, "") || "flower";
}

/**
 * Load one `.vfxpack` from /flower/<fileName> into a catalog preset.
 * Textures/cover come from zip bytes (blob URLs).
 */
async function vfxpackFileToPreset({
	fileName,
	fallbackId,
	fallbackName,
	fallbackDir,
}: {
	fileName: string;
	fallbackId?: string;
	fallbackName?: string;
	fallbackDir?: string;
}): Promise<LoadedFlowerPackPreset | null> {
	const name = String(fileName || "").trim();
	if (!name) return null;
	const file =
		name.toLowerCase().endsWith(".vfxpack") ? name : `${name}.vfxpack`;
	const packUrl = `${FLOWER_PUBLIC_ASSET_PREFIX}/${encodeURIComponent(file)}?v=flower-${FLOWER_CATALOG_REV}`;
	const bytes = await fetchBytes(packUrl);
	if (!bytes) {
		console.warn(`[FreeFilmCut] flower pack missing ${file}`);
		return null;
	}
	const slug = slugFromVfxpackName(file);
	const dir = (fallbackDir || slug).replace(/^\/+|\/+$/g, "");
	const extracted = await extractFlowerStyleFromVfxpackBytes({
		bytes,
		packDir: dir,
	});
	if (!extracted) {
		console.warn(`[FreeFilmCut] flower .vfxpack has no art-text flowerStyle: ${file}`);
		return null;
	}
	trackBlobUrls(extracted.blobUrls);

	const id = (extracted.packId || fallbackId || slug).trim();
	const displayName = (
		extracted.packName ||
		fallbackName ||
		id
	).trim();
	const designFontSize = extracted.designFontSize;
	const designCanvasHeight =
		extracted.designCanvasHeight && extracted.designCanvasHeight > 0
			? extracted.designCanvasHeight
			: 0;

	// Only use assets actually present in the .vfxpack (blob URLs from extract).
	// Do not invent /flower/<dir>/preview.gif or cover_icon.png — those 404 and
	// spam the console; FlowerCoverThumb already falls back to poster / name.
	const cover = extracted.coverUrl || "";
	const preview = extracted.previewUrl || null;

	return {
		id,
		name: displayName,
		cover,
		preview,
		dir,
		vfxpack: file,
		designFontSize,
		designCanvasHeight,
		create: makeCreateFromStyle(extracted.style, designFontSize),
		mediaPlayers:
			extracted.mediaPlayers && extracted.mediaPlayers.length
				? extracted.mediaPlayers
				: null,
	};
}

async function entryToPreset(
	entry: FlowerPackManifestEntry,
): Promise<LoadedFlowerPackPreset | null> {
	const id = String(entry.id || "").trim();
	const dir = String(entry.dir || "")
		.trim()
		.replace(/^\/+|\/+$/g, "");
	const vfxName = entry.vfxpack ? String(entry.vfxpack).trim() : "";

	// Prefer loading the .vfxpack body directly (no unpacked folder required).
	if (vfxName) {
		const fromPack = await vfxpackFileToPreset({
			fileName: vfxName,
			fallbackId: id || undefined,
			fallbackName: entry.name ? String(entry.name) : undefined,
			fallbackDir: dir || undefined,
		});
		if (fromPack) return fromPack;
	}

	if (!id || !dir) return null;
	let designFontSize =
		Number(entry.designFontSize) > 0 ? Number(entry.designFontSize) : 48;
	let designCanvasHeight =
		Number((entry as { designCanvasHeight?: number }).designCanvasHeight) > 0
			? Number((entry as { designCanvasHeight?: number }).designCanvasHeight)
			: 0;
	const coverFile = entry.cover || "cover_icon.png";
	const cover = flowerPublicUrl(dir, coverFile);
	const previewFile = entry.preview;
	const preview =
		previewFile && String(previewFile).trim()
			? flowerPublicUrl(dir, String(previewFile).trim())
			: null;

	let create = builtinCreate(entry.builtin);

	// Fallback: extracted flowerStyle.json (or builtin) for already-unzipped dirs
	if (!create) {
		const styleFile = entry.style || "flowerStyle.json";
		const styleUrl = flowerPublicUrl(dir, styleFile);
		const rawStyle = await fetchJson<unknown>(styleUrl);
		if (rawStyle && typeof rawStyle === "object") {
			create = makeCreateFromStyle(
				bindStyleToPackDir(rawStyle, dir),
				designFontSize,
			);
		}
	}
	if (!create) {
		if (id === JIANYING_7645_PACK_ID) create = createJianying7645FlowerStyle;
		else return null;
	}

	return {
		id,
		name: String(entry.name || id),
		cover,
		preview,
		dir,
		vfxpack: vfxName || null,
		designFontSize,
		designCanvasHeight,
		create,
	};
}

/**
 * index.json may be:
 * - string[] of `.vfxpack` filenames (preferred, same as other pack libraries)
 * - string[] of folder names under /flower/ (legacy unzipped)
 * - { version, packs: FlowerPackManifestEntry[] } (sync-flower-packs output)
 */
function normalizeIndexEntries(raw: unknown): FlowerPackManifestEntry[] | "vfxpack-names" | null {
	if (Array.isArray(raw)) {
		return null; // handled specially — keep raw names
	}
	if (raw && typeof raw === "object" && Array.isArray((raw as FlowerPackCatalogFile).packs)) {
		return (raw as FlowerPackCatalogFile).packs;
	}
	return null;
}

async function loadFromStringIndex(
	names: string[],
): Promise<LoadedFlowerPackPreset[]> {
	const out: LoadedFlowerPackPreset[] = [];
	const seen = new Set<string>();
	for (const rawName of names) {
		if (typeof rawName !== "string" || !rawName.trim()) continue;
		const name = rawName.trim();
		let preset: LoadedFlowerPackPreset | null = null;
		if (/\.vfxpack$/i.test(name) || !name.includes("/")) {
			if (/\.vfxpack$/i.test(name)) {
				preset = await vfxpackFileToPreset({ fileName: name });
			} else {
				// Folder name — try sibling .vfxpack first, then flowerStyle.json dir
				const asPack = await vfxpackFileToPreset({
					fileName: `${name}.vfxpack`,
					fallbackDir: name,
					fallbackId: name,
				});
				if (asPack) {
					preset = asPack;
				} else {
					preset = await entryToPreset({
						id: name,
						name,
						dir: name,
						style: "flowerStyle.json",
						cover: "cover_icon.png",
					});
				}
			}
		}
		if (!preset || seen.has(preset.id)) continue;
		seen.add(preset.id);
		out.push(preset);
	}
	return out;
}

/** Load /flower/index.json (once). Falls back to built-in FLOWER_PRESETS. */
export async function loadFlowerPackCatalog(): Promise<LoadedFlowerPackPreset[]> {
	if (_cache) return _cache;
	if (_inflight) return _inflight;
	_inflight = (async () => {
		const raw = await fetchJson<unknown>(INDEX_URL);
		if (!raw) {
			_cache = fallbackBuiltinPresets();
			return _cache;
		}

		if (Array.isArray(raw)) {
			const names = raw.filter(
				(n): n is string => typeof n === "string" && n.length > 0,
			);
			const out = await loadFromStringIndex(names);
			_cache = out.length > 0 ? out : fallbackBuiltinPresets();
			return _cache;
		}

		const packs = normalizeIndexEntries(raw);
		if (!packs || packs.length === 0) {
			_cache = fallbackBuiltinPresets();
			return _cache;
		}
		const out: LoadedFlowerPackPreset[] = [];
		const seen = new Set<string>();
		for (const entry of packs) {
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

export function getFlowerPackPreset(
	id: string | null | undefined,
): LoadedFlowerPackPreset | null {
	if (!id) return null;
	const list = getFlowerPackPresetsSnapshot();
	return list.find((p) => p.id === id) || null;
}

/** Force re-fetch (after dropping a new pack into public/flower). */
export function invalidateFlowerPackCatalog() {
	_cache = null;
	_inflight = null;
	revokeOwnedBlobUrls();
}
