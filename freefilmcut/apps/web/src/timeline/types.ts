import type { ElementAnimations } from "@/animation/types";
import type { Effect } from "@/effects/types";
import type { Mask } from "@/masks/types";
import type { ParamValues } from "@/params";
import type { MediaTime } from "@/wasm";

export type ElementRef = {
	trackId: string;
	elementId: string;
};

export interface Bookmark {
	time: MediaTime;
	note?: string;
	color?: string;
	duration?: MediaTime;
}

export interface TScene {
	id: string;
	name: string;
	isMain: boolean;
	tracks: SceneTracks;
	bookmarks: Bookmark[];
	createdAt: Date;
	updatedAt: Date;
}

export type TrackType = "video" | "text" | "audio" | "graphic" | "effect";

interface BaseTrack {
	id: string;
	name: string;
}

export interface TransitionEdge {
	id: string;
	trackId: string;
	fromElementId: string;
	toElementId: string;
	packId: string;
	duration: MediaTime;
}

export interface VideoTrack extends BaseTrack {
	type: "video";
	elements: (VideoElement | ImageElement)[];
	transitions: TransitionEdge[];
	muted: boolean;
	hidden: boolean;
}

export interface TextTrack extends BaseTrack {
	type: "text";
	elements: TextElement[];
	hidden: boolean;
}

export interface AudioTrack extends BaseTrack {
	type: "audio";
	elements: AudioElement[];
	muted: boolean;
}

export interface GraphicTrack extends BaseTrack {
	type: "graphic";
	elements: (StickerElement | GraphicElement)[];
	hidden: boolean;
}

export interface EffectTrack extends BaseTrack {
	type: "effect";
	elements: EffectElement[];
	hidden: boolean;
}

export type TimelineTrack =
	| VideoTrack
	| TextTrack
	| AudioTrack
	| GraphicTrack
	| EffectTrack;

export type OverlayTrack = VideoTrack | TextTrack | GraphicTrack | EffectTrack;

export interface SceneTracks {
	overlay: OverlayTrack[];
	main: VideoTrack;
	audio: AudioTrack[];
}

export type RetimeCurveKey = {
	/** Normalized clip local time in [0, 1]. */
	t: number;
	rate: number;
};

export interface RetimeConfig {
	/**
	 * Constant playback rate, or (for `mode: "curve"`) the mean rate over the
	 * curve — used for duration linkage when a full integrate isn't needed.
	 */
	rate: number;
	maintainPitch?: boolean;
	/** Omit / `"constant"` = flat rate. `"curve"` uses `keys`. */
	mode?: "constant" | "curve";
	/** Preset id when mode is curve (None clears curve). */
	curveId?: string;
	/** Piecewise-linear rate keys; t ∈ [0,1] over clip duration. */
	keys?: RetimeCurveKey[];
}

interface BaseAudioElement extends BaseTimelineElement {
	type: "audio";
	buffer?: AudioBuffer;
	retime?: RetimeConfig;
	/** When true, play trimmed source from end→start (orthogonal to retime). */
	reversed?: boolean;
}

export interface UploadAudioElement extends BaseAudioElement {
	sourceType: "upload";
	mediaId: string;
}

export interface LibraryAudioElement extends BaseAudioElement {
	sourceType: "library";
	sourceUrl: string;
}

export type AudioElement = UploadAudioElement | LibraryAudioElement;

interface BaseTimelineElement {
	id: string;
	name: string;
	duration: MediaTime;
	startTime: MediaTime;
	trimStart: MediaTime;
	trimEnd: MediaTime;
	sourceDuration?: MediaTime;
	animations?: ElementAnimations;
	params: ParamValues;
}

export type MediaAnimAssignment = {
	in?: { packId: string; durationSec: number } | null;
	out?: { packId: string; durationSec: number } | null;
	combo?: { packId: string; durationSec: number } | null;
};

export interface VideoElement extends BaseTimelineElement {
	type: "video";
	mediaId: string;
	isSourceAudioEnabled?: boolean;
	hidden?: boolean;
	retime?: RetimeConfig;
	/** When true, play trimmed source from end→start (orthogonal to retime). */
	reversed?: boolean;
	effects?: Effect[];
	masks?: Mask[];
	/** Clip-anim library (in / out / combo). Mutually exclusive combo vs in+out. */
	mediaAnims?: MediaAnimAssignment;
}

export interface ImageElement extends BaseTimelineElement {
	type: "image";
	mediaId: string;
	hidden?: boolean;
	effects?: Effect[];
	masks?: Mask[];
	/** Clip-anim library (in / out / combo). Mutually exclusive combo vs in+out. */
	mediaAnims?: MediaAnimAssignment;
}

export interface TextElement extends BaseTimelineElement {
	type: "text";
	hidden?: boolean;
	effects?: Effect[];
	/** FlowerStyle Effect stack (Troika SDF), same schema as editor fccUI.flowerStyle. */
	flowerStyle?: unknown | null;
	/** Font size at which flowerStyle linear measures were authored. */
	flowerBaseFontSize?: number | null;
	/**
	 * Editor pack canvas height (scene.resolution.height); layout/logging only.
	 * Troika fontSize = params.fontSize (1:1). Stroke scale = fontSize / flowerBaseFontSize.
	 */
	flowerDesignCanvasHeight?: number | null;
	/** Builtin / library flower template id when applied. */
	flowerTemplateId?: string | null;
	/** Source text-template pack id (Assets → Text templates). */
	textTemplatePackId?: string | null;
	/** Remapped textStickers from text-template (textures → pack objectUrls). Clip AABB follow via text-stickers. */
	textStickers?: Array<Record<string, unknown>> | null;
	/** MediaFramePlayers descriptors from text-template (gif/seq/video paths inside pack). */
	textTemplateMediaPlayers?: Array<Record<string, unknown>> | null;
	/** Text RT post-process (Registry PP). From text-template postProcess / textFxStack. */
	textFxStack?: {
		enabled?: boolean;
		effects?: Array<Record<string, unknown>>;
	} | null;
	/**
	 * Clip-side 文字动画 library assignment (parallel to stickerAnims).
	 * packId → loaded text-anim vfxpack; duration may override pack default.
	 */
	textAnims?: {
		in?: { packId: string; duration?: number } | null;
		out?: { packId: string; duration?: number } | null;
		loop?: { packId: string; duration?: number } | null;
	};
}

