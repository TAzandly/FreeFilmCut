/**
 * vfxpack VideoPlayer → RenderTexture.
 * Timeline video tracks own seek when present; else MediaPlayer.autoplay self-clocks on clip local time (fcc-tl-flower-38).
 * Sound follows timeline playback: playing unmutes and lets the element run,
 * scrubbing seeks a still frame with audio paused.
 * fcc-tl-flower-53: muted autoplay still free-runs (mute ≠ pause); seeked re-seek
 * uses play drift (0.2s) not scrub epsilon so async seeks do not cascade stutter.
 * fcc-tl-flower-54: when NLE transport stops, pause ALL live pack videos (autoplay /
 * no-timeline players keep element.play() otherwise — including off-screen packs).
 * fcc-tl-flower-55: preview perf — skip unchanged video/gif→RT blits; rebind without
 * material.needsUpdate spam; throttle scrub seeks; keep last-good RT while seeking.
 * fcc-tl-flower-56: restore RT alpha — never gate bindLiveMedia; stickers were left on
 * whiteTexture (opaque) when blit-skip skipped the rebind/bind path.
 * fcc-tl-flower-57: editor-timeline parity — continuous media time while NLE playing;
 * preview coalesce so slow flower/PP frames do not drop the next tick.
 * fcc-tl-flower-58: after play ends / idle pause — stop seek storms + audible
 * 咔咔. Mute on transport stop; idle writes ZERO currentTime; scrub may seek
 * (throttled, muted); seeked never re-chases while idle.
 * fcc-tl-flower-68: out-of-frame pack parking — a pack whose NLE clip is not
 * drawn this frame has its videos paused (see pausePackSceneVideos); previously
 * they free-ran to media end after the playhead left the clip.
 */
import * as THREE from "three";
import type { LoadedVfxPack, VfxSceneNode } from "@/vfxpack/types";
import { bumpFlowerTextFrameEpoch } from "@/vfxpack/flower-text-epoch";

type RtSlot = { key: string; uuid: string };

type PreviewState = {
	playing: boolean;
	/** True while user is dragging the playhead (scrub). Idle pause must not seek-storm. */
	scrubbing: boolean;
	volume: number;
	/** Continuous timeline seconds while playing (editor tVideo). */
	timelineSec: number;
	/** Frame-snapped timeline seconds (NLE display clock). */
	timelineSecSnapped: number;
};

let previewState: PreviewState = {
	playing: false,
	scrubbing: false,
	volume: 1,
	timelineSec: 0,
	timelineSecSnapped: 0,
};

/** Bumps when a paused Timeline seek settles so preview can re-blit the same frame. */
let packVideoFrameEpoch = 0;

export function getPackVideoFrameEpoch(): number {
	return packVideoFrameEpoch;
}

function markPackVideoFrameReady(): void {
	packVideoFrameEpoch += 1;
	// OpenCut may skip same-playhead redraws; flower epoch wakes preview after async seq/gif upload.
	bumpFlowerTextFrameEpoch();
}

const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
/** MeshBasic+NoBlending = RGBA copy; skips OPAQUE a=1; samples Video/Canvas correctly. */
const blitMat = new THREE.MeshBasicMaterial({
	map: null,
	depthTest: false,
	depthWrite: false,
	toneMapped: false,
	transparent: true,
	blending: THREE.NoBlending,
});
const blitMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMat);
const blitScene = new THREE.Scene();
blitScene.add(blitMesh);


/** Sequence LRU window (mirrors editor FccMediaFrame). */
const SEQ_LRU_AHEAD = 12;
const SEQ_LRU_BEHIND = 4;
const SEQ_LRU_MAX = 24;
const GIF_FULL_DECODE_MAX = 120;
/** Decode whole sequence at prepare when small (hello=50) — sync sample like gif full mode. */
const SEQ_FULL_DECODE_MAX = 120;
const GIF_LRU_MAX = 64;

type MediaKind = "video" | "gif" | "imageSequence";

function packMediaKind(
	vp: { kind?: string } | undefined,
	cache?: FrameCache | null,
): MediaKind {
	if (vp?.kind === "gif" || vp?.kind === "imageSequence") return vp.kind;
	// Infer from attached cache when fccVideoPlayer.kind was dropped on rewrite.
	if (cache?.names && cache.names.length) return "imageSequence";
	if (cache && (cache.mode === "full" || (cache.delays && cache.delays.length)))
		return "gif";
	return "video";
}

function packPlaybackRate(vp: { playbackRate?: number } | undefined): number {
	let r = vp != null ? Number(vp.playbackRate) : 1;
	if (!Number.isFinite(r) || r <= 0) r = 1;
	return Math.min(16, Math.max(0.05, r));
}

/** Explicit false => off. Missing (legacy packs) => on so clip-local drive still works. */
function packAutoplayEnabled(vp: { autoplay?: boolean } | undefined): boolean {
	if (!vp || vp.autoplay === undefined) return true;
	return vp.autoplay === true;
}

type FrameCache = {
	mode: "full" | "lru";
	frameCount: number;
	delays: number[];
	durationSec: number;
	frames?: ImageBitmap[];
	lru: Map<number, ImageBitmap>;
	inflight: Map<number, Promise<ImageBitmap | null>>;
	decoder?: ImageDecoder;
	names?: string[];
	fps?: number;
	dirRel?: string;
	pack?: LoadedVfxPack;
	canvas?: HTMLCanvasElement;
	texture?: THREE.CanvasTexture;
	uploadedIndex?: number;
	gen: number;
};

function ensurePackFrameTexture(cache: FrameCache, w: number, h: number): THREE.CanvasTexture {
	if (!cache.canvas) cache.canvas = document.createElement("canvas");
	if (cache.canvas.width !== w || cache.canvas.height !== h) {
		cache.canvas.width = w;
		cache.canvas.height = h;
	}
	if (!cache.texture) {
		cache.texture = new THREE.CanvasTexture(cache.canvas);
		cache.texture.colorSpace = THREE.SRGBColorSpace;
		cache.texture.minFilter = THREE.LinearFilter;
		cache.texture.magFilter = THREE.LinearFilter;
		cache.texture.generateMipmaps = false;
		cache.texture.flipY = true;
		cache.texture.premultipliedAlpha = false;
		cache.texture.format = THREE.RGBAFormat;
	}
	return cache.texture;
}

function uploadPackBitmap(cache: FrameCache, bitmap: ImageBitmap, index: number): THREE.CanvasTexture {
	const tex = ensurePackFrameTexture(cache, bitmap.width || 1, bitmap.height || 1);
	const ctx = cache.canvas!.getContext("2d", { alpha: true })!;
	ctx.save();
	ctx.globalCompositeOperation = "copy";
	ctx.clearRect(0, 0, cache.canvas!.width, cache.canvas!.height);
	ctx.drawImage(bitmap, 0, 0, cache.canvas!.width, cache.canvas!.height);
	ctx.restore();
	tex.needsUpdate = true;
	cache.uploadedIndex = index;
	return tex;
}

async function decodePackGif(buffer: ArrayBuffer): Promise<FrameCache | null> {
	if (typeof ImageDecoder === "undefined") return null;
	try {
		const decoder = new ImageDecoder({ data: buffer, type: "image/gif" });
		await decoder.tracks.ready;
		const track = decoder.tracks.selectedTrack || decoder.tracks[0];
		if (!track || !track.frameCount) return null;
		const frameCount = track.frameCount;
		const delays: number[] = [];
		const full = frameCount <= GIF_FULL_DECODE_MAX;
		const frames: ImageBitmap[] | undefined = full ? [] : undefined;
		for (let i = 0; i < frameCount; i++) {
			const result = await decoder.decode({ frameIndex: i });
			const delayUs = Number(result.image.duration) || 100000;
			delays.push(Math.max(10, delayUs / 1000));
			if (full) {
				frames!.push(await createImageBitmap(result.image, { premultiplyAlpha: "none" }).catch(() => createImageBitmap(result.image)));
				result.image.close();
			} else {
				result.image.close();
			}
		}
		let durationSec = delays.reduce((a, b) => a + b, 0) / 1000;
		if (!(durationSec > 0)) durationSec = frameCount / 10;
		if (full) {
			decoder.close?.();
			return { mode: "full", frameCount, delays, durationSec, frames, lru: new Map(), inflight: new Map(), gen: 0 };
		}
		return { mode: "lru", frameCount, delays, durationSec, lru: new Map(), inflight: new Map(), decoder, gen: 0 };
	} catch (e) {
		console.warn("[vfxpack] gif decode", e);
		return null;
	}
}

function gifIndexAt(cache: FrameCache, t: number, loop: boolean): number {
	let time = t;
	const dur = cache.durationSec || 1;
	if (loop) time = ((time % dur) + dur) % dur;
	else time = Math.max(0, Math.min(dur - 1e-4, time));
	let acc = 0;
	for (let i = 0; i < cache.frameCount; i++) {
		acc += (cache.delays[i] || 100) / 1000;
		if (time < acc) return i;
	}
	return Math.max(0, cache.frameCount - 1);
}

function seqIndexAt(cache: FrameCache, t: number, loop: boolean): number {
	const n = cache.frameCount || 0;
	if (!n) return 0;
	const fps = cache.fps || 30;
	const dur = n / fps;
	let time = t;
	if (loop) time = ((time % dur) + dur) % dur;
	else time = Math.max(0, Math.min(dur - 1e-6, time));
	let idx = Math.floor(time * fps);
	if (loop) idx = ((idx % n) + n) % n;
	else idx = Math.max(0, Math.min(n - 1, idx));
	return idx;
}

async function ensurePackGifFrame(cache: FrameCache, index: number): Promise<ImageBitmap | null> {
	if (cache.mode === "full" && cache.frames) return cache.frames[index] || null;
	if (cache.lru.has(index)) {
		const b = cache.lru.get(index)!;
		cache.lru.delete(index);
		cache.lru.set(index, b);
		return b;
	}
	if (cache.inflight.has(index)) return cache.inflight.get(index)!;
	if (!cache.decoder) return null;
	const p = (async () => {
		try {
			const result = await cache.decoder!.decode({ frameIndex: index });
			const bitmap = await createImageBitmap(result.image, { premultiplyAlpha: "none" }).catch(() => createImageBitmap(result.image));
			result.image.close();
			while (cache.lru.size >= GIF_LRU_MAX) {
				const oldest = cache.lru.keys().next().value as number;
				const old = cache.lru.get(oldest);
				cache.lru.delete(oldest);
				old?.close?.();
			}
			cache.lru.set(index, bitmap);
			markPackVideoFrameReady();
			return bitmap;
		} catch (e) {
			console.warn("[vfxpack] gif frame", index, e);
			return null;
		} finally {
			cache.inflight.delete(index);
		}
	})();
	cache.inflight.set(index, p);
	return p;
}

const _seqMissWarned = new Set<string>();

function lookupPackSeqBytes(
	pack: LoadedVfxPack,
	dirRel: string,
	name: string,
): Uint8Array | null {
	const dir = dirRel.replace(/\\/g, "/").replace(/\/$/, "");
	const candidates = [
		dir + "/" + name,
		"pack/" + dir + "/" + name,
		name,
		"pack/" + name,
	];
	for (const key of candidates) {
		const hit = pack.files.get(key);
		if (hit) return hit;
	}
	const lowerName = name.toLowerCase();
	for (const [key, bytes] of pack.files) {
		const norm = key.replace(/\\/g, "/");
		if (norm.endsWith("/" + name) || norm.toLowerCase().endsWith("/" + lowerName)) {
			return bytes;
		}
		if (norm === name || norm.toLowerCase() === lowerName) return bytes;
	}
	return null;
}

function lookupPackSeqUrl(
	pack: LoadedVfxPack,
	dirRel: string,
	name: string,
): string {
	const dir = dirRel.replace(/\\/g, "/").replace(/\/$/, "");
	const candidates = [
		dir + "/" + name,
		"pack/" + dir + "/" + name,
		name,
		"pack/" + name,
	];
	for (const key of candidates) {
		const url = pack.objectUrls.get(key);
		if (url) return url;
	}
	const lowerName = name.toLowerCase();
	for (const [key, url] of pack.objectUrls) {
		const norm = key.replace(/\\/g, "/");
		if (norm.endsWith("/" + name) || norm.toLowerCase().endsWith("/" + lowerName)) {
			return url;
		}
	}
	return "";
}

