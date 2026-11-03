/**
 * FreeFilmCut UGUI for OpenCut:
 * - Overlay: ortho after post-process (clear depth only).
 * - Screen Space Camera: plane in front of pack camera, included in beauty
 *   (before PP) via UI_CAMERA_LAYER.
 *
 * Nulls scene.background/fog for the Overlay UI pass so Three.js does not
 * redraw the background and wipe the already-presented 3D/PP color buffer.
 */

import * as THREE from "three";

export const UI_LAYER = 1;
export const UI_CAMERA_LAYER = 2;

export const RENDER_MODE_OVERLAY = "overlay";
export const RENDER_MODE_CAMERA = "camera";
export const DEFAULT_PLANE_DISTANCE = 100;

export type FccUIRenderMode = "overlay" | "camera";

export type FccUIRect = {
	type?: string;
	anchorMin?: [number, number];
	anchorMax?: [number, number];
	pivot?: [number, number];
	anchoredPosition?: [number, number];
	sizeDelta?: [number, number];
	/** Unity-style local Euler degrees XYZ */
	localEulerAngles?: [number, number, number];
	/** Unity-style local scale XYZ */
	localScale?: [number, number, number];
	renderMode?: FccUIRenderMode | string;
	cameraUuid?: string | null;
	planeDistance?: number;
	text?: string;
	font?: string;
	fontBold?: string;
	fontFileName?: string;
	fontSize?: number;
	bold?: boolean;
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
	/** Font size at which flowerStyle linear measures were authored. */
	flowerBaseFontSize?: number;
	/** FlowerStyle Effect stack on Text (not a separate UI type) — see flower-style.ts */
	flowerStyle?: unknown;
};

export type FccUIData = FccUIRect & { type: string };

export function getFccUI(object: THREE.Object3D): FccUIData | null {
	const ud = object.userData as { fccUI?: FccUIData } | undefined;
	const ui = ud?.fccUI;
	if (!ui || typeof ui !== "object" || !ui.type) return null;
	return ui;
}

export function isUICanvas(object: THREE.Object3D): boolean {
	return getFccUI(object)?.type === "canvas";
}

export function isUIImage(object: THREE.Object3D): boolean {
	return getFccUI(object)?.type === "image";
}

export function isUIText(object: THREE.Object3D): boolean {
	return getFccUI(object)?.type === "text";
}

export function getCanvasRenderMode(object: THREE.Object3D): FccUIRenderMode {
	const ui = getFccUI(object);
	if (!ui || ui.type !== "canvas") return RENDER_MODE_OVERLAY;
	return ui.renderMode === RENDER_MODE_CAMERA
		? RENDER_MODE_CAMERA
		: RENDER_MODE_OVERLAY;
}

export function getOwningCanvasRenderMode(
	object: THREE.Object3D,
): FccUIRenderMode {
	let p: THREE.Object3D | null = object;
	while (p) {
		if (isUICanvas(p)) return getCanvasRenderMode(p);
		p = p.parent;
	}
	return RENDER_MODE_OVERLAY;
}

export function packHasUI(root: THREE.Object3D): boolean {
	let found = false;
	root.traverse((o) => {
		if (found) return;
		if (getFccUI(o)) found = true;
	});
	return found;
}

export function packHasUIMode(
	root: THREE.Object3D,
	mode: FccUIRenderMode,
): boolean {
	let found = false;
	root.traverse((o) => {
		if (found) return;
		if (!isUICanvas(o)) return;
		if (getCanvasRenderMode(o) === mode) found = true;
	});
	return found;
}

export function computeAnchoredRect(
	ui: FccUIRect,
	parentRect: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
	const aMin = ui.anchorMin || [0.5, 0.5];
	const aMax = ui.anchorMax || [0.5, 0.5];
	const pivot = ui.pivot || [0.5, 0.5];
	const pos = ui.anchoredPosition || [0, 0];
	const size = ui.sizeDelta || [100, 100];

	const anchorMinX = parentRect.x + parentRect.w * aMin[0];
	const anchorMinY = parentRect.y + parentRect.h * aMin[1];
	const anchorMaxX = parentRect.x + parentRect.w * aMax[0];
	const anchorMaxY = parentRect.y + parentRect.h * aMax[1];

	const width = anchorMaxX - anchorMinX + size[0];
	const height = anchorMaxY - anchorMinY + size[1];

	const pivotX =
		anchorMinX + (anchorMaxX - anchorMinX) * pivot[0] + pos[0];
	const pivotY =
		anchorMinY + (anchorMaxY - anchorMinY) * pivot[1] + pos[1];

	const x = pivotX - width * pivot[0];
	const y = pivotY - height * pivot[1];

	return { x, y, w: Math.max(0.0001, width), h: Math.max(0.0001, height) };
}

