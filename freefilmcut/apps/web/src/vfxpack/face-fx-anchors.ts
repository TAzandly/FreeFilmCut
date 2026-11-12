/**
 * Face FX anchor3d — load GLB from pack files and pose on landmark UV.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { FaceLandmarks } from "@/beauty/analysis/types";
import type { FaceFxAnchor3dLayer, FaceFxConfig } from "@/vfxpack/face-fx";
import { resolveFaceFxBindPoint } from "@/vfxpack/face-fx-driver";
import type { LoadedVfxPack } from "@/vfxpack/types";

const loader = new GLTFLoader();
const templateCache = new Map<string, Promise<THREE.Object3D | null>>();

function packAssetKey(packId: string, asset: string): string {
	return `${packId}::${asset}`;
}

function assetUrlFromPack(
	pack: LoadedVfxPack,
	asset: string,
): string | null {
	const rel = String(asset || "")
		.trim()
		.replace(/^\.\//, "");
	if (!rel) return null;
	const direct = pack.objectUrls.get(rel);
	if (direct) return direct;
	for (const [path, url] of pack.objectUrls) {
		if (path === rel || path.endsWith("/" + rel) || path.endsWith(rel)) {
			return url;
		}
	}
	const bytes = pack.files.get(rel) || pack.files.get("pack/" + rel);
	if (bytes) {
		const blob = new Blob([bytes.slice()], { type: "model/gltf-binary" });
		const url = URL.createObjectURL(blob);
		pack.objectUrls.set(rel, url);
		return url;
	}
	return null;
}

export function loadFaceFxGlbTemplate({
	pack,
	asset,
}: {
	pack: LoadedVfxPack;
	asset: string;
}): Promise<THREE.Object3D | null> {
	const key = packAssetKey(pack.id, asset);
	if (templateCache.has(key)) return templateCache.get(key)!;
	const promise = (async () => {
		const url = assetUrlFromPack(pack, asset);
		if (!url) return null;
		try {
			const gltf = await loader.loadAsync(url);
			const root = gltf.scene || gltf.scenes[0];
			root.traverse((o) => {
				const mesh = o as THREE.Mesh;
				if (mesh.isMesh) {
					mesh.frustumCulled = false;
					mesh.castShadow = false;
					mesh.receiveShadow = false;
				}
			});
			return root;
		} catch (err) {
			console.warn("[face-fx] GLB load failed", asset, err);
			return null;
		}
	})();
	templateCache.set(key, promise);
	return promise;
}

export type FaceFxAnchorInstance = {
	layerId: string;
	asset: string;
	root: THREE.Object3D;
	layer: FaceFxAnchor3dLayer;
};

export async function ensureFaceFxAnchorInstances({
	pack,
	config,
	group,
}: {
	pack: LoadedVfxPack;
	config: FaceFxConfig;
	group: THREE.Group;
}): Promise<FaceFxAnchorInstance[]> {
	const wanted = (config.layers || []).filter(
		(l): l is FaceFxAnchor3dLayer => l.kind === "anchor3d" && !!l.asset,
	);
	const existing = (group.userData.fccFaceFxInstances ||
		[]) as FaceFxAnchorInstance[];
	const next: FaceFxAnchorInstance[] = [];

	for (const layer of wanted) {
		let inst = existing.find(
			(e) => e.layerId === layer.id && e.asset === layer.asset,
		);
		if (!inst) {
			const template = await loadFaceFxGlbTemplate({
				pack,
				asset: layer.asset,
			});
			if (!template) continue;
			const root = template.clone(true);
			root.name = `FaceFx_${layer.id}`;
			root.visible = false;
			group.add(root);
			inst = { layerId: layer.id, asset: layer.asset, root, layer };
		} else {
			inst.layer = layer;
		}
		next.push(inst);
	}

	for (const old of existing) {
		if (!next.includes(old)) {
			group.remove(old.root);
		}
	}
	group.userData.fccFaceFxInstances = next;
	return next;
}

/** Pose GLB roots in UV/ortho space (0..1 plane, y down → y up). */
export function poseFaceFxAnchors({
	instances,
	faces,
	maxFaces = 4,
}: {
	instances: FaceFxAnchorInstance[];
	faces: readonly FaceLandmarks[];
	maxFaces?: number;
}): void {
	if (!faces.length) {
		for (const inst of instances) inst.root.visible = false;
		return;
	}
	const nFaces = Math.min(faces.length, maxFaces);
	for (const inst of instances) {
		const face = faces[0];
		if (!face || nFaces < 1) {
			inst.root.visible = false;
			continue;
		}
		const bind = resolveFaceFxBindPoint({
			face,
			bind: inst.layer.bind,
		});
		if (!bind.ok) {
			inst.root.visible = false;
			continue;
		}
		const off = inst.layer.offset || [0, 0, 0];
		const x = bind.x - 0.5 + off[0];
		const y = 0.5 - bind.y + off[1];
		const z = off[2];
		inst.root.position.set(x, y, z);
		const faceScale =
			Math.max(face.box.w, face.box.h) * (inst.layer.scale || 1) * 1.2;
		inst.root.scale.setScalar(Math.max(0.01, faceScale));
		inst.root.visible = true;
	}
}

export function faceFxConfigHasGlbAnchors(config: FaceFxConfig): boolean {
	return (config.layers || []).some(
		(l) => l.kind === "anchor3d" && !!String(l.asset || "").trim(),
	);
}
