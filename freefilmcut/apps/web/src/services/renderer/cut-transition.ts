import { getElementLocalTime } from "@/animation";
import type { ElementAnimations } from "@/animation/types";
import { resolveOpacityAtTime } from "@/animation/values";
import type { BackgroundFillSettings } from "@/background/fill";
import {
	isBackgroundFillActive,
	readBackgroundFillFromParams,
} from "@/background/fill";
import { resolveBackgroundFillStyleUrl } from "@/background/fill-styles";
import type { StyleFillSource } from "@/background/paint-fill";
import type { ColorGradeSettings } from "@/color-grade";
import {
	isColorGradeIdentity,
	readColorGradeFromParams,
	resolveColorGradeAtTime,
} from "@/color-grade";
import type { MediaAsset } from "@/media/types";
import {
	buildTransformFromParams,
	readOpacityFromParams,
	type Transform,
} from "@/rendering";
import { resolveTransformAtTime } from "@/rendering/animation-values";
import type {
	ImageElement,
	MediaAnimAssignment,
	MediaTime,
	TimelineTrack,
	VideoElement,
} from "@/timeline";
import {
	findAdjacentCut,
	packTimelineSampleTime,
	sampleTransitionSourceTime,
	transitionWindow,
	type TransitionSourceRole,
} from "@/timeline/transitions";
import { mediaTimeToSeconds } from "@/wasm";
import { resolveVfxPackDurationSeconds } from "@/vfxpack/duration";
import { getPackRegistrySnapshot } from "@/vfxpack/pack-registry";
import { videoCache } from "@/services/video-cache/service";
import { measureSpanAsync } from "@/diagnostics/render-perf";
import { loadImageSource } from "./nodes/image-node";
import type {
	CutTransitionComposite,
	CutTransitionSide,
} from "./nodes/visual-node";

/**
 * One side of a cut (outgoing or incoming) with enough media info to
 * decode a frame outside the hard-cut visibility range.
 */
export type TransitionMediaSource = {
	elementStart: MediaTime;
	elementDuration: MediaTime;
	trimStart: MediaTime;
	trimEnd: MediaTime;
	sourceDuration?: MediaTime;
	/** Clip placement. Evaluated at the sample time, then frozen at the in/out edge. */
	transform: Transform;
	opacity: number;
	animations?: ElementAnimations;
	/** Clip background fill — baked into uFrom/uTo with the media. */
	backgroundFill: BackgroundFillSettings;
	/** Resolved style catalog URL when fill mode is style. */
	fillStyleUrl: string | null;
	/** Base color grade — baked into media (not fill) for uFrom/uTo. */
	colorGrade: ColorGradeSettings;
	/** Clip-anim assignment — baked into media (not fill) for uFrom/uTo. */
	mediaAnims?: MediaAnimAssignment;
} & (
	| {
			kind: "video";
			mediaId: string;
			file: File;
	  }
	| {
			kind: "image";
			url: string;
			/** GIF: drawing it advances frames, so it is not a static source. */
			animated?: boolean;
			maxSourceSize?: number;
	  }
);

export type CutTransitionBinding = {
	edgeId: string;
	packId: string;
	cutTime: MediaTime;
	duration: MediaTime;
	role: TransitionSourceRole;
	self: TransitionMediaSource;
	partner: TransitionMediaSource;
};

/**
 * True when `time` is inside `[cut-D/2, cut+D/2]` and this binding's clip
 * is the one the hard cut would have drawn (from before the cut, to at/after).
 */
export function ownsCutTransition({
	binding,
	time,
}: {
	binding: CutTransitionBinding;
	time: MediaTime;
}): boolean {
	const { start, end } = transitionWindow({
		cutTime: binding.cutTime,
		duration: binding.duration,
	});
	if (time < start || time > end) return false;
	if (binding.role === "from") return time < binding.cutTime;
	return time >= binding.cutTime;
}

/** Closest cut wins when two windows overlap inside one clip. */
export function pickOwnedCutTransition({
	bindings,
	time,
}: {
	bindings: CutTransitionBinding[] | undefined;
	time: MediaTime;
}): CutTransitionBinding | null {
	if (!bindings || bindings.length === 0) return null;
	let best: { binding: CutTransitionBinding; distance: number } | null = null;
	for (const binding of bindings) {
		if (!ownsCutTransition({ binding, time })) continue;
		const distance = Math.abs(time - binding.cutTime);
		if (!best || distance < best.distance) {
			best = { binding, distance };
		}
	}
	return best?.binding ?? null;
}

/**
 * True when `time` falls in any cut-transition window for these bindings.
 * Used to hide sibling fill layers — fill is already baked into uFrom/uTo.
 */
