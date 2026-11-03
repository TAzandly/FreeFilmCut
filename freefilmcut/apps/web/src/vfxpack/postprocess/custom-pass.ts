/**
 * Config-driven custom post-effect runtime (NLE mirror of editor CustomEffectRuntime).
 *
 * Registers `custom:<id>` descriptors from pack `manifest.customEffects` and/or
 * stack entry.definition. Image textures resolve via createPasses ctx.resolveAssetUrl
 * (pack objectUrls). `$camera` samples ctx.__fccBeautyTexture (NLE: below
 * composite for filter/effect packs; editor: beauty capture after RenderPass).
 */
import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import type { Pass as PassType } from "three/addons/postprocessing/Pass.js";
import { bumpFlowerTextFrameEpoch } from "@/vfxpack/flower-text-epoch";

export type CustomEffectParamDef = {
	key: string;
	type: "float" | "int" | "boolean" | "color" | "vec2" | "vec3" | "vec4" | string;
	default?: unknown;
	min?: number;
	max?: number;
	step?: number;
	label?: string;
	labelZh?: string;
	expose?: boolean;
};

export type CustomEffectTextureDef = {
	name: string;
	source?: "image" | "rt" | string;
	path?: string;
	dataUrl?: string;
	colorSpace?: "none" | "srgb" | string;
	flipY?: boolean;
	autoCreate?: boolean;
	media?: Record<string, unknown>;
};

export type CustomEffectPassDef = {
	name?: string;
	inputs?: Record<string, string>;
	fragmentShader?: string;
	vertexShader?: string;
	downsample?: number;
	/** Fractional RT scale in (0, 1]; preferred over downsample when set (e.g. 0.55). */
	resolutionScale?: number;
	colorSpace?: "linear" | "gamma" | string;
	output?: { rt?: string };
};

export type CustomEffectDefinition = {
	id: string;
	name?: string;
	title?: string;
	version?: number;
	params?: CustomEffectParamDef[];
	textures?: CustomEffectTextureDef[];
	passes?: CustomEffectPassDef[];
};

export type CustomEffectTextureBindings = Record<
	string,
	{ rtUuid?: string }
>;

export type CreatePassesCtx = {
	width: number;
	height: number;
	resolveAssetUrl?: (path: string) => string | null;
	effectTime?: number;
	/** Pack root scene — used to resolve RT textureBindings each frame. */
	scene?: THREE.Object3D | null;
	/** Per-entry RT slot map (mutated in place; closure keeps the reference). */
	__fccTextureBindings?: CustomEffectTextureBindings;
	/**
	 * Raw beauty for `$camera` inputs. Timeline filter/effect packs set this to
	 * the below-track composite each frame (mutable; resolveInput reads live).
	 */
	__fccBeautyTexture?: THREE.Texture | null;
};

export type CustomEffectDescriptor = {
	type: string;
	label?: string;
	labelZh?: string;
	__customDefinition: CustomEffectDefinition;
	createDefaultParams: () => Record<string, number | boolean | string | number[]>;
	createPasses: (ctx: CreatePassesCtx) => PassType[];
	applyParams: (
		passes: PassType[],
		params: Record<string, number | boolean | string | number[]>,
	) => void;
	paramSchema?: Array<Record<string, unknown>>;
};

const CUSTOM_PREFIX = "custom:";

const DEFAULT_VERTEX_SHADER = /* glsl */ `
	varying vec2 vUv;
	void main() {
		vUv = uv;
		gl_Position = vec4( position.xy, 0.0, 1.0 );
	}
`;

const RESERVED_SAMPLER_ALIASES: Record<string, string> = {
	uInput: "uInput",
	belowInput: "uInput",
	iChannel0: "uInput",
	uTransitionFrom: "uTransitionFrom",
	uFrom: "uTransitionFrom",
	transitionFrom: "uTransitionFrom",
	uTransitionTo: "uTransitionTo",
	uTo: "uTransitionTo",
	transitionTo: "uTransitionTo",
};

