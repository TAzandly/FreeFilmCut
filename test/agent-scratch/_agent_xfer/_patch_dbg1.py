# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")

# ========== TextLayerRT: debug uniform + shader branch ==========
tl_path = ROOT / "ui/TextLayerRT.js"
tl = tl_path.read_text(encoding="utf-8")

# Add uDebug to uniforms
if "uDebug:" not in tl:
    tl = tl.replace(
        "\t\t\tuEdgeIntensity: { value: 2.5 },\n"
        "\t\t\tuEdgeWidth: { value: 0.04 },\n",
        "\t\t\tuEdgeIntensity: { value: 2.5 },\n"
        "\t\t\tuEdgeWidth: { value: 0.04 },\n"
        "\t\t\tuDebug: { value: 0 }, // 1 = visualize mask/axis/edge\n",
    )

# Replace fragment shader body - find the wipe fragmentShader block
old_frag_marker = """		fragmentShader: /* glsl */`
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
		`,"""

new_frag = """		fragmentShader: /* glsl */`
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
			uniform float uDebug;
			varying vec2 vUv;
			void main() {
				vec4 c = texture2D( tDiffuse, vUv );

				// RT UV -> overlay pixel (UI ortho: x 0..W, y 0..H, flipY=false).
				vec2 world = vUv * uRes;
				vec2 d = world - uCenter;
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

				if ( uDebug > 0.5 ) {
					// Debug mask field (full RT): gray = axis 0..1, green = reveal, cyan = edge.
					// Outside layout AABB tinted dark red so wrong bounds are obvious.
					float inBox = step( 0.0, u ) * step( u, 1.0 ) * step( 0.0, v ) * step( v, 1.0 );
					float ax = clamp( axis, 0.0, 1.0 );
					vec3 col = vec3( ax * 0.55 );
					col = mix( col, vec3( 0.05, 0.85, 0.15 ), reveal * 0.85 );
					col = mix( col, vec3( 0.0, 1.0, 1.0 ), clamp( edge * 2.0, 0.0, 1.0 ) );
					// Outside layout range: deep red so Duo sees bad axis domain.
					col = mix( vec3( 0.35, 0.0, 0.05 ), col, inBox );
					// Tiny checker to prove full-RT debug (not text-only).
					float chk = mod( floor( vUv.x * 40.0 ) + floor( vUv.y * 40.0 ), 2.0 );
					col += ( chk * 0.03 ) * ( 1.0 - inBox );
					gl_FragColor = vec4( col, 1.0 );
					return;
				}

				if ( c.a < 0.001 ) discard;
				edge *= c.a;
				vec3 rgb = c.rgb + edge * uEdgeIntensity * vec3( 1.0 );
				gl_FragColor = vec4( rgb, c.a * reveal );
			}
		`,"""

if old_frag_marker not in tl:
    raise SystemExit("wipe fragment block not found exactly")
tl = tl.replace(old_frag_marker, new_frag)

# Wire debugMask in applyWipeReveal
if "uDebug.value" not in tl:
    tl = tl.replace(
        "\twipeMat.uniforms.uEdgeWidth.value = edgeWidth;\n"
        "\twipeMat.uniforms.uDir.value = dirToIndex( args.direction );\n",
        "\twipeMat.uniforms.uEdgeWidth.value = edgeWidth;\n"
        "\twipeMat.uniforms.uDebug.value = args.debugMask ? 1 : 0;\n"
        "\twipeMat.uniforms.uDir.value = dirToIndex( args.direction );\n",
    )

# JSDoc
if "debugMask" not in tl.split("export function applyWipeReveal")[0][-400:]:
    tl = tl.replace(
        " * @param {object} [args.layout] from collectWipeLayoutMetrics (caret local axis)\n"
        " * @returns {THREE.Texture}\n"
        " */\n"
        "\n"
        "/**\n"
        " * @deprecated",
        " * @param {object} [args.layout] from collectWipeLayoutMetrics (caret local axis)\n"
        " * @param {boolean} [args.debugMask] visualize axis/reveal/edge (full RT)\n"
        " * @returns {THREE.Texture}\n"
        " */\n"
        "\n"
        "/**\n"
        " * @deprecated",
    )
    # If deprecated comment structure different, just ensure apply has debug - already wired

tl_path.write_text(tl, encoding="utf-8")
print("TextLayerRT debug OK", "uDebug" in tl, "debugMask" in tl)

# Ensure ensureWipePass gets rebuilt if wipeMat cached old without uDebug - 
# users hard refresh. Also force recreate when debug toggled by disposing wipeMat? 
# Optional: in applyWipeReveal if debug and !uDebug uniform, rebuild.
# Safer: if wipeMat exists but missing uDebug, dispose and recreate
if "wipeMat.uniforms.uDebug" in tl and "ensureWipePass has uDebug" not in tl:
    # Patch ensureWipePass start to invalidate old materials without uDebug
    tl = tl_path.read_text(encoding="utf-8")
    tl = tl.replace(
        "function ensureWipePass() {\n\n\tif ( wipeMat ) return;\n",
        "function ensureWipePass() {\n\n\tif ( wipeMat && ! wipeMat.uniforms.uDebug ) {\n"
        "\t\twipeMat.dispose();\n"
        "\t\twipeMat = null;\n"
        "\t\tif ( wipeMesh ) { wipeMesh.geometry.dispose(); wipeMesh = null; }\n"
        "\t\twipeScene = null;\n"
        "\t\twipeCam = null;\n"
        "\t}\n"
        "\tif ( wipeMat ) return;\n",
    )
    tl_path.write_text(tl, encoding="utf-8")
    print("invalidate old wipeMat without uDebug")
