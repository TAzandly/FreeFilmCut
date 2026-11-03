# -*- coding: utf-8 -*-
"""Patch UIText.js: Face RT mask for inner shadow (fcc-ui-67)."""
from pathlib import Path

UITEXT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\UIText.js")
text = UITEXT.read_text(encoding="utf-8")

OLD_START = " * Clip an inner-shadow Troika pass to the Face glyph: keep only fragments that"
# Find the comment + function through end of applyInnerShadowFaceMask
idx = text.find(OLD_START)
if idx < 0:
    # maybe without leading comment star space
    idx = text.find("function applyInnerShadowFaceMask(")
    if idx < 0:
        raise SystemExit("applyInnerShadowFaceMask not found")
    # back up to doc comment
    doc = text.rfind("/**", 0, idx)
    if doc >= 0 and idx - doc < 500:
        idx = doc

end_marker = "\nfunction applyContentToTroika("
end = text.find(end_marker, idx)
if end < 0:
    raise SystemExit("applyContentToTroika not found after mask fn")

NEW = r''' * Inner shadow mask (fcc-ui-67): render the Face glyph into a screen-aligned
 * WebGLRenderTarget, then multiply the offset+blur inner-shadow pass by that
 * alpha (gl_FragCoord UV). Replaces the broken reverse-SDF UV hack.
 * Works for Overlay (letterbox viewport) and SS-Camera / composer FBOs because
 * we capture with the same camera + viewport/scissor as the destination draw.
 */
const FCC_FACE_MASK_LAYER = 31;
let _fccCapturingFaceMask = false;
const _fccMaskSize = new THREE.Vector2();
const _fccMaskViewport = new THREE.Vector4();
const _fccMaskScissor = new THREE.Vector4();
const _fccMaskClearColor = new THREE.Color();

function getEmptyFaceMaskTexture() {

	if ( getEmptyFaceMaskTexture._tex ) return getEmptyFaceMaskTexture._tex;
	const data = new Uint8Array( [ 0, 0, 0, 0 ] );
	const tex = new THREE.DataTexture( data, 1, 1, THREE.RGBAFormat );
	tex.needsUpdate = true;
	getEmptyFaceMaskTexture._tex = tex;
	return tex;

}

function disposeFaceMaskRT( group ) {

	if ( ! group || ! group.userData ) return;
	const rt = group.userData.__fccFaceMaskRT;
	if ( rt ) {

		try {

			rt.dispose();

		} catch ( e ) { /* ignore */ }

		delete group.userData.__fccFaceMaskRT;

	}
	delete group.userData.__fccFaceMaskFrameId;

}

/**
 * Render only the Face Troika mesh into a mask RT matching the current draw
 * buffer / render target. Same camera + viewport/scissor so gl_FragCoord UVs align.
 */
function captureFaceMaskToRT( renderer, scene, camera, group, faceMesh ) {

	if ( _fccCapturingFaceMask || ! renderer || ! scene || ! camera || ! faceMesh ) return null;
	_fccCapturingFaceMask = true;

	try {

		const currentRT = renderer.getRenderTarget();
		if ( currentRT ) {

			_fccMaskSize.set( currentRT.width, currentRT.height );

		} else {

			renderer.getDrawingBufferSize( _fccMaskSize );

		}

		const w = Math.max( 1, Math.floor( _fccMaskSize.x ) );
		const h = Math.max( 1, Math.floor( _fccMaskSize.y ) );

		let maskRT = group.userData.__fccFaceMaskRT;
		if ( ! maskRT || maskRT.width !== w || maskRT.height !== h ) {

			if ( maskRT ) {

				try {

					maskRT.dispose();

				} catch ( e ) { /* ignore */ }

			}

			maskRT = new THREE.WebGLRenderTarget( w, h, {
				format: THREE.RGBAFormat,
				type: THREE.UnsignedByteType,
				minFilter: THREE.NearestFilter,
				magFilter: THREE.NearestFilter,
				depthBuffer: true,
				stencilBuffer: false,
			} );
			maskRT.texture.generateMipmaps = false;
			group.userData.__fccFaceMaskRT = maskRT;

		}

		renderer.getViewport( _fccMaskViewport );
		renderer.getScissor( _fccMaskScissor );
		const prevScissorTest = renderer.getScissorTest();
		const prevAutoClear = renderer.autoClear;
		const prevClearAlpha = renderer.getClearAlpha();
		renderer.getClearColor( _fccMaskClearColor );

		const prevFaceLayers = faceMesh.layers.mask;
		const prevCamLayers = camera.layers.mask;

		faceMesh.layers.set( FCC_FACE_MASK_LAYER );
		camera.layers.set( FCC_FACE_MASK_LAYER );

		renderer.setRenderTarget( maskRT );
		// Full clear first (avoid uncleared garbage outside letterbox scissor).
		renderer.setScissorTest( false );
		renderer.setViewport( 0, 0, w, h );
		renderer.autoClear = false;
		renderer.setClearColor( 0x000000, 0 );
		renderer.clear( true, true, true );
		// Restore destination viewport/scissor so mask pixels match gl_FragCoord.
		renderer.setViewport( _fccMaskViewport.x, _fccMaskViewport.y, _fccMaskViewport.z, _fccMaskViewport.w );
		renderer.setScissor( _fccMaskScissor.x, _fccMaskScissor.y, _fccMaskScissor.z, _fccMaskScissor.w );
		renderer.setScissorTest( prevScissorTest );
		renderer.render( scene, camera );

		faceMesh.layers.mask = prevFaceLayers;
		camera.layers.mask = prevCamLayers;

		renderer.setRenderTarget( currentRT );
		renderer.setViewport( _fccMaskViewport.x, _fccMaskViewport.y, _fccMaskViewport.z, _fccMaskViewport.w );
		renderer.setScissor( _fccMaskScissor.x, _fccMaskScissor.y, _fccMaskScissor.z, _fccMaskScissor.w );
		renderer.setScissorTest( prevScissorTest );
		renderer.autoClear = prevAutoClear;
		renderer.setClearColor( _fccMaskClearColor, prevClearAlpha );

		return maskRT;

	} catch ( e ) {

		console.warn( '[FreeFilmCut] face mask RT capture failed', e );
		return null;

	} finally {

		_fccCapturingFaceMask = false;

	}

}

function syncFaceMaskUniforms( uniforms, maskRT ) {

	if ( ! uniforms ) return;
	if ( maskRT && maskRT.texture ) {

		uniforms.uFccFaceMask.value = maskRT.texture;
		uniforms.uFccFaceMaskSize.value.set( maskRT.width, maskRT.height );
		uniforms.uFccFaceMaskOn.value = 1;

	} else {

		uniforms.uFccFaceMask.value = getEmptyFaceMaskTexture();
		uniforms.uFccFaceMaskSize.value.set( 1, 1 );
		uniforms.uFccFaceMaskOn.value = 0;

	}

}

/**
 * Clip inner-shadow pass with Face alpha from a captured mask RT.
 * @param {import('troika-three-text').Text} troika
 * @param {THREE.Object3D} group text root
 * @param {'overlay'|'camera'} mode
 */
function applyInnerShadowFaceMask( troika, group, mode ) {

	if ( ! troika || ! group ) return;

	troika.userData = troika.userData || {};
	troika.userData.fccHadInnerMask = true;

	// Never pass a Troika multi-material array into createDerivedMaterial.
	let baseMat = troika.material;
	if ( Array.isArray( baseMat ) ) {

		baseMat = baseMat.length ? baseMat[ baseMat.length - 1 ] : null;

	}

	const existingUniforms = baseMat && baseMat.userData && baseMat.userData.fccFaceMaskUniforms
		? baseMat.userData.fccFaceMaskUniforms
		: null;

	const uniforms = existingUniforms || {
		uFccFaceMask: { value: getEmptyFaceMaskTexture() },
		uFccFaceMaskSize: { value: new THREE.Vector2( 1, 1 ) },
		uFccFaceMaskOn: { value: 1 },
	};

	if ( ! existingUniforms && baseMat && baseMat.isTroikaTextMaterial ) {

		let derived;
		try {

			derived = createDerivedMaterial( baseMat, {
				chained: true,
				uniforms,
				fragmentDefs: `
uniform sampler2D uFccFaceMask;
uniform vec2 uFccFaceMaskSize;
uniform float uFccFaceMaskOn;
`,
				fragmentColorTransform: `
if (uFccFaceMaskOn > 0.5) {
  vec2 mu = gl_FragCoord.xy / max(uFccFaceMaskSize, vec2(1.0));
  float faceA = texture2D(uFccFaceMask, mu).a;
  gl_FragColor.a *= faceA;
  if (gl_FragColor.a < 0.001) discard;
}
`,
			} );

		} catch ( e ) {

			console.warn( '[FreeFilmCut] inner-shadow face mask RT wrap failed', e );
			tuneMaterial( troika, mode );
			return;

		}

		derived.userData = derived.userData || {};
		derived.userData.fccFaceMaskRT = true;
		derived.userData.fccFaceMaskUniforms = uniforms;
		// Drop legacy reverse-SDF flags if present
		delete derived.userData.fccInnerMask;
		delete derived.userData.fccInnerMaskUniforms;
		if ( baseMat.userData ) {

			if ( baseMat.userData.fccGradientMat ) derived.userData.fccGradientMat = true;
			if ( baseMat.userData.fccGradUv ) derived.userData.fccGradUv = true;
			if ( baseMat.userData.fccGradientUniforms ) derived.userData.fccGradientUniforms = baseMat.userData.fccGradientUniforms;
			if ( baseMat.userData.fccTextureMat ) derived.userData.fccTextureMat = true;
			if ( baseMat.userData.fccTextureUniforms ) derived.userData.fccTextureUniforms = baseMat.userData.fccTextureUniforms;

		}
		derived.transparent = true;
		derived.depthWrite = false;
		derived.toneMapped = false;
		derived.depthTest = mode === RENDER_MODE_CAMERA;
		Object.defineProperty( derived, 'isTroikaTextMaterial', { value: true } );
		// Assign a SINGLE base material so Troika can re-derive [outline,face] for blur.
		troika.material = derived;

	} else if ( existingUniforms ) {

		syncFaceMaskUniforms( uniforms, group.userData && group.userData.__fccFaceMaskRT );

	}

	troika.onBeforeRender = function fccInnerShadowMaskBeforeRender( renderer, scene, camera ) {

		if ( _fccCapturingFaceMask ) return;
		const faceMesh = group.getObjectByName( FCC_FLOWER_FACE );
		if ( ! faceMesh ) return;

		const frameId = renderer && renderer.info && renderer.info.render
			? renderer.info.render.frame
			: - 1;
		let maskRT = group.userData.__fccFaceMaskRT;
		if ( frameId < 0 || group.userData.__fccFaceMaskFrameId !== frameId || ! maskRT ) {

			maskRT = captureFaceMaskToRT( renderer, scene, camera, group, faceMesh );
			group.userData.__fccFaceMaskFrameId = frameId;

		}

		syncFaceMaskUniforms( uniforms, maskRT );

		// Keep multi-material (outlineBlur) uniforms in sync if Troika re-derived.
		const mats = troika.material
			? ( Array.isArray( troika.material ) ? troika.material : [ troika.material ] )
			: [];
		for ( let i = 0; i < mats.length; i ++ ) {

			const m = mats[ i ];
			if ( m && m.userData && m.userData.fccFaceMaskUniforms ) {

				syncFaceMaskUniforms( m.userData.fccFaceMaskUniforms, maskRT );

			}

		}

	};

	tuneMaterial( troika, mode );

}

'''