async function ensurePackSeqFrame(cache: FrameCache, index: number): Promise<ImageBitmap | null> {
	if (cache.mode === "full" && cache.frames?.[index]) return cache.frames[index];
	if (cache.lru.has(index)) {
		const b = cache.lru.get(index)!;
		cache.lru.delete(index);
		cache.lru.set(index, b);
		return b;
	}
	if (cache.inflight.has(index)) return cache.inflight.get(index)!;
	const name = cache.names?.[index];
	const pack = cache.pack;
	if (!name || !pack || !cache.dirRel) {
		const missKey = "meta:" + (cache.dirRel || "") + ":" + index;
		if (!_seqMissWarned.has(missKey)) {
			_seqMissWarned.add(missKey);
			console.warn("[vfxpack] seq sample miss (meta)", {
				index,
				name: name || null,
				dirRel: cache.dirRel || null,
				hasPack: !!pack,
			});
		}
		return null;
	}
	const rel = cache.dirRel.replace(/\/$/, "") + "/" + name;
	const p = (async () => {
		try {
			let bytes = lookupPackSeqBytes(pack, cache.dirRel!, name);
			if (!bytes) {
				const url = lookupPackSeqUrl(pack, cache.dirRel!, name);
				if (url) {
					const res = await fetch(url);
					if (res.ok) {
						bytes = new Uint8Array(await res.arrayBuffer());
						pack.files.set(rel, bytes);
					}
				}
			}
			if (!bytes) {
				const missKey = "bytes:" + rel;
				if (!_seqMissWarned.has(missKey)) {
					_seqMissWarned.add(missKey);
					console.warn("[vfxpack] seq sample miss (decode/bytes)", {
						index,
						rel,
						filesHas: pack.files.has(rel),
						urlsHas: pack.objectUrls.has(rel),
					});
				}
				return null;
			}
			const lower = name.toLowerCase();
			const mime = lower.endsWith(".jpg") || lower.endsWith(".jpeg")
				? "image/jpeg"
				: lower.endsWith(".webp")
					? "image/webp"
					: lower.endsWith(".gif")
						? "image/gif"
						: lower.endsWith(".bmp")
							? "image/bmp"
							: "image/png";
			const blob = new Blob([bytes.slice()], { type: mime });
			const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "none" }).catch(() =>
				createImageBitmap(blob),
			);
			while (cache.lru.size >= SEQ_LRU_MAX) {
				let farKey: number | null = null;
				let farDist = -1;
				for (const key of cache.lru.keys()) {
					const dist = Math.abs(key - index);
					if (dist > farDist) {
						farDist = dist;
						farKey = key;
					}
				}
				if (farKey == null) break;
				const old = cache.lru.get(farKey);
				cache.lru.delete(farKey);
				old?.close?.();
			}
			cache.lru.set(index, bitmap);
			markPackVideoFrameReady();
			return bitmap;
		} catch (e) {
			const missKey = "decode:" + rel;
			if (!_seqMissWarned.has(missKey)) {
				_seqMissWarned.add(missKey);
				console.warn("[vfxpack] seq sample miss (decode)", { index, rel, e });
			}
			return null;
		} finally {
			cache.inflight.delete(index);
		}
	})();
	cache.inflight.set(index, p);
	return p;
}
function samplePackMediaTexture(
	ud: { __fccMediaCache?: FrameCache; __fccMediaTime?: number | null; __fccMediaActive?: boolean; fccVideoPlayer?: { kind?: string; loop?: boolean; playbackRate?: number } },
	opts?: { loop?: boolean },
): THREE.Texture | null {
	const cache = ud.__fccMediaCache;
	if (!cache || ud.__fccMediaActive === false) return null;
	const t = ud.__fccMediaTime;
	if (t == null || !Number.isFinite(t)) return null;
	const loop = opts?.loop ?? ud.fccVideoPlayer?.loop !== false;
	const kind = packMediaKind(ud.fccVideoPlayer, cache);
	const sampleT = t * packPlaybackRate(ud.fccVideoPlayer);
	const index = kind === "gif" ? gifIndexAt(cache, sampleT, loop) : seqIndexAt(cache, sampleT, loop);
	if (kind === "gif") {
		if (cache.mode === "full" && cache.frames?.[index]) {
			if (cache.uploadedIndex !== index) uploadPackBitmap(cache, cache.frames[index], index);
			return cache.texture || null;
		}
		void ensurePackGifFrame(cache, index).then((b) => {
			if (b && ud.__fccMediaCache === cache) {
				uploadPackBitmap(cache, b, index);
				markPackVideoFrameReady();
			}
		});
		if (cache.lru.has(index)) {
			if (cache.uploadedIndex !== index) uploadPackBitmap(cache, cache.lru.get(index)!, index);
			return cache.texture || null;
		}
		return cache.texture || null;
	}
	// sequence: warm full-decode and/or LRU prefetch (fcc-tl-flower-21 / editor contract)
	const n = cache.frameCount || 0;
	if (!n) {
		if (!_seqMissWarned.has("empty-frames")) {
			_seqMissWarned.add("empty-frames");
			console.warn("[vfxpack] seq sample miss (empty frames)", { time: t, kind });
		}
		return cache.texture || null;
	}
	if (cache.mode === "full" && cache.frames) {
		const bmp = cache.frames[index];
		if (bmp) {
			if (cache.uploadedIndex !== index) {
				uploadPackBitmap(cache, bmp, index);
				markPackVideoFrameReady();
			}
			return cache.texture || null;
		}
		// Hole in full buffer: kick async fill; try nearest ready neighbor (editor keeps last good).
		void ensurePackSeqFrame(cache, index);
		for (let d = 1; d <= 8; d++) {
			const hi = index + d < n ? cache.frames[index + d] : undefined;
			const lo = index - d >= 0 ? cache.frames[index - d] : undefined;
			const near = hi || lo;
			if (near) {
				if (cache.uploadedIndex !== index) {
					uploadPackBitmap(cache, near, index);
					markPackVideoFrameReady();
				}
				return cache.texture || null;
			}
		}
	}
	for (let d = 0; d <= SEQ_LRU_AHEAD; d++) void ensurePackSeqFrame(cache, (index + d) % n);
	for (let d = 1; d <= SEQ_LRU_BEHIND; d++) void ensurePackSeqFrame(cache, (index - d + n * 8) % n);
	if (cache.lru.has(index)) {
		if (cache.uploadedIndex !== index) {
			uploadPackBitmap(cache, cache.lru.get(index)!, index);
			markPackVideoFrameReady();
		}
		return cache.texture || null;
	}
	void ensurePackSeqFrame(cache, index).then((b) => {
		if (b && ud.__fccMediaCache === cache) {
			uploadPackBitmap(cache, b, index);
			markPackVideoFrameReady();
		}
	});
	return cache.texture || null;
}


/** Live HTMLVideoElements created by preparePackVideos (incl. cached off-screen packs). */
const livePackVideos = new Set<HTMLVideoElement>();

/**
 * Per-element playback counters for `__fccPackVideo()`.
 *
 * "It stutters" has three completely different causes that look identical to the
 * eye, and they need opposite fixes:
 *   1. decode-bound  → `waiting` climbs, droppedVideoFrames climbs. Lower the
 *      source resolution / bitrate; nothing in the render loop will help.
 *   2. seek storm    → `seekCount` climbs while playing. The sync machine is
 *      fighting itself; each seek freezes the picture and re-primes the decoder.
 *   3. compose-bound → element stats are clean but frames get dropped anyway;
 *      the project fps gate in preview (`lastRenderMs < 40`) kicks in.
 * Counting each one turns the argument into a measurement.
 */
type PackVideoCounters = {
	/** Element-initiated seeks (scrub, start-seek, drift correction, exporter). */
	seekCount: number;
	/** Rabbit holes from the media pipeline: total ms spent inside seeks. */
	seekMs: number;
	/** `waiting` = playback stalled because no decoded frame was ready. THE stutter signal. */
	waitingCount: number;
	/** `playing` = playback (re)started after stall/pause. Spikes mean restart thrash. */
	playingCount: number;
};

const packVideoCounters = new WeakMap<HTMLVideoElement, PackVideoCounters>();

/**
 * Blit accounting for the `syncPackVideos` hot path.
 * `skipSeeking` is the "picture froze but audio kept running" counter — every
 * one of those is a visible hitch.
 */
const packVideoBlitStats = { blit: 0, skipSeeking: 0, skipUnchanged: 0, stuckPausedPlays: 0 };

function getPackVideoCounters(video: HTMLVideoElement): PackVideoCounters {
	let c = packVideoCounters.get(video);
	if (!c) {
		c = { seekCount: 0, seekMs: 0, waitingCount: 0, playingCount: 0 };
		packVideoCounters.set(video, c);
	}
	return c;
}

/** Attach stall/seek counters once per element. Cheap: three listeners, no per-frame work. */
function attachPackVideoCounters(video: HTMLVideoElement): void {
	if (packVideoCounters.has(video)) return;
	const c = getPackVideoCounters(video);
	let seekStart = 0;
	video.addEventListener("seeking", () => {
		seekStart = performance.now();
	});
	video.addEventListener("seeked", () => {
		c.seekCount += 1;
		if (seekStart > 0) c.seekMs += performance.now() - seekStart;
		seekStart = 0;
	});
	video.addEventListener("waiting", () => {
		c.waitingCount += 1;
	});
	video.addEventListener("playing", () => {
		c.playingCount += 1;
	});
}

function registerLivePackVideo(video: HTMLVideoElement): void {
	livePackVideos.add(video);
	attachPackVideoCounters(video);
}

function unregisterLivePackVideo(video: HTMLVideoElement): void {
	livePackVideos.delete(video);
}

/** Pause every pack VideoPlayer element. Transport-stop / project teardown. */
export function pauseAllPackVideos(): void {
	for (const video of livePackVideos) {
		try {
			// Mute first — Chromium still clicks (咔咔) if currentTime moves while unmuted.
			video.muted = true;
			video.volume = 0;
			if (!video.paused) video.pause();
		} catch {
			/* ignore */
		}
	}
}

/**
 * fcc-tl-flower-58: after play→pause, stop seeked/queue chase loops + 咔咔.
 * Mute, anchor seek target to currentTime, mark idle-parked (no further seeks).
 */
function clearPackVideoSeekChases(): void {
	for (const video of livePackVideos) {
		try {
			video.muted = true;
			video.volume = 0;
			if (!video.paused) video.pause();
		} catch {
			/* ignore */
		}
		const ud = (
			video as HTMLVideoElement & { __fccTlDriveUd?: TimelineVideoDrive }
		).__fccTlDriveUd;
		if (!ud) continue;
		ud.__fccTlWantPlay = false;
		ud.__fccTlSeekTarget = Number(video.currentTime) || 0;
		ud.__fccTlIdleParked = true;
		// New play session starts here, so the play-start seek must be forced again.
		ud.__fccTlStartSeekDone = false;
		ud.__fccTlLastCorrectionMs = 0;
	}
}

/**
 * fcc-tl-flower-68: park every video inside ONE pack scene.
 *
 * `syncPackVideos` only visits packs drawn this frame, so a pack whose NLE clip
 * is out of range keeps free-running whatever it was playing when the playhead
 * left — including audio: fcc-tl-flower-54 only covers a *stopped* transport
 (`setPackVideoPreviewState` pauses all live videos on play→pause), not a
 * transport that plays on past the clip.
 *
 * The compositor calls this each frame for every built pack that was NOT drawn
 * (`packScenes` entries outside `lastFramePackIds ∪ activeOverlayIds`). That is
 * what makes "vfxpack 的 clip 时间之外，内部视频不播放" true, and — together
 * with the flower-67 ended-park — "媒体播放完成后停住，直到 timeline 再次播放".
 *
 * Same park as the timeline's out-of-range visit (mute → pause → session
 * reset), so re-entering the clip starts a fresh play session from the clip
 * position instead of resuming the stale one. No currentTime writes: the
 * parked frame is invisible (pack not composited) and seeking here would only
 * add an audible/seekstorm risk on the way back in.
 */