const TRANSITION_SIZE_NAMES = [
	"uTransitionFromSize",
	"uFromSize",
	"uTransitionToSize",
	"uToSize",
];

function resolvePassRtSize(
	passDef: CustomEffectPassDef | undefined,
	width: number,
	height: number,
) {
	const scale = passDef?.resolutionScale;
	if (typeof scale === "number" && Number.isFinite(scale) && scale > 0 && scale <= 1) {
		return {
			rtW: Math.max(1, Math.floor(width * scale)),
			rtH: Math.max(1, Math.floor(height * scale)),
			resolutionScale: scale,
			downsample: 1,
		};
	}
	const ds = passDef?.downsample || 1;
	return {
		rtW: Math.max(1, Math.floor(width / ds)),
		rtH: Math.max(1, Math.floor(height / ds)),
		resolutionScale: 1 / ds,
		downsample: ds,
	};
}

let _fallbackTexture: THREE.DataTexture | null = null;

function getFallbackTexture(): THREE.Texture {
	if (_fallbackTexture) return _fallbackTexture;
	const data = new Uint8Array([0, 0, 0, 0]);
	_fallbackTexture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
	_fallbackTexture.colorSpace = THREE.NoColorSpace;
	_fallbackTexture.magFilter = THREE.NearestFilter;
	_fallbackTexture.minFilter = THREE.NearestFilter;
	_fallbackTexture.needsUpdate = true;
	return _fallbackTexture;
}

function gammaPrelude(): string {
	return /* glsl */ `
		vec3 fccLinearToSRGB( vec3 c ) {
			return mix( c * 12.92, pow( max( c, vec3( 0.0 ) ), vec3( 0.4166666666666667 ) ) * 1.055 - 0.055, step( vec3( 0.0031308 ), c ) );
		}
		vec3 fccSRGBToLinear( vec3 c ) {
			return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( vec3( 0.04045 ), c ) );
		}
		vec4 fccGammaTex( sampler2D s, vec2 uv ) {
			vec4 c = texture2D( s, uv );
			return vec4( fccLinearToSRGB( c.rgb ), c.a );
		}
		#define texture2D fccGammaTex
		#define main fccUserMain
	`;
}

function gammaPostlude(): string {
	return /* glsl */ `
		void main() {
			fccUserMain();
			gl_FragColor = vec4( fccSRGBToLinear( max( gl_FragColor.rgb, vec3( 0.0 ) ) ), gl_FragColor.a );
		}
	`;
}

function composeFragmentShader(passDef: CustomEffectPassDef): string {
	const src = passDef.fragmentShader || "";
	if (passDef.colorSpace === "gamma") {
		return gammaPrelude() + "\n" + src + "\n" + gammaPostlude();
	}
	return src;
}

function composeVertexShader(passDef: CustomEffectPassDef): string {
	if (!passDef.vertexShader || passDef.vertexShader === "default") {
		return DEFAULT_VERTEX_SHADER;
	}
	return passDef.vertexShader;
}

function scanDeclaredReserved(passDef: CustomEffectPassDef) {
	const src =
		(passDef.fragmentShader || "") + "\n" + (passDef.vertexShader || "");
	const samplers: Array<{ declared: string; canonical: string }> = [];
	const allSamplers = new Set<string>();
	const sizes = new Set<string>();
	const samplerRe = /\buniform\s+sampler2D\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*;/g;
	let m: RegExpExecArray | null;
	while ((m = samplerRe.exec(src)) !== null) {
			const declared = m[1];
			allSamplers.add(declared);
			const canonical = RESERVED_SAMPLER_ALIASES[declared];
			if (canonical && !samplers.some((s) => s.declared === declared)) {
				samplers.push({ declared, canonical });
			}
		}
		const sizeRe = /\buniform\s+vec2\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*;/g;
		while ((m = sizeRe.exec(src)) !== null) {
			const sizeName = m[1];
			if (TRANSITION_SIZE_NAMES.includes(sizeName)) sizes.add(sizeName);
		}
	return { samplers, allSamplers, sizes };
}

