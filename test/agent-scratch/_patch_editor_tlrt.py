from pathlib import Path
path = Path(r"three.js/editor/js/ui/TextLayerRT.js")
text = path.read_text(encoding="utf-8")

if "shouldReuseTextLayerRtSize" not in text:
    text = text.replace(
        "registerBuiltinEffects();\n",
        "registerBuiltinEffects();\n\nimport { shouldReuseTextLayerRtSize } from './TextLayerAabb.js?v=fcc-ui-164';\n",
        1,
    )
    # imports must be top - fix if we appended wrong
    if text.find("import { shouldReuse") > text.find("registerBuiltinEffects"):
        # move import near other imports
        text = text.replace("\nimport { shouldReuseTextLayerRtSize } from './TextLayerAabb.js?v=fcc-ui-164';\n", "\n")
        text = text.replace(
            "import {\n\trenderTextureFx,\n\tstackDataHasEnabledEffects,\n} from '../postprocessing/PostProcessStack.js?v=fcc-ui-163';\n",
            "import {\n\trenderTextureFx,\n\tstackDataHasEnabledEffects,\n} from '../postprocessing/PostProcessStack.js?v=fcc-ui-163';\nimport { shouldReuseTextLayerRtSize } from './TextLayerAabb.js?v=fcc-ui-164';\n",
            1,
        )

old_ensure = """export function ensureTextLayerRenderTarget( width, height ) {

	const w = Math.max( 1, Math.round( width ) );
	const h = Math.max( 1, Math.round( height ) );
	if ( pooledTarget && pooledTarget.width === w && pooledTarget.height === h && pooledTarget.texture.type === THREE.HalfFloatType ) {

		return pooledTarget;

	}
"""
new_ensure = """export function ensureTextLayerRenderTarget( width, height, opts ) {

	const w = Math.max( 1, Math.round( width ) );
	const h = Math.max( 1, Math.round( height ) );
	const fit = !!( opts && opts.fit );
	if ( pooledTarget && pooledTarget.texture.type === THREE.HalfFloatType ) {

		if ( ! fit && pooledTarget.width === w && pooledTarget.height === h ) return pooledTarget;
		if ( fit && shouldReuseTextLayerRtSize( pooledTarget.width, pooledTarget.height, w, h ) ) return pooledTarget;

	}
"""
if old_ensure not in text:
    raise SystemExit("ensureTextLayerRenderTarget not found in editor")
text = text.replace(old_ensure, new_ensure, 1)

old_render = """export function renderOverlayTextLayerToRT( args ) {

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
new_render = """export function renderOverlayTextLayerToRT( args ) {

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
if old_render not in text:
    raise SystemExit("renderOverlayTextLayerToRT not found")
text = text.replace(old_render, new_render, 1)

path.write_text(text, encoding="utf-8")
print("TextLayerRT.js patched")
