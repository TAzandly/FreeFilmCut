from pathlib import Path

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing: {label}")
    return text.replace(old, new, 1)

# --- text-layer-rt.ts ---
path = Path(r"freefilmcut/apps/web/src/vfxpack/text-layer-rt.ts")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    'from "@/vfxpack/postprocess";\n',
    'from "@/vfxpack/postprocess";\nimport { shouldReuseTextLayerRtSize } from "@/vfxpack/text-layer-aabb";\n',
    "postprocess import",
)
text = replace_once(
    text,
    """export type TextLayerRTSpec = {
	/** Keep true: flower inner shadow / face stencil need a stencil buffer. */
	stencilBuffer?: boolean;
	depthBuffer?: boolean;
};
""",
    """export type TextLayerRTSpec = {
	/** Keep true: flower inner shadow / face stencil need a stencil buffer. */
	stencilBuffer?: boolean;
	depthBuffer?: boolean;
	/**
	 * When true, keep an existing RT if it already covers (w,h) and is not much
	 * larger (hysteresis). Avoids per-frame realloc as AABB breathes with anim.
	 */
	fit?: boolean;
};
""",
    "TextLayerRTSpec",
)
text = replace_once(
    text,
    """export function ensureTextLayerRenderTarget(
	prev: THREE.WebGLRenderTarget | null,
	width: number,
	height: number,
	spec: TextLayerRTSpec = {},
): THREE.WebGLRenderTarget {
	const w = Math.max(1, Math.round(width));
	const h = Math.max(1, Math.round(height));
	if (
		prev &&
		prev.width === w &&
		prev.height === h &&
		prev.texture.type === THREE.HalfFloatType
	)
		return prev;
	prev?.dispose();
	return createTextLayerRenderTarget(w, h, spec);
}
""",
    """export function ensureTextLayerRenderTarget(
	prev: THREE.WebGLRenderTarget | null,
	width: number,
	height: number,
	spec: TextLayerRTSpec = {},
): THREE.WebGLRenderTarget {
	const w = Math.max(1, Math.round(width));
	const h = Math.max(1, Math.round(height));
	const fit = !!spec.fit;
	if (prev && prev.texture.type === THREE.HalfFloatType) {
		if (!fit && prev.width === w && prev.height === h) return prev;
		if (fit && shouldReuseTextLayerRtSize(prev.width, prev.height, w, h)) return prev;
	}
	prev?.dispose();
	return createTextLayerRenderTarget(w, h, spec);
}
""",
    "ensureTextLayerRenderTarget",
)
text = replace_once(
    text,
    """export function renderTextLayerToTarget({
	renderer,
	root,
	uiCamera,
	resW,
	resH,
	target,
}: {
	renderer: THREE.WebGLRenderer;
	root: THREE.Object3D;
	uiCamera: THREE.OrthographicCamera;
	resW: number;
	resH: number;
	target: THREE.WebGLRenderTarget;
}): boolean {
	const prevTarget = renderer.getRenderTarget();
	const prevClear = new THREE.Color();
	renderer.getClearColor(prevClear);
	const prevAlpha = renderer.getClearAlpha();

	renderer.setRenderTarget(target);
	renderer.setClearColor(0x000000, 0);
	renderer.clear(true, true, true);

	const drew = renderUIOverlay({
		renderer,
		root,
		uiCamera,
		resW,
		resH,
		target,
	});

	renderer.setClearColor(prevClear, prevAlpha);
	renderer.setRenderTarget(prevTarget);
	return drew;
}
""",
    """export function renderTextLayerToTarget({
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
	target: THREE.WebGLRenderTarget;
	/** Optional tight frustum in project pixels (bottom-left origin). */
	viewRect?: { x: number; y: number; w: number; h: number } | null;
}): boolean {
	const prevTarget = renderer.getRenderTarget();
	const prevClear = new THREE.Color();
	renderer.getClearColor(prevClear);
	const prevAlpha = renderer.getClearAlpha();

	renderer.setRenderTarget(target);
	renderer.setViewport(0, 0, target.width, target.height);
	renderer.setScissorTest(false);
	renderer.setClearColor(0x000000, 0);
	renderer.clear(true, true, true);

	const drew = renderUIOverlay({
		renderer,
		root,
		uiCamera,
		resW,
		resH,
		target,
		viewRect: viewRect || null,
	});

	renderer.setClearColor(prevClear, prevAlpha);
	renderer.setRenderTarget(prevTarget);
	return drew;
}
""",
    "renderTextLayerToTarget",
)
path.write_text(text, encoding="utf-8")
print("ok text-layer-rt.ts")

# --- ui-overlay.ts: viewRect on renderUIOverlay ---
path = Path(r"freefilmcut/apps/web/src/vfxpack/ui-overlay.ts")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    """export function renderUIOverlay({
	renderer,
	root,
	uiCamera,
	resW,
	resH,
	target,
}: {
	renderer: THREE.WebGLRenderer;
	root: THREE.Object3D;
	uiCamera: THREE.OrthographicCamera;
	resW: number;
	resH: number;
	target: THREE.WebGLRenderTarget | null;
}): boolean {
	if (!packHasUIMode(root, RENDER_MODE_OVERLAY)) return false;

	layoutAllCanvases(root, resW, resH, { forMode: "overlay" });
	uiCamera.left = 0;
	uiCamera.right = resW;
	uiCamera.top = resH;
	uiCamera.bottom = 0;
	uiCamera.updateProjectionMatrix();
""",
    """export function renderUIOverlay({
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
""",
    "renderUIOverlay",
)
path.write_text(text, encoding="utf-8")
print("ok ui-overlay.ts")