function makeParamUniform(p: CustomEffectParamDef): { value: unknown } {
	const d = p.default;
	switch (p.type) {
		case "float":
			return { value: Number(d) || 0 };
		case "int":
			return { value: Math.round(Number(d) || 0) };
		case "boolean":
			return { value: !!d };
		case "color":
			return {
				value: new THREE.Color(
					normalizeHexRgb(typeof d === "string" ? d : "#ffffff"),
				),
			};
		case "vec2": {
			const a = Array.isArray(d) ? d : [0, 0];
			return {
				value: new THREE.Vector2(Number(a[0]) || 0, Number(a[1]) || 0),
			};
		}
		case "vec3": {
			const a = Array.isArray(d) ? d : [0, 0, 0];
			return {
				value: new THREE.Vector3(
					Number(a[0]) || 0,
					Number(a[1]) || 0,
					Number(a[2]) || 0,
				),
			};
		}
		case "vec4": {
			const a = Array.isArray(d) ? d : [0, 0, 0, 1];
			return {
				value: new THREE.Vector4(
					Number(a[0]) || 0,
					Number(a[1]) || 0,
					Number(a[2]) || 0,
					a[3] === undefined ? 1 : Number(a[3]) || 0,
				),
			};
		}
		default:
			return { value: 0 };
	}
}

/**
 * NLE ColorPicker emits #RRGGBBAA; THREE.Color only accepts #RGB / #RRGGBB.
 * Custom PP "color" params are vec3 RGB uniforms — alpha is ignored here.
 */
function normalizeHexRgb(input: string): string {
	const s = String(input || "").trim();
	const m = s.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
	if (!m) return "#ffffff";
	let h = m[1];
	if (h.length === 3) {
		h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
	} else if (h.length === 8) {
		h = h.slice(0, 6);
	}
	return `#${h.toLowerCase()}`;
}

function setParamUniform(
	uniform: { value: unknown } | undefined,
	type: string,
	v: unknown,
) {
	if (!uniform) return;
	switch (type) {
		case "float":
			uniform.value = Number(v) || 0;
			break;
		case "int":
			uniform.value = Math.round(Number(v) || 0);
			break;
		case "boolean":
			uniform.value = !!v;
			break;
		case "color": {
			const c = uniform.value as THREE.Color;
			try {
				if (typeof v === "string") c.set(normalizeHexRgb(v));
				else if (Array.isArray(v) && v.length >= 3) {
					c.setRGB(Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0);
				}
			} catch {
				/* keep */
			}
			break;
		}
		case "vec2":
		case "vec3":
		case "vec4": {
			const t = uniform.value as THREE.Vector2 | THREE.Vector3 | THREE.Vector4;
			if (Array.isArray(v) && "fromArray" in t) {
				const padded = [
					Number(v[0]) || 0,
					Number(v[1]) || 0,
					Number(v[2]) || 0,
					v[3] === undefined ? 1 : Number(v[3]) || 0,
				];
				t.fromArray(padded);
			}
			break;
		}
		default:
			break;
	}
}

type TexEntry = {
	texture: THREE.Texture;
	resolved: boolean;
	pending: boolean;
	dynamic?: "scene";
	texName?: string;
};

/** Survive pack-composer rebuilds (e.g. playback quality) so LUT maps stay warm. */
const effectTextureCache = new Map<string, THREE.Texture>();

function cacheKeyForTexture({
	url,
	colorSpace,
	flipY,
}: {
	url: string;
	colorSpace?: string;
	flipY?: boolean;
}): string {
	return `${url}|cs=${colorSpace || "none"}|fy=${flipY !== false ? 1 : 0}`;
}

