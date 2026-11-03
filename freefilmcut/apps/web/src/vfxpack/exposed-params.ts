import type {
	ParamDefinition,
	ParamValues,
	VectorSize,
} from "@/params";

export type ExposedParamScope = "postProcess" | "material" | "text";

export type ExposedParam = {
	id: string;
	scope: ExposedParamScope;
	label: string;
	type: "float" | "int" | "boolean" | "color" | "vec2" | "vec3" | "vec4" | string;
	default: number | boolean | string | number[];
	min?: number;
	max?: number;
	step?: number;
	effectId?: string;
	effectType?: string;
	key?: string;
	materialUuid?: string;
	uniform?: string;
	objectUuid?: string;
};

const NLE_EXPOSED_TYPES = new Set([
	"float",
	"int",
	"boolean",
	"color",
	"text",
	"vec2",
	"vec3",
	"vec4",
]);

function isNleExposedType(type: string): boolean {
	return NLE_EXPOSED_TYPES.has(type);
}

function vectorSizeOf(type: string): VectorSize | null {
	if (type === "vec2") return 2;
	if (type === "vec3") return 3;
	if (type === "vec4") return 4;
	return null;
}

function normalizeVectorDefault({
	size,
	value,
}: {
	size: VectorSize;
	value: unknown;
}): number[] {
	const src = Array.isArray(value) ? value : [];
	const out: number[] = [];
	for (let i = 0; i < size; i++) {
		const n = Number(src[i]);
		out.push(Number.isFinite(n) ? n : 0);
	}
	return out;
}

export function normalizeExposedParams({
	manifest,
	scene,
}: {
	manifest?: {
		exposedParams?: ExposedParam[];
		params?: Array<Record<string, unknown>>;
	} | null;
	scene?: { exposedParams?: ExposedParam[] } | null;
}): ExposedParam[] {
	const fromScene = scene?.exposedParams;
	const fromManifest = manifest?.exposedParams;
	const raw =
		(Array.isArray(fromManifest) && fromManifest.length > 0 ? fromManifest : null) ??
		(Array.isArray(fromScene) && fromScene.length > 0 ? fromScene : null);

	if (raw) {
		return raw
			.filter((p) => p && typeof p.id === "string" && p.id.length > 0)
			.filter((p) => isNleExposedType(String(p.type || "float")))
			.map((p) => {
				const scope: ExposedParamScope =
					p.scope === "material"
						? "material"
						: p.scope === "text"
							? "text"
							: "postProcess";
				const type = p.type || "float";
				const size = vectorSizeOf(type);
				const defaultValue =
					size != null
						? normalizeVectorDefault({ size, value: p.default })
						: p.default ??
							(type === "text" ? "" : type === "boolean" ? false : 0);
				return {
					id: p.id,
					scope,
					label: p.label || p.id,
					type,
					default: defaultValue,
					min: p.min,
					max: p.max,
					step: p.step,
					effectId: p.effectId,
					effectType: p.effectType,
					key: p.key,
					materialUuid: p.materialUuid,
					uniform: p.uniform,
					objectUuid: p.objectUuid,
				};
			});
	}

	const legacy = manifest?.params;
	if (!Array.isArray(legacy) || legacy.length === 0) return [];
	const out: ExposedParam[] = [];
	for (const p of legacy) {
		if (!p || typeof p.key !== "string") continue;
		const scope =
			p.scope === "material"
				? "material"
				: p.scope === "postProcess"
					? "postProcess"
					: String(p.key).startsWith("mat.")
						? "material"
						: String(p.key).startsWith("pp.")
							? "postProcess"
							: null;
		if (!scope) continue;
		const type = typeof p.type === "string" ? p.type : "float";
		if (!isNleExposedType(type)) continue;
		const size = vectorSizeOf(type);
		out.push({
			id: String(p.key),
			scope,
			label: typeof p.label === "string" ? p.label : String(p.key),
			type,
			default:
				size != null
					? normalizeVectorDefault({ size, value: p.default })
					: ((p.default as number | boolean | string) ?? 0),
			min: typeof p.min === "number" ? p.min : undefined,
			max: typeof p.max === "number" ? p.max : undefined,
			step: typeof p.step === "number" ? p.step : undefined,
			effectId: typeof p.effectId === "string" ? p.effectId : undefined,
			effectType: typeof p.effectType === "string" ? p.effectType : undefined,
			key:
				typeof p.paramKey === "string"
					? p.paramKey
					: scope === "postProcess"
						? String(p.key).split(".").pop()
						: undefined,
			materialUuid: typeof p.materialUuid === "string" ? p.materialUuid : undefined,
			uniform: typeof p.uniform === "string" ? p.uniform : undefined,
		});
	}
	return out;
}

export function exposedParamsToParamDefinitions({
	exposed,
}: {
	exposed: ExposedParam[];
}): ParamDefinition[] {
	return exposed
		.filter((p) => isNleExposedType(String(p.type || "float")))
		.map((p) => {
			const size = vectorSizeOf(String(p.type));
			if (size != null) {
				return {
					key: p.id,
					label: p.label || p.id,
					type: "vector" as const,
					size,
					default: normalizeVectorDefault({ size, value: p.default }),
					min: p.min,
					max: p.max,
					step: p.step ?? 0.01,
					keyframable: true,
				};
			}
			const type =
				p.type === "boolean"
					? "boolean"
					: p.type === "color"
						? "color"
						: p.type === "text"
							? "text"
							: "number";
			return {
				key: p.id,
				label: p.label || p.id,
				type,
				default: p.default as never,
				min: p.min,
				max: p.max,
				step: p.step ?? (p.type === "int" ? 1 : p.type === "text" ? undefined : 0.01),
				keyframable: p.type !== "text",
			} as ParamDefinition;
		});
}

export function buildDefaultExposedParamValues({
	exposed,
}: {
	exposed: ExposedParam[];
}): ParamValues {
	const values: ParamValues = {};
	for (const p of exposed) {
		if (!isNleExposedType(String(p.type || "float"))) continue;
		const size = vectorSizeOf(String(p.type));
		values[p.id] =
			size != null
				? normalizeVectorDefault({ size, value: p.default })
				: (p.default as never);
	}
	return values;
}
