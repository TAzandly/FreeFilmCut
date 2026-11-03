# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")

# ========== Rewrite collectWipeLayoutMetrics (world/overlay pixel space) ==========
rt_path = ROOT / "ui/TextAnimRuntime.js"
rt = rt_path.read_text(encoding="utf-8")

old_fn = None
m = re.search(
    r"/\*\*\n \* Layout-space wipe axis metrics.*?export function collectWipeLayoutMetrics\( object \) \{.*?\n\}\n\n",
    rt,
    re.S,
)
if not m:
    m = re.search(r"export function collectWipeLayoutMetrics\( object \) \{.*?\n\}\n\n", rt, re.S)
if not m:
    raise SystemExit("collectWipeLayoutMetrics not found")

new_fn = r'''/**
 * Wipe axis metrics in **overlay / RT pixel space** (same as UI ortho: origin
 * bottom-left, x right, y up). Built from Troika caret bases transformed by the
 * text root's world matrix — NOT a hand-unwrapped local box (YXZ euler broke that).
 *
 * @param {THREE.Object3D} object UI Text root
 * @returns {{minX:number,maxX:number,minY:number,maxY:number,space:string}|null}
 */
export function collectWipeLayoutMetrics( object ) {

	if ( ! object ) return null;
	const ui = getFccUI( object );
	const fs = ( ui && Number( ui.fontSize ) > 0 ) ? Number( ui.fontSize ) : 48;

	object.updateMatrixWorld( true );

	const v = new THREE.Vector3();
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
			// Rest caret in text-root local → overlay/RT pixels (ignore anim offset).
			v.set( b.x, b.y, b.z || 0 );
			object.localToWorld( v );
			if ( v.x < minX ) minX = v.x;
			if ( v.x > maxX ) maxX = v.x;
			if ( v.y < minY ) minY = v.y;
			if ( v.y > maxY ) maxY = v.y;
			found ++;

		}

	}

	if ( found < 1 ) {

		const rect = ui && ui.rect;
		if ( rect && rect.w > 0 && rect.h > 0 ) {

			minX = rect.x;
			maxX = rect.x + rect.w;
			minY = rect.y;
			maxY = rect.y + rect.h;
			found = 1;

		} else {

			return null;

		}

	}

	// Half-glyph pad in world pixels (scale baked into localToWorld already for bases;
	// fontSize is layout pixels ≈ world when canvas scale is 1).
	const half = Math.max( 4, fs * 0.5 );
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

	const padX = Math.max( 2, ( maxX - minX ) * 0.08 );
	const padY = Math.max( 2, ( maxY - minY ) * 0.08 );

	return {
		space: 'world',
		minX: minX - padX,
		maxX: maxX + padX,
		minY: minY - padY,
		maxY: maxY + padY,
	};

}

'''

rt = rt[:m.start()] + new_fn + rt[m.end():]

# Force rest pose when wipe on
old_loop = """	const wipeOn = !! ( sampleWipeRevealProgress( t, anim ).enabled );

	for ( let i = 0; i < count; i ++ ) {

		const charGroup = root.getObjectByName( FCC_TEXTANIM_CHAR_PREFIX + i );
		if ( ! charGroup ) continue;
		const orderIndex = order.indexOf( i );
		const pose = sampleCharPose( t, phase, count, i, orderIndex < 0 ? i : orderIndex );
		const base = charGroup.userData.__fccCharBase || { x: 0, y: 0, z: 0.01 };
		charGroup.position.set( base.x + pose.offsetX, base.y + pose.offsetY, base.z );
		charGroup.rotation.set( pose.rotateX, pose.rotateY, pose.rotateZ );
		charGroup.scale.set( pose.scaleX, pose.scaleY, 1 );
		const op = wipeOn ? 1 : pose.opacity;
		applyOpacityToCharGroup( charGroup, op );

	}"""

