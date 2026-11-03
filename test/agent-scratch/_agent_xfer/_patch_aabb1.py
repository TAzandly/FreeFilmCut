# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")
tl_path = ROOT / "ui/TextLayerRT.js"
tl = tl_path.read_text(encoding="utf-8")

# Insert computeWipeAlphaBounds before applyWipeReveal
# Also add downsample resources near wipeOutRT vars

# Add module-level scratch after wipeCam vars
marker = "/** @type {THREE.OrthographicCamera|null} */\nlet wipeCam = null;"
if marker not in tl:
    # try without comment
    marker = "let wipeCam = null;"
insert_after = marker
extra = """
let wipeCam = null;

/** Alpha-AABB downsample (wipe bounds from actual RT ink). */
/** @type {THREE.WebGLRenderTarget|null} */
let alphaBoundsRT = null;
/** @type {THREE.ShaderMaterial|null} */
let alphaBoundsMat = null;
/** @type {THREE.Mesh|null} */
let alphaBoundsMesh = null;
/** @type {THREE.Scene|null} */
let alphaBoundsScene = null;
/** @type {THREE.OrthographicCamera|null} */
let alphaBoundsCam = null;
/** @type {Uint8Array|null} */
let alphaBoundsBuf = null;
"""

# Avoid double-insert
if "alphaBoundsRT" not in tl:
    if "let wipeCam = null;" not in tl:
        raise SystemExit("wipeCam not found")
    tl = tl.replace(
        "let wipeCam = null;",
        extra.strip() + "\n",
        1,
    )
    print("scratch vars added")
else:
    print("scratch vars exist")

# Add functions before applyWipeReveal
fn = r'''
function ensureAlphaBoundsPass() {

	if ( alphaBoundsMat ) return;
	alphaBoundsMat = new THREE.ShaderMaterial( {
		name: 'TextLayerRT.alphaBoundsCopy',
		uniforms: { tDiffuse: { value: null } },
		vertexShader: /* glsl */`
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = vec4( position.xy, 0.0, 1.0 );
			}
		`,
		fragmentShader: /* glsl */`
			uniform sampler2D tDiffuse;
			varying vec2 vUv;
			void main() {
				gl_FragColor = texture2D( tDiffuse, vUv );
			}
		`,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
		blending: THREE.NoBlending,
	} );
	alphaBoundsMesh = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), alphaBoundsMat );
	alphaBoundsScene = new THREE.Scene();
	alphaBoundsScene.add( alphaBoundsMesh );
	alphaBoundsCam = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );

}

function ensureAlphaBoundsRT( w, h ) {

	if ( alphaBoundsRT && alphaBoundsRT.width === w && alphaBoundsRT.height === h ) return alphaBoundsRT;
	if ( alphaBoundsRT ) alphaBoundsRT.dispose();
	alphaBoundsRT = new THREE.WebGLRenderTarget( w, h, {
		type: THREE.UnsignedByteType,
		format: THREE.RGBAFormat,
		depthBuffer: false,
		stencilBuffer: false,
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
	} );
	alphaBoundsRT.texture.generateMipmaps = false;
	alphaBoundsRT.texture.flipY = false;
	alphaBoundsRT.texture.colorSpace = THREE.NoColorSpace;
	alphaBoundsRT.texture.name = 'FreeFilmCut.WipeAlphaBounds';
	return alphaBoundsRT;

}

/**
 * Wipe AABB from **actual text-RT alpha** (same space as shader `world = vUv * res`).
 * Downsamples then CPU-scans a>eps. Guarantees bounds sit on drawn ink.
 *
 * @param {object} args
 * @param {THREE.WebGLRenderer} args.renderer
 * @param {THREE.Texture} args.inputTexture text RT color
 * @param {number} args.width
 * @param {number} args.height
 * @param {number} [args.maxSide=128]
 * @param {number} [args.alphaEps=10] 0..255
 * @param {number} [args.padFrac=0.06]
 * @param {boolean} [args.debug]
 * @returns {{minX:number,maxX:number,minY:number,maxY:number,space:string}|null}
 */
export function computeWipeAlphaBounds( args ) {

	const renderer = args.renderer;
	const inputTexture = args.inputTexture;
	const width = Math.max( 1, Math.round( Number( args.width ) || 1 ) );
	const height = Math.max( 1, Math.round( Number( args.height ) || 1 ) );
	if ( ! renderer || ! inputTexture ) return null;

	const maxSide = Math.max( 32, Math.min( 256, Number( args.maxSide ) || 128 ) );
	const scale = Math.min( 1, maxSide / Math.max( width, height ) );
	const dw = Math.max( 1, Math.round( width * scale ) );
	const dh = Math.max( 1, Math.round( height * scale ) );
	const alphaEps = Math.max( 1, Math.min( 255, Number( args.alphaEps ) || 10 ) );
	const padFrac = Math.max( 0, Number( args.padFrac ) || 0.06 );

	ensureAlphaBoundsPass();
	const small = ensureAlphaBoundsRT( dw, dh );

	alphaBoundsMat.uniforms.tDiffuse.value = inputTexture;

	const prevTarget = renderer.getRenderTarget();
	const prevAuto = renderer.autoClear;
	const prevClear = new THREE.Color();
	renderer.getClearColor( prevClear );
	const prevAlpha = renderer.getClearAlpha();

	renderer.setRenderTarget( small );
	renderer.setViewport( 0, 0, dw, dh );
	renderer.setScissorTest( false );
	renderer.setClearColor( 0x000000, 0 );
	renderer.clear( true, true, true );
	renderer.autoClear = false;
	renderer.render( alphaBoundsScene, alphaBoundsCam );

	const need = dw * dh * 4;
	if ( ! alphaBoundsBuf || alphaBoundsBuf.length < need ) {

		alphaBoundsBuf = new Uint8Array( need );

	}
	renderer.readRenderTargetPixels( small, 0, 0, dw, dh, alphaBoundsBuf );

	renderer.autoClear = prevAuto;
	renderer.setClearColor( prevClear, prevAlpha );
	renderer.setRenderTarget( prevTarget );
	alphaBoundsMat.uniforms.tDiffuse.value = null;

	// readPixels: row 0 = bottom (matches flipY=false RT / vUv.y=0 bottom).
	let minC = dw;
	let maxC = - 1;
	let minR = dh;
	let maxR = - 1;
	const buf = alphaBoundsBuf;
	for ( let y = 0; y < dh; y ++ ) {

		for ( let x = 0; x < dw; x ++ ) {

			const a = buf[ ( y * dw + x ) * 4 + 3 ];
			if ( a <= alphaEps ) continue;
			if ( x < minC ) minC = x;
			if ( x > maxC ) maxC = x;
			if ( y < minR ) minR = y;
			if ( y > maxR ) maxR = y;

		}

	}

	if ( maxC < minC || maxR < minR ) {

		if ( args.debug ) {

			console.warn( '[FreeFilmCut wipe] no alpha in text RT; skip wipe bounds' );

		}
		return null;

	}

	// Map small-tex texel spans → full RT pixels (inclusive max texel → +1).
	let minX = ( minC / dw ) * width;
	let maxX = ( ( maxC + 1 ) / dw ) * width;
	let minY = ( minR / dh ) * height;
	let maxY = ( ( maxR + 1 ) / dh ) * height;

	const padX = Math.max( 2, ( maxX - minX ) * padFrac );
	const padY = Math.max( 2, ( maxY - minY ) * padFrac );
	minX = Math.max( 0, minX - padX );
	maxX = Math.min( width, maxX + padX );
	minY = Math.max( 0, minY - padY );
	maxY = Math.min( height, maxY + padY );

	if ( ! ( maxX - minX > 2 && maxY - minY > 2 ) ) return null;

	if ( args.debug ) {

		console.log( '[FreeFilmCut wipe] alpha-AABB', {
			minX, maxX, minY, maxY, dw, dh, width, height,
			texels: [ minC, maxC, minR, maxR ],
		} );

	}

	return { minX, maxX, minY, maxY, space: 'rt-alpha' };

}

'''