function loadEffectTextures(
	def: CustomEffectDefinition,
	resolveAssetUrl?: (path: string) => string | null,
): Map<string, TexEntry> {
	const map = new Map<string, TexEntry>();
	const loader =
		typeof window !== "undefined" ? new THREE.TextureLoader() : null;

	for (const t of def.textures || []) {
		if (t.source === "rt") {
			map.set(t.name, {
				texture: getFallbackTexture(),
				resolved: true,
				pending: false,
				dynamic: "scene",
				texName: t.name,
			});
			continue;
		}

		const entry: TexEntry = {
			texture: getFallbackTexture(),
			resolved: false,
			pending: true,
		};
		map.set(t.name, entry);

		const applyTex = (tex: THREE.Texture, { wake }: { wake: boolean }) => {
			tex.colorSpace =
				t.colorSpace === "srgb"
					? THREE.SRGBColorSpace
					: THREE.NoColorSpace;
			tex.flipY = t.flipY !== false;
			tex.generateMipmaps = false;
			tex.minFilter = THREE.LinearFilter;
			tex.magFilter = THREE.LinearFilter;
			entry.texture = tex;
			entry.resolved = true;
			entry.pending = false;
			// Quality/size rebuilds often draw one frame while the LUT is still
			// pending, then the preview frame-gate sleeps — wake so the ready
			// texture is composed without requiring a scrub.
			if (wake) bumpFlowerTextFrameEpoch();
		};

		const fail = () => {
			entry.resolved = true;
			entry.pending = false;
		};

		if (!loader) {
			fail();
			continue;
		}

		if (t.path) {
			const url =
				t.path.startsWith("blob:") ||
				t.path.startsWith("data:") ||
				t.path.startsWith("http") ||
				t.path.startsWith("/")
					? t.path
					: resolveAssetUrl?.(t.path) || null;
			if (!url) {
				fail();
				continue;
			}
			const key = cacheKeyForTexture({
				url,
				colorSpace: t.colorSpace,
				flipY: t.flipY,
			});
			const cached = effectTextureCache.get(key);
			if (cached) {
				applyTex(cached, { wake: false });
				continue;
			}
			loader.load(
				url,
				(tex) => {
					effectTextureCache.set(key, tex);
					applyTex(tex, { wake: true });
				},
				undefined,
				fail,
			);
		} else if (t.dataUrl) {
			const key = cacheKeyForTexture({
				url: t.dataUrl,
				colorSpace: t.colorSpace,
				flipY: t.flipY,
			});
			const cached = effectTextureCache.get(key);
			if (cached) {
				applyTex(cached, { wake: false });
				continue;
			}
			loader.load(
				t.dataUrl,
				(tex) => {
					effectTextureCache.set(key, tex);
					applyTex(tex, { wake: true });
				},
				undefined,
				fail,
			);
		} else {
			entry.pending = false;
		}
	}

	return map;
}

class ConfigurablePass extends Pass {
	passDef: CustomEffectPassDef;
	_paramDefs: CustomEffectParamDef[];
	isFinalPass: boolean;
	needsSwap: boolean;
	_resolveInput: (source: string) => THREE.Texture;
	_downsample: number;
	_resolutionScale: number;
	_chainW: number;
	_chainH: number;
	_inputBindings: Array<{ uniform: string; source: string }>;
	uniforms: Record<string, { value: unknown }>;
	material: THREE.ShaderMaterial;
	_copyUniforms: { tDiffuse: { value: THREE.Texture } };
	_copyMaterial: THREE.ShaderMaterial;
	_fsQuad: FullScreenQuad;
	outputName?: string;
	outputRT?: THREE.WebGLRenderTarget;
	__effectTextures?: Map<string, TexEntry>;
	_timeAcc = 0;
	_compileChecked = false;
	_compileFailed = false;
	__fccEffectTime?: number;

