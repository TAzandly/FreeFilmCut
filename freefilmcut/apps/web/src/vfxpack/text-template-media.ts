/**
 * Text-template MediaFramePlayer (fcc-tl-flower-38) → RT realtime on the clip timeline.
 * Mirrors pack-video prepare/seek/sync for players listed on a text-template
 * (no full scene videoPlayer nodes). Timeline owns mediaTime / playbackRate.
 */
import * as THREE from "three";
import type { LoadedVfxPack } from "@/vfxpack/types";
import {
	preparePackVideos,
	ensurePackRenderTargets,
	rebindPackRenderTextures,
	syncPackVideos,
	seekPackTimelineVideo,
	settlePackVideosForCapture,
	disposePackVideos,
} from "@/vfxpack/pack-video";
import { isUIText, getFccUI } from "@/vfxpack/ui-overlay";

export type TextTemplateMediaPlayerSpec = {
	uuid?: string;
	name?: string;
	kind?: string;
	path?: string;
	packPath?: string;
	objectUrl?: string;
	loop?: boolean;
	muted?: boolean;
	volume?: number;
	playbackRate?: number;
	autoplay?: boolean;
	targetUuid?: string;
	fileName?: string;
	sequenceFps?: number;
	sequenceDir?: string;
	sequenceStart?: number;
	sequenceEnd?: number;
	frameNames?: string[];
	frameObjectUrls?: Record<string, string>;
	rtWidth?: number;
	rtHeight?: number;
	rtWrapMode?: string;
};

const MEDIA_HOST = "__fccTplMediaHost";
const MEDIA_VIS_PREFIX = "__fccTplMediaVis_";

function findTextGroup(root: THREE.Object3D): THREE.Object3D | null {
	let found: THREE.Object3D | null = null;
	root.traverse((o) => {
		if (found) return;
		if (isUIText(o)) found = o;
	});
	return found;
}

function ensureUuidObject(
	root: THREE.Object3D,
	uuid: string,
	name: string,
): THREE.Object3D {
	let found: THREE.Object3D | null = null;
	root.traverse((o) => {
		if (found) return;
		if (o.uuid === uuid) found = o;
	});
	if (found) return found;
	const obj = new THREE.Object3D();
	obj.uuid = uuid;
	obj.name = name;
	root.add(obj);
	return obj;
}

function ensureMediaHost(root: THREE.Object3D): THREE.Object3D {
	let host = root.getObjectByName(MEDIA_HOST);
	if (host) return host;
	host = new THREE.Object3D();
	host.name = MEDIA_HOST;
	root.add(host);
	return host;
}

/**
 * Create player + RT objects under the flower root and decode gif/seq/video
 * from the source text-template pack (files / objectUrls).
 */

async function hydratePackMediaFiles(
	pack: LoadedVfxPack,
	mediaPlayers: TextTemplateMediaPlayerSpec[],
): Promise<void> {
	for (const raw of mediaPlayers) {
		const kind =
			raw.kind === "gif" || raw.kind === "imageSequence" ? raw.kind : "video";
		const packPath =
			(typeof raw.packPath === "string" && raw.packPath) ||
			(typeof raw.path === "string" && raw.path) ||
			"";
		if (!packPath) continue;
		if (kind === "imageSequence") {
			const dir = packPath.replace(/\\/g, "/").replace(/\/?$/, "");
			const names = Array.isArray(raw.frameNames) ? raw.frameNames : [];
			const urls = raw.frameObjectUrls || {};
			const list =
				names.length > 0
					? names
					: Object.keys(urls);
			for (const name of list) {
				const rel = (dir ? dir + "/" : "") + name;
				if (pack.files.has(rel) || pack.files.has("pack/" + rel)) continue;
				const url = urls[name] || pack.objectUrls.get(rel) || "";
				if (!url) continue;
				try {
					const res = await fetch(url);
					const buf = await res.arrayBuffer();
					pack.files.set(rel, new Uint8Array(buf));
				} catch {
					/* skip */
				}
			}
			continue;
		}
		if (pack.files.has(packPath) || pack.files.has("pack/" + packPath)) continue;
		const url =
			(typeof raw.objectUrl === "string" && raw.objectUrl) ||
			pack.objectUrls.get(packPath) ||
			"";
		if (!url) continue;
		try {
			const res = await fetch(url);
			const buf = await res.arrayBuffer();
			pack.files.set(packPath, new Uint8Array(buf));
		} catch {
			/* skip */
		}
	}
}

