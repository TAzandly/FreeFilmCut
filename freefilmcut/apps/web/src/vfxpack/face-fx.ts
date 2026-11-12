/**
 * Face FX pack schema (`manifest.faceFx`).
 * Layers: anchor3d | eyeRay | warp2d. No particle system in phase 1.
 */

export const FACE_FX_BIND_TARGETS = [
	"forehead",
	"noseBridge",
	"leftEye",
	"rightEye",
	"eyesCenter",
	"faceMatrix",
] as const;

export type FaceFxBindTarget = (typeof FACE_FX_BIND_TARGETS)[number];

export const FACE_FX_LAYER_KINDS = ["anchor3d", "eyeRay", "warp2d"] as const;
export type FaceFxLayerKind = (typeof FACE_FX_LAYER_KINDS)[number];

export const FACE_FX_WARP_PRESETS = [
	"bulge",
	"pinch",
	"stretchY",
	"wave",
] as const;
export type FaceFxWarpPreset = (typeof FACE_FX_WARP_PRESETS)[number];

export interface FaceFxDriver {
	landmarks: boolean;
	transformationMatrix: boolean;
	maxFaces: number;
}

export interface FaceFxAnchor3dLayer {
	id: string;
	kind: "anchor3d";
	asset: string;
	bind: FaceFxBindTarget;
	offset: [number, number, number];
	scale: number;
	multiFace?: boolean;
}

export interface FaceFxEyeRayLayer {
	id: string;
	kind: "eyeRay";
	color: string;
	length: number;
	width: number;
	spread?: number;
	multiFace?: boolean;
}

export interface FaceFxWarp2dLayer {
	id: string;
	kind: "warp2d";
	preset: FaceFxWarpPreset;
	strength: number;
	region?: string;
	multiFace?: boolean;
}

export type FaceFxLayer =
	| FaceFxAnchor3dLayer
	| FaceFxEyeRayLayer
	| FaceFxWarp2dLayer;

export interface FaceFxConfig {
	driver: FaceFxDriver;
	layers: FaceFxLayer[];
}

const BIND_SET = new Set<string>(FACE_FX_BIND_TARGETS);
const KIND_SET = new Set<string>(FACE_FX_LAYER_KINDS);
const WARP_SET = new Set<string>(FACE_FX_WARP_PRESETS);

function asFinite(value: unknown, fallback: number): number {
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) ? n : fallback;
}

function asVec3(value: unknown): [number, number, number] {
	if (!Array.isArray(value) || value.length < 3) return [0, 0, 0];
	return [asFinite(value[0], 0), asFinite(value[1], 0), asFinite(value[2], 0)];
}

function normalizeBind(raw: unknown): FaceFxBindTarget {
	const v = String(raw || "").trim();
	return BIND_SET.has(v) ? (v as FaceFxBindTarget) : "forehead";
}

function normalizeWarpPreset(raw: unknown): FaceFxWarpPreset {
	const v = String(raw || "").trim();
	return WARP_SET.has(v) ? (v as FaceFxWarpPreset) : "bulge";
}

function normalizeColor(raw: unknown): string {
	const v = String(raw || "").trim();
	if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v;
	if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v}`;
	return "#ff0033";
}

function normalizeDriver(raw: unknown): FaceFxDriver {
	const o =
		raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	const maxFaces = Math.max(
		1,
		Math.min(8, Math.round(asFinite(o.maxFaces, 4))),
	);
	return {
		landmarks: o.landmarks !== false,
		transformationMatrix: o.transformationMatrix !== false,
		maxFaces,
	};
}

function normalizeLayer(raw: unknown, index: number): FaceFxLayer | null {
	if (!raw || typeof raw !== "object") return null;
	const o = raw as Record<string, unknown>;
	const kind = String(o.kind || "").trim();
	if (!KIND_SET.has(kind)) return null;
	const id = String(o.id || "").trim() || `layer_${index}`;
	const multiFace =
		typeof o.multiFace === "boolean" ? o.multiFace : undefined;

	if (kind === "anchor3d") {
		return {
			id,
			kind: "anchor3d",
			asset: String(o.asset || "").trim(),
			bind: normalizeBind(o.bind),
			offset: asVec3(o.offset),
			scale: Math.max(0.001, asFinite(o.scale, 1)),
			...(multiFace !== undefined ? { multiFace } : {}),
		};
	}

	if (kind === "eyeRay") {
		const layer: FaceFxEyeRayLayer = {
			id,
			kind: "eyeRay",
			color: normalizeColor(o.color),
			length: Math.max(0, asFinite(o.length, 2)),
			width: Math.max(0.0001, asFinite(o.width, 0.01)),
			...(multiFace !== undefined ? { multiFace } : {}),
		};
		if (o.spread !== undefined) {
			layer.spread = Math.max(0, asFinite(o.spread, 0));
		}
		return layer;
	}

	const region = String(o.region || "").trim();
	return {
		id,
		kind: "warp2d",
		preset: normalizeWarpPreset(o.preset),
		strength: Math.max(0, Math.min(2, asFinite(o.strength, 0.5))),
		...(region ? { region } : {}),
		...(multiFace !== undefined ? { multiFace } : {}),
	};
}

/** Default empty Face FX config (landmarks + matrix on, no layers). */
export function createDefaultFaceFx(): FaceFxConfig {
	return {
		driver: {
			landmarks: true,
			transformationMatrix: true,
			maxFaces: 4,
		},
		layers: [],
	};
}

/**
 * Normalize `manifest.faceFx` (or editor config / scene.userData.faceFx).
 * Unknown layers are dropped; missing fields get sane defaults.
 */
export function normalizeFaceFx(raw: unknown): FaceFxConfig {
	if (!raw || typeof raw !== "object") return createDefaultFaceFx();
	const o = raw as Record<string, unknown>;
	const layersIn = Array.isArray(o.layers) ? o.layers : [];
	const layers: FaceFxLayer[] = [];
	for (let i = 0; i < layersIn.length; i++) {
		const layer = normalizeLayer(layersIn[i], i);
		if (layer) layers.push(layer);
	}
	return {
		driver: normalizeDriver(o.driver),
		layers,
	};
}