export function pausePackSceneVideos({ root }: { root: THREE.Object3D }): void {
	root.traverse((object) => {
		const ud = object.userData as TimelineVideoDrive;
		const video = ud.__fccVideo;
		if (!video) return;
		try {
			// Mute first — Chromium still clicks (咔咔) if currentTime moves while unmuted.
			video.muted = true;
			video.volume = 0;
			if (!video.paused) video.pause();
		} catch {
			/* ignore */
		}
		ud.__fccTlWantPlay = false;
		ud.__fccTlSeekTarget = Number(video.currentTime) || 0;
		ud.__fccTlIdleParked = true;
		ud.__fccTlInRange = false;
		// New play session starts here, so the play-start seek is forced again
		// when the clip (or the transport) comes back.
		ud.__fccTlStartSeekDone = false;
		ud.__fccTlLastCorrectionMs = 0;
	});
}

export function setPackVideoPreviewState(
	state: Partial<PreviewState> & { playing?: boolean; volume?: number },
): void {
	const wasPlaying = previewState.playing;
	const nextPlaying = state.playing === true;
	const nextScrubbing =
		typeof state.scrubbing === "boolean" ? state.scrubbing : previewState.scrubbing;
	const nextVolume =
		typeof state.volume === "number" && Number.isFinite(state.volume)
			? Math.min(1, Math.max(0, state.volume))
			: previewState.volume;
	const nextTimelineSec =
		typeof state.timelineSec === "number" && Number.isFinite(state.timelineSec)
			? state.timelineSec
			: previewState.timelineSec;
	const nextTimelineSecSnapped =
		typeof state.timelineSecSnapped === "number" &&
		Number.isFinite(state.timelineSecSnapped)
			? state.timelineSecSnapped
			: previewState.timelineSecSnapped;
	// fcc-tl-flower-66: preview RAF calls this every tick — skip work when unchanged.
	if (
		previewState.playing === nextPlaying &&
		previewState.scrubbing === (nextPlaying ? false : nextScrubbing) &&
		previewState.volume === nextVolume &&
		previewState.timelineSec === nextTimelineSec &&
		previewState.timelineSecSnapped === nextTimelineSecSnapped
	) {
		return;
	}
	previewState = {
		playing: nextPlaying,
		scrubbing: nextPlaying ? false : nextScrubbing,
		volume: nextVolume,
		timelineSec: nextTimelineSec,
		timelineSecSnapped: nextTimelineSecSnapped,
	};
	// CapCut-like: transport not playing ⇒ no free-run. syncPackVideos only visits
	// packs drawn this frame; autoplay / no-timeline players on finished or
	// off-screen clips would keep element.play() otherwise. Pause every live
	// element whenever transport is stopped (idempotent).
	// fcc-tl-flower-58: do NOT markPackVideoFrameReady on play→pause — that
	// forced a recompose→scrub-seek→seeked→epoch loop after timeline finished.
	if (!previewState.playing) {
		pauseAllPackVideos();
		if (wasPlaying) clearPackVideoSeekChases();
	}
}

export function getPackVideoPreviewPlaying(): boolean {
	return previewState.playing;
}

/** Continuous minus snapped — add to frame-local clip time for media free-run. */
export function getPackVideoPreviewMediaTimeBiasSec(): number {
	if (!previewState.playing) return 0;
	const c = previewState.timelineSec;
	const s = previewState.timelineSecSnapped;
	if (!Number.isFinite(c) || !Number.isFinite(s)) return 0;
	return c - s;
}

/**
 * True when at least one pack video element is actually advancing on its own
 * clock right now.
 *
 * The preview render loop only presents every RAF when it believes something is
 * live (`needsLivePresent`). That check looked at timeline elements of type
 * "video", so a pack clip dragged onto a graphic/text track — where the moving
 * picture lives inside a VideoPlayer, not a VideoElement — fell through to
 * frame-gated presenting: the picture stepped at the project fps (say 30) while
 * the playhead was repositioned every display tick (60). Users read that as
 * "the pack video does not keep up with the playhead".
 */
export function hasPlayingPackVideo(): boolean {
	for (const video of livePackVideos) {
		if (!video.paused) return true;
	}
	return false;
}

const VIDEO_SEEK_PLAY = 0.2;
/** Min ms between mid-play drift-correction seeks (see seekPackTimelineVideo). */
const SEEK_CORRECTION_BACKOFF_MS = 250;
/** Idle pause / after play ends: only correct large drift once; avoid seek storms. */
const VIDEO_SEEK_IDLE = 0.12;

/**
 * Soft-sync band. Under ~1.5 frames nobody can see the offset, so leave the
 * element alone — every write to playbackRate is a small disturbance.
 */
const SYNC_BAND_SEC = 0.045;
/**
 * Above this the offset is too large to hide by nudging speed (chasing 0.4s at
 * the rate ceiling takes ~3s), so pay for one seek.
 */
const SYNC_HARD_SEC = 0.4;
/**
 * Proportional gain for the rate nudge. 1.2 means a 0.1s offset trims speed by
 * 12% — closes in roughly 0.8s without an audible/visible speed change.
 */
const SYNC_GAIN = 1.2;
/** Hard ceiling on the nudge so playback never looks like fast-forward. */
const SYNC_RATE_LIMIT = 0.15;
/** Ignore playbackRate writes smaller than this; they only churn the media pipeline. */
const SYNC_RATE_EPSILON = 0.008;

/**
 * Writes playbackRate only when it actually moves.
 *
 * Chromium re-evaluates its pipeline on every assignment; the previous code
 * assigned unconditionally on each render tick, which on its own discouraged
 * any rate-based correction from ever settling to "no correction".
 */
function applyPackVideoRate({
	video,
	rate,
}: {
	video: HTMLVideoElement;
	rate: number;
}): void {
	if (Math.abs((video.playbackRate || 1) - rate) <= SYNC_RATE_EPSILON) return;
	try {
		video.playbackRate = rate;
	} catch {
		/* ignore */
	}
}

/**
 * How recently the pack timeline must have driven an element for the probe to
 * call it "fresh". Diagnostic only — never used to decide transport ownership.
 */
const TIMELINE_DRIVEN_FRESH_MS = 120;

/** Probe helper: was the timeline driving this element within the last ~2 frames? */
function isTimelineDriven(ud: {
	__fccTlMediaDriven?: boolean;
	__fccTlMediaDrivenAt?: number;
}): boolean {
	return (
		ud.__fccTlMediaDriven === true &&
		performance.now() - (ud.__fccTlMediaDrivenAt ?? 0) <
			TIMELINE_DRIVEN_FRESH_MS
	);
}

type TimelineVideoDrive = {
	__fccTlVideoClipKey?: string;
	/** Latest scrub/play seek target; applied when the element is not mid-seek. */
	__fccTlSeekTarget?: number;
	/** True while NLE wants free-run play (seeked must not re-seek at scrub epsilon). */
	__fccTlWantPlay?: boolean;
	__fccTlSeekListening?: boolean;
	/** fcc-tl-flower-58: parked after play→pause; skip further idle seeks until scrub/play. */
	__fccTlIdleParked?: boolean;
	/** Wall-clock ms of last scrub seek kick (throttle rapid playhead drags). */
	__fccTlLastSeekKickMs?: number;
	/**
	 * Set once the play-start seek has been forced for the current play session.
	 * Scrubbing leaves an in-flight seek behind (queueVideoSeek defers while
	 * video.seeking), so the first play frame must override it; without the flag
	 * every frame that still sees video.paused would re-issue it.
	 */
	__fccTlStartSeekDone?: boolean;
	/** Wall-clock ms of last mid-play drift-correction seek (backoff, see below). */
	__fccTlLastCorrectionMs?: number;
	/** Signed seconds: video.currentTime - timeline target (positive = video ahead). */
	__fccTlLastDriftSec?: number;
	/** Which branch of the sync state machine ran last (debug/`__fccPackVideo`). */
	__fccTlSyncMode?:
		| "start-seek"
		| "seek-pending"
		| "hard-seek"
		| "trim-slow"
		| "trim-fast"
		| "locked"
		| "idle";
	/** Last video.currentTime successfully blitted into RT (skip unchanged). */
	__fccLastBlitMediaTime?: number;
	/**
	 * `performance.now()` of the last frame the pack timeline actually drove this
	 * element. Diagnostic only (`__fccPackVideo().timelineFresh`) — the transport
	 * authority is `__fccTlBound`, which cannot go stale.
	 */
	__fccTlMediaDrivenAt?: number;
	/**
	 * True once `seekPackTimelineVideo` has touched this element at all.
	 *
	 * This is the real "who owns the transport" answer. An element referenced by
	 * a pack timeline is driven — or deliberately parked — by
	 * `samplePackTimeline`; `syncPackVideos` must never also play/seek it, even
	 * on frames where the clip is out of range. Per-frame flags cannot express
	 * that, because "not driven this frame" means "the timeline parked it", not
	 * "nobody owns it".
	 */
	__fccTlBound?: boolean;
	/**
	 * Last visit from the pack timeline was inside the clip's range.
	 * `false` while `previewState.playing` means the transport is running past a
	 * clip that is not on screen — the element is parked on purpose.
	 */
	__fccTlInRange?: boolean;
	/**
	 * fcc-tl-flower-67: the media ran out while the clip is still on screen.
	 * A non-looping player shorter than its clip clamps to `duration - 0.001`,
	 * so the element ends and the transport still says "playing". Parked here
	 * so neither this module nor the sync safety net calls `play()` on it.
	 */
	__fccTlMediaEnded?: boolean;
	/** Size of the RT the last blit wrote into (diagnostics: source-res RTs are pure fill-rate waste). */
	__fccBlitRtW?: number;
	__fccBlitRtH?: number;
	/** Last gif/seq uploadedIndex blitted into RT. */
	__fccLastBlitUploadedIndex?: number;
	__fccVideo?: HTMLVideoElement;
	__fccVideoTexture?: THREE.VideoTexture;
	fccVideoPlayer?: {
		muted?: boolean;
		volume?: number;
		loop?: boolean;
	};
};

function ensureTimelineSeekListener(
	ud: TimelineVideoDrive,
	video: HTMLVideoElement,
): void {
	// Always refresh drive pointer (element may be reused across pack rebuilds).
	(
		video as HTMLVideoElement & { __fccTlDriveUd?: TimelineVideoDrive }
	).__fccTlDriveUd = ud;
	if (ud.__fccTlSeekListening) return;
	ud.__fccTlSeekListening = true;
	video.addEventListener("seeked", () => {
		// fcc-tl-flower-53: during free-run play, never re-seek from seeked.
		// Target can be stale (NLE moved on, or video already advanced past the
		// seek that just finished) — chasing it caused seek cascades / reverse jumps.
		// Large drift is corrected on the next RAF by seekPackTimelineVideo.
		// fcc-tl-flower-58: while idle (not scrubbing), never re-chase — that looped
		// with markPackVideoFrameReady → preview recompose → queueSeek forever
		// after timeline play finished.
		if (!ud.__fccTlWantPlay) {
			if (previewState.scrubbing) {
				const target = ud.__fccTlSeekTarget;
				if (
					target != null &&
					Number.isFinite(target) &&
					Math.abs((video.currentTime || 0) - target) > 0.04
				) {
					try {
						video.muted = true;
						video.volume = 0;
						video.currentTime = target;
					} catch {
						/* ignore */
					}
					return;
				}
			} else {
				const pendingTarget = ud.__fccTlSeekTarget;
				const landedAt = Number(video.currentTime) || 0;
				const pendingFar =
					pendingTarget != null &&
					Number.isFinite(pendingTarget) &&
					Math.abs(landedAt - pendingTarget) > 0.1;
				if (pendingFar) {
					// Scrub ended while a deferred target was still queued. Apply it once,
					// muted: leaving it pending shows a frame that does not match the
					// playhead until playback starts, and nothing re-renders to fix it.
					// This terminates — the retry lands within 0.1s and parks below.
					try {
						video.muted = true;
						video.volume = 0;
						video.currentTime = pendingTarget;
					} catch {
						/* ignore */
					}
					return;
				}
				ud.__fccTlSeekTarget = landedAt;
				ud.__fccTlIdleParked = true;
			}
		}
		if (ud.__fccVideoTexture) ud.__fccVideoTexture.needsUpdate = true;
		// Preview RAF skips same-frame redraw; without this, scrub settles on a
		// black/stale blit that never gets replaced after seeked.
		markPackVideoFrameReady();
	});
}

