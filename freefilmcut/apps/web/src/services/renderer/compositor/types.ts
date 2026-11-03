import type { BlendMode } from "@/rendering";
import type { ChromaKeySettings } from "@/chroma-key";
import type { ColorGradeSettings } from "@/color-grade";
import type { EffectPass } from "@/effects/types";

export type FrameDescriptor = {
	width: number;
	height: number;
	clear: {
		color: [number, number, number, number];
	};
	items: FrameItemDescriptor[];
};

export type FrameItemDescriptor =
	| {
			type: "layer";
			textureId: string;
			transform: QuadTransformDescriptor;
			opacity: number;
			blendMode: BlendMode;
			effectPassGroups: EffectPass[][];
			mask: LayerMaskDescriptor | null;
			/**
			 * Chroma key for this layer, already sampled for the frame. Applied
			 * inside the layer's fragment shader, so it costs no extra pass and
			 * folds into `opacity` × mask alpha correctly.
			 */
			chromaKey?: ChromaKeySettings | null;
			/**
			 * Full color grade (non-identity only). Applied in the layer shader
			 * after chroma, before blend — one blit with the rest of the layer.
			 */
			colorGrade?: ColorGradeSettings | null;
			/** Clip-local seconds / duration for mediaAnims sampling. */
			clipLocalTime?: number;
			clipDurationSec?: number;
			mediaAnims?: import("@/timeline").MediaAnimAssignment;
	  }
	| {
			type: "sceneEffect";
			effectType: string;
			effectPassGroups: EffectPass[][];
			effectParams?: import("@/params").ParamValues;
			/** Seconds within the timeline clip (0..duration). Used to sample pack .anim. */
			clipLocalTime?: number;
			clipDurationSec?: number;
			stickerAnims?: import("@/timeline").StickerAnimAssignment;
	  }
	| {
			type: "transition";
			packId: string;
			/** u * author timeline duration T (or transition D when the pack has no timeline). */
			packTimelineTimeSec: number;
			from: TransitionSideDescriptor;
			to: TransitionSideDescriptor;
	  }
	| {
			/**
			 * Timeline text layer via Text→RT→blit (plain Default + flower).
			 * Name is historical; plain text uses a solid-face default FlowerStyle.
			 */
			type: "flowerText";
			elementId: string;
			/** Stable hash of Troika/FlowerStyle inputs (not transform/opacity). */
			contentHash: string;
			props: import("@/vfxpack/timeline-flower-text").TimelineFlowerTextProps;
			opacity: number;
			blendMode: BlendMode;
			effectPassGroups: EffectPass[][];
			/** Clip-local seconds for text-anim library sampling. */
			clipLocalTime?: number;
			clipDurationSec?: number;
			textAnims?: import("@/timeline").TextElement["textAnims"];
	  };

/**
 * One cut side, composited on the GPU into its own target (fill, then media
 * with grade / clip-anim). That target is what the pack samples as uFrom / uTo.
 */
export type TransitionSideDescriptor = {
	/** Fill is on: start from opaque black so the letterbox cannot show through. */
	opaqueBase: boolean;
	layers: Extract<FrameItemDescriptor, { type: "layer" }>[];
};

export type QuadTransformDescriptor = {
	centerX: number;
	centerY: number;
	width: number;
	height: number;
	rotationDegrees: number;
	flipX: boolean;
	flipY: boolean;
};

export type LayerMaskDescriptor = {
	textureId: string;
	feather: number;
	inverted: boolean;
};

export type TextureCanvasDrawFn = (
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
) => void;

/**
 * A layer texture whose pixels come from somewhere outside the renderer —
 * typically a decoded video/image frame or a sticker. Cached by reference
 * identity of the source object.
 */
export type ExternalTextureDescriptor = {
	kind: "external";
	id: string;
	source: CanvasImageSource;
	width: number;
	height: number;
};

/**
 * A layer texture that the renderer rasterizes from scene state (color fill,
 * text layout, mask shape, blur backdrop). Cached by `contentHash`: when it
 * matches the previous frame's hash for this id, the upload is skipped
 * entirely and the persistent canvas is not even cleared.
 */
export type RenderedTextureDescriptor = {
	kind: "rendered";
	id: string;
	contentHash: string;
	width: number;
	height: number;
	draw: TextureCanvasDrawFn;
};

export type TextureUploadDescriptor =
	| ExternalTextureDescriptor
	| RenderedTextureDescriptor;