function readLocalEulerDegrees(ui: FccUIRect): [number, number, number] {
	const e = ui.localEulerAngles;
	if (Array.isArray(e) && e.length >= 3) {
		return [Number(e[0]) || 0, Number(e[1]) || 0, Number(e[2]) || 0];
	}
	return [0, 0, 0];
}

function readLocalScale(ui: FccUIRect): [number, number, number] {
	const s = ui.localScale;
	if (Array.isArray(s) && s.length >= 3) {
		const x = Number(s[0]);
		const y = Number(s[1]);
		const z = Number(s[2]);
		return [
			Number.isFinite(x) && x !== 0 ? x : 1,
			Number.isFinite(y) && y !== 0 ? y : 1,
			Number.isFinite(z) && z !== 0 ? z : 1,
		];
	}
	return [1, 1, 1];
}

const FCC_IMAGE_MESH = "__fccImageMesh";

function applyLocalRotScale(node: THREE.Object3D, ui: FccUIRect) {
	let [sx, sy, sz] = readLocalScale(ui);
	if (Math.abs(sx) > 10 || Math.abs(sy) > 10 || Math.abs(sz) > 10) {
		sx = 1;
		sy = 1;
		sz = 1;
		if (ui) (ui as { localScale?: number[] }).localScale = [1, 1, 1];
	}
	const [ex, ey, ez] = readLocalEulerDegrees(ui);
	node.matrixAutoUpdate = true;
	node.scale.set(sx, sy, sz);
	node.rotation.order = "YXZ";
	node.rotation.set(
		THREE.MathUtils.degToRad(ex),
		THREE.MathUtils.degToRad(ey),
		THREE.MathUtils.degToRad(ez),
	);
}

function syncImageGeometrySize(node: THREE.Object3D, w: number, h: number) {
	if (!(node as THREE.Mesh).isMesh) return;
	const mesh = node as THREE.Mesh;
	const width = Math.max(0.0001, w);
	const height = Math.max(0.0001, h);
	const g = mesh.geometry as THREE.PlaneGeometry;
	if (g && g.type === "PlaneGeometry" && g.parameters) {
		if (
			Math.abs(g.parameters.width - width) < 0.05 &&
			Math.abs(g.parameters.height - height) < 0.05
		) {
			return;
		}
		g.dispose();
	} else if (mesh.geometry) {
		mesh.geometry.dispose();
	}
	mesh.geometry = new THREE.PlaneGeometry(width, height);
}

function applyNodeTransform(
	node: THREE.Object3D,
	rect: { x: number; y: number; w: number; h: number },
	ui: FccUIRect = {},
) {
	node.position.set(
		rect.x + rect.w * 0.5,
		rect.y + rect.h * 0.5,
		node.position.z || 0,
	);
	const sizeMesh =
		node.getObjectByName && node.getObjectByName(FCC_IMAGE_MESH);
	if (sizeMesh && (sizeMesh as THREE.Mesh).isMesh) {
		applyLocalRotScale(node, ui);
		sizeMesh.position.set(0, 0, 0);
		sizeMesh.rotation.set(0, 0, 0);
		sizeMesh.scale.set(1, 1, 1);
		// Size in geometry only — never non-uniform scale under/with rotation.
		syncImageGeometrySize(sizeMesh, rect.w, rect.h);
		return;
	}
	syncImageGeometrySize(node, rect.w, rect.h);
	applyLocalRotScale(node, ui);
}