/** Min ms between scrub seek kicks (target still updates every call). */
const SCRUB_SEEK_MIN_MS = 50;
/** Preview scrub: ignore sub-frame drift (30fps ≈ 33ms). Precise/export keeps tight. */
const VIDEO_SEEK_SCRUB = 1 / 30;

function queueVideoSeek(
	ud: TimelineVideoDrive,
	video: HTMLVideoElement,
	t: number,
	opts?: { force?: boolean; precise?: boolean; scrub?: boolean; idle?: boolean },
): void {
	ud.__fccTlSeekTarget = t;
	ensureTimelineSeekListener(ud, video);
	// Rapid scrub cancels in-flight seeks → black/stale RT. Queue until seeked;
	// seeked handler applies the latest __fccTlSeekTarget.
	if (video.seeking && !opts?.force) return;
	const eps = opts?.precise
		? 0.001
		: opts?.idle
			? VIDEO_SEEK_IDLE
			: opts?.scrub
				? VIDEO_SEEK_SCRUB
				: 0.001;
	if (Math.abs((video.currentTime || 0) - t) < eps) return;
	// Throttle scrub kicks only — play resync / export must not wait.
	if (opts?.scrub && !opts?.force) {
		const now = performance.now();
		const last = ud.__fccTlLastSeekKickMs || 0;
		if (now - last < SCRUB_SEEK_MIN_MS) return;
		ud.__fccTlLastSeekKickMs = now;
	}
	// fcc-tl-flower-58: any non-play seek must be muted — otherwise pause/scrub
	// currentTime thrash is audible as 咔咔咔.
	if (!ud.__fccTlWantPlay) {
		video.muted = true;
		video.volume = 0;
	}
	try {
		video.currentTime = t;
	} catch {
		/* ignore */
	}
}

/**
 * Drive a pack VideoPlayer from FreeFilmCut Timeline (mirrors editor seekVideoPlayer).
 * Free-run while NLE is playing; queued seek while scrubbing; pause outside clips.
 */
export function seekPackTimelineVideo(
	obj: THREE.Object3D,
	mediaTimeSec: number | null,
	opts?: { loop?: boolean; playing?: boolean; clipKey?: string; precise?: boolean },
): void {
	const ud = obj.userData as TimelineVideoDrive & {
		__fccMediaCache?: FrameCache;
		__fccMediaTime?: number | null;
		__fccMediaActive?: boolean;
		fccVideoPlayer?: {
			kind?: string;
			loop?: boolean;
			muted?: boolean;
			volume?: number;
			playbackRate?: number;
		};
	};
	const kind = packMediaKind(ud.fccVideoPlayer, ud.__fccMediaCache);
	// Mark the element as timeline-owned from the very first visit, including the
	// "out of range" visit that only parks it. See TimelineVideoDrive.__fccTlBound.
	ud.__fccTlBound = true;
	if (kind === "gif" || kind === "imageSequence") {
		if (mediaTimeSec == null || !Number.isFinite(Number(mediaTimeSec))) {
			ud.__fccMediaActive = false;
			ud.__fccMediaTime = null;
			ud.__fccTlVideoClipKey = "";
			(ud as { __fccTlMediaDriven?: boolean }).__fccTlMediaDriven = false;
			ud.__fccTlMediaDrivenAt = 0;
			return;
		}
		ud.__fccMediaActive = true;
		ud.__fccMediaTime = Number(mediaTimeSec) || 0;
		(ud as { __fccTlMediaDriven?: boolean }).__fccTlMediaDriven = true;
		ud.__fccTlMediaDrivenAt = performance.now();
		if (opts?.clipKey) ud.__fccTlVideoClipKey = String(opts.clipKey);
		samplePackMediaTexture(ud, { loop: !!opts?.loop || ud.fccVideoPlayer?.loop !== false });
		return;
	}
	const video = ud.__fccVideo;
	if (!video) return;

	const wantPlay = !!(opts?.playing && previewState.playing);
	ud.__fccTlWantPlay = wantPlay;
	const clipKey = opts?.clipKey != null ? String(opts.clipKey) : "";
	const vp = ud.fccVideoPlayer;
	const master = previewState.volume;
	const audible = wantPlay && vp?.muted !== true;

	if (mediaTimeSec == null || !Number.isFinite(Number(mediaTimeSec))) {
		ud.__fccTlVideoClipKey = "";
		ud.__fccTlSeekTarget = undefined;
		ud.__fccTlWantPlay = false;
		(ud as { __fccTlMediaDriven?: boolean }).__fccTlMediaDriven = false;
		ud.__fccTlMediaDrivenAt = 0;
		ud.__fccTlInRange = false;
		// Entering the clip again is a brand-new play session for this element.
		// Leaving these latched is what made "start the transport before the clip
		// begins, then let it run into the clip" behave differently from "park the
		// playhead on the clip, then press space": the second case forces a start
		// seek, the first inherited a stale `startSeekDone` and skipped the
		// `play()` that only happens on the start path.
		ud.__fccTlStartSeekDone = false;
		ud.__fccTlLastCorrectionMs = 0;
		ud.__fccTlSyncMode = "idle";
		video.loop = false;
		if (!video.paused) video.pause();
		video.muted = true;
		video.volume = 0;
		return;
	}
	(ud as { __fccTlMediaDriven?: boolean }).__fccTlMediaDriven = true;
	ud.__fccTlMediaDrivenAt = performance.now();
	ud.__fccTlInRange = true;

	const rawT = (Number(mediaTimeSec) || 0) * packPlaybackRate(vp);
	let t = rawT;
	const d = Number(video.duration);
	const hasDuration = Number.isFinite(d) && d > 0;
	if (hasDuration) {
		if (opts?.loop) t = ((t % d) + d) % d;
		else t = Math.max(0, Math.min(d - 0.001, t));
	}

	/**
	 * fcc-tl-flower-67: the media ended but the clip did not.
	 *
	 * A player's picture can be shorter than the clip it sits on — this pack's
	 * MG.mp4 is 1.667s while the clip runs 1.667s + 4s of looping GIF. Past
	 * 1.667s the clamp above pins `t` at `duration - 0.001`, a time the finished
	 * element can never reach. The transport is still `playing`, so control
	 * falls into the `wantPlay` branch below — the idle branch that explicitly
	 * stops writing currentTime after playback ends never runs — and the element
	 * gets `play()`ed at RAF rate.
	 *
	 * Per HTML spec `play()` on an ended element seeks back to 0, so each call
	 * restarts the audio decoder from the top at full volume; the next frame
	 * measures a ~1.6s drift, hard-seeks to the end, the element ends again, and
	 * the cycle repeats. With an unmuted audio track baked into the video that
	 * is audible as 咔咔咔 while the playhead sits on the remaining clip.
	 *
	 * Park it exactly like the idle branch: muted, paused, zero currentTime
	 * writes, and never `play()`.
	 */
	if (hasDuration && !opts?.loop && rawT >= d) {
		ud.__fccTlMediaEnded = true;
		ud.__fccTlWantPlay = false;
		ud.__fccTlSeekTarget = t;
		ud.__fccTlSyncMode = "idle";
		ud.__fccTlIdleParked = true;
		// Re-entering the media range is a new play session for this element:
		// without this the start-seek is skipped and the element plays from the
		// end it was parked on.
		ud.__fccTlStartSeekDone = false;
		ud.__fccTlLastCorrectionMs = 0;
		video.loop = false;
		if (!video.paused) video.pause();
		video.muted = true;
		video.volume = 0;
		applyPackVideoRate({ video, rate: packPlaybackRate(vp) });
		return;
	}
	ud.__fccTlMediaEnded = false;

	const prevKey = ud.__fccTlVideoClipKey || "";
	const clipChanged = clipKey !== "" && clipKey !== prevKey;
	if (clipKey) ud.__fccTlVideoClipKey = clipKey;

	const baseRate = packPlaybackRate(vp);
	video.loop = false;
	// Target time below is scaled by playbackRate, so the element has to run at the
	// same rate — otherwise it advances at 1x against a rate-scaled playhead and the
	// drift-correction seek fires forever. While playing the rate is trimmed around
	// this base by the soft-sync branch below.
	video.muted = !audible;
	const targetVolume = audible
		? Math.min(1, Math.max(0, (vp?.volume ?? 1) * master))
		: 0;
	if (Math.abs((video.volume || 0) - targetVolume) > 0.001) {
		video.volume = targetVolume;
	}

	const signedDrift = (video.currentTime || 0) - t;
	const drift = Math.abs(signedDrift);
	ud.__fccTlLastDriftSec = signedDrift;
	if (wantPlay) {
		ud.__fccTlIdleParked = false;
		const startingPlayback = video.paused;
		if (clipChanged || (startingPlayback && !ud.__fccTlStartSeekDone)) {
			// Force the seek through before playing. Scrubbing leaves an in-flight seek
			// behind and queueVideoSeek defers while video.seeking, so without `force`
			// play() starts from the old landing point. The resulting catch-up seeks
			// then collide with "skip blits while seeking" and freeze the picture while
			// audio keeps running.
			ud.__fccTlStartSeekDone = true;
			queueVideoSeek(ud, video, t, { force: true });
			// A start seek always lands late by however long the decode takes. Hold the
			// base rate here; the soft-sync branch measures the damage next frame and
			// closes it by nudging speed (a second seek would just add more latency).
			applyPackVideoRate({ video, rate: baseRate });
			ud.__fccTlSyncMode = "start-seek";
		} else if (video.seeking) {
			// A seek is already in flight. Rate writes are pointless until it lands,
			// and issuing another seek would only move the target under it.
			ud.__fccTlSyncMode = "seek-pending";
		} else if (drift > SYNC_HARD_SEC) {
			// Mid-play correction has to back off: one seek cannot always close a >0.2s
			// gap (keyframe distance, slow disk), and retrying every frame turns a
			// transient offset into a permanent seek loop.
			const now = performance.now();
			if (
				now - (ud.__fccTlLastCorrectionMs || 0) >=
				SEEK_CORRECTION_BACKOFF_MS
			) {
				ud.__fccTlLastCorrectionMs = now;
				queueVideoSeek(ud, video, t, {});
			}
			applyPackVideoRate({ video, rate: baseRate });
			ud.__fccTlSyncMode = "hard-seek";
		} else if (drift > SYNC_BAND_SEC) {
			// Soft sync. The old code let the element free-run and only seeked past
			// 0.2s, so a start seek that landed 150ms late stayed 150ms late for the
			// whole clip: the picture visibly trailed the playhead while audio was
			// correct. Trimming playbackRate closes the gap without a frozen frame
			// (syncPackVideos skips blits while seeking, which is exactly the hitch
			// users read as "video and playhead are out of step").
			const rawTrim = signedDrift * SYNC_GAIN;
			const trim =
				rawTrim < -SYNC_RATE_LIMIT
					? -SYNC_RATE_LIMIT
					: rawTrim > SYNC_RATE_LIMIT
						? SYNC_RATE_LIMIT
						: rawTrim;
			applyPackVideoRate({ video, rate: baseRate * (1 - trim) });
			ud.__fccTlSyncMode = trim > 0 ? "trim-slow" : "trim-fast";
		} else {
			applyPackVideoRate({ video, rate: baseRate });
			ud.__fccTlSyncMode = "locked";
		}
		// fcc-tl-flower-67: `ended` must not be resumed by play() — the spec seeks
		// an ended element back to 0, which restarts the audio from the top instead
		// of continuing. Let the seek branches land first (next frame).
		if (startingPlayback && !video.ended) video.play().catch(() => {});
	} else {
		ud.__fccTlStartSeekDone = false;
		ud.__fccTlLastCorrectionMs = 0;
		ud.__fccTlSyncMode = "idle";
		// Drop any soft-sync trim: a leftover 1.08x would make the first frames of
		// the next session run fast before the start path resets it.
		applyPackVideoRate({ video, rate: baseRate });
		// Scrub / pause / export: keep element paused and retarget media time.
		// precise=true (export): force currentTime even mid-seek so each encoded
		// frame lands on the timeline sample instead of a queued stale target.
		// Preview scrub: throttle + coarser epsilon; keep last-good RT while seeking.
		// fcc-tl-flower-58: idle pause (play finished / paused, not scrubbing) —
		// mute + ZERO currentTime. Scrub-seek + seeked epoch loops caused
		// Duo's post-end 咔咔咔 (audible seek thrash).
		if (!video.paused) video.pause();
		ud.__fccTlWantPlay = false;
		if (opts?.precise) {
			ud.__fccTlIdleParked = false;
			video.muted = true;
			video.volume = 0;
			queueVideoSeek(ud, video, t, { force: true, precise: true });
		} else if (previewState.scrubbing) {
			ud.__fccTlIdleParked = false;
			// Scrub seeks stay muted (audible only while wantPlay).
			video.muted = true;
			video.volume = 0;
			queueVideoSeek(ud, video, t, { scrub: true });
		} else {
			// Idle / after play ends: ZERO currentTime writes. Free-run already
			// left the frame near playhead; seeking here caused Duo's 咔咔 thrash.
			video.muted = true;
			video.volume = 0;
			ud.__fccTlSeekTarget = Number(video.currentTime) || 0;
			ud.__fccTlIdleParked = true;
		}
	}
}

