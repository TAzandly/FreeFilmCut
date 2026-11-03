# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")

# ========== 1) TextAnimRuntime: collectWipeLayoutMetrics ==========
rt_path = ROOT / "ui/TextAnimRuntime.js"
rt = rt_path.read_text(encoding="utf-8")

if "export function collectWipeLayoutMetrics" not in rt:
    helper = r'''
/**
 * Layout-space wipe axis metrics from Troika caret char bases (not object Box3).
 * Axis is continuous in the text group's local XY so the fragment wipe soft edge
 * travels across glyphs in reading order and can cut through a character.
 *
 * @param {THREE.Object3D} object UI Text root
 * @returns {{centerX:number,centerY:number,scaleX:number,scaleY:number,cosR:number,sinR:number,minX:number,maxX:number,minY:number,maxY:number}|null}
 */
export function collectWipeLayoutMetrics( object ) {

	if ( ! object ) return null;
	const ui = getFccUI( object );
	const fs = ( ui && Number( ui.fontSize ) > 0 ) ? Number( ui.fontSize ) : 48;

	let minX = Infinity;
	let maxX = - Infinity;
	let minY = Infinity;
	let maxY = - Infinity;
	let found = 0;

	const root = object.getObjectByName( FCC_TEXTANIM_ROOT );
	const count = root && root.userData ? ( root.userData.__fccCharCount || 0 ) : 0;
	if ( root && root.userData && root.userData.__fccReady && count > 0 ) {

		for ( let i = 0; i < count; i ++ ) {

			const cg = root.getObjectByName( FCC_TEXTANIM_CHAR_PREFIX + i );
			const b = cg && cg.userData && cg.userData.__fccCharBase;
			if ( ! b ) continue;
			if ( b.x < minX ) minX = b.x;
			if ( b.x > maxX ) maxX = b.x;
			if ( b.y < minY ) minY = b.y;
			if ( b.y > maxY ) maxY = b.y;
			found ++;

		}

	}

	// Fallback: UI rect in local centered space (same as applyTextTransform).
	if ( found < 1 ) {

		const rect = ui && ui.rect;
		if ( rect && rect.w > 0 && rect.h > 0 ) {

			minX = - rect.w * 0.5;
			maxX = rect.w * 0.5;
			minY = - rect.h * 0.5;
			maxY = rect.h * 0.5;
			found = 1;

		} else {

			return null;

		}

	}

	// Expand by ~half glyph so axis 0..1 covers ink of first/last chars (not just centers).
	const half = Math.max( 4, fs * 0.45 );
	minX -= half;
	maxX += half;
	minY -= half;
	maxY += half;
	if ( !( maxX > minX ) ) {

		minX -= half;
		maxX += half;

	}
	if ( !( maxY > minY ) ) {

		minY -= half;
		maxY += half;

	}

	// Soft-room pad (~8%).
	const padX = Math.max( 2, ( maxX - minX ) * 0.08 );
	const padY = Math.max( 2, ( maxY - minY ) * 0.08 );

	const sx = object.scale && Number.isFinite( object.scale.x ) ? object.scale.x : 1;
	const sy = object.scale && Number.isFinite( object.scale.y ) ? object.scale.y : 1;
	const rz = object.rotation && Number.isFinite( object.rotation.z ) ? object.rotation.z : 0;

	return {
		centerX: object.position.x,
		centerY: object.position.y,
		scaleX: sx !== 0 ? sx : 1,
		scaleY: sy !== 0 ? sy : 1,
		cosR: Math.cos( rz ),
		sinR: Math.sin( rz ),
		minX: minX - padX,
		maxX: maxX + padX,
		minY: minY - padY,
		maxY: maxY + padY,
	};

}

'''
    # Insert before applyTextAnimsInScene
    anchor = "export function applyTextAnimsInScene"
    if anchor not in rt:
        raise SystemExit("applyTextAnimsInScene not found")
    rt = rt.replace(anchor, helper + anchor, 1)
    rt_path.write_text(rt, encoding="utf-8")
    print("Runtime: collectWipeLayoutMetrics added")
else:
    print("Runtime: already has collectWipeLayoutMetrics")

# ========== 2) TextLayerRT wipe shader rewrite ==========
tl_path = ROOT / "ui/TextLayerRT.js"
tl = tl_path.read_text(encoding="utf-8")