new_loop = """	const wipeOn = !! ( sampleWipeRevealProgress( t, anim ).enabled );

	for ( let i = 0; i < count; i ++ ) {

		const charGroup = root.getObjectByName( FCC_TEXTANIM_CHAR_PREFIX + i );
		if ( ! charGroup ) continue;
		const orderIndex = order.indexOf( i );
		const pose = sampleCharPose( t, phase, count, i, orderIndex < 0 ? i : orderIndex );
		const base = charGroup.userData.__fccCharBase || { x: 0, y: 0, z: 0.01 };
		// Wipe fragment mask is layout-spatial: keep glyphs at rest so ink stays
		// inside the wipe AABB (stagger fly-in made reveal look "always on").
		if ( wipeOn ) {

			charGroup.position.set( base.x, base.y, base.z );
			charGroup.rotation.set( 0, 0, 0 );
			charGroup.scale.set( 1, 1, 1 );
			applyOpacityToCharGroup( charGroup, 1 );

		} else {

			charGroup.position.set( base.x + pose.offsetX, base.y + pose.offsetY, base.z );
			charGroup.rotation.set( pose.rotateX, pose.rotateY, pose.rotateZ );
			charGroup.scale.set( pose.scaleX, pose.scaleY, 1 );
			applyOpacityToCharGroup( charGroup, pose.opacity );

		}

	}"""

if old_loop not in rt:
    raise SystemExit("wipeOn loop not found")
rt = rt.replace(old_loop, new_loop)
rt_path.write_text(rt, encoding="utf-8")
print("Runtime OK")

# ========== Simplify wipe shader to world-space bounds ==========
tl_path = ROOT / "ui/TextLayerRT.js"
tl = tl_path.read_text(encoding="utf-8")

# Replace uniforms: drop uCenter/uScale/uCosSin, keep uLocalBounds as world min/max
# Update ensureWipePass uniforms and fragment

m = re.search(
    r"function ensureWipePass\(\) \{.*?\n\}\n\nfunction ensureWipeOutRT",
    tl,
    re.S,
)
if not m:
    raise SystemExit("ensureWipePass not found")

new_ensure = r'''function ensureWipePass() {

	if ( wipeMat && ( ! wipeMat.uniforms.uDebug || wipeMat.blending !== THREE.NoBlending || ! wipeMat.uniforms.uWorldBounds ) ) {
		wipeMat.dispose();
		wipeMat = null;
		if ( wipeMesh ) { wipeMesh.geometry.dispose(); wipeMesh = null; }
		wipeScene = null;
		wipeCam = null;
	}
	if ( wipeMat ) return;
	wipeMat = new THREE.ShaderMaterial( {
		name: 'TextLayerRT.wipeReveal',
		uniforms: {
			tDiffuse: { value: null },
			uProgress: { value: 1 },
			uSoft: { value: 0.12 },
			uDir: { value: 0 }, // 0 ltr, 1 rtl, 2 ttb, 3 btt
			uRes: { value: new THREE.Vector2( 1, 1 ) },
			// World/overlay pixel AABB (xy=min, zw=max) — same space as vUv*uRes.
			uWorldBounds: { value: new THREE.Vector4( 0, 0, 1, 1 ) },
			uEdgeIntensity: { value: 2.5 },
			uEdgeWidth: { value: 0.04 },
			uDebug: { value: 0 },
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
			uniform vec4 uWorldBounds;
			uniform float uEdgeIntensity;
			uniform float uEdgeWidth;
			uniform float uDebug;
			varying vec2 vUv;
			void main() {
				vec4 c = texture2D( tDiffuse, vUv );

				// RT UV → overlay/RT pixels (UI ortho bottom-left).
				vec2 world = vUv * uRes;
				float u = ( world.x - uWorldBounds.x ) / max( uWorldBounds.z - uWorldBounds.x, 1e-5 );
				float v = ( world.y - uWorldBounds.y ) / max( uWorldBounds.w - uWorldBounds.y, 1e-5 );

				// Static mask: 1 at wipe-start … 0 at end (LTR left white → right black).
				float mask = 1.0 - u;
				if ( uDir > 0.5 && uDir < 1.5 ) mask = u;
				else if ( uDir > 1.5 && uDir < 2.5 ) mask = v;
				else if ( uDir > 2.5 ) mask = 1.0 - v;

				float soft = max( uSoft, 1e-4 );
				float pExp = uProgress * ( 1.0 + 2.0 * soft ) - soft;
				float thresh = 1.0 - pExp;
				float reveal = smoothstep( thresh - soft, thresh + soft, mask );

				float ew = max( uEdgeWidth, 1e-4 );
				float edge = smoothstep( thresh - ew, thresh, mask )
					* ( 1.0 - smoothstep( thresh, thresh + ew, mask ) );

				if ( uDebug > 0.5 ) {
					float inBox = step( 0.0, u ) * step( u, 1.0 ) * step( 0.0, v ) * step( v, 1.0 );
					vec3 col = vec3( clamp( reveal, 0.0, 1.0 ) );
					col = mix( col, vec3( 0.0, 1.0, 1.0 ), clamp( edge * 2.5, 0.0, 1.0 ) );
					col = mix( vec3( 0.35, 0.0, 0.05 ), col, inBox );
					float chk = mod( floor( vUv.x * 40.0 ) + floor( vUv.y * 40.0 ), 2.0 );
					col += ( chk * 0.03 ) * ( 1.0 - inBox );
					gl_FragColor = vec4( col, 1.0 );
					return;
				}

				if ( c.a < 0.001 ) discard;
				edge *= c.a;
				vec3 rgb = c.rgb * reveal + edge * uEdgeIntensity * vec3( 1.0 );
				float a = max( c.a * reveal, edge * c.a );
				gl_FragColor = vec4( rgb, a );
			}
		`,
		transparent: true,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
		premultipliedAlpha: false,
		blending: THREE.NoBlending,
	} );
	wipeMesh = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), wipeMat );
	wipeScene = new THREE.Scene();
	wipeScene.add( wipeMesh );
	wipeCam = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );

}

function ensureWipeOutRT'''