function layoutNested(
	parent: THREE.Object3D,
	parentRect: { x: number; y: number; w: number; h: number },
) {
	for (const child of parent.children) {
		const ui = getFccUI(child);
		if (!ui) continue;
		const rect = computeAnchoredRect(ui, parentRect);
		const offsetX =
			rect.x + rect.w * 0.5 - (parentRect.x + parentRect.w * 0.5);
		const offsetY =
			rect.y + rect.h * 0.5 - (parentRect.y + parentRect.h * 0.5);
		if (ui.type === "text") {
			child.position.set(offsetX, offsetY, child.position.z || 0);
			applyLocalRotScale(child, ui);
			const hideOrig = !!(child.userData as { __fccTextAnimHideOriginals?: boolean })
				.__fccTextAnimHideOriginals;
			if (!hideOrig) {
				const sync = (child.userData as { __fccSyncText?: (r: typeof rect) => void }).__fccSyncText;
				if (sync) sync(rect);
			}
		} else {
			const sizeMesh =
				child.getObjectByName && child.getObjectByName(FCC_IMAGE_MESH);
			applyLocalRotScale(child, ui);
			if (sizeMesh && (sizeMesh as THREE.Mesh).isMesh) {
				sizeMesh.position.set(0, 0, 0);
				sizeMesh.rotation.set(0, 0, 0);
				sizeMesh.scale.set(1, 1, 1);
				syncImageGeometrySize(sizeMesh, rect.w, rect.h);
			} else {
				syncImageGeometrySize(child, rect.w, rect.h);
			}
			child.position.set(offsetX, offsetY, child.position.z || 0);
			if (child.children.length > 0) layoutNested(child, rect);
		}
	}
}

function layoutChildren(
	parent: THREE.Object3D,
	parentRect: { x: number; y: number; w: number; h: number },
) {
	for (const child of parent.children) {
		const ui = getFccUI(child);
		if (!ui) continue;
		const rect = computeAnchoredRect(ui, parentRect);
		if (ui.type === "text") {
			// Position + Unity localScale/Euler; Troika glyph size stays fontSize.
			child.position.set(
				rect.x + rect.w * 0.5,
				rect.y + rect.h * 0.5,
				child.position.z || 0,
			);
			applyLocalRotScale(child, ui);
			const hideOrig = !!(child.userData as { __fccTextAnimHideOriginals?: boolean })
				.__fccTextAnimHideOriginals;
			if (!hideOrig) {
				const sync = (child.userData as { __fccSyncText?: (r: typeof rect) => void }).__fccSyncText;
				if (sync) sync(rect);
			}
		} else if (ui.type === "image" || ui.type === "canvas") {
			applyNodeTransform(child, rect, ui);
		}
		if (ui.type !== "text" && child.children.length > 0) layoutNested(child, rect);
	}
}

const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _center = new THREE.Vector3();
const _bl = new THREE.Vector3();
const _camPos = new THREE.Vector3();

export function placeCanvasInFrontOfCamera(
	canvas: THREE.Object3D,
	camera: THREE.Camera,
	resW: number,
	resH: number,
	planeDistance: number,
) {
	camera.updateMatrixWorld(true);
	const dist = Math.max(0.01, Number(planeDistance) || DEFAULT_PLANE_DISTANCE);
	const persp = camera as THREE.PerspectiveCamera;
	const ortho = camera as THREE.OrthographicCamera;
	const aspect =
		persp.isPerspectiveCamera && persp.aspect > 0
			? persp.aspect
			: resW / Math.max(resH, 1);

	let fw: number;
	let fh: number;
	if (persp.isPerspectiveCamera) {
		const fovRad = THREE.MathUtils.degToRad(persp.fov);
		fh = 2 * dist * Math.tan(fovRad * 0.5);
		fw = fh * aspect;
	} else if (ortho.isOrthographicCamera) {
		const zoom = ortho.zoom || 1;
		fh = (ortho.top - ortho.bottom) / zoom;
		fw = (ortho.right - ortho.left) / zoom;
	} else {
		fh = Math.max(resH, 1) * 0.01;
		fw = fh * aspect;
	}

	_right.set(1, 0, 0).applyQuaternion(camera.quaternion);
	_up.set(0, 1, 0).applyQuaternion(camera.quaternion);
	_fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
	camera.getWorldPosition(_camPos);
	_center.copy(_camPos).addScaledVector(_fwd, dist);
	// Uniform XYZ. Z=1 with tiny XY scale amplifies child X/Y rotation.
	const sx = fw / Math.max(resW, 1);
	const sy = fh / Math.max(resH, 1);
	const uni = Math.min(sx, sy);
	const usedW = resW * uni;
	const usedH = resH * uni;
	const padX = (fw - usedW) * 0.5;
	const padY = (fh - usedH) * 0.5;

	_bl
		.copy(_center)
		.addScaledVector(_right, -fw * 0.5 + padX)
		.addScaledVector(_up, -fh * 0.5 + padY);

	canvas.position.copy(_bl);
	canvas.quaternion.copy(camera.quaternion);
	canvas.scale.set(uni, uni, uni);
	canvas.updateMatrixWorld(true);
}