	constructor({
		passDef,
		paramDefs,
		textureNames,
		resolveInput,
		width,
		height,
		isFinal,
	}: {
		passDef: CustomEffectPassDef;
		paramDefs: CustomEffectParamDef[];
		textureNames: Set<string>;
		resolveInput: (source: string) => THREE.Texture;
		width: number;
		height: number;
		isFinal: boolean;
	}) {
		super();
		this.passDef = passDef;
		this._paramDefs = paramDefs;
		this.isFinalPass = isFinal;
		this.needsSwap = isFinal;
		this._resolveInput = resolveInput;

		const rtSize = resolvePassRtSize(passDef, width, height);
		this._downsample = rtSize.downsample;
		this._resolutionScale = rtSize.resolutionScale;
		this._chainW = Math.max(1, Math.floor(width));
		this._chainH = Math.max(1, Math.floor(height));
		const rtW = rtSize.rtW;
		const rtH = rtSize.rtH;

		const uniforms: Record<string, { value: unknown }> = {};
		for (const p of paramDefs) {
			uniforms[p.key] = makeParamUniform(p);
		}

		const { samplers: declaredSamplers, allSamplers, sizes: declaredSizes } =
			scanDeclaredReserved(passDef);
		const inputs = passDef.inputs || {};
		this._inputBindings = [];
		const explicitNames = new Set(Object.keys(inputs));

		for (const uniformName of Object.keys(inputs)) {
			uniforms[uniformName] = { value: getFallbackTexture() };
			this._inputBindings.push({
				uniform: uniformName,
				source: inputs[uniformName],
			});
		}

		for (const { declared, canonical } of declaredSamplers) {
			if (explicitNames.has(declared)) continue;
			uniforms[declared] = { value: getFallbackTexture() };
			this._inputBindings.push({ uniform: declared, source: canonical });
		}

		for (const samplerName of allSamplers) {
			if (explicitNames.has(samplerName)) continue;
			if (RESERVED_SAMPLER_ALIASES[samplerName]) continue;
			if (!textureNames.has(samplerName)) continue;
			uniforms[samplerName] = { value: getFallbackTexture() };
			this._inputBindings.push({
				uniform: samplerName,
				source: "$tex:" + samplerName,
			});
		}

		for (const sizeName of declaredSizes) {
			if (uniforms[sizeName]) continue;
			uniforms[sizeName] = { value: new THREE.Vector2(1, 1) };
		}

		uniforms.uTexel = { value: new THREE.Vector2(1 / rtW, 1 / rtH) };
		uniforms.uResolution = { value: new THREE.Vector2(rtW, rtH) };
		uniforms.uChainTexel = {
			value: new THREE.Vector2(1 / this._chainW, 1 / this._chainH),
		};
		uniforms.uChainResolution = {
			value: new THREE.Vector2(this._chainW, this._chainH),
		};
		uniforms.uTime = { value: 0 };
		uniforms.uFrame = { value: 0 };
		this.uniforms = uniforms;

		this.material = new THREE.ShaderMaterial({
			name: "FccCustom:" + (passDef.name || "pass"),
			uniforms: uniforms as THREE.ShaderMaterialParameters["uniforms"],
			vertexShader: composeVertexShader(passDef),
			fragmentShader: composeFragmentShader(passDef),
			depthTest: false,
			depthWrite: false,
			transparent: false,
			blending: THREE.NoBlending,
			toneMapped: false,
		});

		this._copyUniforms = { tDiffuse: { value: getFallbackTexture() } };
		this._copyMaterial = new THREE.ShaderMaterial({
			name: "FccCustomCopy:" + (passDef.name || "pass"),
			uniforms: this._copyUniforms,
			vertexShader: DEFAULT_VERTEX_SHADER,
			fragmentShader: /* glsl */ `
				uniform sampler2D tDiffuse;
				varying vec2 vUv;
				void main() {
					gl_FragColor = texture2D( tDiffuse, vUv );
				}
			`,
			depthTest: false,
			depthWrite: false,
			transparent: false,
			blending: THREE.NoBlending,
			toneMapped: false,
		});

		this._fsQuad = new FullScreenQuad(this.material);

		if (passDef.output?.rt) {
			this.outputName = passDef.output.rt;
			this.outputRT = new THREE.WebGLRenderTarget(rtW, rtH, {
				type: THREE.HalfFloatType,
				format: THREE.RGBAFormat,
				minFilter: THREE.LinearFilter,
				magFilter: THREE.LinearFilter,
				depthBuffer: false,
				stencilBuffer: false,
			});
			this.outputRT.texture.colorSpace = THREE.NoColorSpace;
			this.outputRT.texture.generateMipmaps = false;
		}
	}

