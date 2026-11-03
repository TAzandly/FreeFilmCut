/**
 * Graft non-UI scene meshes (e.g. Box/Cube) + materials from a text-template
 * source pack onto the synthetic Troika flower-text root so clip preview can
 * show authored scene props and shader sticker materials.
 *
 * fcc-tl-flower-16 / fcc-ui-194
 */
import * as THREE from "three";
import type { LoadedVfxPack, VfxSceneNode } from "@/vfxpack/types";
import {
	buildPackScene,
	type BuiltPackScene,
} from "@/vfxpack/scene-builder";
import { disposePackVideos } from "@/vfxpack/pack-video";
import { getFccUI } from "@/vfxpack/ui-overlay";

export const FCC_TEXT_TEMPLATE_PROPS = "__fccTextTemplateProps";

function isInternalName(name: string): boolean {
	return (
		name.startsWith("__fcc") ||
		name.startsWith("TimelineText") ||
		name === "Text" ||
		/troika/i.test(name)
	);
}

/** True for authored prop meshes (Box/Cube/etc.), not flower/sticker/UI. */
export function isTextTemplatePropMeshName(name: string): boolean {
	if (!name || isInternalName(name)) return false;
	return true;
}

export function sceneHasTextTemplatePropMeshes(
	pack: LoadedVfxPack | null | undefined,
): boolean {
	const nodes = pack?.scene?.nodes;
	if (!Array.isArray(nodes)) return false;
	for (const n of nodes as VfxSceneNode[]) {
		if (n.kind !== "mesh" && n.type !== "Mesh" && n.type !== "SkinnedMesh")
			continue;
		const name = String(n.name || "");
		if (isInternalName(name)) continue;
		if ((n.userData as { fccUI?: unknown } | undefined)?.fccUI) continue;
		return true;
	}
	return false;
}

function collectPropMeshes(root: THREE.Object3D): THREE.Mesh[] {
	const out: THREE.Mesh[] = [];
	root.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (!mesh.isMesh) return;
		const name = String(mesh.name || "");
		if (isInternalName(name)) return;
		// Skip UI subtree meshes
		let p: THREE.Object3D | null = mesh;
		while (p) {
			const ui = getFccUI(p);
			if (ui) return;
			p = p.parent;
		}
		out.push(mesh);
	});
	return out;
}

export type GraftedTextTemplateProps = {
	materialsByUuid: Map<string, THREE.Material>;
	/** Perspective (or ortho) camera from the source pack, if any. */
	camera: THREE.PerspectiveCamera | THREE.OrthographicCamera | null;
	/** True when at least one prop mesh was attached. */
	hasProps: boolean;
	/** Dispose helper for grafted source built leftovers. */
	dispose: () => void;
};

/**
 * Build the source text-template pack scene once, steal prop meshes + camera +
 * materials map onto `targetRoot`, then dispose the leftover built scene.
 */
