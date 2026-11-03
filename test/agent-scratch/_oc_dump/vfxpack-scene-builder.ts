import * as THREE from "three";
import type { LoadedVfxPack, VfxSceneNode } from "@/vfxpack/types";
import {
	ensureBelowInputUniforms,
	isBelowInputUniformName,
	packNeedsBelowInput,
	type BelowInputUniformName,
} from "@/vfxpack/below-input";
import { ensureGlobalScreenUniforms } from "@/vfxpack/global-screen-params";
import {
	normalizeExposedParams,
	type ExposedParam,
} from "@/vfxpack/exposed-params";
import type { PostProcessStackData } from "@/vfxpack/postprocess";
import {
	normalizeAnim,
	type FreecapcutAnimClip,
} from "@/vfxpack/freecapcut-anim";

export type BuiltPackScene = {
	packId: string;
	/** Normalized / raw pack type from manifest (filter, effect, ...). */
	packType: string;
	/** Compose scope (below | stack | clip). */
	packScope: string;
	/** True when NLE should bind below-track composite to uInput etc. */
	needsBelowInput: boolean;
	/** Sampler names found on shaders that accept below input. */
	belowInputUniformNames: BelowInputUniformName[];
	root: THREE.Scene;
	camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
	disposables: Array<{ dispose: () => void }>;
	render?: {
		toneMapping?: number;
		toneMappingExposure?: number;
		shadows?: boolean;
		shadowType?: number;
		antialias?: boolean;
	};
	/** Camera post-process stack from Editor export. */
	postProcess?: PostProcessStackData | null;
	/** Materials keyed by exported uuid (for exposed uniform overrides). */
	materialsByUuid: Map<string, THREE.Material>;
	/** Params exposed to OpenCut properties / keyframes. */
	exposedParams: ExposedParam[];
	/** FreeFilmCut .anim clips packed with this scene (sampled by clip local time). */
	animClips: FreecapcutAnimClip[];
};

/**
 * Build a Three.js scene from vfxpack scene.json (MVP subset):
 * Scene / Mesh (BoxGeometry + map) / PerspectiveCamera + default lights.
 */
