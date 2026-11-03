/**
 * Apply a loaded text-template pack onto a timeline TextElement draft.
 * Remaps sticker / media paths to pack.objectUrls so textures & gif bytes resolve.
 *
 * Remaps paths; clip compositor runs AABB sticker-follow + MediaFramePlayer→RT
 * (see text-stickers.js / text-template-media.ts).
 *
 * fcc-tl-flower-14: if manifest.textTemplate / text-template.json is missing
 * (scene VfxPackExporter packs wrongly tagged type=text-template), synthesize
 * the payload from scene.json (fccUI + fccVideoPlayer + camera PP).
 * fcc-tl-flower-16: merge animations/*.anim progress tracks into embedded textAnim
 * (generic exporter left them only in .anim); auto-assign textAnims;
 * keep shader sticker materials; scene prop meshes grafted via text-template-scene-props.
 */
import type { LoadedVfxPack, VfxManifest, VfxSceneFile } from "@/vfxpack/types";
import type { ParamValues } from "@/params";
import {
	registerEmbeddedTextAnimPack,
	enrichTextAnimWithPackTracks,
	embeddedTextAnimPackId,
	type TextAnimAssignment,
} from "@/vfxpack/text-template-textanim";
import { getPackRegistrySnapshot, usePackRegistry } from "@/vfxpack/pack-registry";
import { onPackRegistered } from "@/vfxpack/pack-registry-hooks";
import { normalizeVfxPackType } from "@/vfxpack/pack-placement";


/** True text-template clips only (baked textAnim). Flower Effects may set textTemplatePackId for MediaPlayer->RT (art-text); those are not templates. fcc-tl-flower-63 */
export function isTextTemplateClip(element: {
	textTemplatePackId?: string | null;
	textStickers?: unknown;
	textFxStack?: unknown;
	textAnims?: unknown;
}): boolean {
	const id = element.textTemplatePackId;
	if (!id || typeof id !== "string") return false;
	const pack = getPackRegistrySnapshot().packs.find((e) => e.id === id);
	if (pack) {
		return normalizeVfxPackType(pack.type) === "text-template";
	}
	// Pack not loaded yet: treat stickers / textFx / auto textAnims as template markers.
	return !!(
		(Array.isArray(element.textStickers) && element.textStickers.length > 0) ||
		element.textFxStack ||
		element.textAnims
	);
}

export type TextTemplateApplyResult = {
	content: string;
	paramsPatch: Partial<ParamValues>;
	flowerStyle: unknown | null;
	flowerBaseFontSize: number | null;
	textTemplatePackId: string;
	textStickers: Array<Record<string, unknown>> | null;
	textTemplateMediaPlayers: Array<Record<string, unknown>> | null;
	/** Clip text RT Fx (Registry PP). From textTemplate.textFxStack or postProcess. */
	textFxStack: Record<string, unknown> | null;
	/** Auto-filled In/Out/Loop from embedded textAnim or animRefs. */
	textAnims: TextAnimAssignment | null;
	hasFlower: boolean;
	hasStickers: boolean;
	hasMediaPlayers: boolean;
	hasTextAnim: boolean;
	hasPostProcess: boolean;
	hasSceneProps: boolean;
	/** True when payload was rebuilt from scene.json (legacy / wrong exporter). */
	synthesizedFromScene: boolean;
};

type TextTemplatePayload = NonNullable<VfxManifest["textTemplate"]>;