/**
 * Wait until HTMLVideoElement seeks under root have settled (export frame capture).
 * GIF/seq sample synchronously; video decode is async — without this, export blits
 * while video.seeking and RTs stay black/stale.
 */
export function awaitPackVideoSeeks(
	root: THREE.Object3D,
	timeoutMs = 2500,
): Promise<void> {
	const pending: Promise<void>[] = [];
	root.traverse((object) => {
		const ud = object.userData as TimelineVideoDrive;
		const video = ud.__fccVideo;
		if (!video) return;
		const target = ud.__fccTlSeekTarget;
		const atTarget =
			target == null ||
			!Number.isFinite(target) ||
			Math.abs((video.currentTime || 0) - target) <= 0.04;
		if (!video.seeking && atTarget) return;
		pending.push(
			new Promise<void>((resolve) => {
				let settled = false;
				const done = () => {
					if (settled) return;
					settled = true;
					video.removeEventListener('seeked', onSeeked);
					resolve();
				};
				const onSeeked = () => {
					const t = ud.__fccTlSeekTarget;
					if (
						t != null &&
						Number.isFinite(t) &&
						Math.abs((video.currentTime || 0) - t) > 0.04
					) {
						try {
							video.muted = true;
							video.volume = 0;
							video.currentTime = t;
						} catch {
							/* ignore */
						}
						return;
					}
					done();
				};
				video.addEventListener('seeked', onSeeked);
				// Kick / re-apply if the element is not already seeking toward target.
				if (
					target != null &&
					Number.isFinite(target) &&
					(!video.seeking || Math.abs((video.currentTime || 0) - target) > 0.04)
				) {
					try {
						video.muted = true;
						video.volume = 0;
						video.currentTime = target;
					} catch {
						/* ignore */
					}
				}
				setTimeout(done, timeoutMs);
				// Already settled between check and subscribe.
				if (!video.seeking) {
					const t = ud.__fccTlSeekTarget;
					if (
						t == null ||
						!Number.isFinite(t) ||
						Math.abs((video.currentTime || 0) - t) <= 0.04
					) {
						done();
					}
				}
			}),
		);
	});
	if (!pending.length) return Promise.resolve();
	return Promise.all(pending).then(() => undefined);
}

/**
 * Export helper: wait for HTMLVideo seeks, then blit into RTs (gif/seq already sync).
 */
export async function settlePackVideosForCapture(
	renderer: THREE.WebGLRenderer,
	root: THREE.Object3D,
	timeSeconds: number,
): Promise<void> {
	await awaitPackVideoSeeks(root);
	syncPackVideos(renderer, root, timeSeconds, { driveTransport: false });
	rebindPackRenderTextures(root);
}

function videoMime(path: string): string {
	const n = path.toLowerCase();
	if (n.endsWith(".webm")) return "video/webm";
	if (n.endsWith(".mov")) return "video/quicktime";
	if (n.endsWith(".ogv") || n.endsWith(".ogg")) return "video/ogg";
	return "video/mp4";
}

function packVideoUrl(pack: LoadedVfxPack, relPath: string): string | null {
	const cached = pack.objectUrls.get(relPath);
	if (cached) return cached;
	const bytes = pack.files.get(relPath);
	if (!bytes) return null;
	const copy = bytes.slice();
	const url = URL.createObjectURL(new Blob([copy], { type: videoMime(relPath) }));
	pack.objectUrls.set(relPath, url);
	return url;
}

export async function preparePackVideos({
	root,
	pack,
	nodes,
}: {
	root: THREE.Object3D;
	pack: LoadedVfxPack;
	nodes: VfxSceneNode[];
}) {
	const byUuid = new Map<string, THREE.Object3D>();
	root.traverse((object) => {
		if (object.uuid) byUuid.set(object.uuid, object);
	});

	for (const node of nodes) {
		const udVp = (node.userData as { fccVideoPlayer?: Record<string, unknown> } | undefined)
			?.fccVideoPlayer;
		const isPlayer =
			node.kind === "videoPlayer" ||
			!!node.video ||
			!!udVp;
		if (!isPlayer) continue;
		const object = byUuid.get(node.uuid);
		if (!object) continue;

		const merged = {
			...(udVp || {}),
			...(node.video || {}),
		} as {
			path?: string;
			projectPath?: string;
			fileName?: string;
			targetUuid?: string;
			loop?: boolean;
			muted?: boolean;
			volume?: number;
			kind?: string;
			sequenceFps?: number;
			sequenceDir?: string;
			playbackRate?: number;
			autoplay?: boolean;
			frameNames?: string[];
		};

		const mediaKind = packMediaKind({ kind: merged.kind || (udVp as { kind?: string } | undefined)?.kind });
		const explicitFrameNames = Array.isArray(merged.frameNames)
			? merged.frameNames.filter((n) => typeof n === "string" && n.length > 0)
			: [];
		(object.userData as { fccVideoPlayer?: Record<string, unknown> }).fccVideoPlayer = {
			...((object.userData as { fccVideoPlayer?: Record<string, unknown> }).fccVideoPlayer || {}),
			kind: mediaKind,
			path: merged.path || merged.sequenceDir || "",
			projectPath: merged.projectPath || merged.path || "",
			targetUuid: merged.targetUuid || "",
			loop: merged.loop !== false,
			muted: merged.muted === true,
			volume: Number.isFinite(Number(merged.volume)) ? Number(merged.volume) : 1,
			sequenceFps: Number(merged.sequenceFps) || 30,
			sequenceDir: merged.sequenceDir || merged.path || "",
			playbackRate: packPlaybackRate({ playbackRate: Number(merged.playbackRate) }),
			...((merged as { autoplay?: boolean }).autoplay !== undefined
				? { autoplay: (merged as { autoplay?: boolean }).autoplay === true }
				: {}),
			...(explicitFrameNames.length ? { frameNames: explicitFrameNames } : {}),
		};

		if (mediaKind === "gif") {
			let path = merged.path || "";
			if (!path || !pack.files.has(path)) {
				for (const key of pack.files.keys()) {
					const lower = key.toLowerCase();
					if ((lower.startsWith("media/") || lower.startsWith("videos/")) && lower.endsWith(".gif")) {
						if (lower.includes(node.uuid.slice(0, 8).toLowerCase()) || !path) path = key;
					}
				}
			}
			if (!path || !pack.files.has(path)) {
				console.warn("[vfxpack] gif missing", node.name || node.uuid);
				continue;
			}
			const buf = pack.files.get(path)!.buffer.slice(
				pack.files.get(path)!.byteOffset,
				pack.files.get(path)!.byteOffset + pack.files.get(path)!.byteLength,
			);
			const cache = await decodePackGif(buf);
			if (!cache) {
				console.warn("[vfxpack] gif decode failed", path);
				continue;
			}
			(object.userData as { __fccMediaCache?: FrameCache }).__fccMediaCache = cache;
			(object.userData as { __fccMediaActive?: boolean }).__fccMediaActive = true;
			(object.userData as { __fccMediaTime?: number }).__fccMediaTime = 0;
			continue;
		}

		if (mediaKind === "imageSequence") {
			let dir = merged.path || merged.sequenceDir || "";
			dir = dir.replace(/\\/g, "/").replace(/\/$/, "");
			const explicitNames = Array.isArray(
				(merged as { frameNames?: string[] }).frameNames,
			)
				? ((merged as { frameNames?: string[] }).frameNames as string[]).filter(
						(n) => typeof n === "string" && n.length > 0,
					)
				: [];
			if (!dir) {
				for (const key of pack.files.keys()) {
					if (key.toLowerCase().startsWith("sequences/") && key.includes(node.uuid.slice(0, 8))) {
						dir = key.split("/").slice(0, 2).join("/");
						break;
					}
				}
			}
			// If authored dir missing from pack.files, still accept explicit frameNames
			// (hydrate / objectUrls may fill bytes later in ensurePackSeqFrame).
			if (
				dir &&
				explicitNames.length === 0 &&
				![...pack.files.keys()].some(
					(k) => k.startsWith(dir + "/") || k.startsWith("pack/" + dir + "/"),
				)
			) {
				for (const key of pack.files.keys()) {
					if (!key.toLowerCase().startsWith("sequences/")) continue;
					dir = key.split("/").slice(0, 2).join("/");
					break;
				}
			}
			const names: string[] = [];
			if (explicitNames.length) {
				names.push(...explicitNames);
			} else {
				const prefix = dir ? dir + "/" : "sequences/";
				for (const key of pack.files.keys()) {
					const norm = key.startsWith("pack/") ? key.slice(5) : key;
					if (!norm.startsWith(prefix)) continue;
					const base = norm.slice(prefix.length);
					if (!base || base.includes("/")) continue;
					if (/\.(png|jpe?g|webp|bmp|gif)$/i.test(base)) names.push(base);
				}
				names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
			}
			if (!names.length) {
				console.warn("[vfxpack] sequence empty", node.name || node.uuid, dir);
				continue;
			}
			const fps = Math.max(1, Number(merged.sequenceFps) || 30);
			const full = names.length <= SEQ_FULL_DECODE_MAX;
			const cache: FrameCache = {
				mode: full ? "full" : "lru",
				frameCount: names.length,
				delays: [],
				durationSec: names.length / fps,
				lru: new Map(),
				inflight: new Map(),
				names,
				fps,
				dirRel: dir,
				pack,
				gen: 0,
				...(full ? { frames: [] as ImageBitmap[] } : {}),
			};
			(object.userData as { __fccMediaCache?: FrameCache }).__fccMediaCache = cache;
			(object.userData as { __fccMediaActive?: boolean }).__fccMediaActive = true;
			(object.userData as { __fccMediaTime?: number }).__fccMediaTime = 0;
			// fcc-tl-flower-21: warm-decode small sequences (hello=50); runtime still seek→sample→blit→RT.
			// Decode straight into frames[] (skip LRU) so eviction cannot close kept bitmaps.
			if (full && cache.frames) {
				let decoded = 0;
				for (let i = 0; i < names.length; i++) {
					const fname = names[i];
					let bytes = lookupPackSeqBytes(pack, dir, fname);
					if (!bytes) {
						const url = lookupPackSeqUrl(pack, dir, fname);
						if (url) {
							try {
								const res = await fetch(url);
								if (res.ok) {
									bytes = new Uint8Array(await res.arrayBuffer());
									pack.files.set(dir + "/" + fname, bytes);
								}
							} catch { /* skip */ }
						}
					}
					if (!bytes) continue;
					const lower = fname.toLowerCase();
					const mime = lower.endsWith(".jpg") || lower.endsWith(".jpeg")
						? "image/jpeg"
						: lower.endsWith(".webp")
							? "image/webp"
							: lower.endsWith(".gif")
								? "image/gif"
								: lower.endsWith(".bmp")
									? "image/bmp"
									: "image/png";
					try {
						const blob = new Blob([bytes.slice()], { type: mime });
						const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "none" }).catch(() =>
							createImageBitmap(blob),
						);
						cache.frames[i] = bitmap;
						decoded++;
					} catch {
						/* skip bad frame */
					}
				}
				if (!decoded) {
					console.warn("[vfxpack] sequence full-decode empty", node.name || node.uuid, dir);
					cache.mode = "lru";
					delete cache.frames;
				} else {
					if (decoded < names.length) {
						const holes: number[] = [];
						for (let hi = 0; hi < names.length; hi++) {
							if (!cache.frames![hi]) holes.push(hi);
						}
						console.warn("[vfxpack] seq sample miss (full-decode holes)", {
							dir,
							decoded,
							total: names.length,
							holes: holes.slice(0, 12),
						});
					}
					const first = cache.frames[0] || cache.frames.find(Boolean)!;
					uploadPackBitmap(cache, first, 0);
					markPackVideoFrameReady();
				}
			} else {
				const bit0 = await ensurePackSeqFrame(cache, 0);
				if (bit0) {
					uploadPackBitmap(cache, bit0, 0);
					markPackVideoFrameReady();
				}
				for (let d = 1; d <= Math.min(8, names.length - 1); d++) {
					void ensurePackSeqFrame(cache, d);
				}
			}
			continue;
		}

		let path = merged.path || "";
		if (!path || !pack.files.has(path)) {
			const needle = String(merged.fileName || "").split(/[/\\]/).pop()?.toLowerCase() || "";
			const uuid8 = node.uuid.slice(0, 8).toLowerCase();
			for (const key of pack.files.keys()) {
				const lower = key.toLowerCase();
				if (!lower.startsWith("videos/")) continue;
				if (
					lower.includes(uuid8) ||
					(needle && lower.endsWith(needle)) ||
					(!needle && lower.endsWith(".mp4"))
				) {
					path = key;
					break;
				}
			}
		}
		if (!path) {
			console.warn("[vfxpack] video player has no packed file", node.name || node.uuid);
			continue;
		}
		const spec = { ...merged, path };
		const url = packVideoUrl(pack, path);
		if (!url) {
			console.warn("[vfxpack] video file missing", path);
			continue;
		}
		const video = document.createElement("video");
		video.crossOrigin = "anonymous";
		video.playsInline = true;
		video.muted = true;
		video.preload = "auto";
		video.src = url;
		registerLivePackVideo(video);
		await new Promise<void>((resolve) => {
			const done = () => resolve();
			video.addEventListener("loadeddata", done, { once: true });
			video.addEventListener("error", done, { once: true });
		});
		const texture = new THREE.VideoTexture(video);
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.minFilter = THREE.LinearFilter;
		texture.magFilter = THREE.LinearFilter;
		texture.generateMipmaps = false;
		const ud = object.userData as {
			__fccVideo?: HTMLVideoElement;
			__fccVideoTexture?: THREE.VideoTexture;
			fccVideoPlayer?: {
				targetUuid?: string;
				loop?: boolean;
				muted?: boolean;
				volume?: number;
			};
		};
		ud.__fccVideo = video;
		ud.__fccVideoTexture = texture;
		ud.fccVideoPlayer = {
			...(ud.fccVideoPlayer || {}),
			kind: "video",
			targetUuid: spec.targetUuid || ud.fccVideoPlayer?.targetUuid || "",
			loop: spec.loop !== false,
			muted: spec.muted === true,
			volume: Number.isFinite(Number(spec.volume)) ? Number(spec.volume) : 1,
		};
	}
}