export async function prepareTextTemplateMediaOnRoot({
	root,
	pack,
	mediaPlayers,
}: {
	root: THREE.Object3D;
	pack: LoadedVfxPack;
	mediaPlayers: TextTemplateMediaPlayerSpec[] | null | undefined;
}): Promise<void> {
	if (!mediaPlayers?.length) return;
	const host = ensureMediaHost(root);
	const nodes: Array<{
		uuid: string;
		name: string;
		kind: string;
		video: Record<string, unknown>;
		userData: { fccVideoPlayer: Record<string, unknown> };
	}> = [];

	for (const raw of mediaPlayers) {
		const uuid =
			typeof raw.uuid === "string" && raw.uuid
				? raw.uuid
				: `tpl-media-${nodes.length}`;
		const kind =
			raw.kind === "gif" || raw.kind === "imageSequence" ? raw.kind : "video";
		const packPath =
			(typeof raw.packPath === "string" && raw.packPath) ||
			(typeof raw.path === "string" && raw.path) ||
			"";
		let targetUuid =
			typeof raw.targetUuid === "string" && raw.targetUuid
				? raw.targetUuid
				: `${uuid}_rt`;

		const player = ensureUuidObject(host, uuid, raw.name || "TplMediaPlayer");
		const rtObj = ensureUuidObject(host, targetUuid, `TplMediaRT_${uuid.slice(0, 8)}`);
		const existingRt = (rtObj.userData as {
			fccRenderTexture?: { width?: number; height?: number; wrapMode?: string };
		}).fccRenderTexture;
		const rtSpec = {
			width: Number(raw.rtWidth) > 0 ? Number(raw.rtWidth) : (existingRt?.width || 512),
			height: Number(raw.rtHeight) > 0 ? Number(raw.rtHeight) : (existingRt?.height || 512),
			wrapMode:
				(typeof raw.rtWrapMode === "string" && raw.rtWrapMode) ||
				existingRt?.wrapMode ||
				"clamp",
		};
		const wrapRaw = typeof rtSpec.wrapMode === "string" ? rtSpec.wrapMode : "clamp";
		const wrapMode =
			wrapRaw === "repeat" || wrapRaw === "mirroredRepeat" || wrapRaw === "clamp"
				? wrapRaw
				: "clamp";
		rtObj.userData.fccRenderTexture = {
			width: Math.min(4096, Math.max(16, Math.round(Number(rtSpec.width) || 512))),
			height: Math.min(4096, Math.max(16, Math.round(Number(rtSpec.height) || 512))),
			wrapMode,
		};

		const playbackRate = Number(raw.playbackRate);
		// Normalize seq dir (no trailing slash) so pack.files prefix scan + sticker
		// texturePackPath matching stay consistent with ensurePackSeqFrame rel keys.
		const seqDirRaw =
			kind === "imageSequence"
				? packPath || raw.sequenceDir || ""
				: raw.sequenceDir || "";
		const seqDir = String(seqDirRaw).replace(/\\/g, "/").replace(/\/$/, "");
		const frameNames = Array.isArray(raw.frameNames)
			? raw.frameNames.filter((n) => typeof n === "string" && n.length > 0)
			: [];
		const vp: Record<string, unknown> = {
			kind,
			path: kind === "imageSequence" ? (seqDir || packPath) : packPath,
			projectPath: kind === "imageSequence" ? (seqDir || packPath) : packPath,
			fileName: raw.fileName || "",
			targetUuid,
			loop: raw.loop !== false,
			muted: raw.muted === true,
			volume: Number.isFinite(Number(raw.volume)) ? Number(raw.volume) : 1,
			playbackRate:
				Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1,
			...(raw.autoplay !== undefined ? { autoplay: raw.autoplay === true } : {}),
			sequenceFps: Number(raw.sequenceFps) || 30,
			sequenceDir: seqDir,
			frameNames,
		};
		(player.userData as { fccVideoPlayer?: Record<string, unknown> }).fccVideoPlayer = {
			...((player.userData as { fccVideoPlayer?: Record<string, unknown> }).fccVideoPlayer ||
				{}),
			...vp,
		};

		nodes.push({
			uuid,
			name: player.name,
			kind: "videoPlayer",
			video: vp,
			userData: { fccVideoPlayer: vp },
		});
	}

	// Ensure gif/video bytes exist on pack.files (registry pack usually has them;
	// fall back to fetching remapped objectUrls when needed).
	await hydratePackMediaFiles(pack, mediaPlayers);

	await preparePackVideos({
		root,
		pack,
		nodes: nodes as unknown as import("@/vfxpack/types").VfxSceneNode[],
	});
	ensurePackRenderTargets(root);
	ensureMediaVisPlanes(root, mediaPlayers);
}

