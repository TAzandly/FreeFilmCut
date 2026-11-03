export type PrimaryVfxPackType =
	| "sticker"
	| "transition"
	| "effect"
	| "filter"
	| "art-text"
	| "sticker-anim"
	| "text-anim"
	| "text-template"
	| "clip-anim";

/** Canonical + legacy type strings accepted in manifest.type */
export type VfxPackType =
	| PrimaryVfxPackType
	| "text-style"
	| "animation"
	| "post-effect"
	| "scene";

export type VfxPackScope = "clip" | "below" | "stack";

export interface VfxManifest {
	schema: string;
	id: string;
	version: string;
	displayName: string;
	engine?: { api?: string; renderer?: string };
	type: VfxPackType | string;
	/** sticker-anim / text-anim / clip-anim: which library tab this pack belongs to. */
	phase?: "in" | "out" | "loop" | "combo" | string;
	/** sticker-anim motion. Other pack types ignore this. */
	motion?: import("@/vfxpack/sticker-motion").StickerMotion;
	/** text-template payload (freecapcut.text-template/1). May embed flower + textAnim + PP. */
	textTemplate?: {
		format?: string;
		name?: string;
		text?: {
			content?: string;
			font?: string;
			fontBold?: string;
			fontFileName?: string;
			fontSize?: number;
			bold?: boolean;
			italic?: boolean;
			fontStyle?: string;
			color?: string;
			letterSpacing?: number;
			lineHeight?: number;
			align?: string;
			verticalAlign?: string;
			outline?: Record<string, unknown>;
			shadow?: Record<string, unknown>;
		};
		flowerStyle?: unknown;
		flowerBaseFontSize?: number;
		textAnim?: unknown;
		animRefs?: { in?: string | null; out?: string | null; loop?: string | null };
		postProcess?: {
			enabled?: boolean;
			effects?: Array<{
				id?: string;
				type: string;
				enabled?: boolean;
				params?: Record<string, number | boolean | string>;
				exposed?: Record<string, boolean>;
			}>;
		};
		textFxStack?: {
			enabled?: boolean;
			effects?: Array<{
				id?: string;
				type: string;
				enabled?: boolean;
				params?: Record<string, number | boolean | string>;
				exposed?: Record<string, boolean>;
			}>;
		};
		background?: { type?: string; color?: string };
		output?: { toneMapping?: string; toneMappingExposure?: number };
		/** Glyph AABB follow stickers (editor fccUI.textStickers); textures under pack/textures/. */
		stickers?: Array<Record<string, unknown>>;
		/** MediaFramePlayers packed as media/ / sequences/ / videos/. */
		mediaPlayers?: Array<{
			uuid?: string;
			name?: string;
			kind?: "video" | "gif" | "imageSequence" | string;
			path?: string;
			loop?: boolean;
			muted?: boolean;
			volume?: number;
			playbackRate?: number;
			/** When true and no pack timeline video track binds this player, free-run / clip-local self-clock. */
			autoplay?: boolean;
			targetUuid?: string;
			fileName?: string;
			sequenceFps?: number;
			sequenceDir?: string;
			sequenceStart?: number;
			sequenceEnd?: number;
			frameNames?: string[];
		}>;
		/** Relative asset paths written into the pack (media/, sequences/, videos/). */
		mediaAssets?: string[];
	};
	/** text-anim payload (freecapcut.textanim-pack/1). Never carries flowerStyle. */
	textAnim?: {
		format?: string;
		name?: string;
		category?: "in" | "out" | "loop" | string;
		duration?: number;
		components?: unknown[];
		tracks?: Array<{
			path: string;
			interp?: string;
			relative?: "add" | "mul" | string;
			keys: Array<{ t: number; v: number; ease?: string }>;
		}>;
		/** Authoring-camera PP snapshot; clip applies via textFxStack path. */
		postProcess?: {
			enabled?: boolean;
			effects?: Array<{
				id?: string;
				type: string;
				enabled?: boolean;
				params?: Record<string, number | boolean | string>;
				exposed?: Record<string, boolean>;
			}>;
		};
	};
	scope?: VfxPackScope | string;
	entry?: { scene?: string };
	params?: Array<{
		key: string;
		label?: string;
		type?: string;
		default?: number | string | boolean;
		min?: number;
		max?: number;
		step?: number;
		scope?: string;
		effectId?: string;
		effectType?: string;
		paramKey?: string;
		materialUuid?: string;
		uniform?: string;
	}>;
	exposedParams?: import("@/vfxpack/exposed-params").ExposedParam[];
	/**
	 * Custom post-effect definitions (type `custom:<id>`).
	 * Shaders inline; image textures under assets.customEffectTextures / effects/custom/<id>/.
	 */
	customEffects?: Array<{
		id: string;
		name?: string;
		title?: string;
		version?: number;
		params?: unknown[];
		textures?: unknown[];
		passes?: unknown[];
	}>;
	/** Top-level PP stack (text-anim / scene packs); also may live on scene camera. */
	postProcess?: {
		enabled?: boolean;
		effects?: Array<{
			id?: string;
			type: string;
			enabled?: boolean;
			params?: Record<string, number | boolean | string | number[]>;
			exposed?: Record<string, boolean>;
			definition?: {
				id: string;
				name?: string;
				title?: string;
				version?: number;
				params?: unknown[];
				textures?: unknown[];
				passes?: unknown[];
			};
		}>;
	};
	assets?: {
		scene?: string;
		textures?: string[];
		shaders?: string[];
		animations?: string[];
		customEffectTextures?: string[];
	};
	/** Pack-embedded FreeFilmCut .anim clips (manifest list). */
	animations?: Array<{
		name: string;
		path: string;
		fps?: number;
		duration?: number;
		loop?: "clamp" | "loop";
		objectUuids?: string[];
	}>;
	/** Total pack duration in seconds (optional). */
	duration?: number;
	/** Pack-embedded FreeFilmCut timelines (NLE tracks). */
	timelines?: Array<{
		name: string;
		path: string;
		fps?: number;
		duration?: number;
		loop?: "clamp" | "loop";
		objectUuid?: string;
	}>;
	meta?: Record<string, unknown>;
	resolution?: { width: number; height: number };
	render?: VfxPackRenderSettings;
	/** Library card. Poster is the still; hover plays while the pointer is over the card. */
	preview?: {
		poster?: string;
		hover?: string;
	};
}