# Keep the /** opener that precedes OLD_START
# idx points either at " * Inner..." old text or at /**
if text[idx:idx+3] == "/**":
    # replace from after /**
    # find end of /**
    # Actually OLD_START is inside the comment. Find "/**\n" before it
    doc_start = text.rfind("/**", 0, idx + 10)
    if doc_start < 0:
        doc_start = idx
    # We want: /**\n + NEW  (NEW already starts with " * Inner...")
    replacement = "/**\n" + NEW
    text = text[:doc_start] + replacement + text[end:]
else:
    # idx is at " * Clip..."
    doc_start = text.rfind("/**", 0, idx)
    if doc_start < 0:
        raise SystemExit("doc comment start not found")
    replacement = "/**\n" + NEW
    text = text[:doc_start] + replacement + text[end:]

# Update call site: applyInnerShadowFaceMask( mesh, ox, oy, passMode ) -> applyInnerShadowFaceMask( mesh, group, passMode )
old_call = "applyInnerShadowFaceMask( mesh, ox, oy, passMode );"
new_call = "applyInnerShadowFaceMask( mesh, group, passMode );"
if old_call not in text:
    # try alternate spacing
    if "applyInnerShadowFaceMask( mesh, ox, oy, passMode )" in text:
        text = text.replace(
            "applyInnerShadowFaceMask( mesh, ox, oy, passMode )",
            "applyInnerShadowFaceMask( mesh, group, passMode )",
        )
    else:
        raise SystemExit("call site not found")
