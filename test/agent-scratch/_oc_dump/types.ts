export type PrimaryVfxPackType =
	| "sticker"
	| "transition"
	| "effect"
	| "filter"
	| "art-text";

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
	assets?: {
		scene?: string;
		textures?: string[];
		shaders?: string[];
		animations?: string[];
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
	meta?: Record<string, unknown>;
	resolution?: { width: number; height: number };
	render?: VfxPackRenderSettings;
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
	parameters?: Record<string, number>;
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
	postProcess?: {
		enabled?: boolean;
		effects?: Array<{
			id: string;
			type: string;
			enabled?: boolean;
			params?: Record<string, number | boolean | string>;
			exposed?: Record<string, boolean>;
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