export async function graftTextTemplateSceneProps({
	targetRoot,
	sourcePack,
}: {
	targetRoot: THREE.Object3D;
	sourcePack: LoadedVfxPack;
}): Promise<GraftedTextTemplateProps> {
	const empty: GraftedTextTemplateProps = {
		materialsByUuid: new Map(),
		camera: null,
		hasProps: false,
		dispose: () => undefined,
	};

	let built: BuiltPackScene | null = null;
	try {
		built = await buildPackScene({ pack: sourcePack });
	} catch (err) {
		console.warn("[FreeFilmCut] text-template prop buildPackScene failed", err);
		return empty;
	}
	if (!built) return empty;

	const propsRootName = FCC_TEXT_TEMPLATE_PROPS;
	const old = targetRoot.getObjectByName(propsRootName);
	if (old) {
		targetRoot.remove(old);
		old.traverse((o) => {
			const m = o as THREE.Mesh;
			if (m.isMesh) {
				m.geometry?.dispose?.();
				const mat = m.material;
				const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
				for (const x of mats) {
					// Shared with materialsByUuid — do not dispose here.
					void x;
				}
			}
		});
	}

	const propsRoot = new THREE.Group();
	propsRoot.name = propsRootName;
	propsRoot.userData.__fccTextTemplateProps = true;

	const meshes = collectPropMeshes(built.root);
	for (const mesh of meshes) {
		// Preserve world transform when reparenting out of the source hierarchy.
		mesh.updateMatrixWorld(true);
		const wPos = new THREE.Vector3();
		const wQuat = new THREE.Quaternion();
		const wScale = new THREE.Vector3();
		mesh.matrixWorld.decompose(wPos, wQuat, wScale);
		if (mesh.parent) mesh.parent.remove(mesh);
		propsRoot.add(mesh);
		mesh.position.copy(wPos);
		mesh.quaternion.copy(wQuat);
		mesh.scale.copy(wScale);
		mesh.updateMatrix();
		mesh.userData.__fccTextTemplateProp = true;
	}

	// Copy useful lights into props root (MeshStandard on Box needs them).
	const lights: THREE.Light[] = [];
	built.root.traverse((o) => {
		const L = o as THREE.Light;
		if ((L as { isLight?: boolean }).isLight) lights.push(L);
	});
	for (const L of lights) {
		const clone = L.clone();
		clone.userData.__fccTextTemplatePropLight = true;
		propsRoot.add(clone);
	}

	targetRoot.add(propsRoot);

	const materialsByUuid = new Map(built.materialsByUuid);
	const camera = built.camera;

	// Detach camera from built.root so dispose doesn't kill it if we keep a ref.
	let keptCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera | null =
		null;
	if (camera) {
		keptCamera = camera.clone();
		keptCamera.name = (camera.name || "TplPropCamera") + "_clone";
		if (camera.parent) {
			camera.updateMatrixWorld(true);
			const wPos = new THREE.Vector3();
			const wQuat = new THREE.Quaternion();
			const wScale = new THREE.Vector3();
			camera.matrixWorld.decompose(wPos, wQuat, wScale);
			keptCamera.position.copy(wPos);
			keptCamera.quaternion.copy(wQuat);
			keptCamera.scale.copy(wScale);
		}
		keptCamera.updateProjectionMatrix?.();
		propsRoot.add(keptCamera);
	}

	// Dispose leftover built scene, but KEEP stolen mesh geometries + materialsMap
	// entries. disposeBuiltPackScene would dispose them (they're in built.disposables)
	// and kill shader stickers + Cube (fcc-tl-flower-16).
	try {
		const keep = new Set<{ dispose?: () => void }>();
		for (const mat of materialsByUuid.values()) keep.add(mat);
		for (const mesh of meshes) {
			if (mesh.geometry) keep.add(mesh.geometry);
			const mats = Array.isArray(mesh.material)
				? mesh.material
				: mesh.material
					? [mesh.material]
					: [];
			for (const m of mats) if (m) keep.add(m);
		}
		try {
			disposePackVideos(built.root);
		} catch {
			/* ignore */
		}
		for (const d of built.disposables) {
			if (keep.has(d as { dispose?: () => void })) continue;
			try {
				d.dispose();
			} catch {
				/* ignore */
			}
		}
		built.root.clear();
	} catch {
		/* ignore */
	}

	return {
		materialsByUuid,
		camera: keptCamera,
		hasProps: meshes.length > 0,
		dispose: () => {
			const g = targetRoot.getObjectByName(propsRootName);
			if (!g) return;
			targetRoot.remove(g);
			g.traverse((o) => {
				const m = o as THREE.Mesh;
				if (m.isMesh) {
					m.geometry?.dispose?.();
				}
			});
		},
	};
}

/** Materials map shape expected by text-stickers.js (uuid → Material). */
export function materialsMapFromUuidMap(
	map: Map<string, THREE.Material> | null | undefined,
): Record<string, THREE.Material> | null {
	if (!map || map.size === 0) return null;
	const out: Record<string, THREE.Material> = {};
	for (const [k, v] of map) out[k] = v;
	return out;
}