# Update header comment
tl = tl.replace(
    " * wipeReveal: textanim channel (not TextFx PP). Fragment linear wipe + edge\n"
    " * glint",
    " * wipeReveal: textanim channel (not TextFx PP). Fragment wipe along glyph/layout\n"
    " * axis (Troika caret local) + edge glint",
)

# Replace ensureWipePass entirely via marker
m = re.search(r"function ensureWipePass\(\) \{.*?\n\}\n\nfunction ensureWipeOutRT", tl, re.S)
if not m:
    raise SystemExit("ensureWipePass block not found")

new_ensure = r'''function ensureWipePass() {

	if ( wipeMat ) return;
	wipeMat = new THREE.ShaderMaterial( {
		name: 'TextLayerRT.wipeReveal',
		uniforms: {
			tDiffuse: { value: null },
			uProgress: { value: 1 },
			uSoft: { value: 0.12 },
			uDir: { value: 0 }, // 0 ltr, 1 rtl, 2 ttb, 3 btt
			uRes: { value: new THREE.Vector2( 1, 1 ) },
			// Text group pose in overlay pixel space (UI ortho).
			uCenter: { value: new THREE.Vector2( 0, 0 ) },
			uScale: { value: new THREE.Vector2( 1, 1 ) },
			uCosSin: { value: new THREE.Vector2( 1, 0 ) }, // cos(rz), sin(rz)
			// Caret-layout local AABB (not object Box3 / RT UV bbox).
			uLocalBounds: { value: new THREE.Vector4( -1, -1, 1, 1 ) },
			uEdgeIntensity: { value: 2.5 },
			uEdgeWidth: { value: 0.04 },
		},
		vertexShader: /* glsl */`
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = vec4( position.xy, 0.0, 1.0 );
			}
		`,
		fragmentShader: /* glsl */`
			uniform sampler2D tDiffuse;
			uniform float uProgress;
			uniform float uSoft;
			uniform float uDir;
			uniform vec2 uRes;
			uniform vec2 uCenter;
			uniform vec2 uScale;
			uniform vec2 uCosSin;
			uniform vec4 uLocalBounds;
			uniform float uEdgeIntensity;
			uniform float uEdgeWidth;
			varying vec2 vUv;
			void main() {
				vec4 c = texture2D( tDiffuse, vUv );
				if ( c.a < 0.001 ) discard;

				// RT UV -> overlay pixel (UI ortho: x 0..W, y 0..H, flipY=false).
				vec2 world = vUv * uRes;
				vec2 d = world - uCenter;
				// Un-rotate then un-scale into text-local layout space (caret bases live here).
				float cosR = uCosSin.x;
				float sinR = uCosSin.y;
				vec2 local = vec2(
					cosR * d.x + sinR * d.y,
					- sinR * d.x + cosR * d.y
				);
				local.x /= max( abs( uScale.x ), 1e-5 );
				local.y /= max( abs( uScale.y ), 1e-5 );

				float u = ( local.x - uLocalBounds.x ) / max( uLocalBounds.z - uLocalBounds.x, 1e-5 );
				float v = ( local.y - uLocalBounds.y ) / max( uLocalBounds.w - uLocalBounds.y, 1e-5 );
				float axis = u;
				if ( uDir > 0.5 && uDir < 1.5 ) axis = 1.0 - u;
				else if ( uDir > 1.5 && uDir < 2.5 ) axis = 1.0 - v;
				else if ( uDir > 2.5 ) axis = v;

				float soft = max( uSoft, 1e-4 );
				float p = uProgress * ( 1.0 + 2.0 * soft ) - soft;
				float reveal = smoothstep( axis - soft, axis + soft, p );

				float ew = max( uEdgeWidth, 1e-4 );
				float edge = smoothstep( axis - ew, axis, p ) * ( 1.0 - smoothstep( axis, axis + ew, p ) );
				edge *= c.a;

				vec3 rgb = c.rgb + edge * uEdgeIntensity * vec3( 1.0 );
				gl_FragColor = vec4( rgb, c.a * reveal );
			}
		`,
		transparent: true,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
		premultipliedAlpha: false,
		blending: THREE.NormalBlending,
	} );
	wipeMesh = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), wipeMat );
	wipeScene = new THREE.Scene();
	wipeScene.add( wipeMesh );
	wipeCam = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );

}

function ensureWipeOutRT'''

tl = tl[:m.start()] + new_ensure + tl[m.end():]