export interface VfxSceneNodeTransform {
	position: [number, number, number];
	rotation: [number, number, number];
	quaternion: [number, number, number, number];
	scale: [number, number, number];
	matrix?: number[];
}

export interface VfxSceneMaterial {
	uuid: string;
	name?: string;
	type: string;
	transparent?: boolean;
	opacity?: number;
	side?: number;
	depthWrite?: boolean;
	depthTest?: boolean;
	color?: string;
	emissive?: string;
	metalness?: number;
	roughness?: number;
	textures?: Record<string, string>;
	/** Paths under pack/ for ShaderMaterial / RawShaderMaterial */
	shader?: {
		vertex?: string;
		fragment?: string;
		raw?: boolean;
	};
	uniforms?: Record<string, unknown>;
	defines?: Record<string, unknown>;
	exposedUniforms?: Record<string, boolean>;
}

export interface VfxSceneGeometry {
	uuid: string;
	type: string;
	name?: string;
	parameters?: Record<string, number>;
	/** Attribute names present on the source geometry (informational). */
	attributes?: string[];
	indexCount?: number | null;
	/** Pack-relative JSON with BufferGeometry attributes (GLB/FBX imports). */
	data?: string;
}

export interface VfxSceneNode {
	uuid: string;
	name: string;
	kind: string;
	type: string;
	visible?: boolean;
	parent?: string | null;
	transform: VfxSceneNodeTransform;
	geometry?: VfxSceneGeometry;
	materials?: VfxSceneMaterial[];
	cameraType?: string;
	fov?: number;
	aspect?: number;
	near?: number;
	far?: number;
	zoom?: number;
	userData?: Record<string, unknown>;
	/** Packed video decoded in the NLE and copied into a RenderTexture. */
	video?: {
		path?: string;
		loop?: boolean;
		muted?: boolean;
		volume?: number;
		targetUuid?: string;
	};
	/** FreeFilmCut UGUI (Canvas / Image) rect + type. */
	ui?: {
		type: string;
		stub?: boolean;
		note?: string;
		anchorMin?: [number, number];
		anchorMax?: [number, number];
		pivot?: [number, number];
		anchoredPosition?: [number, number];
		sizeDelta?: [number, number];
		localEulerAngles?: [number, number, number];
		localScale?: [number, number, number];
		/** overlay | camera (Unity Screen Space modes). */
		renderMode?: "overlay" | "camera" | string;
		cameraUuid?: string | null;
		planeDistance?: number;
		/** Text (Troika SDF) */
		text?: string;
		font?: string;
		fontBold?: string;
		fontFileName?: string;
		fontSize?: number;
		bold?: boolean;
		italic?: boolean;
		fontStyle?: string;
		color?: string;
		letterSpacing?: number;
		lineHeight?: number;
		align?: string;
		verticalAlign?: string;
		outline?: {
			enabled?: boolean;
			width?: number;
			color?: string;
			opacity?: number;
		};
		shadow?: {
			enabled?: boolean;
			offsetX?: number;
			offsetY?: number;
			blur?: number;
			color?: string;
			opacity?: number;
		};
		flowerStyle?: unknown;
		flowerBaseFontSize?: number;
		flowerDesignCanvasHeight?: number;
		textFxStack?: unknown;
		/** Glyph AABB follow stickers (editor fccUI.textStickers). */
		textStickers?: unknown;
	};
	postProcess?: {
		enabled?: boolean;
		effects?: Array<{
			id: string;
			type: string;
			enabled?: boolean;
			params?: Record<string, number | boolean | string | number[]>;
			exposed?: Record<string, boolean>;
			/** Custom effect definition (shaders inline) for type `custom:<id>`. */
			definition?: {
				id: string;
				name?: string;
				title?: string;
				version?: number;
				params?: unknown[];
				textures?: unknown[];
				passes?: unknown[];
			};
			/** RT slots: texName → pack scene RT node uuid. */
			textureBindings?: Record<string, { rtUuid?: string }>;
		}>;
	};
}