	_texturesPending(): boolean {
		const textures = this.__effectTextures;
		if (!textures) return false;
		for (const entry of textures.values()) {
			if (entry?.pending) return true;
		}
		return false;
	}

	_probeCompile(renderer: THREE.WebGLRenderer) {
		if (this._compileChecked) return;
		this._compileChecked = true;
		try {
			const props = (
				renderer as unknown as {
					properties?: { get: (m: THREE.Material) => { programs?: Map<string, { diagnostics?: { runnable?: boolean } }> } };
				}
			).properties?.get(this.material);
			const programs = props?.programs;
			if (!programs) return;
			for (const prog of programs.values()) {
				if (prog?.diagnostics?.runnable === false) {
					this._compileFailed = true;
					console.error(
						`[FreeFilmCut custom-effect] shader compile failed ("${this.passDef.name}") — passthrough`,
					);
					break;
				}
			}
		} catch {
			/* ignore */
		}
	}

	_blitPassthrough(
		renderer: THREE.WebGLRenderer,
		writeBuffer: THREE.WebGLRenderTarget,
		readBuffer: THREE.WebGLRenderTarget,
	) {
		const src = readBuffer?.texture || getFallbackTexture();
		this._copyUniforms.tDiffuse.value = src;
		this._fsQuad.material = this._copyMaterial;
		const target = this.outputRT
			? this.outputRT
			: this.renderToScreen
				? null
				: writeBuffer;
		const prevRT = renderer.getRenderTarget();
		renderer.setRenderTarget(target);
		const prevClear = new THREE.Color();
		renderer.getClearColor(prevClear);
		const prevAlpha = renderer.getClearAlpha();
		renderer.setClearColor(0x000000, 0);
		renderer.clear(true, true, true);
		this._fsQuad.render(renderer);
		renderer.setClearColor(prevClear, prevAlpha);
		renderer.setRenderTarget(prevRT);
		this._fsQuad.material = this.material;
	}

	_applyInput(source: string, readBuffer: THREE.WebGLRenderTarget) {
		if (source === "uInput") {
			return readBuffer?.texture || getFallbackTexture();
		}
		return this._resolveInput(source);
	}

	render(
		renderer: THREE.WebGLRenderer,
		writeBuffer: THREE.WebGLRenderTarget,
		readBuffer: THREE.WebGLRenderTarget,
		deltaTime?: number,
	) {
		if (this._texturesPending() || this._compileFailed) {
			this._blitPassthrough(renderer, writeBuffer, readBuffer);
			return;
		}

		for (const binding of this._inputBindings) {
			const tex = this._applyInput(binding.source, readBuffer);
			const u = this.uniforms[binding.uniform];
			if (u) u.value = tex || getFallbackTexture();
		}

		if (
			typeof this.__fccEffectTime === "number" &&
			Number.isFinite(this.__fccEffectTime)
		) {
			(this.uniforms.uTime as { value: number }).value = this.__fccEffectTime;
		} else {
			const dt =
				typeof deltaTime === "number" && Number.isFinite(deltaTime)
					? Math.max(0, deltaTime)
					: 0;
			this._timeAcc += dt;
			(this.uniforms.uTime as { value: number }).value = this._timeAcc;
		}
		(this.uniforms.uFrame as { value: number }).value =
			(((this.uniforms.uFrame as { value: number }).value as number) + 1) %
			65536;

		const target = this.outputRT
			? this.outputRT
			: this.renderToScreen
				? null
				: writeBuffer;
		const prevRT = renderer.getRenderTarget();
		renderer.setRenderTarget(target);
		const prevClear = new THREE.Color();
		renderer.getClearColor(prevClear);
		const prevAlpha = renderer.getClearAlpha();
		renderer.setClearColor(0x000000, 0);
		renderer.clear(true, true, true);
		this._fsQuad.material = this.material;
		this._fsQuad.render(renderer);
		this._probeCompile(renderer);
		renderer.setClearColor(prevClear, prevAlpha);
		renderer.setRenderTarget(prevRT);

		if (this._compileFailed) {
			this._blitPassthrough(renderer, writeBuffer, readBuffer);
		}
	}