if "export function computeWipeAlphaBounds" not in tl:
    anchor = "export function applyWipeReveal( args )"
    if anchor not in tl:
        raise SystemExit("applyWipeReveal not found")
    tl = tl.replace(anchor, fn + "\n" + anchor)
    print("computeWipeAlphaBounds added")
else:
    print("computeWipeAlphaBounds already present")

# Dispose alpha bounds in disposeTextLayerRT
if "alphaBoundsRT" in tl and "if ( alphaBoundsRT )" not in tl:
    tl = tl.replace(
        "\tif ( wipeOutRT ) {\n\n\t\twipeOutRT.dispose();\n\t\twipeOutRT = null;\n\n\t}",
        "\tif ( wipeOutRT ) {\n\n\t\twipeOutRT.dispose();\n\t\twipeOutRT = null;\n\n\t}\n\n"
        "\tif ( alphaBoundsRT ) {\n\n\t\talphaBoundsRT.dispose();\n\t\talphaBoundsRT = null;\n\n\t}\n\n"
        "\tif ( alphaBoundsMat ) {\n\n\t\talphaBoundsMat.dispose();\n\t\talphaBoundsMat = null;\n\n\t}\n\n"
        "\tif ( alphaBoundsMesh ) {\n\n\t\talphaBoundsMesh.geometry.dispose();\n\t\talphaBoundsMesh = null;\n\n\t}\n\n"
        "\talphaBoundsScene = null;\n\talphaBoundsCam = null;\n\talphaBoundsBuf = null;",
    )
    print("dispose wired")

# Update header comment
tl = tl.replace(
    " * wipeReveal: textanim channel (not TextFx PP). Fragment wipe along glyph/layout\n"
    " * axis (Troika caret local): mask 1 at wipe-start (LTR left=white) + edge glint",
    " * wipeReveal: textanim channel. Fragment wipe; AABB from **text-RT alpha**\n"
    " * scan (not caret/project). mask 1 at wipe-start (LTR left=white) + edge glint",
)

tl_path.write_text(tl, encoding="utf-8")
print("TextLayerRT written", "computeWipeAlphaBounds" in tl)

import subprocess
r = subprocess.run(["node", "--check", str(tl_path)], capture_output=True, text=True)
print("syntax", r.returncode, (r.stderr or "")[:400])