function packUrl(pack: LoadedVfxPack, rel: string | undefined | null): string {
	if (!rel || typeof rel !== "string") return "";
	const clean = rel.replace(/^pack\//, "").replace(/^\.\//, "");
	return (
		pack.objectUrls.get(clean) ||
		pack.objectUrls.get("pack/" + clean) ||
		pack.objectUrls.get(rel) ||
		""
	);
}




/** Prefer pack-relative fonts/ paths in params (persistable). Resolve to blob at render. */
function remapFontPath(pack: LoadedVfxPack, font: string | undefined | null): string {
	const firstPackFontRel = (): string => {
		for (const key of pack.files.keys()) {
			const clean = key.replace(/^pack\//, "");
			if (clean.startsWith("fonts/") && /\.(ttf|otf|woff)$/i.test(clean)) {
				return clean;
			}
		}
		for (const key of pack.objectUrls.keys()) {
			const clean = key.replace(/^pack\//, "");
			if (clean.startsWith("fonts/") && /\.(ttf|otf|woff)$/i.test(clean)) {
				return clean;
			}
		}
		return "";
	};

	if (!font || typeof font !== "string") return "";
	const f = font.trim();
	if (!f) return "";
	if (
		f.startsWith("http://") ||
		f.startsWith("https://") ||
		f.startsWith("data:") ||
		f.startsWith("/fonts/")
	) {
		return f;
	}
	if (f.startsWith("fonts/") || f.startsWith("pack/fonts/")) {
		return f.replace(/^pack\//, "");
	}
	if (f.startsWith("blob:")) {
		// Stale editor blob — recover pack-relative fonts/ if present.
		return firstPackFontRel();
	}
	return f;
}

function remapDeepTexturePaths(pack: LoadedVfxPack, value: unknown): unknown {
	if (value == null) return value;
	if (typeof value === "string") {
		if (
			value.startsWith("textures/") ||
			value.startsWith("pack/textures/") ||
			value.startsWith("media/") ||
			value.startsWith("sequences/")
		) {
			const url = packUrl(pack, value);
			return url || value;
		}
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((v) => remapDeepTexturePaths(pack, v));
	}
	if (typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			out[k] = remapDeepTexturePaths(pack, v);
		}
		return out;
	}
	return value;
}


/** Prefer ShaderMaterial / materialUuid from pack.scene when stickers were sprite-fallbacked. */
function upgradeStickersMaterialsFromScene(
	pack: LoadedVfxPack,
	stickers: Array<Record<string, unknown>> | null,
): Array<Record<string, unknown>> | null {
	if (!stickers?.length) return stickers;
	const materials = new Map<string, Record<string, unknown>>();
	const nodes = (pack.scene as { nodes?: Array<Record<string, unknown>> } | null)?.nodes;
	if (Array.isArray(nodes)) {
		for (const n of nodes) {
			const mats = n.materials;
			if (!Array.isArray(mats)) continue;
			for (const m of mats) {
				if (m && typeof m === "object" && typeof (m as { uuid?: string }).uuid === "string") {
					materials.set((m as { uuid: string }).uuid, m as Record<string, unknown>);
				}
			}
		}
	}
	if (!materials.size) return stickers;
	return stickers.map((raw) => {
		const s = { ...raw };
		const matUuid = typeof s.materialUuid === "string" ? s.materialUuid : "";
		if (!matUuid) return s;
		const mat = materials.get(matUuid);
		if (!mat) return s;
		const matType = String(mat.type || "");
		const isShader =
			matType === "ShaderMaterial" || matType === "RawShaderMaterial";
		if (isShader || matUuid) {
			s.material = "material";
			// Keep texturePackPath for live RT rebind; clear static TextureLoader path for seq/video.
			const textures = (mat.textures as Record<string, unknown>) || null;
			const mapPath =
				textures && typeof textures.map === "string" ? textures.map : "";
			if (mapPath.startsWith("rt:")) {
				s.texturePath = "";
				s.rtTargetUuid = mapPath.slice(3);
			}
		}
		return s;
	});
}

function remapStickerTextures(
	pack: LoadedVfxPack,
	stickers: Array<Record<string, unknown>> | undefined,
): Array<Record<string, unknown>> | null {
	if (!Array.isArray(stickers) || !stickers.length) return null;
	return stickers.map((raw) => {
		const s = { ...raw };
		const path =
			(typeof s.texturePackPath === "string" && s.texturePackPath) ||
			(typeof s.texturePath === "string" ? s.texturePath : "");
		if (typeof path === "string" && path.startsWith("rt:")) {
			// Sprite sticker authored against a live RenderTexture.
			s.texturePath = path;
			s.rtTargetUuid =
				(typeof s.rtTargetUuid === "string" && s.rtTargetUuid) ||
				path.slice(3);
		} else if (path && !path.startsWith("blob:") && !path.startsWith("rt:")) {
			const url = packUrl(pack, path);
			if (url) {
				s.texturePath = url;
				s.texturePackPath =
					typeof s.texturePackPath === "string" && s.texturePackPath
						? s.texturePackPath
						: path;
			} else if (typeof s.texturePackPath !== "string" || !s.texturePackPath) {
				s.texturePackPath = path;
			}
		} else if (
			typeof s.texturePath === "string" &&
			s.texturePath.startsWith("blob:")
		) {
			s.texturePath = "";
		}
		return s;
	});
}

function remapMediaPlayers(
	pack: LoadedVfxPack,
	players: Array<Record<string, unknown>> | undefined,
): Array<Record<string, unknown>> | null {
	if (!Array.isArray(players) || !players.length) return null;
	return players.map((raw) => {
		const p = { ...raw };
		const path = typeof p.path === "string" ? p.path : "";
		const kind = String(p.kind || "video");
		p.packPath = path;
		if (kind === "gif" || kind === "video") {
			const url = packUrl(pack, path);
			if (url) p.objectUrl = url;
		} else if (kind === "imageSequence") {
			const dir = path.replace(/\/?$/, "/");
			const names = Array.isArray(p.frameNames)
				? (p.frameNames as string[])
				: [];
			const frameUrls: Record<string, string> = {};
			for (const name of names) {
				const rel = dir + name;
				const url = packUrl(pack, rel);
				if (url) frameUrls[name] = url;
			}
			if (!names.length) {
				const prefix = path.replace(/\/?$/, "/");
				for (const key of pack.objectUrls.keys()) {
					if (!key.startsWith(prefix) && !key.startsWith("pack/" + prefix))
						continue;
					const base = key.split("/").pop() || "";
					if (!/\.(png|jpe?g|webp|bmp|gif)$/i.test(base)) continue;
					frameUrls[base] = pack.objectUrls.get(key) || "";
				}
			}
			p.frameObjectUrls = frameUrls;
		}
		return p;
	});
}

function decodeFileText(bytes: Uint8Array): string {
	return new TextDecoder("utf-8").decode(bytes);
}

function readEmbeddedTextTemplateJson(
	pack: LoadedVfxPack,
): TextTemplatePayload | null {
	const bytes =
		pack.files.get("text-template.json") ||
		pack.files.get("pack/text-template.json");
	if (!bytes) return null;
	try {
		const parsed = JSON.parse(decodeFileText(bytes)) as TextTemplatePayload;
		if (parsed && typeof parsed === "object") return parsed;
	} catch {
		/* ignore */
	}
	return null;
}

type SceneNodeLike = {
	name?: string;
	type?: string;
	uuid?: string;
	children?: SceneNodeLike[];
	nodes?: SceneNodeLike[];
	materials?: Array<Record<string, unknown> & { uuid?: string }>;
	postProcess?: {
		enabled?: boolean;
		effects?: unknown[];
	};
	userData?: {
		fccUI?: Record<string, unknown> & {
			type?: string;
			text?: string;
			textStickers?: Array<Record<string, unknown>>;
			flowerStyle?: unknown;
			flowerBaseFontSize?: number;
			textAnim?: unknown;
			textFxStack?: Record<string, unknown>;
			font?: string;
			fontBold?: string;
			fontFileName?: string;
			fontSize?: number;
			bold?: boolean;
			color?: string;
			letterSpacing?: number;
			lineHeight?: number;
			align?: string;
			verticalAlign?: string;
			outline?: Record<string, unknown>;
			shadow?: Record<string, unknown>;
		};
		fccVideoPlayer?: Record<string, unknown> & {
			kind?: string;
			fileName?: string;
			targetUuid?: string;
			loop?: boolean;
			muted?: boolean;
			volume?: number;
			playbackRate?: number;
			autoplay?: boolean;
			sequenceFps?: number;
			sequenceDir?: string;
			sequenceStart?: number;
			sequenceEnd?: number;
			projectPath?: string;
		};
		postProcessStack?: {
			enabled?: boolean;
			effects?: unknown[];
		};
		fccRenderTexture?: { width?: number; height?: number };
	};
};

function walkSceneNodes(nodes: SceneNodeLike[] | undefined, fn: (n: SceneNodeLike) => void) {
	if (!Array.isArray(nodes)) return;
	for (const n of nodes) {
		fn(n);
		if (n.children) walkSceneNodes(n.children, fn);
		if (n.nodes) walkSceneNodes(n.nodes, fn);
	}
}

function listPackFileKeys(pack: LoadedVfxPack): string[] {
	const keys = new Set<string>();
	for (const k of pack.files.keys()) {
		keys.add(k.replace(/^pack\//, ""));
	}
	for (const k of pack.objectUrls.keys()) {
		keys.add(k.replace(/^pack\//, ""));
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
				: fileKeys.filter((f) => f.startsWith("videos/"));
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

/**
 * Rebuild freecapcut.text-template/1 from a full scene pack (VfxPackExporter).
 * Used when type=text-template but textTemplate payload was never written.
 */
export function synthesizeTextTemplateFromScene(
	pack: LoadedVfxPack,
): TextTemplatePayload | null {
	const scene = pack.scene as VfxSceneFile | null;
	if (!scene || typeof scene !== "object") return null;

	const fileKeys = listPackFileKeys(pack);
	const materials = new Map<string, Record<string, unknown>>();
	let textUi: NonNullable<NonNullable<SceneNodeLike["userData"]>["fccUI"]> | null = null;
	let textUuid: string | null = null;
	const players: Array<{
		uuid: string;
		name: string;
		vp: NonNullable<NonNullable<SceneNodeLike["userData"]>["fccVideoPlayer"]>;
	}> = [];
	let cameraPp: { enabled?: boolean; effects?: unknown[] } | null = null;

	const roots =
		(scene as { nodes?: SceneNodeLike[] }).nodes ||
		((scene as { object?: SceneNodeLike }).object
			? [(scene as { object: SceneNodeLike }).object]
			: []);

	walkSceneNodes(roots, (n) => {
		if (Array.isArray(n.materials)) {
			for (const m of n.materials) {
				if (m && typeof m.uuid === "string") materials.set(m.uuid, m);
			}
		}
		const ui = n.userData?.fccUI;
		if (ui && ui.type === "text" && !textUi) {
			textUi = ui;
			textUuid = typeof n.uuid === "string" ? n.uuid : null;
		}
		const vp = n.userData?.fccVideoPlayer;
		if (vp && n.uuid) {
			players.push({ uuid: n.uuid, name: n.name || "MediaPlayer", vp });
		}
		const isCam =
			n.type === "PerspectiveCamera" || n.type === "OrthographicCamera";
		if (isCam) {
			const pp = n.postProcess || n.userData?.postProcessStack;
			if (pp && Array.isArray(pp.effects) && pp.effects.length) cameraPp = pp;
		}
	});

	if (!textUi) return null;

	const mediaPlayers = players.map(({ uuid, name, vp }) => {
		const kind = String(vp.kind || "video");
		const packPath = findPackedMediaPath(
			fileKeys,
			uuid,
			kind,
			typeof vp.fileName === "string" ? vp.fileName : undefined,
		);
		const out: Record<string, unknown> = {
			uuid,
			name,
			kind,
			path: packPath,
			targetUuid: vp.targetUuid,
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
			const names: string[] = [];
			const prefix = seqDir ? seqDir + "/" : "sequences/";
			for (const key of fileKeys) {
				const norm = key.replace(/^pack\//, "");
				if (!norm.startsWith(prefix)) continue;
				const base = norm.slice(prefix.length);
				if (!base || base.includes("/")) continue;
				if (/\.(png|jpe?g|webp|bmp|gif)$/i.test(base)) names.push(base);
			}
			names.sort((a, b) =>
				a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
			);
			if (names.length) out.frameNames = names;
		}
		return out;
	});

	const rtToMediaPath = new Map<string, string>();
	for (const mp of mediaPlayers) {
		const target = typeof mp.targetUuid === "string" ? mp.targetUuid : "";
		const path = typeof mp.path === "string" ? mp.path : "";
		if (target && path) rtToMediaPath.set(target, path);
	}

	const rawStickers = Array.isArray(textUi.textStickers)
		? textUi.textStickers
		: [];
	const stickers = rawStickers.map((raw) => {
		const s: Record<string, unknown> = { ...raw };
		if (typeof s.texturePath === "string" && s.texturePath.startsWith("blob:")) {
			s.texturePath = "";
		}
		const matUuid =
			typeof s.materialUuid === "string" ? s.materialUuid : "";
		const mat = matUuid ? materials.get(matUuid) : null;
		const textures = (mat && (mat.textures as Record<string, unknown>)) || null;
		const mapPath =
			textures && typeof textures.map === "string" ? textures.map : "";
		if (mat) {
			const matType = String((mat as { type?: string }).type || "");
			const isShader =
				matType === "ShaderMaterial" || matType === "RawShaderMaterial";
			if (isShader || matUuid) {
				// Keep material-ball / shader stickers; clip builds materialsMap from pack.
				s.material = "material";
				if (matUuid) s.materialUuid = matUuid;
			}
		}
		if (mapPath.startsWith("rt:")) {
			const rt = mapPath.slice(3);
			const mediaPath = rtToMediaPath.get(rt);
			if (mediaPath) {
				s.texturePackPath = mediaPath;
				// Sprite fallback path only when no linked material uuid.
				if (s.material !== "material") {
					s.material = "sprite";
					s.texturePath = mediaPath.startsWith("media/") ? mediaPath : "";
				} else {
					// Shader materials sample RT via fccRtSlots; avoid TextureLoader on video/seq.
					s.texturePath = "";
				}
				s.rtTargetUuid = rt;
			}
		} else if (mapPath && !mapPath.startsWith("blob:")) {
			s.texturePackPath = mapPath;
			if (s.material !== "material") {
				s.texturePath = mapPath;
			}
		}
		// Sprite stickers may author texturePath=rt:<uuid> directly (no material map).
		const spriteTex =
			typeof s.texturePath === "string" ? s.texturePath : "";
		if (spriteTex.startsWith("rt:") && !s.rtTargetUuid) {
			const rt = spriteTex.slice(3);
			s.rtTargetUuid = rt;
			const mediaPath = rtToMediaPath.get(rt);
			if (mediaPath) s.texturePackPath = mediaPath;
		}
		return s;
	});

	const text: NonNullable<TextTemplatePayload["text"]> = {
		content: typeof textUi.text === "string" ? textUi.text : "",
		font: typeof textUi.font === "string" ? textUi.font : undefined,
		fontBold: typeof textUi.fontBold === "string" ? textUi.fontBold : undefined,
		fontFileName:
			typeof textUi.fontFileName === "string" ? textUi.fontFileName : undefined,
		fontSize:
			typeof textUi.fontSize === "number" ? textUi.fontSize : undefined,
		bold: typeof textUi.bold === "boolean" ? textUi.bold : undefined,
		color: typeof textUi.color === "string" ? textUi.color : undefined,
		letterSpacing:
			typeof textUi.letterSpacing === "number"
				? textUi.letterSpacing
				: undefined,
		lineHeight:
			typeof textUi.lineHeight === "number" ? textUi.lineHeight : undefined,
		align: typeof textUi.align === "string" ? textUi.align : undefined,
		verticalAlign:
			typeof textUi.verticalAlign === "string"
				? textUi.verticalAlign
				: undefined,
		outline:
			textUi.outline && typeof textUi.outline === "object"
				? textUi.outline
				: undefined,
		shadow:
			textUi.shadow && typeof textUi.shadow === "object"
				? textUi.shadow
				: undefined,
	};

	const tpl: TextTemplatePayload = {
		format: "freecapcut.text-template/1",
		name: pack.displayName || pack.id,
		text,
	};
	if (textUi.flowerStyle && typeof textUi.flowerStyle === "object") {
		tpl.flowerStyle = textUi.flowerStyle;
	}
	if (
		textUi.flowerBaseFontSize != null &&
		Number(textUi.flowerBaseFontSize) > 0
	) {
		tpl.flowerBaseFontSize = Number(textUi.flowerBaseFontSize);
	}
	if (textUi.textAnim) {
		tpl.textAnim = enrichTextAnimWithPackTracks(
			pack,
			textUi.textAnim,
			textUuid,
		) as TextTemplatePayload["textAnim"];
	}
	const textFx =
		textUi.textFxStack &&
		typeof textUi.textFxStack === "object" &&
		Array.isArray((textUi.textFxStack as { effects?: unknown[] }).effects) &&
		(textUi.textFxStack as { effects: unknown[] }).effects.length
			? (textUi.textFxStack as TextTemplatePayload["textFxStack"])
			: null;
	if (textFx) tpl.textFxStack = textFx;
	if (cameraPp && Array.isArray(cameraPp.effects) && cameraPp.effects.length) {
		tpl.postProcess = cameraPp as TextTemplatePayload["postProcess"];
	}
	if (stickers.length) tpl.stickers = stickers;
	if (mediaPlayers.length) {
		tpl.mediaPlayers = mediaPlayers as TextTemplatePayload["mediaPlayers"];
		tpl.mediaAssets = mediaPlayers
			.map((m) => (typeof m.path === "string" ? m.path : ""))
			.filter(Boolean);
	}
	return tpl;
}

/**
 * Resolve textTemplate payload: manifest → text-template.json → scene synthesis.
 * Mutates pack.manifest.textTemplate when recovering so later consumers see it.
 */
export function resolveTextTemplatePayload(
	pack: LoadedVfxPack,
): { tpl: TextTemplatePayload | null; synthesizedFromScene: boolean } {
	const existing = pack.manifest.textTemplate;
	if (existing && typeof existing === "object") {
		return { tpl: existing, synthesizedFromScene: false };
	}
	const fromJson = readEmbeddedTextTemplateJson(pack);
	if (fromJson) {
		pack.manifest.textTemplate = fromJson;
		if (fromJson.postProcess && !pack.manifest.postProcess) {
			(pack.manifest as { postProcess?: unknown }).postProcess =
				fromJson.postProcess;
		}
		return { tpl: fromJson, synthesizedFromScene: false };
	}
	const synthesized = synthesizeTextTemplateFromScene(pack);
	if (synthesized) {
		pack.manifest.textTemplate = synthesized;
		if (synthesized.postProcess && !pack.manifest.postProcess) {
			(pack.manifest as { postProcess?: unknown }).postProcess =
				synthesized.postProcess;
		}
		return { tpl: synthesized, synthesizedFromScene: true };
	}
	return { tpl: null, synthesizedFromScene: false };
}

/**
 * fcc-tl-flower-61: (re)register virtual text-anim pack for a text-template.
 * Called on apply AND whenever the template pack is registered (refresh/builtin load),
 * so timeline textAnims.{in|out|loop}.packId keeps resolving after page reload.
 */
export function ensureEmbeddedTextAnimFromTemplatePack(
	pack: LoadedVfxPack,
): TextAnimAssignment | null {
	const { tpl } = resolveTextTemplatePayload(pack);
	if (!tpl) return null;

	const animRefsEarly = (
		tpl as {
			animRefs?: { in?: string | null; out?: string | null; loop?: string | null };
		} | null
	)?.animRefs;
	// Fast path: virtual pack already in registry (common after first ensure / each compose).
	if (!(animRefsEarly && (animRefsEarly.in || animRefsEarly.out || animRefsEarly.loop))) {
		const existingId = embeddedTextAnimPackId(pack.id);
		const existing = usePackRegistry.getState().getPack(existingId);
		const ta = existing?.manifest?.textAnim as
			| { category?: string; components?: unknown[] }
			| undefined;
		if (existing && ta && (Array.isArray(ta.components) ? ta.components.length > 0 : true)) {
			const catRaw = String(ta.category || "in").toLowerCase();
			const category = catRaw === "out" || catRaw === "loop" ? catRaw : "in";
			return { [category]: { packId: existingId } };
		}
	}

	const fxFromText =
		tpl.textFxStack &&
		typeof tpl.textFxStack === "object" &&
		Array.isArray(tpl.textFxStack.effects) &&
		tpl.textFxStack.effects.length
			? (tpl.textFxStack as Record<string, unknown>)
			: null;
	const fxFromPp =
		tpl.postProcess &&
		typeof tpl.postProcess === "object" &&
		Array.isArray(tpl.postProcess.effects) &&
		tpl.postProcess.effects.length
			? (tpl.postProcess as Record<string, unknown>)
			: null;
	const textFxStack = fxFromText || fxFromPp;

	const animRefs = animRefsEarly;
	const enrichedTextAnim = tpl.textAnim
		? enrichTextAnimWithPackTracks(pack, tpl.textAnim)
		: null;
	if (enrichedTextAnim) tpl.textAnim = enrichedTextAnim as typeof tpl.textAnim;
	if (!(enrichedTextAnim || animRefs)) return null;

	const registered = registerEmbeddedTextAnimPack({
		templatePackId: pack.id,
		displayName: pack.displayName || pack.id,
		textAnim: enrichedTextAnim || tpl.textAnim,
		animRefs: animRefs || null,
		postProcess:
			(textFxStack as import("@/vfxpack/text-anim-motion").TextAnimPackPayload["postProcess"] | null) ||
			null,
		background:
			(tpl as { background?: import("@/vfxpack/text-anim-motion").TextAnimPackPayload["background"] } | null)
				?.background || null,
		output:
			(tpl as { output?: import("@/vfxpack/text-anim-motion").TextAnimPackPayload["output"] } | null)?.output ||
			null,
	});
	return registered?.textAnims ?? null;
}

/**
 * Build apply payload from a loaded text-template pack.
 */
export function buildTextTemplateApply(pack: LoadedVfxPack): TextTemplateApplyResult {
	const { tpl, synthesizedFromScene } = resolveTextTemplatePayload(pack);
	const text = tpl?.text;
	const content =
		(typeof text?.content === "string" && text.content.length > 0
			? text.content
			: null) ||
		pack.displayName ||
		"Text template";

	const paramsPatch: Partial<ParamValues> = {};
	if (typeof text?.fontSize === "number") paramsPatch.fontSize = text.fontSize;
	if (typeof text?.color === "string") paramsPatch.color = text.color;
	if (typeof text?.letterSpacing === "number")
		paramsPatch.letterSpacing = text.letterSpacing;
	if (typeof text?.lineHeight === "number") paramsPatch.lineHeight = text.lineHeight;
	if (typeof text?.align === "string") paramsPatch.textAlign = text.align;
	{
		const rawFont = typeof text?.font === "string" ? text.font : "";
		const resolvedFont = remapFontPath(pack, rawFont || null);
		if (resolvedFont) paramsPatch.fontFamily = resolvedFont;
	}

	const flowerStyle =
		tpl?.flowerStyle && typeof tpl.flowerStyle === "object"
			? (remapDeepTexturePaths(pack, tpl.flowerStyle) as Record<
					string,
					unknown
				>)
			: null;
	const baseFs = Number(tpl?.flowerBaseFontSize);
	const stickers = upgradeStickersMaterialsFromScene(
		pack,
		remapStickerTextures(
			pack,
			tpl?.stickers as Array<Record<string, unknown>> | undefined,
		),
	);
	const mediaPlayers = remapMediaPlayers(
		pack,
		tpl?.mediaPlayers as Array<Record<string, unknown>> | undefined,
	);

	const fxFromText =
		tpl?.textFxStack &&
		typeof tpl.textFxStack === "object" &&
		Array.isArray(tpl.textFxStack.effects) &&
		tpl.textFxStack.effects.length
			? (tpl.textFxStack as Record<string, unknown>)
			: null;
	const fxFromPp =
		tpl?.postProcess &&
		typeof tpl.postProcess === "object" &&
		Array.isArray(tpl.postProcess.effects) &&
		tpl.postProcess.effects.length
			? (tpl.postProcess as Record<string, unknown>)
			: null;
	const textFxStack = fxFromText || fxFromPp;

	// fcc-tl-flower-61: shared ensure (also runs on pack register / refresh).
	const textAnims = ensureEmbeddedTextAnimFromTemplatePack(pack);

	// Scene prop meshes (Box/Cube) live in pack.scene — clip grafts them at build time.
	const sceneNodes = (pack.scene as { nodes?: Array<{ kind?: string; type?: string; name?: string; userData?: { fccUI?: unknown } }> } | null)?.nodes;
	let hasSceneProps = false;
	if (Array.isArray(sceneNodes)) {
		for (const n of sceneNodes) {
			if (n.kind !== "mesh" && n.type !== "Mesh" && n.type !== "SkinnedMesh") continue;
			const name = String(n.name || "");
			if (name.startsWith("__fcc")) continue;
			if (n.userData?.fccUI) continue;
			hasSceneProps = true;
			break;
		}
	}

	return {
		content,
		paramsPatch,
		flowerStyle,
		flowerBaseFontSize: baseFs > 0 ? baseFs : null,
		textTemplatePackId: pack.id,
		textStickers: stickers,
		textTemplateMediaPlayers: mediaPlayers,
		textFxStack,
		textAnims,
		hasFlower: !!flowerStyle,
		hasStickers: !!(stickers && stickers.length),
		hasMediaPlayers: !!(mediaPlayers && mediaPlayers.length),
		hasTextAnim: !!(tpl?.textAnim || textAnims),
		hasPostProcess: !!textFxStack,
		hasSceneProps,
		synthesizedFromScene,
	};
}

export function describeTextTemplateApply(a: TextTemplateApplyResult): string {
	const bits: string[] = ["Text content"];
	if (a.hasFlower) bits.push("flowerStyle");
	if (a.hasStickers) bits.push(`stickers×${a.textStickers!.length}`);
	if (a.hasMediaPlayers)
		bits.push(`media×${a.textTemplateMediaPlayers!.length}`);
	if (a.hasTextAnim) bits.push(a.textAnims ? "textAnim→Animation" : "textAnim");
	if (a.hasPostProcess) bits.push("postProcess→textFx");
	if (a.hasSceneProps) bits.push("scene props");
	if (a.synthesizedFromScene) bits.push("recovered from scene.json");
	return bits.join(" · ");
}

// fcc-tl-flower-61: refresh / builtin load re-registers text-template packs without
// re-running apply — re-bind ::embedded-textanim so saved textAnims packIds resolve.
onPackRegistered((pack) => {
	if (normalizeVfxPackType(pack.type) !== "text-template") return;
	ensureEmbeddedTextAnimFromTemplatePack(pack);
});
