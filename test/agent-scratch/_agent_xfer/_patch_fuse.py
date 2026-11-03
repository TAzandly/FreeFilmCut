# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")

# ========== 1) TextAnimRuntime: wipe owns visibility ==========
rt_path = ROOT / "ui/TextAnimRuntime.js"
rt = rt_path.read_text(encoding="utf-8")

# Re-import sampleWipeRevealProgress for enabled check (lightweight)
if "sampleWipeRevealProgress" not in rt.split("from './TextAnim.js")[0]:
    rt = rt.replace(
        """import {
	ensureTextAnimOnUI,
	getActivePhase,
	buildCharOrder,
	sampleCharPose,
	normalizeTextAnim,
} from './TextAnim.js?v=fcc-ui-7';""",
        """import {
	ensureTextAnimOnUI,
	getActivePhase,
	buildCharOrder,
	sampleCharPose,
	sampleWipeRevealProgress,
	normalizeTextAnim,
} from './TextAnim.js?v=fcc-ui-7';""",
    )

old_loop = """	// wipeReveal runs as TextLayerRT fragment wipe + edge glint (not per-glyph opacity).

	for ( let i = 0; i < count; i ++ ) {

		const charGroup = root.getObjectByName( FCC_TEXTANIM_CHAR_PREFIX + i );
		if ( ! charGroup ) continue;
		const orderIndex = order.indexOf( i );
		const pose = sampleCharPose( t, phase, count, i, orderIndex < 0 ? i : orderIndex );
		const base = charGroup.userData.__fccCharBase || { x: 0, y: 0, z: 0.01 };
		charGroup.position.set( base.x + pose.offsetX, base.y + pose.offsetY, base.z );
		charGroup.rotation.set( pose.rotateX, pose.rotateY, pose.rotateZ );
		charGroup.scale.set( pose.scaleX, pose.scaleY, 1 );
		applyOpacityToCharGroup( charGroup, pose.opacity );

	}"""

