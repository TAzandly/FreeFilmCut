/**
 * Sticker-pack blit placement: NLE transform is authored in project (logical)
 * pixels — same space as selection bounds / live-drag. The compose buffer may
 * be quality-scaled, so positions must be multiplied by contentScale before
 * the fullscreen contain blit (mirrors computeVisualTransform).
 *
 * Pack design resolution (e.g. 400×400) is the RT / contain source size and
 * must match stickerPackSourceSize used by element-bounds — never the canvas.
 */

import { getPackRegistrySnapshot } from "@/vfxpack/pack-registry";
import { stickerPackSourceSize } from "@/vfxpack/sticker-canvas";

export type StickerBlitPlacement = {
	scaleX: number;
	scaleY: number;
	positionX: number;
	positionY: number;
	rotate: number;
};

/** Logical NLE pixels → compose-buffer pixels. */
export function scaleStickerPlacementToBuffer({
	placement,
	contentScale,
}: {
	placement: StickerBlitPlacement;
	contentScale: number;
}): StickerBlitPlacement {
	const scale =
		Number.isFinite(contentScale) && contentScale > 0 ? contentScale : 1;
	return {
		scaleX: placement.scaleX,
		scaleY: placement.scaleY,
		positionX: placement.positionX * scale,
		positionY: placement.positionY * scale,
		rotate: placement.rotate,
	};
}

/**
 * Authoritative sticker RT size: registry pack (same as selection bounds),
 * then built scene resolution, then a square fallback.
 */
export function resolveStickerPackRenderSize({
	packId,
	builtResolution,
}: {
	packId: string;
	builtResolution?: { width?: number; height?: number } | null;
}): { width: number; height: number } {
	const pack = getPackRegistrySnapshot().packs.find((entry) => entry.id === packId);
	if (pack) {
		const fromPack = stickerPackSourceSize({ pack });
		return {
			width: Math.max(1, fromPack.width),
			height: Math.max(1, fromPack.height),
		};
	}
	const w = builtResolution?.width || 0;
	const h = builtResolution?.height || 0;
	return {
		width: Math.max(1, w || 400),
		height: Math.max(1, h || 400),
	};
}

/**
 * Buffer-space center implied by contain+placement blit — must match
 * getVisualElementBounds mapped through contentScale.
 */
export function stickerBlitCenterInBuffer({
	bufferWidth,
	bufferHeight,
	sourceWidth,
	sourceHeight,
	logicalPositionX,
	logicalPositionY,
	contentScale,
}: {
	bufferWidth: number;
	bufferHeight: number;
	sourceWidth: number;
	sourceHeight: number;
	logicalPositionX: number;
	logicalPositionY: number;
	contentScale: number;
}): { x: number; y: number; width: number; height: number } {
	const scale =
		Number.isFinite(contentScale) && contentScale > 0 ? contentScale : 1;
	const containScale = Math.min(
		bufferWidth / Math.max(1, sourceWidth),
		bufferHeight / Math.max(1, sourceHeight),
	);
	return {
		x: bufferWidth / 2 + logicalPositionX * scale,
		y: bufferHeight / 2 + logicalPositionY * scale,
		width: sourceWidth * containScale,
		height: sourceHeight * containScale,
	};
}