	setSize(width: number, height: number) {
		this._chainW = Math.max(1, Math.floor(width));
		this._chainH = Math.max(1, Math.floor(height));
		const rtSize = resolvePassRtSize(this.passDef, this._chainW, this._chainH);
		this._downsample = rtSize.downsample;
		this._resolutionScale = rtSize.resolutionScale;
		const { rtW, rtH } = rtSize;
		this.outputRT?.setSize(rtW, rtH);
		(this.uniforms.uTexel as { value: THREE.Vector2 }).value.set(
			1 / rtW,
			1 / rtH,
		);
		(this.uniforms.uResolution as { value: THREE.Vector2 }).value.set(
			rtW,
			rtH,
		);
		(this.uniforms.uChainTexel as { value: THREE.Vector2 }).value.set(
			1 / this._chainW,
			1 / this._chainH,
		);
		(this.uniforms.uChainResolution as { value: THREE.Vector2 }).value.set(
			this._chainW,
			this._chainH,
		);
	}

	dispose() {
		this.material.dispose();
		this._copyMaterial.dispose();
		this._fsQuad.dispose();
		this.outputRT?.dispose();
	}
}

function buildParamSchema(params: CustomEffectParamDef[]) {
	const schema: Array<Record<string, unknown>> = [];
	for (const p of params || []) {
		if (p.type === "float" || p.type === "int") {
			schema.push({
				key: p.key,
				type: p.type,
				label: p.label || p.key,
				labelZh: p.labelZh,
				min: p.min !== undefined ? p.min : 0,
				max: p.max !== undefined ? p.max : p.type === "int" ? 100 : 1,
				step: p.step !== undefined ? p.step : p.type === "int" ? 1 : 0.01,
			});
		} else if (p.type === "boolean") {
			schema.push({
				key: p.key,
				type: "boolean",
				label: p.label || p.key,
				labelZh: p.labelZh,
			});
		} else if (p.type === "color") {
			schema.push({
				key: p.key,
				type: "color",
				label: p.label || p.key,
				labelZh: p.labelZh,
			});
		} else if (
			p.type === "vec2" ||
			p.type === "vec3" ||
			p.type === "vec4"
		) {
			schema.push({
				key: p.key,
				type: p.type,
				label: p.label || p.key,
				labelZh: p.labelZh,
				size: Number(p.type.slice(3)),
			});
		}
	}
	return schema;
}

export function definitionFingerprint(def: CustomEffectDefinition): string {
	try {
		return JSON.stringify(def);
	} catch {
		return String(def?.id || "");
	}
}