else:
    text = text.replace(old_call, new_call)

# disposeFaceMaskRT in disposeFlowerChildren
old_dispose = """function disposeFlowerChildren( group ) {

	const toRemove = [];
"""
new_dispose = """function disposeFlowerChildren( group ) {

	disposeFaceMaskRT( group );

	const toRemove = [];
"""
if old_dispose not in text:
    raise SystemExit("disposeFlowerChildren block not found")
text = text.replace(old_dispose, new_dispose, 1)

# bump signature
text = text.replace(
    "innerFaceMask: 1, // fcc-ui-66 Face-SDF clip; never assign Troika multi-material arrays",
    "innerFaceMask: 2, // fcc-ui-67 Face RT mask (screen UV); replaces reverse-SDF hack",
)

# Update import cache bumps in this file
text = text.replace("UIConstants.js?v=fcc-ui-64", "UIConstants.js?v=fcc-ui-67")
text = text.replace("FlowerStyle.js?v=fcc-ui-64", "FlowerStyle.js?v=fcc-ui-67")

UITEXT.write_text(text, encoding="utf-8")
print("UIText.js patched OK, length", len(text))
# sanity
assert "captureFaceMaskToRT" in text
assert "applyInnerShadowFaceMask( mesh, group, passMode )" in text
assert "uFccFaceMask" in text
assert "troikaGlyphUvToDistance" not in text.split("function applyInnerShadowFaceMask")[1].split("function applyContentToTroika")[0]
print("sanity OK")