export async function buildPackScene({
	pack,
}: {
	pack: LoadedVfxPack;
}): Promise<BuiltPackScene | null> {
	if (!pack.scene) return null;

	const sceneFile = pack.scene;
	const root = new THREE.Scene();
	root.name = sceneFile.name || pack.displayName;

	const disposables: Array<{ dispose: () => void }> = [];
	const textureCache = new Map<string, THREE.Texture>();
	const belowInputUniformNames = new Set<BelowInputUniformName>();
	const materialsByUuid = new Map<string, THREE.Material>();
	let postProcess: PostProcessStackData | null = null;
	const needsBelow = packNeedsBelowInput({ type: pack.type, scope: pack.scope });

	const loadTexture = async (relPath: string): Promise<THREE.Texture | null> => {
		const url = pack.objectUrls.get(relPath);
		if (!url) return null;
		if (textureCache.has(relPath)) return textureCache.get(relPath)!;

		const texture = await new Promise<THREE.Texture>((resolve, reject) => {
			const loader = new THREE.TextureLoader();
			loader.load(
				url,
				(tex) => {
					tex.colorSpace = THREE.SRGBColorSpace;
					tex.flipY = true;
					tex.needsUpdate = true;
					resolve(tex);
				},
				undefined,
				reject,
			);
		});
		textureCache.set(relPath, texture);
		disposables.push(texture);
		return texture;
	};

	await applySceneRenderSettings({ root, sceneFile, loadTexture });

	// Default lights — exported packs often omit lights; MeshStandard needs them.
	const ambient = new THREE.AmbientLight(0xffffff, 0.85);
	const dir = new THREE.DirectionalLight(0xffffff, 1.1);
	dir.position.set(2, 4, 3);
	root.add(ambient);
	root.add(dir);

	let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera | null = null;

	for (const node of sceneFile.nodes) {
		if (node.kind === "scene" || node.type === "Scene") {
			continue;
		}

		if (node.kind === "camera" || node.type === "PerspectiveCamera") {
			const cam = new THREE.PerspectiveCamera(
				node.fov ?? 50,
				node.aspect ?? 16 / 9,
				node.near ?? 0.1,
				node.far ?? 2000,
			);
			applyTransform(cam, node);
			cam.name = node.name;
			root.add(cam);
			const stackFromNode =
				node.postProcess ||
				(node.userData &&
					(node.userData as { postProcessStack?: PostProcessStackData })
						.postProcessStack) ||
				null;
			if (
				!camera ||
				(sceneFile.activeCamera && sceneFile.activeCamera === node.uuid)
			) {
				camera = cam;
				if (stackFromNode && typeof stackFromNode === "object") {
					postProcess = {
						enabled: stackFromNode.enabled !== false,
						effects: Array.isArray(stackFromNode.effects)
							? stackFromNode.effects.map((e) => ({
									id: e.id,
									type: e.type,
									enabled: e.enabled !== false,
									params: { ...(e.params || {}) },
									exposed: { ...(e.exposed || {}) },
								}))
							: [],
					};
				}
			}
			continue;
		}

		if (node.kind === "mesh" || node.type === "Mesh") {
			const geometry = createGeometry(node);
			disposables.push(geometry);
			const material = await createMaterial(node, loadTexture, pack, disposables);
			disposables.push(material);
			const matUuid = node.materials?.[0]?.uuid;
			if (matUuid) materialsByUuid.set(matUuid, material);
			collectBelowInputNames(material, belowInputUniformNames);
			const mesh = new THREE.Mesh(geometry, material);
			mesh.name = node.name;
			mesh.visible = node.visible !== false;
			applyTransform(mesh, node);
			root.add(mesh);
		}
	}

	if (!camera) {
		camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 2000);
		camera.position.set(0, 1.5, 4);
		camera.lookAt(0, 0, 0);
		root.add(camera);
	}

	const belowNames = Array.from(belowInputUniformNames);
	const exposedParams = normalizeExposedParams({
		manifest: pack.manifest,
		scene: sceneFile,
	});


	// Load FreeFilmCut .anim clips listed in manifest (or assets.animations)
	const animClips: FreecapcutAnimClip[] = [];
	const animPaths = new Set<string>();
	for (const entry of pack.manifest.animations || []) {
		if (entry?.path) animPaths.add(String(entry.path).replace(/^pack\//, ""));
	}
	for (const p of pack.manifest.assets?.animations || []) {
		if (p) animPaths.add(String(p).replace(/^pack\//, ""));
	}
	// Also pick up any *.anim under animations/
	for (const key of pack.files.keys()) {
		if (/^animations\/.*\.anim$/i.test(key)) animPaths.add(key);
	}
	const decodeText = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
	for (const rel of animPaths) {
		const bytes = pack.files.get(rel) || pack.files.get(`pack/${rel}`);
		if (!bytes) continue;
		try {
			const raw = JSON.parse(decodeText(bytes));
			const clip = normalizeAnim(raw);
			if (clip) animClips.push(clip);
		} catch (err) {
			console.warn("[FreeFilmCut] failed to parse .anim", rel, err);
		}
	}

	return {
		packId: pack.id,
		packType: String(pack.type || "effect"),
		packScope: String(pack.scope || (needsBelow ? "below" : "stack")),
		needsBelowInput: needsBelow,
		belowInputUniformNames: belowNames,
		root,
		camera,
		disposables,
		postProcess,
		materialsByUuid,
		animClips,
		exposedParams,
		render: sceneFile.render
			? {
					toneMapping: sceneFile.render.toneMapping,
					toneMappingExposure: sceneFile.render.toneMappingExposure,
					shadows: sceneFile.render.shadows,
					shadowType: sceneFile.render.shadowType,
					antialias: sceneFile.render.antialias,
			  }
			: undefined,
	};
}

export function disposeBuiltPackScene({ built }: { built: BuiltPackScene }) {
	for (const d of built.disposables) {
		d.dispose();
	}
	built.root.clear();
}

function applyTransform(obj: THREE.Object3D, node: VfxSceneNode) {
	const t = node.transform;
	if (t.matrix && t.matrix.length === 16) {
		const m = new THREE.Matrix4().fromArray(t.matrix);
		m.decompose(obj.position, obj.quaternion, obj.scale);
		return;
	}
	obj.position.fromArray(t.position);
	obj.quaternion.fromArray(t.quaternion);
	obj.scale.fromArray(t.scale);
}


async function readPackText(
	pack: LoadedVfxPack,
	relPath: string | undefined,
): Promise<string | null> {
	if (!relPath) return null;
	const url = pack.objectUrls.get(relPath);
	if (url) {
		try {
			return await fetch(url).then((r) => r.text());
		} catch {
			/* fall through */
		}
	}
	const bytes = pack.files.get(relPath);
	if (!bytes) return null;
	return new TextDecoder("utf-8").decode(bytes);
}

async function applySceneRenderSettings({
	root,
	sceneFile,
	loadTexture,
}: {
	root: THREE.Scene;
	sceneFile: NonNullable<LoadedVfxPack["scene"]>;
	loadTexture: (rel: string) => Promise<THREE.Texture | null>;
}) {
	const bg = sceneFile.background as
		| {
				type?: string;
				color?: string;
				path?: string | null;
				blurriness?: number;
				intensity?: number;
		  }
		| string
		| null
		| undefined;

	if (typeof bg === "string") {
		root.background = new THREE.Color(bg);
	} else if (bg && typeof bg === "object") {
		if (bg.type === "Color" && bg.color) {
			root.background = new THREE.Color(bg.color);
		} else if (
			(bg.type === "Texture" || bg.type === "Equirectangular") &&
			bg.path
		) {
			const tex = await loadTexture(bg.path);
			if (tex) {
				if (bg.type === "Equirectangular") {
					tex.mapping = THREE.EquirectangularReflectionMapping;
				}
				root.background = tex;
			}
		} else if (bg.type === "None") {
			root.background = null;
		}
		if (typeof bg.blurriness === "number") {
			root.backgroundBlurriness = bg.blurriness;
		}
		if (typeof bg.intensity === "number") {
			root.backgroundIntensity = bg.intensity;
		}
	}

	const env = sceneFile.environment as
		| { type?: string; path?: string | null; intensity?: number }
		| null
		| undefined;
	if (env && env.type === "Equirectangular" && env.path) {
		const tex = await loadTexture(env.path);
		if (tex) {
			tex.mapping = THREE.EquirectangularReflectionMapping;
			root.environment = tex;
		}
		if (typeof env.intensity === "number") {
			(
				root as THREE.Scene & { environmentIntensity?: number }
			).environmentIntensity = env.intensity;
		}
	} else if (env && env.type === "None") {
		root.environment = null;
	}

	const fog = sceneFile.fog;
	if (fog && fog.type === "Fog") {
		root.fog = new THREE.Fog(
			fog.color ?? "#000000",
			fog.near ?? 1,
			fog.far ?? 1000,
		);
	} else if (fog && fog.type === "FogExp2") {
		root.fog = new THREE.FogExp2(
			fog.color ?? "#000000",
			fog.density ?? 0.00025,
		);
	}
}

function createGeometry(node: VfxSceneNode): THREE.BufferGeometry {
	const g = node.geometry;
	const p = g?.parameters ?? {};
	if (g?.type === "BoxGeometry") {
		return new THREE.BoxGeometry(
			p.width ?? 1,
			p.height ?? 1,
			p.depth ?? 1,
			p.widthSegments ?? 1,
			p.heightSegments ?? 1,
			p.depthSegments ?? 1,
		);
	}
	if (g?.type === "PlaneGeometry") {
		return new THREE.PlaneGeometry(p.width ?? 1, p.height ?? 1);
	}
	if (g?.type === "SphereGeometry") {
		return new THREE.SphereGeometry(
			p.radius ?? 0.5,
			p.widthSegments ?? 32,
			p.heightSegments ?? 16,
		);
	}
	return new THREE.BoxGeometry(1, 1, 1);
}

async function createMaterial(
	node: VfxSceneNode,
	loadTexture: (rel: string) => Promise<THREE.Texture | null>,
	pack?: LoadedVfxPack,
	disposables?: Array<{ dispose: () => void }>,
): Promise<THREE.Material> {
	const matDef = node.materials?.[0];
	const color = matDef?.color
		? new THREE.Color(matDef.color)
		: new THREE.Color(0xffffff);
	const mapPath = matDef?.textures?.map;
	const map = mapPath ? await loadTexture(mapPath) : null;

	// Custom ShaderMaterial / RawShaderMaterial from Editor export
	const shaderPaths = matDef?.shader as
		| { vertex?: string; fragment?: string; raw?: boolean }
		| undefined;
	if (
		pack &&
		shaderPaths?.vertex &&
		shaderPaths?.fragment &&
		(matDef?.type === "ShaderMaterial" || matDef?.type === "RawShaderMaterial")
	) {
		const vertexShader = await readPackText(pack, shaderPaths.vertex);
		const fragmentShader = await readPackText(pack, shaderPaths.fragment);
		if (vertexShader && fragmentShader) {
			// WebGL: a null sampler2D uniform often makes ALL samplers sample black
			// (including uInput). Always bind a 1x1 placeholder for empty maps.
			const white1x1 = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
			white1x1.needsUpdate = true;
			white1x1.colorSpace = THREE.SRGBColorSpace;
			disposables?.push(white1x1);
			const uniforms: Record<string, { value: unknown }> = {
				map: { value: map ?? white1x1 },
				color: { value: color.clone() },
				opacity: { value: matDef?.opacity ?? 1 },
				uTime: { value: 0 },
				useMap: { value: map !== null },
			};
			const ud = (matDef as { uniforms?: Record<string, unknown> })?.uniforms;
			if (ud) {
				for (const [k, v] of Object.entries(ud)) {
					if (v && typeof v === "object" && (v as { type?: string }).type === "t") {
						// NLE binds below-composite each frame — never treat as packed map.
						const binding = (v as { binding?: string }).binding;
						if (
							isBelowInputUniformName(k) ||
							binding === "accumBelow"
						) {
							uniforms[k] = { value: white1x1 };
							continue;
						}
						const p = (v as { path?: string }).path;
						const loaded = p ? await loadTexture(p) : null;
						uniforms[k] = { value: loaded ?? white1x1 };
					} else if (
						v &&
						typeof v === "object" &&
						"value" in (v as object)
					) {
						const raw = (v as { value: unknown }).value;
						if (typeof raw === "string" && raw.startsWith("#")) {
							uniforms[k] = { value: new THREE.Color(raw) };
						} else {
							uniforms[k] = { value: raw };
						}
					} else if (typeof v === "string" && v.startsWith("#")) {
						uniforms[k] = { value: new THREE.Color(v) };
					} else if (v !== null && v !== undefined) {
						uniforms[k] = { value: v };
					}
					// else: skip null (uInput placeholder / NLE bind)
				}
			}
			// Auto-create sampler slots declared as uInput / belowInput / iChannel0
			const belowNames = ensureBelowInputUniforms({
				uniforms,
				vertexShader,
				fragmentShader,
			});
			// Placeholder so WebGL always has a real sampler (null samples as black).
			for (const name of belowNames) {
				if (!uniforms[name].value) {
					uniforms[name].value = white1x1;
				}
			}
			// Any other sampler left null also breaks sibling samplers on some GPUs.
			for (const [k, u] of Object.entries(uniforms)) {
				if (u.value === null || u.value === undefined) {
					// Heuristic: names used as textures in this material path
					if (/map|input|channel|tex|sampler/i.test(k)) {
						u.value = white1x1;
					}
				}
			}
			const Ctor = shaderPaths.raw ? THREE.RawShaderMaterial : THREE.ShaderMaterial;
			const matBuilt = new Ctor({
				uniforms,
				vertexShader,
				fragmentShader,
				transparent: matDef?.transparent ?? false,
				opacity: matDef?.opacity ?? 1,
				side: matDef?.side ?? THREE.DoubleSide,
				toneMapped: false,
				depthWrite: matDef?.depthWrite ?? true,
				depthTest: matDef?.depthTest ?? true,
			});
			if (!matBuilt.userData) matBuilt.userData = {};
			matBuilt.userData.freecapcutGlobalScreen = true;
			ensureGlobalScreenUniforms(matBuilt, { forceAll: true });
			return matBuilt;
		}
	}

	if (matDef?.type === "MeshBasicMaterial") {
		return new THREE.MeshBasicMaterial({
			color,
			map,
			transparent: matDef.transparent ?? false,
			opacity: matDef.opacity ?? 1,
			side: matDef.side ?? THREE.FrontSide,
		});
	}

	return new THREE.MeshStandardMaterial({
		color,
		map,
		emissive: matDef?.emissive ? new THREE.Color(matDef.emissive) : undefined,
		metalness: matDef?.metalness ?? 0,
		roughness: matDef?.roughness ?? 1,
		transparent: matDef?.transparent ?? false,
		opacity: matDef?.opacity ?? 1,
		side: matDef?.side ?? THREE.FrontSide,
	});
}


function collectBelowInputNames(
	material: THREE.Material,
	into: Set<BelowInputUniformName>,
) {
	const mat = material as THREE.ShaderMaterial;
	if (!mat.uniforms) return;
	const names = ensureBelowInputUniforms({
		uniforms: mat.uniforms as Record<string, { value: unknown }>,
		vertexShader: mat.vertexShader,
		fragmentShader: mat.fragmentShader,
	});
	for (const n of names) into.add(n);
}