tl = tl[:m.start()] + new_ensure + tl[m.end():]

# Replace applyWipeReveal layout uniform wiring
old_layout = """	const layout = args.layout || null;
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

new_layout = """	const layout = args.layout || null;
	if ( layout
		&& Number.isFinite( layout.minX ) && Number.isFinite( layout.maxX )
		&& Number.isFinite( layout.minY ) && Number.isFinite( layout.maxY )
		&& ( layout.maxX - layout.minX ) > 1e-4
		&& ( layout.maxY - layout.minY ) > 1e-4 ) {

		wipeMat.uniforms.uWorldBounds.value.set(
			layout.minX, layout.minY, layout.maxX, layout.maxY,
		);

	} else {

		wipeMat.uniforms.uWorldBounds.value.set( 0, 0, width, height );

	}

	if ( args.debugMask && args.debugLog && typeof console !== 'undefined' ) {

		const b = wipeMat.uniforms.uWorldBounds.value;
		console.log( '[FreeFilmCut wipe]', {
			progress,
			bounds: [ b.x, b.y, b.z, b.w ],
			res: [ width, height ],
			direction: args.direction,
		} );

	}"""

if old_layout not in tl:
    # try if already partially changed
    if "uWorldBounds" in tl and "uLocalBounds.value" in tl:
        print("WARN: mixed state, searching uLocalBounds wiring")
    raise SystemExit("layout wiring block not found")
tl = tl.replace(old_layout, new_layout)

tl_path.write_text(tl, encoding="utf-8")
print("TextLayerRT OK", "uWorldBounds" in tl, "uCenter" not in tl[tl.find("ensureWipePass"):tl.find("ensureWipeOutRT")])

# ========== Viewport: optional debug log + bump ==========
vp = (ROOT / "Viewport.js").read_text(encoding="utf-8")
vp = re.sub(r"TextLayerRT\.js\?v=fcc-ui-\d+", "TextLayerRT.js?v=fcc-ui-17", vp)
vp = re.sub(r"TextAnimRuntime\.js\?v=fcc-ui-\d+", "TextAnimRuntime.js?v=fcc-ui-10", vp)

# Add debugLog sparingly when wipe debug on
old_call = """					outTex = applyWipeReveal( {
						renderer,
						inputTexture: outTex,
						width: textRT.width,
						height: textRT.height,
						progress: wipeInfo.wipe.progress,
						direction: wipeInfo.wipe.direction,
						soft: wipeInfo.wipe.soft,
						edgeIntensity: wipeInfo.wipe.edgeIntensity,
						edgeWidth: wipeInfo.wipe.edgeWidth,
						layout,
						debugMask: !! editor.textAnimWipeDebug,
					} ) || outTex;"""

new_call = """					if ( editor.textAnimWipeDebug && ! editor._fccWipeDbgLogged ) {
						editor._fccWipeDbgLogged = true;
						console.log( '[FreeFilmCut wipe] layout metrics', layout, 'progress', wipeInfo.wipe.progress );
					}
					if ( ! editor.textAnimWipeDebug ) editor._fccWipeDbgLogged = false;
					outTex = applyWipeReveal( {
						renderer,
						inputTexture: outTex,
						width: textRT.width,
						height: textRT.height,
						progress: wipeInfo.wipe.progress,
						direction: wipeInfo.wipe.direction,
						soft: wipeInfo.wipe.soft,
						edgeIntensity: wipeInfo.wipe.edgeIntensity,
						edgeWidth: wipeInfo.wipe.edgeWidth,
						layout,
						debugMask: !! editor.textAnimWipeDebug,
						debugLog: !! editor.textAnimWipeDebug && ! editor._fccWipeDbgLogged,
					} ) || outTex;"""

# Fix logic - _fccWipeDbgLogged set true before apply means debugLog always false. Simplify:
new_call = """					if ( editor.textAnimWipeDebug ) {
						if ( ! editor._fccWipeDbgLogged ) {
							editor._fccWipeDbgLogged = true;
							console.log( '[FreeFilmCut wipe] layout(world px)', layout,
								'progress', wipeInfo.wipe.progress,
								'res', textRT.width, textRT.height );
						}
					} else {
						editor._fccWipeDbgLogged = false;
					}
					outTex = applyWipeReveal( {
						renderer,
						inputTexture: outTex,
						width: textRT.width,
						height: textRT.height,
						progress: wipeInfo.wipe.progress,
						direction: wipeInfo.wipe.direction,
						soft: wipeInfo.wipe.soft,
						edgeIntensity: wipeInfo.wipe.edgeIntensity,
						edgeWidth: wipeInfo.wipe.edgeWidth,
						layout,
						debugMask: !! editor.textAnimWipeDebug,
					} ) || outTex;"""

if old_call not in vp:
    raise SystemExit("wipe call not found in Viewport")
vp = vp.replace(old_call, new_call)
(ROOT / "Viewport.js").write_text(vp, encoding="utf-8")
print("Viewport OK")

# Sidebar + UI bumps
side = (ROOT / "Sidebar.Object.TextAnim.js").read_text(encoding="utf-8")
side = re.sub(r"TextAnimRuntime\.js\?v=fcc-ui-\d+", "TextAnimRuntime.js?v=fcc-ui-10", side)
(ROOT / "Sidebar.Object.TextAnim.js").write_text(side, encoding="utf-8")
ui = (ROOT / "Sidebar.Object.UI.js").read_text(encoding="utf-8")
ui = re.sub(r"Sidebar\.Object\.TextAnim\.js\?v=fcc-ui-\d+", "Sidebar.Object.TextAnim.js?v=fcc-ui-13", ui)
(ROOT / "Sidebar.Object.UI.js").write_text(ui, encoding="utf-8")

md = (ROOT / "ui/TEXTANIM.md").read_text(encoding="utf-8")
md = md.replace("TextLayerRT.js?v=fcc-ui-16", "TextLayerRT.js?v=fcc-ui-17")
md = md.replace("TextAnimRuntime.js?v=fcc-ui-9", "TextAnimRuntime.js?v=fcc-ui-10")
if "world/overlay pixel" not in md:
    md = md.replace(
        "1. `collectWipeLayoutMetrics(text)`：读 `__fccCharBase`",
        "1. `collectWipeLayoutMetrics(text)`：caret → `localToWorld` **overlay/RT 像素**",
    )
(ROOT / "ui/TEXTANIM.md").write_text(md, encoding="utf-8")

import subprocess
for f in ["ui/TextLayerRT.js", "ui/TextAnimRuntime.js", "Viewport.js"]:
    r = subprocess.run(["node", "--check", str(ROOT/f)], capture_output=True, text=True)
    print(("OK" if r.returncode==0 else "FAIL"), f, (r.stderr or "")[:300])