export function layoutAllCanvases(
	scene: THREE.Object3D,
	resW: number,
	resH: number,
	options?: {
		forMode?: "overlay" | "camera" | "all";
		resolveCamera?: (uuid: string | null) => THREE.Camera | null;
	},
) {
	const forMode = options?.forMode || "all";
	const resolveCamera = options?.resolveCamera;
	const screenRect = { x: 0, y: 0, w: resW, h: resH };
	scene.traverse((obj) => {
		if (!isUICanvas(obj)) return;
		let p = obj.parent;
		let underCanvas = false;
		while (p) {
			if (isUICanvas(p)) {
				underCanvas = true;
				break;
			}
			p = p.parent;
		}
		if (underCanvas) return;
		const ui = getFccUI(obj);
		if (!ui) return;
		const mode = getCanvasRenderMode(obj);
		if (forMode !== "all" && mode !== forMode) return;

		// Parent chain is reliable here — fix Image layers for Camera canvases.
		applyUIObjectFlags(obj);
		obj.traverse((child) => {
			if (child !== obj && getFccUI(child)) applyUIObjectFlags(child);
		});
		const canvasRect = computeAnchoredRect(ui, screenRect);
		obj.position.set(0, 0, 0);
		obj.scale.set(1, 1, 1);
		obj.rotation.set(0, 0, 0);
		obj.quaternion.identity();
		layoutChildren(obj, canvasRect);

		if (mode === RENDER_MODE_CAMERA && resolveCamera) {
			const cam = resolveCamera(ui.cameraUuid || null);
			if (cam) {
				placeCanvasInFrontOfCamera(
					obj,
					cam,
					resW,
					resH,
					ui.planeDistance ?? DEFAULT_PLANE_DISTANCE,
				);
			}
		}
	});
}

function markMeshFlags(mesh: THREE.Object3D | null | undefined, mode: string) {
	const m = mesh as THREE.Mesh | null | undefined;
	if (!m || !m.isMesh || !m.material) return;
	m.layers.set(mode === RENDER_MODE_CAMERA ? UI_CAMERA_LAYER : UI_LAYER);
	m.frustumCulled = false;
	const mats = Array.isArray(m.material) ? m.material : [m.material];
	for (const mat of mats) {
		if (!mat) continue;
		mat.depthTest = mode === RENDER_MODE_CAMERA;
		mat.depthWrite = false;
		mat.side = THREE.DoubleSide;
		(mat as THREE.Material & { toneMapped?: boolean }).toneMapped = false;
	}
}

export function isFccTroikaTextMesh(object: THREE.Object3D): boolean {
	const n = object.name || "";
	return (
		n === "__fccText" ||
		n === "__fccTextShadow" ||
		n.startsWith("__fccFlower_")
	);
}

/** Troika glyph meshes default to layer 0; overlay camera only sees UI_LAYER. */
export function applyTroikaTextMeshLayers(
	root: THREE.Object3D,
	mode: FccUIRenderMode | string = RENDER_MODE_OVERLAY,
) {
	const layer = mode === RENDER_MODE_CAMERA ? UI_CAMERA_LAYER : UI_LAYER;
	const hideOrig = !!(root.userData as { __fccTextAnimHideOriginals?: boolean })
		?.__fccTextAnimHideOriginals;
	root.traverse((child) => {
		if (!isFccTroikaTextMesh(child)) return;
		// Skip parked / hidden originals while char-split owns drawing.
		let p: THREE.Object3D | null = child.parent;
		while (p && p !== root) {
			if (p.name === "__fccTextAnimPark") return;
			p = p.parent;
		}
		if (
			hideOrig &&
			child.parent === root &&
			(child.name === "__fccText" ||
				child.name === "__fccTextShadow" ||
				child.name.startsWith("__fccFlower_"))
		) {
			child.visible = false;
			child.layers.disableAll();
			return;
		}
		child.layers.set(layer);
		child.frustumCulled = false;
		markMeshFlags(child, mode);
	});
}