type PackRtWrapMode = "clamp" | "repeat" | "mirroredRepeat";

function normalizePackRtWrapMode(mode: unknown): PackRtWrapMode {
	const m = String(mode ?? "").trim();
	if (m === "clamp" || m === "repeat" || m === "mirroredRepeat") return m;
	if (m === "ClampToEdge" || m === "ClampToEdgeWrapping" || m === "Clamp") return "clamp";
	if (m === "Repeat" || m === "RepeatWrapping") return "repeat";
	if (m === "MirroredRepeat" || m === "MirroredRepeatWrapping") return "mirroredRepeat";
	return "clamp";
}

function applyPackRtTextureWrap(texture: THREE.Texture, wrapMode: unknown) {
	const mode = normalizePackRtWrapMode(wrapMode);
	const wrapping =
		mode === "repeat"
			? THREE.RepeatWrapping
			: mode === "mirroredRepeat"
				? THREE.MirroredRepeatWrapping
				: THREE.ClampToEdgeWrapping;
	if (texture.wrapS !== wrapping || texture.wrapT !== wrapping) {
		texture.wrapS = wrapping;
		texture.wrapT = wrapping;
		texture.needsUpdate = true;
	}
}

export function ensurePackRenderTargets(root: THREE.Object3D) {
	root.traverse((object) => {
		const spec = (object.userData as {
			fccRenderTexture?: { width?: number; height?: number; wrapMode?: string };
		}).fccRenderTexture;
		if (!spec) return;
		const width = Math.min(4096, Math.max(16, Math.round(Number(spec.width) || 512)));
		const height = Math.min(4096, Math.max(16, Math.round(Number(spec.height) || 512)));
		spec.width = width;
		spec.height = height;
		spec.wrapMode = normalizePackRtWrapMode(spec.wrapMode);
		let rt = (object.userData as { __fccRT?: THREE.WebGLRenderTarget }).__fccRT;
		if (!rt) {
			// Three r152+: non-XR RTs are written in workingColorSpace (linear).
			// Marking SRGB caused MeshBasic/sticker double-decode (dark/red GIF).
			rt = new THREE.WebGLRenderTarget(width, height, {
				depthBuffer: false,
				stencilBuffer: false,
				generateMipmaps: false,
				minFilter: THREE.LinearFilter,
				magFilter: THREE.LinearFilter,
				format: THREE.RGBAFormat,
				type: THREE.UnsignedByteType,
				colorSpace: THREE.LinearSRGBColorSpace,
			});
			rt.texture.flipY = false;
			rt.texture.generateMipmaps = false;
			rt.texture.premultipliedAlpha = false;
			rt.texture.userData.fccRenderTextureUuid = object.uuid;
			(object.userData as { __fccRT?: THREE.WebGLRenderTarget }).__fccRT = rt;
		} else if (rt.width !== width || rt.height !== height) {
			rt.setSize(width, height);
		}
		// Always re-mark so hot sessions pick up LinearSRGB after code change.
		const prevCS = rt.texture.colorSpace;
		rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
		if (prevCS && prevCS !== THREE.LinearSRGBColorSpace) {
			rt.texture.userData.fccColorSpaceResync = true;
		}
		rt.texture.userData.fccRenderTextureUuid = object.uuid;
		applyPackRtTextureWrap(rt.texture, spec.wrapMode);
	});
}

export function rebindPackRenderTextures(root: THREE.Object3D) {
	const live = new Map<string, THREE.Texture>();
	root.traverse((object) => {
		const rt = (object.userData as { __fccRT?: THREE.WebGLRenderTarget }).__fccRT;
		if (rt) live.set(object.uuid, rt.texture);
	});
	if (live.size === 0) return;

	root.traverse((object) => {
		const materials = Array.isArray(object.material)
			? object.material
			: object.material
				? [object.material]
				: [];
		for (const material of materials) {
			if (!material) continue;
			const slots = (material.userData as { fccRtSlots?: RtSlot[] }).fccRtSlots;
			if (!slots) continue;
			for (const slot of slots) {
				let texture = live.get(slot.uuid);
				if (!texture && slot.uuid === "__auto__" && live.size === 1) {
					texture = live.values().next().value;
				}
				if (!texture) continue;
				let changed = false;
				if (slot.key === "map" && material.map !== texture) {
					material.map = texture;
					changed = true;
				}
				const shader = material as THREE.ShaderMaterial;
				if (shader.uniforms && shader.uniforms[slot.key]) {
					if (shader.uniforms[slot.key].value !== texture) {
						shader.uniforms[slot.key].value = texture;
						changed = true;
					}
					if (shader.uniforms.useMap && shader.uniforms.useMap.value !== true) {
						shader.uniforms.useMap.value = true;
						changed = true;
					}
					// Flower texture fill (uFccTex) may start with placeholder until RT is live.
					if (slot.key === "uFccTex" && shader.uniforms.uFccTexUse) {
						if (shader.uniforms.uFccTexUse.value !== 1) {
							shader.uniforms.uFccTexUse.value = 1;
							changed = true;
						}
					}
				}
				// GIF/seq RT has real alpha — without transparent, Three OPAQUE forces a=1.
				if (texture.userData?.fccHasAlpha && !material.transparent) {
					material.transparent = true;
					changed = true;
				}
				// fcc-tl-flower-55: needsUpdate every frame forced shader rebuild → scrub/play jank.
				if (changed) material.needsUpdate = true;
			}
		}
	});
}

function localVideoTime(video: HTMLVideoElement, time: number, loop: boolean): number {
	const duration = video.duration;
	if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, time);
	if (loop) return time % duration;
	return Math.min(Math.max(0, time), Math.max(0, duration - 0.04));
}

/**
 * Blit VideoPlayers into RenderTextures.
 * @param driveTransport When false, only blit (Timeline already owns seek/play).
 */
/**
 * Blit VideoPlayers into RenderTextures.
 * @returns true when at least one RT was rewritten this call.
 */