export function buildCustomEffectDescriptor(
	def: CustomEffectDefinition,
): CustomEffectDescriptor | null {
	if (!def?.id || !Array.isArray(def.passes) || def.passes.length === 0) {
		return null;
	}
	const paramDefs = (def.params || []).map((p) => ({ ...p }));
	const paramTypes: Record<string, string> = {};
	for (const p of paramDefs) paramTypes[p.key] = p.type;

	return {
		type: CUSTOM_PREFIX + def.id,
		label: def.name,
		labelZh: def.name,
		__customDefinition: def,
		createDefaultParams() {
			const out: Record<string, number | boolean | string | number[]> = {};
			for (const p of paramDefs) {
				if (
					p.type === "vec2" ||
					p.type === "vec3" ||
					p.type === "vec4"
				) {
					const size = Number(p.type.slice(3));
					out[p.key] = Array.isArray(p.default)
						? (p.default as number[]).slice()
						: new Array(size).fill(0);
				} else if (p.type === "color") {
					out[p.key] =
						typeof p.default === "string" ? p.default : "#ffffff";
				} else if (p.type === "boolean") {
					out[p.key] = !!p.default;
				} else if (p.type === "int") {
					out[p.key] = Math.round(Number(p.default) || 0);
				} else {
					out[p.key] = Number(p.default) || 0;
				}
			}
			return out;
		},
		paramSchema: buildParamSchema(paramDefs),
		createPasses(ctx: CreatePassesCtx) {
			const textures = loadEffectTextures(def, ctx.resolveAssetUrl);
			const textureNames = new Set(
				(def.textures || []).map((t) => t.name),
			);
			const rtMap = new Map<string, ConfigurablePass>();
			const passes: PassType[] = [];

			const resolveInput = (source: string): THREE.Texture => {
				if (source === "$camera") {
					return ctx.__fccBeautyTexture || getFallbackTexture();
				}
				if (
					source === "uTransitionFrom" ||
					source === "uTransitionTo"
				) {
					return getFallbackTexture();
				}
				if (source.startsWith("$rt:")) {
					const upstream = rtMap.get(source.slice(4));
					return upstream?.outputRT?.texture || getFallbackTexture();
				}
				if (source.startsWith("$tex:")) {
					const t = textures.get(source.slice(5));
					if (!t) return getFallbackTexture();
					if (t.dynamic === "scene") {
						// MediaPlay RT: uuid from entry.textureBindings; look up
						// live __fccRT each frame (NLE stores on userData).
						const bindings = ctx.__fccTextureBindings || {};
						const b = bindings[t.texName || ""];
						const rtUuid = b?.rtUuid;
						const obj =
							rtUuid && ctx.scene
								? ctx.scene.getObjectByProperty("uuid", rtUuid)
								: null;
						const rt =
							(
								obj as
									| (THREE.Object3D & {
											__fccRT?: THREE.WebGLRenderTarget;
									  })
									| null
							)?.__fccRT ||
							(
								obj?.userData as
									| { __fccRT?: THREE.WebGLRenderTarget }
									| undefined
							)?.__fccRT;
						return rt?.texture || getFallbackTexture();
					}
					return t.texture || getFallbackTexture();
				}
				return getFallbackTexture();
			};

			(def.passes || []).forEach((passDef, index) => {
				const isFinal = index === (def.passes || []).length - 1;
				const pass = new ConfigurablePass({
					passDef,
					paramDefs,
					textureNames,
					resolveInput,
					width: ctx.width,
					height: ctx.height,
					isFinal,
				});
				pass.__effectTextures = textures;
				if (typeof ctx.effectTime === "number") {
					pass.__fccEffectTime = ctx.effectTime;
				}
				if (pass.outputName) rtMap.set(pass.outputName, pass);
				passes.push(pass);
			});

			return passes;
		},
		applyParams(passes, params) {
			for (const pass of passes) {
				if (!(pass instanceof ConfigurablePass)) continue;
				for (const key of Object.keys(params || {})) {
					const u = pass.uniforms[key];
					if (!u) continue;
					setParamUniform(u, paramTypes[key], params[key]);
				}
			}
		},
	};
}

export function customEffectTypeId(defOrId: CustomEffectDefinition | string): string {
	const id = typeof defOrId === "string" ? defOrId : defOrId.id;
	return CUSTOM_PREFIX + id;
}