export function applyUIObjectFlags(object: THREE.Object3D) {
	const own = getFccUI(object);
	if (!own) return;
	const mode =
		own.type === "canvas"
			? own.renderMode === RENDER_MODE_CAMERA
				? RENDER_MODE_CAMERA
				: RENDER_MODE_OVERLAY
			: getOwningCanvasRenderMode(object);

	object.layers.set(mode === RENDER_MODE_CAMERA ? UI_CAMERA_LAYER : UI_LAYER);
	object.frustumCulled = false;
	if ((object as THREE.Mesh).isMesh) {
		markMeshFlags(object, mode);
	} else if (own.type === "image") {
		markMeshFlags(object.getObjectByName?.(FCC_IMAGE_MESH), mode);
	} else if (own.type === "text") {
		// Glyph meshes are plain Troika children (no fccUI) — must match UI camera layer
		// or Default text / Sample show selection box but no glyphs.
		applyTroikaTextMeshLayers(object, mode);
	}
}

export function createUIOverlayCamera(): THREE.OrthographicCamera {
	const cam = new THREE.OrthographicCamera(0, 1, 1, 0, -1000, 1000);
	cam.name = "UIOverlayCamera";
	cam.layers.set(UI_LAYER);
	cam.position.set(0, 0, 10);
	cam.lookAt(0, 0, 0);
	return cam;
}

/**
 * Layout Camera-mode canvases and enable UI_CAMERA_LAYER on beautyCam.
 */
export function prepareCameraModeUI({
	root,
	beautyCam,
	resW,
	resH,
	resolveCamera,
}: {
	root: THREE.Object3D;
	beautyCam: THREE.Camera;
	resW: number;
	resH: number;
	resolveCamera?: (uuid: string | null) => THREE.Camera | null;
}): boolean {
	if (!packHasUIMode(root, RENDER_MODE_CAMERA)) {
		beautyCam.layers.disable(UI_CAMERA_LAYER);
		return false;
	}
	layoutAllCanvases(root, resW, resH, {
		forMode: "camera",
		resolveCamera:
			resolveCamera ||
			((uuid) => {
				if (uuid) {
					let found: THREE.Camera | null = null;
					root.traverse((o) => {
						if (found) return;
						const c = o as THREE.Camera;
						if (
							o.uuid === uuid &&
							(c.isPerspectiveCamera || c.isOrthographicCamera || c.isCamera)
						) {
							found = c;
						}
					});
					if (found) return found;
				}
				return beautyCam;
			}),
	});
	beautyCam.layers.enable(UI_CAMERA_LAYER);
	return true;
}

export function restoreCameraModeUI(beautyCam: THREE.Camera) {
	beautyCam.layers.disable(UI_CAMERA_LAYER);
}

/**
 * Overlay-only: layout + render onto current RT. Clears depth only.
 */
/** Draw overlay UI into `target` (or default FB). Timeline text uses text-layer-rt wrappers. */
export function renderUIOverlay({
	renderer,
	root,
	uiCamera,
	resW,
	resH,
	target,
	viewRect,
}: {
	renderer: THREE.WebGLRenderer;
	root: THREE.Object3D;
	uiCamera: THREE.OrthographicCamera;
	resW: number;
	resH: number;
	target: THREE.WebGLRenderTarget | null;
	/** Tight frustum in project pixels (bottom-left origin). Layout still uses full res. */
	viewRect?: { x: number; y: number; w: number; h: number } | null;
}): boolean {
	if (!packHasUIMode(root, RENDER_MODE_OVERLAY)) return false;

	layoutAllCanvases(root, resW, resH, { forMode: "overlay" });
	if (viewRect && viewRect.w > 0 && viewRect.h > 0) {
		uiCamera.left = viewRect.x;
		uiCamera.right = viewRect.x + viewRect.w;
		uiCamera.bottom = viewRect.y;
		uiCamera.top = viewRect.y + viewRect.h;
	} else {
		uiCamera.left = 0;
		uiCamera.right = resW;
		uiCamera.top = resH;
		uiCamera.bottom = 0;
	}
	uiCamera.updateProjectionMatrix();

	const scene = root as THREE.Scene;
	const prevBackground = scene.background;
	const prevFog = scene.fog;
	if ("background" in scene) scene.background = null;
	if ("fog" in scene) scene.fog = null;

	const prevAutoClear = renderer.autoClear;
	renderer.setRenderTarget(target);
	renderer.autoClear = false;
	renderer.clearDepth();
	if (typeof renderer.clearStencil === "function") renderer.clearStencil();
	renderer.render(scene, uiCamera);

	if ("background" in scene) scene.background = prevBackground;
	if ("fog" in scene) scene.fog = prevFog;
	renderer.autoClear = prevAutoClear;
	return true;
}