# Replace computeWipeUvBounds docs + keep as deprecated thin wrapper; add applyWipeReveal layout wiring
# Replace applyWipeReveal uniform setup for bounds -> layout
old_apply_tail = """	wipeMat.uniforms.uDir.value = dirToIndex( args.direction );
	const b = args.bounds || null;
	if ( b && Number.isFinite( b.u0 ) && Number.isFinite( b.u1 )
		&& Number.isFinite( b.v0 ) && Number.isFinite( b.v1 )
		&& ( b.u1 - b.u0 ) > 1e-4 && ( b.v1 - b.v0 ) > 1e-4 ) {

		wipeMat.uniforms.uBounds.value.set( b.u0, b.v0, b.u1, b.v1 );

	} else {

		wipeMat.uniforms.uBounds.value.set( 0, 0, 1, 1 );

	}"""

new_apply_tail = """	wipeMat.uniforms.uDir.value = dirToIndex( args.direction );
	wipeMat.uniforms.uRes.value.set(
		Math.max( 1, Number( width ) || 1 ),
		Math.max( 1, Number( height ) || 1 ),
	);
	const layout = args.layout || null;
	if ( layout
		&& Number.isFinite( layout.centerX ) && Number.isFinite( layout.centerY )
		&& Number.isFinite( layout.minX ) && Number.isFinite( layout.maxX )
		&& Number.isFinite( layout.minY ) && Number.isFinite( layout.maxY )
		&& ( layout.maxX - layout.minX ) > 1e-4
		&& ( layout.maxY - layout.minY ) > 1e-4 ) {

		wipeMat.uniforms.uCenter.value.set( layout.centerX, layout.centerY );
		wipeMat.uniforms.uScale.value.set(
			layout.scaleX != null ? layout.scaleX : 1,
			layout.scaleY != null ? layout.scaleY : 1,
		);
		wipeMat.uniforms.uCosSin.value.set(
			layout.cosR != null ? layout.cosR : 1,
			layout.sinR != null ? layout.sinR : 0,
		);
		wipeMat.uniforms.uLocalBounds.value.set(
			layout.minX, layout.minY, layout.maxX, layout.maxY,
		);

	} else {

		// Fallback: full-frame layout (last resort; prefer collectWipeLayoutMetrics).
		wipeMat.uniforms.uCenter.value.set( width * 0.5, height * 0.5 );
		wipeMat.uniforms.uScale.value.set( 1, 1 );
		wipeMat.uniforms.uCosSin.value.set( 1, 0 );
		wipeMat.uniforms.uLocalBounds.value.set( 0, 0, width, height );

	}"""

if old_apply_tail not in tl:
    raise SystemExit("applyWipeReveal bounds block not found")
tl = tl.replace(old_apply_tail, new_apply_tail)

# Update JSDoc for applyWipeReveal — layout instead of bounds
tl = tl.replace(
    " * @param {number} [args.edgeIntensity] edge glint strength (刃光)\n"
    " * @param {number} [args.edgeWidth] edge band width in text-local UV\n"
    " * @param {{u0:number,v0:number,u1:number,v1:number}} [args.bounds] text UV rect in RT\n"
    " * @returns {THREE.Texture}\n"
    " */",
    " * @param {number} [args.edgeIntensity] edge glint strength (刃光)\n"
    " * @param {number} [args.edgeWidth] edge band width in layout-normalized units\n"
    " * @param {object} [args.layout] from collectWipeLayoutMetrics (caret local axis)\n"
    " * @returns {THREE.Texture}\n"
    " */",
)

# Mark computeWipeUvBounds deprecated in comment
tl = tl.replace(
    " * Map a text Object3D AABB (overlay pixel space) into RT UV 0..1.\n"
    " * Used so wipe progress sweeps the glyphs, not the full frame.",
    " * @deprecated Prefer collectWipeLayoutMetrics (caret layout axis).\n"
    " * Map object Box3 into RT UV — wrong for flower-expanded bounds.",
)

tl_path.write_text(tl, encoding="utf-8")
print("TextLayerRT wipe shader + applyWipeReveal OK", "uLocalBounds" in tl, "uBounds" not in tl.split("ensureWipePass")[1][:2000] if "ensureWipePass" in tl else "?")

# Verify no uBounds in new shader
ens = re.search(r"function ensureWipePass\(\) \{.*?\n\}\n\nfunction ensureWipeOutRT", tl, re.S)
print("uBounds in ensureWipePass?", "uBounds" in (ens.group(0) if ens else ""))
print("uLocalBounds in ensureWipePass?", "uLocalBounds" in (ens.group(0) if ens else ""))
