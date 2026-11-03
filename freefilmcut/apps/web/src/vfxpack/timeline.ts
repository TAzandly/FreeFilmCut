import type * as THREE from "three";
import {
	applyAnimToRoot,
	type ApplyAnimOptions,
	type FreecapcutAnimClip,
} from "@/vfxpack/freecapcut-anim";

export const TIMELINE_FORMAT = "freecapcut-timeline/1";

export type TimelineTrackClip = {
	id?: string;
	start: number;
	duration: number;
	animId?: string;
	animPath?: string;
	name?: string;
	clipLocalOffset?: number;
	mediaOffset?: number;
	loop?: boolean;
	videoPlayerUuid?: string;
};

export type TimelineTrack = {
	id?: string;
	type: "animation" | "video" | "activation" | string;
	name?: string;
	muted?: boolean;
	bindingUuid?: string;
	videoPlayerUuid?: string;
	clips?: TimelineTrackClip[];
};

export type TimelineAsset = {
	format?: string;
	name: string;
	fps: number;
	duration: number;
	loop?: "clamp" | "loop";
	tracks: TimelineTrack[];
};

export type SeekPackTimelineVideo = (
	obj: THREE.Object3D,
	mediaTimeSec: number | null,
	opts?: { loop?: boolean; playing?: boolean; clipKey?: string },
) => void;

function snapTimeToFrame(t: number, fps: number): number {
	const f = Math.max(1, Number(fps) || 30);
	return Math.round((Number(t) || 0) * f) / f;
}

/** True when any unmuted video track exists (NLE should not free-run all pack videos). */
export function timelineAssetHasVideoTracks(asset: TimelineAsset): boolean {
	return (asset.tracks || []).some(
		(t) => t.type === "video" && !t.muted && (t.clips?.length ?? 0) > 0,
	);
}

/**
 * Apply a pack timeline at time `t` (seconds) onto `root`.
 * Mirrors three.js editor FccTimelineCore.sampleTimeline (incl. video free-run / out-of-clip pause).
 */
export function samplePackTimeline({
	root,
	asset,
	t,
	animByName,
	objectsByUuid,
	animOpts,
	seekVideo,
	timelinePlaying = false,
}: {
	root: THREE.Object3D;
	asset: TimelineAsset;
	t: number;
	animByName?: Map<string, FreecapcutAnimClip>;
	objectsByUuid?: Map<string, THREE.Object3D>;
	/** Extra options forwarded to applyAnimToRoot (materials / post-process maps). */
	animOpts?: {
		materialsByUuid?: Map<string, THREE.Material>;
		postProcess?: ApplyAnimOptions["postProcess"];
		objectsByUuid?: Map<string, THREE.Object3D>;
	};
	seekVideo?: SeekPackTimelineVideo;
	/** When true, video tracks free-run (large drift seek only). */
	timelinePlaying?: boolean;
}): void {
	if (!root || !asset) return;
	const fps = asset.fps || 30;
	const dur = Math.max(0.01, Number(asset.duration) || 0.01);
	let tRaw = Number(t) || 0;
	if (asset.loop === "loop") {
		tRaw = ((tRaw % dur) + dur) % dur;
	} else {
		tRaw = Math.max(0, Math.min(dur, tRaw));
	}
	const time = snapTimeToFrame(tRaw, fps);
	const tVideo = timelinePlaying ? tRaw : time;

	const mergedObjects = animOpts?.objectsByUuid ?? objectsByUuid;
	const anims = animByName ?? new Map<string, FreecapcutAnimClip>();
	const resolve = (uuid: string): THREE.Object3D | undefined =>
		mergedObjects?.get(uuid) ?? root.getObjectByProperty("uuid", uuid);
	const tracks = asset.tracks || [];

	// Activation: collect bound uuids, then force visibility
	const activationBounds = new Map<string, Array<[number, number]>>();
	for (const track of tracks) {
		if (track.muted || track.type !== "activation" || !track.bindingUuid)
			continue;
		const list = activationBounds.get(track.bindingUuid) ?? [];
		for (const clip of track.clips || []) {
			const start = Number(clip.start) || 0;
			const end = start + (Number(clip.duration) || 0);
			list.push([start, end]);
		}
		activationBounds.set(track.bindingUuid, list);
	}
	for (const [uuid, ranges] of activationBounds) {
		const obj = resolve(uuid);
		if (!obj) continue;
		let visible = false;
		for (const [a, b] of ranges) {
			if (time >= a && time < b) {
				visible = true;
				break;
			}
		}
		obj.visible = visible;
	}

	// Animation tracks (later track / later clip wins)
	for (const track of tracks) {
		if (track.muted || track.type !== "animation" || !track.bindingUuid)
			continue;
		for (const clip of track.clips || []) {
			const start = Number(clip.start) || 0;
			const cdur = Number(clip.duration) || 0;
			if (time < start || time >= start + cdur) continue;
			const anim =
				(clip.animId ? anims.get(clip.animId) : undefined) ||
				(clip.animPath ? anims.get(clip.animPath) : undefined) ||
				(clip.name ? anims.get(clip.name) : undefined);
			if (!anim) continue;
			const local = time - start + (Number(clip.clipLocalOffset) || 0);
			applyAnimToRoot(root, anim, local, {
				...animOpts,
				objectsByUuid: mergedObjects,
			});
		}
	}

	// Video tracks
	if (!seekVideo) return;
	for (const track of tracks) {
		if (track.muted || track.type !== "video") continue;
		const uuid = track.bindingUuid || track.videoPlayerUuid;
		if (!uuid) continue;
		const obj = resolve(uuid);
		if (!obj) continue;
		let mediaT: number | null = null;
		let mediaLoop = false;
		let clipKey = "";
		for (const clip of track.clips || []) {
			const start = Number(clip.start) || 0;
			const cdur = Number(clip.duration) || 0;
			if (tVideo < start || tVideo >= start + cdur) continue;
			mediaT = tVideo - start + (Number(clip.mediaOffset) || 0);
			mediaLoop = !!clip.loop;
			clipKey = String(clip.id || `${track.id || "tr"}:${start}`);
		}
		if (mediaT !== null) {
			seekVideo(obj, mediaT, {
				loop: mediaLoop,
				playing: !!timelinePlaying,
				clipKey,
			});
		} else {
			seekVideo(obj, null, { playing: false });
		}
	}
}
