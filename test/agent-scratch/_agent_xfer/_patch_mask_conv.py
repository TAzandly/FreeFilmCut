# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")
tl_path = ROOT / "ui/TextLayerRT.js"
tl = tl_path.read_text(encoding="utf-8")

old = """				float u = ( local.x - uLocalBounds.x ) / max( uLocalBounds.z - uLocalBounds.x, 1e-5 );
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
			}"""

new = """				float u = ( local.x - uLocalBounds.x ) / max( uLocalBounds.z - uLocalBounds.x, 1e-5 );
				float v = ( local.y - uLocalBounds.y ) / max( uLocalBounds.w - uLocalBounds.y, 1e-5 );

				// Static LinearWipe mask: 1 at wipe-start side, 0 at end.
				// LTR: left=1 … right=0 (white→black). RTL / TTB / BTT analogous.
				float mask = 1.0 - u; // ltr
				if ( uDir > 0.5 && uDir < 1.5 ) mask = u;           // rtl: right=1
				else if ( uDir > 1.5 && uDir < 2.5 ) mask = v;      // ttb: top (high y)=1
				else if ( uDir > 2.5 ) mask = 1.0 - v;              // btt: bottom=1

				float soft = max( uSoft, 1e-4 );
				// Expand so progress 0 = fully hidden, 1 = fully shown (feather included).
				float pExp = uProgress * ( 1.0 + 2.0 * soft ) - soft;
				// Threshold descends 1→0: reveal where mask >= thresh (JY LinearWipe).
				float thresh = 1.0 - pExp;
				float reveal = smoothstep( thresh - soft, thresh + soft, mask );

				float ew = max( uEdgeWidth, 1e-4 );
				float edge = smoothstep( thresh - ew, thresh, mask )
					* ( 1.0 - smoothstep( thresh, thresh + ew, mask ) );

				if ( uDebug > 0.5 ) {
					// Primary: reveal grayscale (white=shown, black=hidden).
					// Mid LTR scrub => left white / right black. t=0 => all black.
					float inBox = step( 0.0, u ) * step( u, 1.0 ) * step( 0.0, v ) * step( v, 1.0 );
					float rev = clamp( reveal, 0.0, 1.0 );
					vec3 col = vec3( rev );
					// Cyan edge band on the wipe frontier.
					col = mix( col, vec3( 0.0, 1.0, 1.0 ), clamp( edge * 2.5, 0.0, 1.0 ) );
					// Outside layout: dark red.
					col = mix( vec3( 0.35, 0.0, 0.05 ), col, inBox );
					float chk = mod( floor( vUv.x * 40.0 ) + floor( vUv.y * 40.0 ), 2.0 );
					col += ( chk * 0.03 ) * ( 1.0 - inBox );
					gl_FragColor = vec4( col, 1.0 );
					return;
				}

				if ( c.a < 0.001 ) discard;
				edge *= c.a;
				vec3 rgb = c.rgb + edge * uEdgeIntensity * vec3( 1.0 );
				gl_FragColor = vec4( rgb, c.a * reveal );
			}"""

if old not in tl:
    raise SystemExit("fragment body not found")
tl = tl.replace(old, new)

# Bump comment at top of wipe if any
tl = tl.replace(
    " * axis (Troika caret local) + edge glint",
    " * axis (Troika caret local): mask 1 at wipe-start (LTR left=white) + edge glint",
)

tl_path.write_text(tl, encoding="utf-8")
print("shader updated", "thresh = 1.0 - pExp" in tl)

# Viewport + UI cache bumps
vp = (ROOT / "Viewport.js").read_text(encoding="utf-8")
vp2 = vp.replace("TextLayerRT.js?v=fcc-ui-14", "TextLayerRT.js?v=fcc-ui-15")
if vp2 == vp:
    vp2 = re.sub(r"TextLayerRT\.js\?v=fcc-ui-\d+", "TextLayerRT.js?v=fcc-ui-15", vp)
(ROOT / "Viewport.js").write_text(vp2, encoding="utf-8")
print("Viewport", "fcc-ui-15" in vp2)

# Sidebar hint text update
side = (ROOT / "Sidebar.Object.TextAnim.js").read_text(encoding="utf-8")
side2 = side.replace(
    "'灰=axis 绿=reveal 青=刃光 深红=布局框外'",
    "'白=已显/高 黑=未显 青=刃光 深红=布局外；LTR中段应左白右黑'",
)
side2 = side2.replace(
    "'Gray=axis Green=reveal Cyan=edge DarkRed=outside layout'",
    "'White=shown Black=hidden Cyan=edge DarkRed=outside; mid LTR = left white / right black'",
)
ui = (ROOT / "Sidebar.Object.UI.js").read_text(encoding="utf-8")
ui2 = re.sub(r"Sidebar\.Object\.TextAnim\.js\?v=fcc-ui-\d+", "Sidebar.Object.TextAnim.js?v=fcc-ui-11", ui)
(ROOT / "Sidebar.Object.TextAnim.js").write_text(side2, encoding="utf-8")
(ROOT / "Sidebar.Object.UI.js").write_text(ui2, encoding="utf-8")
print("sidebar hint", "左白右黑" in side2)

# TEXTANIM.md
md = (ROOT / "ui/TEXTANIM.md").read_text(encoding="utf-8")
md = re.sub(
    r"3\. `u = \(local\.x.*?\n4\. `pExp.*?\n5\. `reveal = smoothstep.*?\n6\. `edge = band.*?\n",
    "3. Static mask (LTR): `mask = 1 - u` → left=1 white … right=0 black (RTL/TTB/BTT flip)\n"
    "4. `pExp = p*(1+2*soft)-soft`; `thresh = 1 - pExp`\n"
    "5. `reveal = smoothstep(thresh±soft, mask)` — mid LTR left white / right black; t=0 all black\n"
    "6. `edge` = band around thresh on mask; `rgb += edge * intensity`; `a *= reveal`\n",
    md,
    count=1,
    flags=re.S,
)
md = md.replace("TextLayerRT.js?v=fcc-ui-14", "TextLayerRT.js?v=fcc-ui-15")
md = md.replace("Sidebar.Object.TextAnim.js?v=fcc-ui-10", "Sidebar.Object.TextAnim.js?v=fcc-ui-11")
# debug section
md = md.replace(
    "- 全 RT：灰=axis0..1，绿=reveal，青=刃光，深红=布局框外；调试时跳过 TextFx\n",
    "- 全 RT：主显 reveal 灰度（白=已显 黑=未显），青=刃光，深红=布局外；LTR 中段左白右黑；调试跳过 TextFx\n",
)
(ROOT / "ui/TEXTANIM.md").write_text(md, encoding="utf-8")

import subprocess
r = subprocess.run(["node", "--check", str(tl_path)], capture_output=True, text=True)
print("syntax", "OK" if r.returncode == 0 else r.stderr[:400])