export function syncPackVideos(
	renderer: THREE.WebGLRenderer,
	root: THREE.Object3D,
	timeSeconds: number,
	opts?: { driveTransport?: boolean },
): boolean {
	const driveTransport = opts?.driveTransport !== false;
	let didBlit = false;
	const players: THREE.Object3D[] = [];
	root.traverse((object) => {
		const ud = object.userData as { __fccVideo?: HTMLVideoElement; __fccMediaCache?: FrameCache; fccVideoPlayer?: { kind?: string } };
		if (ud.__fccVideo || ud.__fccMediaCache) players.push(object);
	});
	if (players.length === 0) return false;

	const playing = previewState.playing;
	const master = previewState.volume;
	const targets = new Map<string, THREE.WebGLRenderTarget>();
	root.traverse((object) => {
		const rt = (object.userData as { __fccRT?: THREE.WebGLRenderTarget }).__fccRT;
		if (rt) targets.set(object.uuid, rt);
	});

	const prevTarget = renderer.getRenderTarget();
	const prevAutoClear = renderer.autoClear;
	const prevTone = renderer.toneMapping;
	const prevViewport = new THREE.Vector4();
	const prevScissor = new THREE.Vector4();
	renderer.getViewport(prevViewport);
	renderer.getScissor(prevScissor);
	const prevScissorTest = renderer.getScissorTest();

	for (const object of players) {
		const ud = object.userData as {
			__fccVideo?: HTMLVideoElement;
			__fccVideoTexture?: THREE.VideoTexture;
			__fccMediaCache?: FrameCache;
			__fccMediaTime?: number | null;
			__fccMediaActive?: boolean;
			__fccTlMediaDriven?: boolean;
			__fccTlMediaDrivenAt?: number;
			__fccTlBound?: boolean;
	/** Whether the last timeline visit had this element inside its clip range. */
	__fccTlInRange?: boolean;
			/** Media ended while the clip was still on screen (see TimelineVideoDrive). */
			__fccTlMediaEnded?: boolean;
			/** Shared throttle stamp for scrub kicks / self-clock resyncs. */
			__fccTlLastSeekKickMs?: number;
			fccVideoPlayer?: {
				targetUuid?: string;
				loop?: boolean;
				muted?: boolean;
				volume?: number;
				kind?: string;
				autoplay?: boolean;
				playbackRate?: number;
			};
		};
			const vp = ud.fccVideoPlayer;
			if (!vp?.targetUuid) continue;
			const mediaKind = packMediaKind(vp, ud.__fccMediaCache);
			if (mediaKind === "gif" || mediaKind === "imageSequence") {
				// Editor FccVideo.updateFccVideos: timeline owns __fccMediaTime →
				// sampleMediaFrameSync → blitTextureToRT → rebind fccRtSlots.
				// "Timeline owns this" is a property of the element (__fccTlBound),
				// not of whether the pack happens to have video tracks: a pack clip
				// on a graphic track still has its media advanced by
				// samplePackTimeline, and free-running it here would overwrite the
				// frame the timeline just chose.
				const tlDriven = ud.__fccTlBound === true || !driveTransport;
				const wantsAuto = packAutoplayEnabled(vp);
				ud.__fccMediaActive = true;
				if (!tlDriven) {
					// No timeline binding: autoplay self-clocks on clip local time; else freeze.
					ud.__fccMediaTime = wantsAuto ? (Number(timeSeconds) || 0) : 0;
				}
				const prevUploaded = ud.__fccMediaCache?.uploadedIndex;
				const tex = samplePackMediaTexture(ud, { loop: vp.loop !== false });
				if (!tex) {
					if (
						mediaKind === "imageSequence" &&
						ud.__fccMediaCache &&
						(Number(timeSeconds) || 0) > 0.05
					) {
						const missKey = "sync-no-tex:" + (object.uuid || "");
						if (!_seqMissWarned.has(missKey)) {
							_seqMissWarned.add(missKey);
							console.warn("[vfxpack] seq sample miss (no texture)", {
								uuid: object.uuid,
								time: timeSeconds,
								frames: ud.__fccMediaCache.frameCount,
								mode: ud.__fccMediaCache.mode,
								uploaded: ud.__fccMediaCache.uploadedIndex,
							});
						}
					}
					continue;
				}
				const uploaded = ud.__fccMediaCache?.uploadedIndex;
				const uploadChanged =
					ud.__fccMediaCache != null && uploaded !== prevUploaded;
				if (uploadChanged) {
					tex.needsUpdate = true;
					markPackVideoFrameReady();
				}
				const rt = targets.get(vp.targetUuid);
				if (!rt) {
					if (mediaKind === "imageSequence") {
						const missKey = "sync-no-rt:" + String(vp.targetUuid || "");
						if (!_seqMissWarned.has(missKey)) {
							_seqMissWarned.add(missKey);
							console.warn("[vfxpack] seq sample miss (no RT)", {
								targetUuid: vp.targetUuid,
								time: timeSeconds,
							});
						}
					}
					continue;
				}
				// Skip RT rewrite when gif/seq frame unchanged (preview scrub/play hot path).
				const driveUd = ud as TimelineVideoDrive;
				if (
					uploaded != null &&
					driveUd.__fccLastBlitUploadedIndex === uploaded &&
					!uploadChanged
				) {
					continue;
				}
				blitMat.map = tex;
				blitMat.transparent = true;
				blitMat.blending = THREE.NoBlending;
				blitMat.needsUpdate = true;
				renderer.toneMapping = THREE.NoToneMapping;
				renderer.autoClear = false;
				renderer.setRenderTarget(rt);
				renderer.setViewport(0, 0, rt.width, rt.height);
				renderer.setScissorTest(false);
				const prevC = new THREE.Color();
				renderer.getClearColor(prevC);
				const prevA = renderer.getClearAlpha();
				renderer.setClearColor(0x000000, 0);
				renderer.clear(true, true, true);
				renderer.render(blitScene, blitCam);
				renderer.setClearColor(prevC, prevA);
				rt.texture.userData.fccHasAlpha = true;
				rt.texture.premultipliedAlpha = false;
				rt.texture.needsUpdate = true;
				if (uploaded != null) driveUd.__fccLastBlitUploadedIndex = uploaded;
				packVideoBlitStats.blit += 1;
				didBlit = true;
				continue;
			}
			const video = ud.__fccVideo;
			const texture = ud.__fccVideoTexture;
			if (!video || !texture) continue;
			if (video.readyState < 2) continue;
			// Mid-seek frames are often empty; keep the last good RT until seeked.
			if (video.seeking) {
				packVideoBlitStats.skipSeeking += 1;
				continue;
			}

			/**
			 * Two transports used to run over the same element whenever the pack
			 * timeline had no *video track* (exactly the vfxpack case: the moving
			 * picture sits in a VideoPlayer on a graphic track):
			 *
			 *   - `seekPackTimelineVideo` (soft sync: 45ms band, 400ms hard seek,
			 *     playbackRate trimmed by up to ±15%)
			 *   - this self-clock branch (hard `currentTime = targetTime` whenever
			 *     drift passed 0.2s, plus an unconditional playbackRate reset)
			 *
			 * They fought. The rate reset undid every trim, drift grew past 0.2s,
			 * and the self-clock then wrote `currentTime` on *every* frame. Each
			 * write left `video.seeking === true`, and the blit above `continue`s
			 * while seeking — so with a playhead at 2s and the clip starting at 3s
			 * the element thrashed audibly (咔咔, unmuted because the clip is now
			 * "playing") and the RT never received a single frame: sound only, no
			 * picture.
			 *
			 * The timeline wins for any element it has ever visited, including the
			 * frames where the clip is out of range and the timeline's job is to
			 * park it.
			 */
			const tlDrivenV = ud.__fccTlBound === true || !driveTransport;
			const wantsAutoV = packAutoplayEnabled(vp);
			if (!tlDrivenV) {
				const loop = vp.loop !== false;
				const selfClock = wantsAutoV;
				const targetTime = selfClock
					? localVideoTime(video, timeSeconds, loop)
					: 0;
				// Mute is independent of transport. RT / sticker VideoPlayers are often
				// muted; gating play() on audible forced pause+seek every frame → stutter.
				// fcc-tl-flower-53: free-run whenever NLE is playing + autoplay.
				const audible = selfClock && playing && vp.muted !== true;
				video.loop = selfClock ? loop : false;
				applyPackVideoRate({ video, rate: packPlaybackRate(vp) });
				video.muted = !audible;
				video.volume = audible
					? Math.min(1, Math.max(0, (vp.volume ?? 1) * master))
					: 0;

				if (selfClock && playing) {
					// fcc-tl-flower-67: `ended` means the non-loop clamp already ran
					// out of media; play() would restart it from 0 (see the ended-park
					// in seekPackTimelineVideo for the audible consequence).
					if (video.paused && !video.ended) video.play().catch(() => {});
					if (Math.abs((video.currentTime || 0) - targetTime) > VIDEO_SEEK_PLAY) {
						// Never chase every frame. An element that is already seeking
						// cannot advance, so next frame measures the same miss again;
						// re-issuing it turns one transient offset into a permanent
						// freeze — the picture never lands while audio keeps running.
						// This is exactly what "播放头在 2s、clip 从 3s 开始" used to hit:
						// the clip woke mid-play, both drivers wrote currentTime, and
						// syncPackVideos skipped every blit because video.seeking stayed
						// true. Sound 咔咔, no picture.
						const now = performance.now();
						if (
							now - (ud.__fccTlLastSeekKickMs || 0) >=
							SEEK_CORRECTION_BACKOFF_MS
						) {
							ud.__fccTlLastSeekKickMs = now;
							video.currentTime = targetTime;
						}
					}
				} else {
					// fcc-tl-flower-58: pause + mute only — no currentTime writes.
					// Seeking here after play ended caused Duo's audible 咔咔 thrash.
					video.muted = true;
					video.volume = 0;
					if (!video.paused) video.pause();
				}
			}

		const rt = targets.get(vp.targetUuid);
		if (!rt) continue;

		/**
		 * Safety net: the timeline owns transport for a bound element, but that
		 * also means this function never starts it. If the timeline path ever
		 * leaves an on-screen clip parked while the transport is running, nothing
		 * else will notice — the element just sits there on a frozen frame and the
		 * picture never advances, which reads exactly like "the video only plays
		 * when the playhead is already on the clip".
		 *
		 * This cannot fight the timeline: it only acts when the element is
		 * paused, never writes currentTime, never touches playbackRate, and never
		 * runs for an element that is out of range (that one is parked on purpose).
		 * `stuckPausedPlays` in the probe counts how often it had to rescue.
		 */
		if (
			tlDrivenV &&
			ud.__fccTlInRange === true &&
			playing &&
			video.paused &&
			!video.seeking &&
			/**
			 * fcc-tl-flower-67: never rescue an element whose media is over.
			 * `__fccTlInRange` is a property of the CLIP, not of the media: a
			 * 1.667s player inside a 5.67s clip stays "in range" for 4s after its
			 * picture ends. Rescuing it called `play()` every frame on an ended
			 * element, which restarts it from 0 and produces the 咔咔咔 loop.
			 */
			!video.ended &&
			ud.__fccTlMediaEnded !== true
		) {
			packVideoBlitStats.stuckPausedPlays += 1;
			video.play().catch(() => {});
		}

		const driveUdV = ud as TimelineVideoDrive;
		const mediaT = video.currentTime || 0;
		const lastBlit = driveUdV.__fccLastBlitMediaTime;
		// Mid-seek already continued above — last-good RT stays on screen.
		// Scrub/pause: skip GPU blit when currentTime unchanged.
		// Play: skip only when decoded-frame counter stalls (same presentation).
		if (video.paused) {
			if (lastBlit != null && Math.abs(lastBlit - mediaT) < 0.001) {
				packVideoBlitStats.skipUnchanged += 1;
				continue;
			}
		} else {
			const vq = video as HTMLVideoElement & {
				webkitDecodedFrameCount?: number;
				__fccLastDecodedFrames?: number;
			};
			const dec = vq.webkitDecodedFrameCount;
			if (typeof dec === "number") {
				if (vq.__fccLastDecodedFrames === dec) {
					packVideoBlitStats.skipUnchanged += 1;
					continue;
				}
				vq.__fccLastDecodedFrames = dec;
			}
			// No decoded-frame counter: blit every RAF while free-running.
		}

		texture.needsUpdate = true;
		blitMat.map = texture;
		blitMat.transparent = true;
		blitMat.blending = THREE.NoBlending;
		blitMat.needsUpdate = true;
		renderer.toneMapping = THREE.NoToneMapping;
		renderer.autoClear = false;
		renderer.setRenderTarget(rt);
		renderer.setViewport(0, 0, rt.width, rt.height);
		renderer.setScissorTest(false);
		const prevCv = new THREE.Color();
		renderer.getClearColor(prevCv);
		const prevAv = renderer.getClearAlpha();
		renderer.setClearColor(0x000000, 1);
		renderer.clear(true, true, true);
		renderer.render(blitScene, blitCam);
		renderer.setClearColor(prevCv, prevAv);
		rt.texture.userData.fccHasAlpha = false;
		driveUdV.__fccLastBlitMediaTime = mediaT;
		driveUdV.__fccBlitRtW = rt.width;
		driveUdV.__fccBlitRtH = rt.height;
		packVideoBlitStats.blit += 1;
		didBlit = true;
	}

	blitMat.map = null;
	renderer.toneMapping = prevTone;
	renderer.autoClear = prevAutoClear;
	renderer.setRenderTarget(prevTarget);
	renderer.setViewport(prevViewport);
	renderer.setScissor(prevScissor);
	renderer.setScissorTest(prevScissorTest);
	return didBlit;
}

export function disposePackVideos(root: THREE.Object3D) {
	root.traverse((object) => {
		const ud = object.userData as {
			__fccVideo?: HTMLVideoElement;
			__fccVideoTexture?: THREE.VideoTexture;
			__fccRT?: THREE.WebGLRenderTarget;
			__fccMediaCache?: FrameCache;
		};
		const cache = ud.__fccMediaCache;
		if (cache) {
			cache.gen++;
			for (const b of cache.lru.values()) b.close?.();
			cache.lru.clear();
			if (cache.frames) for (const b of cache.frames) b.close?.();
			cache.decoder?.close?.();
			cache.texture?.dispose();
			ud.__fccMediaCache = undefined;
		}
		if (ud.__fccVideo) {
			unregisterLivePackVideo(ud.__fccVideo);
			ud.__fccVideo.pause();
			ud.__fccVideo.removeAttribute("src");
			ud.__fccVideo.load();
			ud.__fccVideo = undefined;
		}
		ud.__fccVideoTexture?.dispose();
		ud.__fccVideoTexture = undefined;
		ud.__fccRT?.dispose();
		ud.__fccRT = undefined;
	});
}

/**
 * Dev-only snapshot of every live pack video element. "It plays wrong after a few
 * scrubs" is hard to reproduce by eye; this shows which latch is stuck — an
 * unresolved seek, a stale seek target, idle-parked, or the blit-skip counter.
 *
 * Console: `__fccPackVideo()`
 */