function ensureMediaVisRoot(text: THREE.Object3D): THREE.Object3D {
	let vis = text.getObjectByName("__fccTplMediaVisRoot");
	if (!vis) {
		vis = new THREE.Group();
		vis.name = "__fccTplMediaVisRoot";
		text.add(vis);
	}
	// First child = drawn behind siblings in overlay (depthTest off still uses order).
	const idx = text.children.indexOf(vis);
	if (idx > 0) {
		text.children.splice(idx, 1);
		text.children.unshift(vis);
	}
	return vis;
}

function rtUuidFromMapPath(path: unknown): string {
	const raw = typeof path === "string" ? path : "";
	if (!raw) return "";
	const m = /^rt:(.+)$/i.exec(raw.trim());
	return m ? m[1] : "";
}

/** RTs sampled by stickers OR flowerStyle texture fills (`rt:` / fccRtSlots). */
function collectStickerOwnedRtUuids(root: THREE.Object3D): Set<string> {
	const owned = new Set<string>();
	const add = (u: string) => {
		if (u) owned.add(u);
	};
	const addRtPath = (path: unknown) => {
		add(rtUuidFromMapPath(path));
	};
	const walkFlowerContent = (content: unknown) => {
		if (!content || typeof content !== "object") return;
		const c = content as { renderType?: string; texture?: { path?: string } };
		if (c.renderType === "texture") addRtPath(c.texture?.path);
	};
	const walkFlowerStyle = (style: unknown) => {
		if (!style || typeof style !== "object") return;
		const s = style as Record<string, unknown>;
		const fill = s.fill as { content?: unknown } | undefined;
		walkFlowerContent(fill?.content);
		for (const key of ["strokes", "shadows", "innerShadows", "stack"] as const) {
			const list = s[key];
			if (!Array.isArray(list)) continue;
			for (const layer of list) {
				if (!layer || typeof layer !== "object") continue;
				const L = layer as { content?: unknown; strokes?: unknown[] };
				walkFlowerContent(L.content);
				if (Array.isArray(L.strokes)) {
					for (const st of L.strokes) {
						if (st && typeof st === "object") {
							walkFlowerContent((st as { content?: unknown }).content);
						}
					}
				}
			}
		}
	};
	root.traverse((o) => {
		if (!isUIText(o)) return;
		const ui = getFccUI(o) as {
			flowerStyle?: unknown;
			textStickers?: Array<{
				enabled?: boolean;
				rtTargetUuid?: string;
				materialUuid?: string;
			}>;
		} | null;
		walkFlowerStyle(ui?.flowerStyle);
		const list = ui?.textStickers;
		if (Array.isArray(list)) {
			for (const s of list) {
				if (!s || s.enabled === false) continue;
				add(typeof s.rtTargetUuid === "string" ? s.rtTargetUuid : "");
				const tp = (s as { texturePath?: string }).texturePath;
				addRtPath(tp);
			}
		}
	});
	// Mesh path: shared ShaderMaterial map is authored as rt:{uuid} (hello pack has
	// no sticker.rtTargetUuid). Also flower Troika materials stamp fccRtSlots for
	// uFccTex — treat those RTs as owned so ensureMediaVisPlanes does not draw a
	// full-text GIF quad on top of the flower fill.
	root.traverse((o) => {
		const ud = o.userData as {
			__fccTextSticker?: boolean;
			__fccStickerData?: { rtTargetUuid?: string };
		};
		if (ud?.__fccTextSticker) {
			add(
				typeof ud.__fccStickerData?.rtTargetUuid === "string"
					? ud.__fccStickerData.rtTargetUuid
					: "",
			);
		}
		const mesh = o as THREE.Mesh;
		const mats = Array.isArray(mesh.material)
			? mesh.material
			: mesh.material
				? [mesh.material]
				: [];
		for (const mat of mats) {
			if (!mat) continue;
			const slots = (mat.userData as { fccRtSlots?: Array<{ uuid?: string }> })
				?.fccRtSlots;
			if (Array.isArray(slots)) {
				for (const slot of slots) add(typeof slot?.uuid === "string" ? slot.uuid : "");
			}
			if (!ud?.__fccTextSticker) continue;
			const mapPath =
				(mat.userData as { __fccMapPath?: string })?.__fccMapPath ||
				(typeof (mat as { userData?: { fccTexturePath?: string } }).userData
					?.fccTexturePath === "string"
					? (mat as { userData: { fccTexturePath: string } }).userData.fccTexturePath
					: "");
			add(rtUuidFromMapPath(mapPath));
		}
	});
	return owned;
}