new_loop = """	// wipeReveal = TextLayerRT fragment wipe + edge. When wipe is on, force glyph
	// opacity to fully inked so staggered opacity fade does not hide the scan.
	const wipeOn = !! ( sampleWipeRevealProgress( t, anim ).enabled );

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

if old_loop not in rt:
    raise SystemExit("pose loop not found")
rt = rt.replace(old_loop, new_loop)
rt = rt.replace("TextAnim.js?v=fcc-ui-7", "TextAnim.js?v=fcc-ui-7")  # keep
# bump own cache via Viewport import to fcc-ui-9
rt_path.write_text(rt, encoding="utf-8")
print("Runtime wipeOn opacity OK", "wipeOn" in rt)

# ========== 2) TextLayerRT: NoBlending + rgb*reveal fusion ==========
tl_path = ROOT / "ui/TextLayerRT.js"
tl = tl_path.read_text(encoding="utf-8")

# Normal path output
old_out = """				if ( c.a < 0.001 ) discard;
				edge *= c.a;
				vec3 rgb = c.rgb + edge * uEdgeIntensity * vec3( 1.0 );
				gl_FragColor = vec4( rgb, c.a * reveal );
			}"""

new_out = """				if ( c.a < 0.001 ) discard;
				edge *= c.a;
				// Fuse mask into RGB+A (not alpha-only) so blit/composites cannot ignore reveal.
				vec3 rgb = c.rgb * reveal + edge * uEdgeIntensity * vec3( 1.0 );
				float a = c.a * reveal;
				// Keep a sliver of alpha on the glint so bloom can see the edge.
				a = max( a, edge * c.a );
				gl_FragColor = vec4( rgb, a );
			}"""

if old_out not in tl:
    raise SystemExit("normal out not found")
tl = tl.replace(old_out, new_out)

# NoBlending on wipe material
tl = tl.replace(
    """		transparent: true,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
		premultipliedAlpha: false,
		blending: THREE.NormalBlending,
	} );
	wipeMesh = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), wipeMat );""",
    """		transparent: true,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
		premultipliedAlpha: false,
		// NoBlending: write straight into cleared wipe RT (NormalBlending double-muls alpha).
		blending: THREE.NoBlending,
	} );
	wipeMesh = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), wipeMat );""",
)

# Invalidate wipeMat if still NormalBlending from old session
if "wipeMat.blending !== THREE.NoBlending" not in tl:
    tl = tl.replace(
        "function ensureWipePass() {\n\n\tif ( wipeMat && ! wipeMat.uniforms.uDebug ) {\n",
        "function ensureWipePass() {\n\n"
        "\tif ( wipeMat && ( ! wipeMat.uniforms.uDebug || wipeMat.blending !== THREE.NoBlending ) ) {\n",
    )

tl_path.write_text(tl, encoding="utf-8")
print("TextLayerRT fusion OK", "c.rgb * reveal" in tl, "NoBlending" in tl)

# ========== 3) Cache bumps ==========
vp = (ROOT / "Viewport.js").read_text(encoding="utf-8")
vp = re.sub(r"TextLayerRT\.js\?v=fcc-ui-\d+", "TextLayerRT.js?v=fcc-ui-16", vp)
vp = re.sub(r"TextAnimRuntime\.js\?v=fcc-ui-\d+", "TextAnimRuntime.js?v=fcc-ui-9", vp)
(ROOT / "Viewport.js").write_text(vp, encoding="utf-8")

side = (ROOT / "Sidebar.Object.TextAnim.js").read_text(encoding="utf-8")
side = re.sub(r"TextAnimRuntime\.js\?v=fcc-ui-\d+", "TextAnimRuntime.js?v=fcc-ui-9", side)
# Update note about wipe owning opacity
if "wipe 开启时逐字透明度固定为 1" not in side:
    side = side.replace(
        "'白=已显/高 黑=未显 青=刃光 深红=布局外；LTR中段应左白右黑'",
        "'白=已显 黑=未显 青=刃光；播放时 wipe 接管显隐(opacity=1)以便看到扫光'",
    )
    side = side.replace(
        "'White=shown Black=hidden Cyan=edge DarkRed=outside; mid LTR = left white / right black'",
        "'White=shown Black=hidden Cyan=edge; play: wipe owns visibility (opacity forced 1)'",
    )
(ROOT / "Sidebar.Object.TextAnim.js").write_text(side, encoding="utf-8")

ui = (ROOT / "Sidebar.Object.UI.js").read_text(encoding="utf-8")
ui = re.sub(r"Sidebar\.Object\.TextAnim\.js\?v=fcc-ui-\d+", "Sidebar.Object.TextAnim.js?v=fcc-ui-12", ui)
(ROOT / "Sidebar.Object.UI.js").write_text(ui, encoding="utf-8")

md = (ROOT / "ui/TEXTANIM.md").read_text(encoding="utf-8")
md = md.replace("TextLayerRT.js?v=fcc-ui-15", "TextLayerRT.js?v=fcc-ui-16")
md = md.replace("TextAnimRuntime.js?v=fcc-ui-8", "TextAnimRuntime.js?v=fcc-ui-9")
if "wipe 开启时" not in md:
    md = md.replace(
        "## 调试遮罩",
        "## 与逐字 opacity\n"
        "- **wipeReveal.enabled 时**：预览强制每字 opacity=1，由 RT 片元 reveal 控制显隐（否则 stagger 淡入会盖住扫光）。\n"
        "- 融合：`rgb *= reveal` + `a *= reveal`（NoBlending 写入 wipe RT），再 blit。\n\n"
        "## 调试遮罩",
    )
(ROOT / "ui/TEXTANIM.md").write_text(md, encoding="utf-8")

import subprocess
for f in ["ui/TextLayerRT.js", "ui/TextAnimRuntime.js", "Viewport.js", "Sidebar.Object.TextAnim.js"]:
    r = subprocess.run(["node", "--check", str(ROOT/f)], capture_output=True, text=True)
    print(("OK" if r.returncode==0 else "FAIL"), f, (r.stderr or "")[:200])