export function isInsideCutTransitionWindow({
	bindings,
	time,
}: {
	bindings: CutTransitionBinding[] | undefined;
	time: MediaTime;
}): boolean {
	if (!bindings || bindings.length === 0) return false;
	for (const binding of bindings) {
		const { start, end } = transitionWindow({
			cutTime: binding.cutTime,
			duration: binding.duration,
		});
		if (time >= start && time <= end) return true;
	}
	return false;
}

/**
 * Author timeline length T from the pack manifest (same source as
 * getVfxPackElementDuration, without the 5s element-duration fallback).
 * Null means the pack has no timeline — callers should use transition D.
 */
export function authorPackTimelineDurationSec({
	packId,
}: {
	packId: string;
}): number | null {
	const pack = getPackRegistrySnapshot().packs.find((entry) => entry.id === packId);
	if (!pack) return null;
	return resolveVfxPackDurationSeconds({ manifest: pack.manifest });
}

export function transitionPackSampleTimeSec({
	timelineTime,
	cutTime,
	duration,
	packTimelineDurationSec,
}: {
	timelineTime: MediaTime;
	cutTime: MediaTime;
	duration: MediaTime;
	packTimelineDurationSec: number | null;
}): number {
	const window = transitionWindow({ cutTime, duration });
	const durationSec = mediaTimeToSeconds({ time: duration });
	const authorT =
		packTimelineDurationSec != null && packTimelineDurationSec > 0
			? packTimelineDurationSec
			: durationSec;
	return packTimelineSampleTime({
		timelineTime: mediaTimeToSeconds({ time: timelineTime }),
		windowStart: mediaTimeToSeconds({ time: window.start }),
		duration: durationSec,
		packTimelineDurationSec: authorT,
	});
}

function isHiddenElement(element: { hidden?: boolean }): boolean {
	return element.hidden === true;
}

function toTransitionMedia({
	element,
	mediaMap,
	imageMaxSourceSize,
}: {
	element: VideoElement | ImageElement;
	mediaMap: Map<string, MediaAsset>;
	imageMaxSourceSize?: number;
}): TransitionMediaSource | null {
	const media = mediaMap.get(element.mediaId);
	if (!media?.file || !media.url) return null;
	const backgroundFill = readBackgroundFillFromParams({
		params: element.params,
	});
	const fillStyleUrl =
		backgroundFill.mode === "style"
			? resolveBackgroundFillStyleUrl({ styleId: backgroundFill.styleId })
			: null;
		const colorGrade = readColorGradeFromParams({ params: element.params });
		const timing = {
			elementStart: element.startTime,
			elementDuration: element.duration,
			trimStart: element.trimStart,
			trimEnd: element.trimEnd,
			sourceDuration: element.sourceDuration,
			transform: buildTransformFromParams({ params: element.params }),
			opacity: readOpacityFromParams({ params: element.params }),
			animations: element.animations,
			backgroundFill,
			fillStyleUrl,
			colorGrade,
			mediaAnims: element.mediaAnims,
		};
	if (element.type === "video" && media.type === "video") {
		return {
			...timing,
			kind: "video",
			mediaId: media.id,
			file: media.file,
		};
	}
	if (element.type === "image" && media.type === "image") {
		return {
			...timing,
			kind: "image",
			url: media.url,
			animated:
				media.file.type === "image/gif" || /\.gif$/i.test(media.file.name),
			...(imageMaxSourceSize != null ? { maxSourceSize: imageMaxSourceSize } : {}),
		};
	}
	return null;
}

async function resolveStyleFillSource({
	media,
}: {
	media: TransitionMediaSource;
}): Promise<StyleFillSource | null> {
	if (
		!isBackgroundFillActive({ fill: media.backgroundFill }) ||
		media.backgroundFill.mode !== "style" ||
		!media.fillStyleUrl
	) {
		return null;
	}
	const image = await loadImageSource({ url: media.fillStyleUrl });
	return {
		source: image.source,
		width: image.width,
		height: image.height,
	};
}