export interface VfxPackRenderSettings {
	rendererType?: string;
	cameraType?: string;
	antialias?: boolean;
	shadows?: boolean;
	shadowType?: number;
	toneMapping?: number;
	toneMappingName?: string;
	toneMappingExposure?: number;
}

export interface VfxSceneBackground {
	type: string;
	color?: string;
	path?: string | null;
	uuid?: string;
	blurriness?: number;
	intensity?: number;
	rotation?: number[];
	exported?: boolean;
	colorSpace?: string;
	flipY?: boolean;
	value?: null;
	note?: string;
}

export interface VfxSceneEnvironment {
	type: string;
	path?: string | null;
	uuid?: string;
	intensity?: number;
	rotation?: number[];
	exported?: boolean;
	colorSpace?: string;
	value?: null;
	note?: string;
}

export interface VfxSceneFog {
	type: string;
	color?: string;
	near?: number;
	far?: number;
	density?: number;
}

export interface VfxSceneFile {
	schema: string;
	name?: string;
	exposedParams?: import("@/vfxpack/exposed-params").ExposedParam[];
	background?: VfxSceneBackground | string | null | unknown;
	environment?: VfxSceneEnvironment | null;
	fog?: VfxSceneFog | null;
	render?: VfxPackRenderSettings;
	activeCamera?: string | null;
	nodes: VfxSceneNode[];
	assets?: {
		textures?: Array<{ uuid: string; path: string; name?: string }>;
		shaders?: Array<{
			name?: string;
			vertex?: string;
			fragment?: string;
			raw?: boolean;
		}>;
		animations?: string[];
		timelines?: string[];
	};
	resolution?: { width: number; height: number };
}

export interface LoadedVfxPack {
	id: string;
	displayName: string;
	/** Normalized primary type (sticker|transition|effect|filter|art-text) */
	type: PrimaryVfxPackType | string;
	scope: string;
	manifest: VfxManifest;
	scene: VfxSceneFile | null;
	/** Relative path (no leading pack/) -> bytes */
	files: Map<string, Uint8Array>;
	/** Relative path -> blob URL for images etc. */
	objectUrls: Map<string, string>;
	sourceFileName: string;
}
