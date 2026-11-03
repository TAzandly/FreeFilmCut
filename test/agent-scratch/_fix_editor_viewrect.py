from pathlib import Path
path = Path(r"three.js/editor/js/ui/TextLayerRT.js")
text = path.read_text(encoding="utf-8")
old = """export function renderOverlayTextLayerToRT( args ) {

	const renderer = args.renderer;
	const uiOverlay = args.uiOverlay;
	const resW = args.resW;
	const resH = args.resH;
	const target = args.target;
	const viewRect = args.viewRect || null;
	if ( ! renderer || ! uiOverlay || ! target ) return;

	const prevTarget = renderer.getRenderTarget();
	const prevClear = new THREE.Color();
	renderer.getClearColor( prevClear );
	const prevAlpha = renderer.getClearAlpha();

	renderer.setRenderTarget( target );
	renderer.setViewport( 0, 0, target.width, target.height );
	renderer.setScissorTest( false );
	renderer.setClearColor( 0x000000, 0 );
	renderer.clear( true, true, true );

	// Layout always full project; optional viewRect crops the overlay camera frustum.
	const layoutRect = viewRect && viewRect.w > 0 && viewRect.h > 0
		? { x: viewRect.x, y: viewRect.y, w: viewRect.w, h: viewRect.h }
		: { x: 0, y: 0, w: target.width, h: target.height };

	uiOverlay.render(
		renderer,
		layoutRect,
		resW,
		resH,
		target,
		viewRect,
	);

	renderer.setClearColor( prevClear, prevAlpha );
	renderer.setRenderTarget( prevTarget );

}
"""
new = """export function renderOverlayTextLayerToRT( args ) {

	const renderer = args.renderer;
	const uiOverlay = args.uiOverlay;
	const resW = args.resW;
	const resH = args.resH;
	const target = args.target;
	if ( ! renderer || ! uiOverlay || ! target ) return;

	const prevTarget = renderer.getRenderTarget();
	const prevClear = new THREE.Color();
	renderer.getClearColor( prevClear );
	const prevAlpha = renderer.getClearAlpha();

	renderer.setRenderTarget( target );
	renderer.setViewport( 0, 0, target.width, target.height );
	renderer.setScissorTest( false );
	renderer.setClearColor( 0x000000, 0 );
	renderer.clear( true, true, true );

	// Editor overlay TextFx still full project RT (SS-camera PP is scene-wide).
	// Tight AABB path is landed on OpenCut clip first; see TextLayerAabb.js.
	uiOverlay.render(
		renderer,
		{ x: 0, y: 0, w: target.width, h: target.height },
		resW,
		resH,
		target,
	);

	renderer.setClearColor( prevClear, prevAlpha );
	renderer.setRenderTarget( prevTarget );

}
"""
if old not in text:
    raise SystemExit("patched render block missing")
text = text.replace(old, new, 1)
# bump PostProcessStack import cache for TextLayerRT consumers via Viewport
path.write_text(text, encoding="utf-8")
print("reverted editor viewRect render")

vp = Path(r"three.js/editor/js/Viewport.js")
vt = vp.read_text(encoding="utf-8")
vt2 = vt.replace("from './ui/TextLayerRT.js?v=fcc-ui-137';", "from './ui/TextLayerRT.js?v=fcc-ui-164';")
if vt2 == vt:
    print("Viewport bump already or missing", "fcc-ui-137" in vt)
else:
    vp.write_text(vt2, encoding="utf-8")
    print("Viewport cache bump 164")