export function buildCutTransitionBindings({
	track,
	element,
	mediaMap,
	imageMaxSourceSize,
}: {
	track: TimelineTrack;
	element: VideoElement | ImageElement;
	mediaMap: Map<string, MediaAsset>;
	imageMaxSourceSize?: number;
}): CutTransitionBinding[] {
	if (track.type !== "video") return [];
	if (isHiddenElement(element)) return [];

	const bindings: CutTransitionBinding[] = [];
	for (const edge of track.transitions ?? []) {
		if (!edge.packId) continue;
		const role: TransitionSourceRole | null =
			edge.fromElementId === element.id
				? "from"
				: edge.toElementId === element.id
					? "to"
					: null;
		if (!role) continue;

		const cut = findAdjacentCut({
			elements: track.elements,
			fromId: edge.fromElementId,
			toId: edge.toElementId,
		});
		if (!cut) continue;

		const fromEl = track.elements.find((entry) => entry.id === edge.fromElementId);
		const toEl = track.elements.find((entry) => entry.id === edge.toElementId);
		if (!fromEl || !toEl) continue;
		if (fromEl.type !== "video" && fromEl.type !== "image") continue;
		if (toEl.type !== "video" && toEl.type !== "image") continue;
		if (isHiddenElement(fromEl) || isHiddenElement(toEl)) continue;

		const selfEl = role === "from" ? fromEl : toEl;
		const partnerEl = role === "from" ? toEl : fromEl;
		const self = toTransitionMedia({
			element: selfEl,
			mediaMap,
			imageMaxSourceSize,
		});
		const partner = toTransitionMedia({
			element: partnerEl,
			mediaMap,
			imageMaxSourceSize,
		});
		if (!self || !partner) continue;

		bindings.push({
			edgeId: edge.id,
			packId: edge.packId,
			cutTime: cut.cutTime,
			duration: edge.duration,
			role,
			self,
			partner,
		});
	}
	return bindings;
}

async function sampleTransitionMedia({
	media,
	role,
	timelineTime,
	cutTime,
	streamKey,
}: {
	media: TransitionMediaSource;
	role: TransitionSourceRole;
	timelineTime: MediaTime;
	cutTime: MediaTime;
	streamKey?: string;
}): Promise<{
	source: CanvasImageSource;
	width: number;
	height: number;
	frameKey: string;
} | null> {
	const sampled = sampleTransitionSourceTime({
		role,
		timelineTime,
		elementStart: media.elementStart,
		elementDuration: media.elementDuration,
		trimStart: media.trimStart,
		trimEnd: media.trimEnd,
		sourceDuration: media.sourceDuration,
		cutTime,
	});

	if (media.kind === "image") {
		const image = await loadImageSource({
			url: media.url,
			maxSourceSize: media.maxSourceSize,
		});
		return {
			source: image.source,
			width: image.width,
			height: image.height,
			frameKey: "still",
		};
	}

	const frame = await videoCache.getFrameAt({
		mediaId: media.mediaId,
		file: media.file,
		time: sampled.sourceTimeSec,
		streamKey,
	});
	if (!frame?.canvas) return null;
	return {
		source: frame.canvas,
		width: frame.canvas.width,
		height: frame.canvas.height,
		// Sink canvases are pooled: the same object carries different frames.
		frameKey: `t=${frame.timestamp}`,
	};
}

/**
 * Pose used when drawing this side. Inside the clip, this is the animated
 * transform. Before the in point or after the out point it holds the edge
 * pose, while the pixels still follow handle frames and freeze.
 */
export function resolveTransitionPlacement({
	media,
	timelineTime,
}: {
	media: Pick<
		TransitionMediaSource,
		"elementStart" | "elementDuration" | "transform" | "opacity" | "animations"
	>;
	timelineTime: MediaTime;
}): { transform: Transform; opacity: number } {
	const localTime = getElementLocalTime({
		timelineTime,
		elementStartTime: media.elementStart,
		elementDuration: media.elementDuration,
	});
	return {
		transform: resolveTransformAtTime({
			baseTransform: media.transform,
			animations: media.animations,
			localTime,
		}),
		opacity: resolveOpacityAtTime({
			baseOpacity: media.opacity,
			animations: media.animations,
			localTime,
		}),
	};
}

/** Same contain-then-transform quad the normal clip layer uses. */
export function transitionFrameLayout({
	canvasWidth,
	canvasHeight,
	sourceWidth,
	sourceHeight,
	transform,
}: {
	canvasWidth: number;
	canvasHeight: number;
	sourceWidth: number;
	sourceHeight: number;
	transform: Transform;
}): {
	centerX: number;
	centerY: number;
	width: number;
	height: number;
	rotationDegrees: number;
	flipX: boolean;
	flipY: boolean;
} {
	const safeSourceWidth = Math.max(1, sourceWidth);
	const safeSourceHeight = Math.max(1, sourceHeight);
	const containScale = Math.min(
		canvasWidth / safeSourceWidth,
		canvasHeight / safeSourceHeight,
	);
	const scaledWidth = safeSourceWidth * containScale * transform.scaleX;
	const scaledHeight = safeSourceHeight * containScale * transform.scaleY;
	return {
		centerX: canvasWidth / 2 + transform.position.x,
		centerY: canvasHeight / 2 + transform.position.y,
		width: Math.abs(scaledWidth),
		height: Math.abs(scaledHeight),
		rotationDegrees: transform.rotate,
		flipX: scaledWidth < 0,
		flipY: scaledHeight < 0,
	};
}