export type StickerAnimAssignment = {
	in?: { packId: string } | null;
	out?: { packId: string } | null;
	loop?: { packId: string } | null;
};

export interface StickerElement extends BaseTimelineElement {
	type: "sticker";
	stickerId: string;
	stickerAnims?: StickerAnimAssignment;
	/** Natural dimensions of the sticker asset, stored at insert time. Used by renderer and preview bounds to avoid split-brain geometry. */
	intrinsicWidth?: number;
	intrinsicHeight?: number;
	hidden?: boolean;
	effects?: Effect[];
}

export interface GraphicElement extends BaseTimelineElement {
	type: "graphic";
	definitionId: string;
	hidden?: boolean;
	effects?: Effect[];
	masks?: Mask[];
}

export interface EffectElement extends BaseTimelineElement {
	type: "effect";
	effectType: string;
	stickerAnims?: StickerAnimAssignment;
}

export type ElementUpdatePatch = { params?: Partial<ParamValues> };

export type TimelineElement =
	| AudioElement
	| VideoElement
	| ImageElement
	| TextElement
	| StickerElement
	| GraphicElement
	| EffectElement;

export type ElementType = TimelineElement["type"];

function elementTypes<T extends ElementType[]>(...types: T): T {
	return types;
}

export const MASKABLE_ELEMENT_TYPES = elementTypes("video", "image", "graphic");

export type MaskableElement = Extract<
	TimelineElement,
	{ type: (typeof MASKABLE_ELEMENT_TYPES)[number] }
>;

export const RETIMABLE_ELEMENT_TYPES = elementTypes("video", "audio");

export type RetimableElement = Extract<
	TimelineElement,
	{ type: (typeof RETIMABLE_ELEMENT_TYPES)[number] }
>;

export const VISUAL_ELEMENT_TYPES = elementTypes(
	"video",
	"image",
	"text",
	"sticker",
	"graphic",
);

export type VisualElement = Extract<
	TimelineElement,
	{ type: (typeof VISUAL_ELEMENT_TYPES)[number] }
>;

export type CreateUploadAudioElement = Omit<UploadAudioElement, "id">;
export type CreateLibraryAudioElement = Omit<LibraryAudioElement, "id">;
export type CreateAudioElement =
	| CreateUploadAudioElement
	| CreateLibraryAudioElement;
export type CreateVideoElement = Omit<VideoElement, "id">;
export type CreateImageElement = Omit<ImageElement, "id">;
export type CreateTextElement = Omit<TextElement, "id">;
export type CreateStickerElement = Omit<StickerElement, "id">;
export type CreateGraphicElement = Omit<GraphicElement, "id">;
export type CreateEffectElement = Omit<EffectElement, "id">;
export type CreateTimelineElement =
	| CreateAudioElement
	| CreateVideoElement
	| CreateImageElement
	| CreateTextElement
	| CreateStickerElement
	| CreateGraphicElement
	| CreateEffectElement;

export interface ElementDragState {
	isDragging: boolean;
	elementId: string | null;
	dragElementIds: string[];
	dragTimeOffsets: Record<string, MediaTime>;
	trackId: string | null;
	startMouseX: number;
	startMouseY: number;
	startElementTime: MediaTime;
	clickOffsetTime: MediaTime;
	currentTime: MediaTime;
	currentMouseY: number;
}

export type ElementDragView =
	| { readonly kind: "idle" }
	| {
			readonly kind: "dragging";
			readonly anchorElementId: string;
			readonly trackId: string;
			readonly memberTimeOffsets: ReadonlyMap<string, MediaTime>;
			readonly startMouseX: number;
			readonly startMouseY: number;
			readonly startElementTime: MediaTime;
			readonly clickOffsetTime: MediaTime;
			readonly currentTime: MediaTime;
			readonly currentMouseX: number;
			readonly currentMouseY: number;
			readonly dropTarget: DropTarget | null;
	  };

/** Adjacent cut under a transition-pack drag. */
export interface TransitionCutDrop {
	trackId: string;
	fromElementId: string;
	toElementId: string;
	cutTime: MediaTime;
}

export interface DropTarget {
	trackIndex: number;
	isNewTrack: boolean;
	insertPosition: "above" | "below" | null;
	xPosition: MediaTime;
	targetElement: { elementId: string; trackId: string } | null;
	transitionCut?: TransitionCutDrop | null;
}

export interface ComputeDropTargetParams {
	elementType: ElementType;
	mouseX: number;
	mouseY: number;
	tracks: SceneTracks;
	playheadTime: MediaTime;
	isExternalDrop: boolean;
	elementDuration: MediaTime;
	pixelsPerSecond: number;
	zoomLevel: number;
	verticalDragDirection?: "up" | "down" | null;
	startTimeOverride?: MediaTime;
	excludeElementId?: string;
	targetElementTypes?: string[];
}

export interface ClipboardItem {
	trackId: string;
	trackType: TrackType;
	element: CreateTimelineElement;
}