function ensureMediaVisPlanes(
	root: THREE.Object3D,
	mediaPlayers: TextTemplateMediaPlayerSpec[],
): void {
	const text = findTextGroup(root);
	if (!text) return;
	const visRoot = ensureMediaVisRoot(text);
	// fcc-tl-flower-21: editor shows seq/gif via sticker map→RT only. Auto vis
	// planes for sticker-owned RTs stacked full-text quads and hid/froze playback.
	const stickerOwnedRt = collectStickerOwnedRtUuids(root);

	const rtByUuid = new Map<string, THREE.WebGLRenderTarget>();
	root.traverse((o) => {
		const rt = (o.userData as { __fccRT?: THREE.WebGLRenderTarget }).__fccRT;
		if (rt) rtByUuid.set(o.uuid, rt);
	});

	// Drop stale vis meshes for sticker-owned targets.
	for (let i = visRoot.children.length - 1; i >= 0; i--) {
		const child = visRoot.children[i];
		const tu = String(child.userData?.__fccTplMediaTarget || "");
		if (tu && stickerOwnedRt.has(tu)) {
			visRoot.remove(child);
			const mesh = child as THREE.Mesh;
			mesh.geometry?.dispose?.();
			const mat = mesh.material as THREE.Material | THREE.Material[];
			const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
			for (const m of mats) m?.dispose?.();
		}
	}

	for (const raw of mediaPlayers) {
		const uuid =
			typeof raw.uuid === "string" && raw.uuid ? raw.uuid : "";
		if (!uuid) continue;
		const targetUuid =
			typeof raw.targetUuid === "string" && raw.targetUuid
				? raw.targetUuid
				: `${uuid}_rt`;
		if (stickerOwnedRt.has(targetUuid)) continue;
		const rt = rtByUuid.get(targetUuid);
		if (!rt) continue;
		const name = MEDIA_VIS_PREFIX + uuid;
		let mesh = visRoot.getObjectByName(name) as THREE.Mesh | null;
		if (!mesh) {
			const mat = new THREE.MeshBasicMaterial({
				map: rt.texture,
				transparent: true,
				opacity: 1,
				depthTest: false,
				depthWrite: false,
				toneMapped: false,
				side: THREE.DoubleSide,
			});
			mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
			mesh.name = name;
			mesh.renderOrder = -10000;
			mesh.userData.__fccTplMediaVis = uuid;
			mesh.userData.__fccTplMediaTarget = targetUuid;
			visRoot.add(mesh);
		} else {
			const mat = mesh.material as THREE.MeshBasicMaterial;
			if (mat.map !== rt.texture) {
				mat.map = rt.texture;
				mat.needsUpdate = true;
			}
		}
	}
}