export function describePackVideoState(): Array<Record<string, unknown>> {
	const rows: Array<Record<string, unknown>> = [];
	for (const video of livePackVideos) {
		const drive = (
			video as HTMLVideoElement & { __fccTlDriveUd?: TimelineVideoDrive }
		).__fccTlDriveUd;
		const decoded = video as HTMLVideoElement & {
			webkitDecodedFrameCount?: number;
			__fccLastDecodedFrames?: number;
		};
		const counters = getPackVideoCounters(video);
		// Standard API: totalVideoFrames vs droppedVideoFrames is the ground truth
		// for "the picture is choppy" that no amount of app-side timing explains.
		const quality =
			typeof video.getVideoPlaybackQuality === "function"
				? video.getVideoPlaybackQuality()
				: undefined;
		const source = video.currentSrc || video.src || "";
		const buffered = video.buffered;
		const bufferedEnd =
			buffered && buffered.length > 0 ? buffered.end(buffered.length - 1) : null;
		rows.push({
			src: source.split("/").pop() ?? "",
			res: `${video.videoWidth || 0}x${video.videoHeight || 0}`,
			rtRes:
				drive?.__fccBlitRtW != null
					? `${drive.__fccBlitRtW}x${drive.__fccBlitRtH}`
					: null,
			paused: video.paused,
			seeking: video.seeking,
			readyState: video.readyState,
			currentTime: Number((video.currentTime || 0).toFixed(3)),
			duration: Number((video.duration || 0).toFixed(3)),
			bufferedEnd:
				bufferedEnd != null ? Number(bufferedEnd.toFixed(3)) : null,
			playbackRate: Number((video.playbackRate || 1).toFixed(3)),
			muted: video.muted,
			seekTarget: drive?.__fccTlSeekTarget,
			wantPlay: drive?.__fccTlWantPlay,
			idleParked: drive?.__fccTlIdleParked,
			/** Media ended while the clip is still on screen (fcc-tl-flower-67). */
			mediaEnded: drive?.__fccTlMediaEnded === true,
			ended: video.ended,
			startSeekDone: drive?.__fccTlStartSeekDone,
			lastBlit: drive?.__fccLastBlitMediaTime,
			/** Positive => the element is ahead of the playhead. */
			driftMs:
				drive?.__fccTlLastDriftSec != null
					? Math.round(drive.__fccTlLastDriftSec * 1000)
					: null,
			syncMode: drive?.__fccTlSyncMode,
			/** Timeline owns this element (see TimelineVideoDrive.__fccTlBound). */
			tlBound: drive?.__fccTlBound === true,
			/** Timeline drove it within the last ~2 frames. */
			timelineFresh: drive ? isTimelineDriven(drive) : null,
			/** Inside the clip range on the last timeline visit. */
			inRange: drive?.__fccTlInRange === true,
			/**
			 * The one flag that means "this is broken": the clip is on screen, the
			 * transport is running, and the element still is not advancing.
			 */
			stuckPaused:
				previewState.playing &&
				drive?.__fccTlInRange === true &&
				video.paused === true,
			correctionAgeMs:
				drive?.__fccTlLastCorrectionMs != null
					? Math.round(performance.now() - drive.__fccTlLastCorrectionMs)
					: null,
			/** Cumulative. `waitingCount` climbing during play == decode-bound stutter. */
			waits: counters.waitingCount,
			plays: counters.playingCount,
			seeks: counters.seekCount,
			seekMs: Math.round(counters.seekMs),
			totalFrames: quality?.totalVideoFrames,
			droppedFrames: quality?.droppedVideoFrames,
			decodedFrames: decoded.webkitDecodedFrameCount,
			lastDecodedFrames: decoded.__fccLastDecodedFrames,
			transport: previewState.playing
				? "playing"
				: previewState.scrubbing
					? "scrubbing"
					: "idle",
		});
	}
	return rows;
}

/**
 * Sample pack-video state over a window of real playback and summarise it.
 *
 * Play a few seconds of the problem clip, then run
 * `await __fccPackVideoWatch(6000)` and keep playing. The summary separates the
 * three failure modes that all look like "stutter":
 *   - `waits` up        → decode-bound  (source too heavy for realtime decode)
 *   - `seeks` up        → seek storm    (sync machine fighting the playhead)
 *   - neither, but app FPS low → compose-bound (look at the light meter)
 */
export async function watchPackVideoState({
	ms = 6000,
}: {
	ms?: number;
} = {}): Promise<Record<string, unknown>> {
	const pmBefore = { ...packVideoBlitStats };
	const before = new Map<HTMLVideoElement, PackVideoCounters>();
	const framesOf = new Map<HTMLVideoElement, number>();
	for (const video of livePackVideos) {
		const c = getPackVideoCounters(video);
		before.set(video, { ...c });
		const q =
			typeof video.getVideoPlaybackQuality === "function"
				? video.getVideoPlaybackQuality()
				: undefined;
		framesOf.set(video, q?.totalVideoFrames ?? 0);
	}
	const driftSamples: number[] = [];
	const modes: Record<string, number> = {};
	const started = performance.now();
	let ticks = 0;
	await new Promise<void>((resolve) => {
		const tick = () => {
			ticks += 1;
			for (const video of livePackVideos) {
				const drive = (
					video as HTMLVideoElement & { __fccTlDriveUd?: TimelineVideoDrive }
				).__fccTlDriveUd;
				if (!drive) continue;
				if (drive.__fccTlSyncMode) {
					modes[drive.__fccTlSyncMode] = (modes[drive.__fccTlSyncMode] ?? 0) + 1;
				}
				if (drive.__fccTlLastDriftSec != null) {
					driftSamples.push(Math.abs(drive.__fccTlLastDriftSec) * 1000);
				}
			}
			if (performance.now() - started >= ms) {
				resolve();
				return;
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
	const elapsedSec = (performance.now() - started) / 1000;
	const perVideo: Array<Record<string, unknown>> = [];
	for (const video of livePackVideos) {
		const now = getPackVideoCounters(video);
		const was = before.get(video);
		const q =
			typeof video.getVideoPlaybackQuality === "function"
				? video.getVideoPlaybackQuality()
				: undefined;
		const frames = (q?.totalVideoFrames ?? 0) - (framesOf.get(video) ?? 0);
		const decoded = (q?.totalVideoFrames ?? 0) / Math.max(0.001, elapsedSec);
		perVideo.push({
			res: `${video.videoWidth || 0}x${video.videoHeight || 0}`,
			seeks: now.seekCount - (was?.seekCount ?? 0),
			waits: now.waitingCount - (was?.waitingCount ?? 0),
			plays: now.playingCount - (was?.playingCount ?? 0),
			decodeFps: Number(decoded.toFixed(1)),
			newFrames: frames,
		});
	}
	driftSamples.sort((a, b) => a - b);
	// Percentile pick, returning null instead of asserting so an empty window
	// (no sample landed) reads as "unknown" rather than crashing the probe.
	const pick = (p: number): number | null => {
		if (driftSamples.length === 0) return null;
		const i = Math.min(driftSamples.length - 1, Math.floor(driftSamples.length * p));
		const v = driftSamples[i];
		return v == null ? null : Math.round(v);
	};
	const summary = {
		windowSec: Number(elapsedSec.toFixed(2)),
		rafTicks: ticks,
		appFps: Number((ticks / Math.max(0.001, elapsedSec)).toFixed(1)),
		blitPerSec: Number(
			((packVideoBlitStats.blit - pmBefore.blit) / Math.max(0.001, elapsedSec)).toFixed(1),
		),
		skipSeekingPerSec: Number(
			(
				(packVideoBlitStats.skipSeeking - pmBefore.skipSeeking) /
				Math.max(0.001, elapsedSec)
			).toFixed(1),
		),
			skipUnchangedPerSec: Number(
				(
					(packVideoBlitStats.skipUnchanged - pmBefore.skipUnchanged) /
					Math.max(0.001, elapsedSec)
				).toFixed(1),
			),
			/** >0 means the timeline left an on-screen clip paused and the net caught it. */
			stuckPausedPlays: packVideoBlitStats.stuckPausedPlays - pmBefore.stuckPausedPlays,
		driftMs: {
			p50: pick(0.5),
			p90: pick(0.9),
			max: pick(1),
		},
		syncModes: modes,
		videos: perVideo,
	};
	// Dev-only probe: printing is the point.
	console.table(perVideo);
	console.log("[vfxpack] playback window summary", summary);
	return summary;
}

/**
 * Record the transport state machine frame by frame and print only the frames
 * where something discrete changed.
 *
 * This exists because "the video only plays when the playhead is already on the
 * clip" is a *transition* bug: everything looks healthy in a static snapshot,
 * and the failure lives in the two or three frames around the clip boundary.
 * Watching `currentTime` against `inRange`/`playing`/`syncMode` shows whether
 * the element was ever asked to start, and whether it obeyed.
 *
 *   await __fccPackVideoRecord({ ms: 5000 })
 *
 * Play across the clip start while it runs.
 */
export async function recordPackVideoState({
	ms = 5000,
}: {
	ms?: number;
} = {}): Promise<Array<Record<string, unknown>>> {
	const rows: Array<Record<string, unknown>> = [];
	const started = performance.now();
	let lastSig = "";
	await new Promise<void>((resolve) => {
		const tick = () => {
			const at = Math.round(performance.now() - started);
			let video = livePackVideos.values().next().value as
				| HTMLVideoElement
				| undefined;
			// Prefer an element the timeline has actually visited.
			for (const candidate of livePackVideos) {
				const drive = (
					candidate as HTMLVideoElement & { __fccTlDriveUd?: TimelineVideoDrive }
				).__fccTlDriveUd;
				if (drive?.__fccTlBound) {
					video = candidate;
					break;
				}
			}
			if (video) {
				const drive = (
					video as HTMLVideoElement & { __fccTlDriveUd?: TimelineVideoDrive }
				).__fccTlDriveUd;
				const counters = getPackVideoCounters(video);
				const sig = [
					video.paused,
					video.seeking,
					drive?.__fccTlInRange === true,
					previewState.playing,
					drive?.__fccTlSyncMode,
				].join("|");
				if (sig !== lastSig) {
					lastSig = sig;
					rows.push({
						ms: at,
						ct: Number((video.currentTime || 0).toFixed(2)),
						rate: Number((video.playbackRate || 1).toFixed(3)),
						paused: video.paused,
						seeking: video.seeking,
						inRange: drive?.__fccTlInRange === true,
						transport: previewState.playing ? "playing" : "idle",
						syncMode: drive?.__fccTlSyncMode,
						seeks: counters.seekCount,
						waits: counters.waitingCount,
					});
				}
			}
			if (performance.now() - started >= ms) {
				resolve();
				return;
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
	console.table(rows);
	return rows;
}

declare global {
	interface Window {
		/** Dev-only: dump live pack video element state. See describePackVideoState. */
		__fccPackVideo?: () => Array<Record<string, unknown>>;
		/** Dev-only: sample playback for N ms and print a stutter triage summary. */
		__fccPackVideoWatch?: (opts?: { ms?: number }) => Promise<Record<string, unknown>>;
		/** Dev-only: frame-by-frame transport trace. See recordPackVideoState. */
		__fccPackVideoRecord?: (opts?: { ms?: number }) => Promise<Array<Record<string, unknown>>>;
		/** Dev-only: same rows as __fccPackVideo(), serialised for copy/paste. */
		__fccPackVideoJSON?: () => string;
	}
}

if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
	if (!window.__fccPackVideo) {
		window.__fccPackVideo = () => {
			const rows = describePackVideoState();
			console.table(rows);
			return rows;
		};
	}
	if (!window.__fccPackVideoJSON) {
		window.__fccPackVideoJSON = () =>
			JSON.stringify(
				{
					at: new Date().toISOString(),
					preview: { ...previewState },
					blit: { ...packVideoBlitStats },
					videos: describePackVideoState(),
				},
				null,
				2,
			);
	}
	if (!window.__fccPackVideoWatch) {
		window.__fccPackVideoWatch = watchPackVideoState;
	}
	if (!window.__fccPackVideoRecord) {
		window.__fccPackVideoRecord = recordPackVideoState;
	}
}