async function sampleSide({
	media,
	role,
	timelineTime,
	cutTime,
	streamKey,
	sourceIsStatic,
}: {
	media: TransitionMediaSource;
	role: TransitionSourceRole;
	timelineTime: MediaTime;
	cutTime: MediaTime;
	streamKey?: string;
	sourceIsStatic: boolean;
}): Promise<CutTransitionSide | null> {
	const raw = await measureSpanAsync({
		name: "transition:sample",
		fn: () =>
			sampleTransitionMedia({ media, role, timelineTime, cutTime, streamKey }),
	});
	if (!raw) return null;
	const placement = resolveTransitionPlacement({ media, timelineTime });
	const styleSource = await resolveStyleFillSource({ media });
	const localTime = getElementLocalTime({
		timelineTime,
		elementStartTime: media.elementStart,
		elementDuration: media.elementDuration,
	});
	const grade = resolveColorGradeAtTime({
		base: media.colorGrade,
		animations: media.animations,
		localTime,
	});
	return {
		source: raw.source,
		sourceWidth: raw.width,
		sourceHeight: raw.height,
		sourceIsStatic,
		frameKey: raw.frameKey,
		transform: placement.transform,
		opacity: placement.opacity,
		backgroundFill: media.backgroundFill,
		styleSource,
		colorGrade: isColorGradeIdentity({ grade }) ? null : grade,
		clipLocalTime: mediaTimeToSeconds({ time: localTime }),
		clipDurationSec: mediaTimeToSeconds({ time: media.elementDuration }),
		...(media.mediaAnims ? { mediaAnims: media.mediaAnims } : {}),
	};
}

/**
 * Sample outgoing A and incoming B (frames + placement, fill, grade,
 * clip-anim). Nothing is painted here: the compositor builds each side on the
 * GPU. Masks and clip effects are not included.
 */
export async function sampleCutTransitionComposite({
	binding,
	timelineTime,
	packTimelineDurationSec,
}: {
	binding: CutTransitionBinding;
	timelineTime: MediaTime;
	/**
	 * Author timeline T when already known (built pack timelines).
	 * Omit to read the pack manifest; null falls through to transition D.
	 */
	packTimelineDurationSec?: number | null;
}): Promise<CutTransitionComposite | null> {
	const partnerRole: TransitionSourceRole = binding.role === "from" ? "to" : "from";
	// Same file on both sides: the incoming side gets its own decoder so the two
	// sides don't seek each other every frame. The outgoing side keeps the main
	// one, which the incoming clip then continues on after the window.
	const sharesDecoder =
		binding.self.kind === "video" &&
		binding.partner.kind === "video" &&
		binding.self.mediaId === binding.partner.mediaId;
	const streamKeyFor = (role: TransitionSourceRole) =>
		sharesDecoder && role === "to" ? "transition-to" : undefined;
	// GIFs animate when drawn, so only still images count as static.
	const isGifUrl = (url: string | null | undefined) =>
		!!url && /\.gif($|\?)/i.test(url);
	const isStaticMedia = (media: TransitionMediaSource) =>
		media.kind === "image" &&
		!media.animated &&
		!isGifUrl(media.url) &&
		!(media.backgroundFill.mode === "style" && isGifUrl(media.fillStyleUrl));

	const partner = await sampleSide({
		media: binding.partner,
		role: partnerRole,
		timelineTime,
		cutTime: binding.cutTime,
		streamKey: streamKeyFor(partnerRole),
		sourceIsStatic: isStaticMedia(binding.partner),
	});
	if (!partner) return null;
	const self = await sampleSide({
		media: binding.self,
		role: binding.role,
		timelineTime,
		cutTime: binding.cutTime,
		streamKey: streamKeyFor(binding.role),
		sourceIsStatic: isStaticMedia(binding.self),
	});
	if (!self) return null;

	return {
		packId: binding.packId,
		packTimelineTimeSec: transitionPackSampleTimeSec({
			timelineTime,
			cutTime: binding.cutTime,
			duration: binding.duration,
			packTimelineDurationSec:
				packTimelineDurationSec !== undefined
					? packTimelineDurationSec
					: authorPackTimelineDurationSec({ packId: binding.packId }),
		}),
		from: binding.role === "from" ? self : partner,
		to: binding.role === "to" ? self : partner,
	};
}