/**
 * Timeline-driven seek + blit into RTs. Call each flowerText frame.
 * Also sizes media vis planes to the whole-text AABB (char=all contract).
 */
function seekAllTextTemplateMedia({
	root,
	mediaTimeSec,
	playing,
	clipKey,
	precise,
}: {
	root: THREE.Object3D;
	mediaTimeSec: number;
	playing?: boolean;
	clipKey?: string;
	precise?: boolean;
}): void {
	// Seek every attached gif/seq/video on the flower root (not only host children).
	// Ensures __fccMediaTime advances even if a player was parented outside MEDIA_HOST.
	root.traverse((obj) => {
		const ud = obj.userData as {
			__fccVideo?: HTMLVideoElement;
			__fccMediaCache?: unknown;
			fccVideoPlayer?: { loop?: boolean };
		};
		if (!ud.__fccVideo && !ud.__fccMediaCache) return;
		seekPackTimelineVideo(obj, mediaTimeSec, {
			loop: ud.fccVideoPlayer?.loop !== false,
			playing: playing === true,
			clipKey: clipKey || "",
			precise: precise === true,
		});
	});
}

export function driveTextTemplateMedia({
	renderer,
	root,
	mediaTimeSec,
	playing,
	clipKey,
}: {
	renderer: THREE.WebGLRenderer;
	root: THREE.Object3D;
	mediaTimeSec: number;
	playing?: boolean;
	clipKey?: string;
}): void {
	const host = root.getObjectByName(MEDIA_HOST);
	if (!host) return;

	seekAllTextTemplateMedia({ root, mediaTimeSec, playing, clipKey });

	ensurePackRenderTargets(root);
	// fcc-tl-flower-55: sync returns whether any RT was rewritten — skip rebind spam.
	// fcc-tl-flower-56: still skip unchanged GPU blits inside syncPackVideos, but
	// always rebind (needsUpdate only when slot texture actually changes) so
	// shader/sprite stickers keep live RT maps after applyTextStickers.
	syncPackVideos(renderer, root, mediaTimeSec, { driveTransport: false });
	rebindPackRenderTextures(root);
	layoutMediaVisPlanes(root);
}

/**
 * Export path: force video seeks, await seeked, then blit (gif/seq already sync).
 * Preview keeps the sync driveTextTemplateMedia above.
 */
export async function driveTextTemplateMediaForExport({
	renderer,
	root,
	mediaTimeSec,
	clipKey,
}: {
	renderer: THREE.WebGLRenderer;
	root: THREE.Object3D;
	mediaTimeSec: number;
	clipKey?: string;
}): Promise<void> {
	const host = root.getObjectByName(MEDIA_HOST);
	if (!host) return;

	seekAllTextTemplateMedia({
		root,
		mediaTimeSec,
		playing: false,
		clipKey,
		precise: true,
	});
	ensurePackRenderTargets(root);
	await settlePackVideosForCapture(renderer, root, mediaTimeSec);
	layoutMediaVisPlanes(root);
}

function layoutMediaVisPlanes(root: THREE.Object3D): void {
	const text = findTextGroup(root);
	if (!text) return;
	const visRoot = text.getObjectByName("__fccTplMediaVisRoot");
	if (!visRoot) return;
	// fcc-tl-flower-26: drop AABB vis for sticker-owned RTs every frame (prepare
	// may have created them before stickers stamped rtTargetUuid / materials).
	const stickerOwnedRt = collectStickerOwnedRtUuids(root);
	let removedOwned = false;
	for (let i = visRoot.children.length - 1; i >= 0; i--) {
		const child = visRoot.children[i];
		const tu = String(child.userData?.__fccTplMediaTarget || "");
		if (tu && stickerOwnedRt.has(tu)) {
			visRoot.remove(child);
			const mesh = child as THREE.Mesh;
			mesh.geometry?.dispose?.();
			const mat = mesh.material as THREE.Material | THREE.Material[];
			const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
			for (const m of mats) m?.dispose?.();
			removedOwned = true;
		}
	}
	const ui = getFccUI(text);
	const fs = ui && Number((ui as { fontSize?: number }).fontSize) > 0
		? Number((ui as { fontSize?: number }).fontSize)
		: 48;
	let w = fs * 4;
	let h = fs * 1.2;
	const sizeDelta = (ui as { sizeDelta?: number[] } | null)?.sizeDelta;
	if (Array.isArray(sizeDelta) && sizeDelta.length >= 2) {
		w = Math.max(1, Number(sizeDelta[0]) || w);
		h = Math.max(1, Number(sizeDelta[1]) || h);
	}
	text.traverse((o) => {
		const any = o as THREE.Object3D & {
			textRenderInfo?: { visibleBounds?: number[] };
		};
		const vb = any.textRenderInfo?.visibleBounds;
		if (vb && vb.length >= 4) {
			w = Math.max(0.001, vb[2] - vb[0]);
			h = Math.max(0.001, vb[3] - vb[1]);
		}
	});

	// fcc-tl-flower-55: skip scale/matrix work when AABB + child count unchanged.
	const layoutUd = visRoot.userData as {
		__fccTplVisLayoutSig?: string;
	};
	const sig = `${visRoot.children.length}|${w.toFixed(2)}|${h.toFixed(2)}`;
	if (!removedOwned && layoutUd.__fccTplVisLayoutSig === sig) return;
	layoutUd.__fccTplVisLayoutSig = sig;

	const idx = text.children.indexOf(visRoot);
	if (idx > 0) {
		text.children.splice(idx, 1);
		text.children.unshift(visRoot);
	}

	let i = 0;
	for (const child of visRoot.children) {
		if (!child.userData?.__fccTplMediaVis) continue;
		child.visible = true;
		child.position.set(0, 0, -0.6 - i * 0.001);
		child.scale.set(w, h, 1);
		child.updateMatrix();
		i++;
	}
}

/** Refresh sticker sprite maps when a sticker texturePackPath matches a live gif/seq player. */
export function bindLiveMediaToStickers({
	root,
}: {
	root: THREE.Object3D;
}): void {
	const host = root.getObjectByName(MEDIA_HOST);
	if (!host) return;
	const liveByPath = new Map<string, THREE.Texture>();
	const liveByRt = new Map<string, THREE.Texture>();
	// Live RT textures (seq/gif blit target) — stickers with rtTargetUuid bind here.
	root.traverse((obj) => {
		const rt = (obj.userData as { __fccRT?: THREE.WebGLRenderTarget }).__fccRT;
		if (rt) liveByRt.set(obj.uuid, rt.texture);
	});
	host.traverse((obj) => {
		const ud = obj.userData as {
			__fccMediaCache?: { texture?: THREE.Texture };
			__fccVideoTexture?: THREE.VideoTexture;
			fccVideoPlayer?: {
				path?: string;
				projectPath?: string;
				kind?: string;
				targetUuid?: string;
			};
		};
		const pathRaw = String(
			ud.fccVideoPlayer?.path || ud.fccVideoPlayer?.projectPath || "",
		);
		const tu = ud.fccVideoPlayer?.targetUuid
			? String(ud.fccVideoPlayer.targetUuid)
			: "";
		// Editor contract: stickers / shader map sample the RT after blit.
		// Keep canvas as fallback only when RT is missing.
		const rtTex = tu ? liveByRt.get(tu) || null : null;
		const canvasTex = ud.__fccMediaCache?.texture || ud.__fccVideoTexture || null;
		const tex = rtTex || canvasTex || null;
		if (!tex) return;
		if (pathRaw) {
			const path = pathRaw.replace(/\\/g, "/").replace(/\/$/, "");
			liveByPath.set(path.replace(/^pack\//, ""), tex);
			liveByPath.set(path, tex);
			liveByPath.set(path + "/", tex);
			liveByPath.set(path.replace(/^pack\//, "") + "/", tex);
		}
		if (tu) liveByPath.set("rt:" + tu, rtTex || tex);
	});
	if (!liveByPath.size && !liveByRt.size) return;

	root.traverse((obj) => {
		const ud = obj.userData as {
			__fccTextSticker?: boolean;
			__fccStickerData?: {
				texturePackPath?: string;
				texturePath?: string;
				rtTargetUuid?: string;
			};
		};
		if (!ud.__fccTextSticker || !ud.__fccStickerData) return;
		const packPathRaw = String(
			ud.__fccStickerData.texturePackPath || "",
		);
		const packPath = packPathRaw.replace(/\\/g, "/").replace(/\/$/, "");
		const texPath = String(ud.__fccStickerData.texturePath || "");
		const rtFromPath = texPath.startsWith("rt:") ? texPath.slice(3) : "";
		const rtUuid = String(
			ud.__fccStickerData.rtTargetUuid || rtFromPath || "",
		);
		// fcc-tl-flower-21: prefer RT (editor seek→sample→blit→RT→fccRtSlots),
		// not canvas-first — material stickers are authored as map: rt:{uuid}.
		const tex =
			(rtUuid && liveByRt.get(rtUuid)) ||
			(rtUuid && liveByPath.get("rt:" + rtUuid)) ||
			(packPath && liveByPath.get(packPath.replace(/^pack\//, ""))) ||
			(packPath && liveByPath.get(packPath)) ||
			(packPath && liveByPath.get(packPath + "/")) ||
			(packPathRaw && liveByPath.get(packPathRaw)) ||
			null;
	if (!tex) return;
		const mesh = obj as THREE.Mesh;
		const mats = Array.isArray(mesh.material)
			? mesh.material
			: mesh.material
				? [mesh.material]
				: [];
		for (const mat of mats) {
			if (!mat) continue;
			const anyMat = mat as THREE.MeshBasicMaterial & {
				map?: THREE.Texture | null;
				uniforms?: Record<string, { value: unknown }>;
			};
			// fcc-tl-flower-56: sprite stickers get white placeholder from
			// applyTextStickers every frame — always restore RT and keep
			// transparent so GIF/RT alpha (and packed-alpha video shaders) blend.
			let touched = false;
			if ("map" in anyMat && anyMat.map !== tex) {
				anyMat.map = tex;
				touched = true;
			}
			if (!anyMat.transparent) {
				anyMat.transparent = true;
				touched = true;
			}
			const uni = anyMat.uniforms;
			if (uni) {
				if (uni.map && uni.map.value !== tex) {
					uni.map.value = tex;
					touched = true;
				}
				if (uni.useMap && uni.useMap.value !== true) {
					uni.useMap.value = true;
					touched = true;
				}
			}
			if (touched) anyMat.needsUpdate = true;
			// fccRtSlots for shader materials: rebindPackRenderTextures in drive.
		}

	});
}

export function disposeTextTemplateMedia(root: THREE.Object3D): void {
	disposePackVideos(root);
	const host = root.getObjectByName(MEDIA_HOST);
	if (host) {
		host.traverse((o) => {
			const rt = (o.userData as { __fccRT?: THREE.WebGLRenderTarget }).__fccRT;
			if (rt) {
				rt.dispose();
				delete (o.userData as { __fccRT?: THREE.WebGLRenderTarget }).__fccRT;
			}
		});
		host.parent?.remove(host);
	}
}
