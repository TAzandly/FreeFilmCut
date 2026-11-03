# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")
tl_path = ROOT / "ui/TextLayerRT.js"
tl = tl_path.read_text(encoding="utf-8")

# Replace debug branch in wipe fragment shader
old_dbg = """				if ( uDebug > 0.5 ) {
					float inBox = step( 0.0, u ) * step( u, 1.0 ) * step( 0.0, v ) * step( v, 1.0 );
					vec3 col = vec3( clamp( reveal, 0.0, 1.0 ) );
					col = mix( col, vec3( 0.0, 1.0, 1.0 ), clamp( edge * 2.5, 0.0, 1.0 ) );
					col = mix( vec3( 0.35, 0.0, 0.05 ), col, inBox );
					float chk = mod( floor( vUv.x * 40.0 ) + floor( vUv.y * 40.0 ), 2.0 );
					col += ( chk * 0.03 ) * ( 1.0 - inBox );
					gl_FragColor = vec4( col, 1.0 );
					return;
				}"""

new_dbg = """				if ( uDebug > 0.5 ) {
					// Show masked text composite so Duo can see if mask hits glyphs.
					// Outside layout: dark red. Edge frontier: cyan tint on top.
					float inBox = step( 0.0, u ) * step( u, 1.0 ) * step( 0.0, v ) * step( v, 1.0 );
					vec3 base = c.rgb * reveal;
					float a = c.a * reveal;
					// Dim checker behind empty so frame is visible.
					float chk = mod( floor( vUv.x * 32.0 ) + floor( vUv.y * 32.0 ), 2.0 );
					vec3 bg = vec3( 0.08 + chk * 0.04 );
					vec3 col = mix( bg, base, clamp( a * 4.0, 0.0, 1.0 ) );
					col = mix( col, vec3( 0.0, 1.0, 1.0 ), clamp( edge * c.a * 2.5, 0.0, 1.0 ) );
					col = mix( vec3( 0.35, 0.0, 0.05 ), col, inBox );
					gl_FragColor = vec4( col, 1.0 );
					return;
				}"""

if old_dbg not in tl:
    # find debug block
    i = tl.find("if ( uDebug > 0.5 )")
    print("dbg at", i)
    print(repr(tl[i:i+500]))
    raise SystemExit("debug block not found")

tl = tl.replace(old_dbg, new_dbg)

# Invalidate wipeMat when fragment changes - already invalidates on missing uWorldBounds etc.
# Force recreate by checking a comment marker in ensureWipePass - bump by disposing always once
# Add wipeMat uniform uDebugMode or just bump version so module reloads.

tl_path.write_text(tl, encoding="utf-8")
print("debug composite OK")

# Sidebar hint update
side = (ROOT / "Sidebar.Object.TextAnim.js").read_text(encoding="utf-8")
side2 = side.replace(
    "'白=已显 黑=未显 青=刃光；播放时 wipe 接管显隐(opacity=1)以便看到扫光'",
    "'调试=文字×reveal（青=刃光，红=框外）；播放时 wipe 接管显隐'",
)
side2 = side2.replace(
    "'White=shown Black=hidden Cyan=edge; play: wipe owns visibility (opacity forced 1)'",
    "'Debug=text*reveal (cyan=edge, red=outside); play: wipe owns visibility'",
)
side2 = side2.replace(
    "'白=已显/高 黑=未显 青=刃光 深红=布局外；LTR中段应左白右黑'",
    "'调试=文字×reveal（青=刃光）；LTR中段左露右藏'",
)
(ROOT / "Sidebar.Object.TextAnim.js").write_text(side2, encoding="utf-8")

# Cache bumps
vp = (ROOT / "Viewport.js").read_text(encoding="utf-8")
vp = re.sub(r"TextLayerRT\.js\?v=fcc-ui-\d+", "TextLayerRT.js?v=fcc-ui-19", vp)
vp = re.sub(r"TextAnimRuntime\.js\?v=fcc-ui-\d+", "TextAnimRuntime.js?v=fcc-ui-12", vp)
(ROOT / "Viewport.js").write_text(vp, encoding="utf-8")

side = (ROOT / "Sidebar.Object.TextAnim.js").read_text(encoding="utf-8")
side = re.sub(r"TextAnimRuntime\.js\?v=fcc-ui-\d+", "TextAnimRuntime.js?v=fcc-ui-12", side)
(ROOT / "Sidebar.Object.TextAnim.js").write_text(side, encoding="utf-8")

ui = (ROOT / "Sidebar.Object.UI.js").read_text(encoding="utf-8")
ui = re.sub(r"Sidebar\.Object\.TextAnim\.js\?v=fcc-ui-\d+", "Sidebar.Object.TextAnim.js?v=fcc-ui-15", ui)
(ROOT / "Sidebar.Object.UI.js").write_text(ui, encoding="utf-8")

md = (ROOT / "ui/TEXTANIM.md").read_text(encoding="utf-8")
md = md.replace("TextLayerRT.js?v=fcc-ui-18", "TextLayerRT.js?v=fcc-ui-19")
md = md.replace("TextAnimRuntime.js?v=fcc-ui-11", "TextAnimRuntime.js?v=fcc-ui-12")
md = md.replace("TextAnimRuntime.js?v=fcc-ui-12", "TextAnimRuntime.js?v=fcc-ui-12")
if "文字×reveal" not in md and "text*reveal" not in md:
    md = md.replace(
        "- 全 RT：主显 reveal 灰度（白=已显 黑=未显），青=刃光，深红=布局外；LTR 中段左白右黑；调试跳过 TextFx\n",
        "- 调试：显示 **文字×reveal** 合成（非纯灰条）；青=刃光，红=框外；像素正交用 raw Y；跳过 TextFx\n",
    )
(ROOT / "ui/TEXTANIM.md").write_text(md, encoding="utf-8")

# Force wipeMat recreate - add check for a new uniform flag or change ensureWipePass condition
# Add uDebugComposite marker by bumping dispose condition
tl = tl_path.read_text(encoding="utf-8")
if "uWorldBounds" in tl and "wipeMat.userData.__fccWipeV" not in tl:
    tl = tl.replace(
        "\tif ( wipeMat && ( ! wipeMat.uniforms.uDebug || wipeMat.blending !== THREE.NoBlending || ! wipeMat.uniforms.uWorldBounds ) ) {\n",
        "\tif ( wipeMat && ( ! wipeMat.uniforms.uDebug || wipeMat.blending !== THREE.NoBlending || ! wipeMat.uniforms.uWorldBounds || wipeMat.userData.__fccWipeV !== 19 ) ) {\n",
    )
    tl = tl.replace(
        "\twipeMat = new THREE.ShaderMaterial( {\n\t\tname: 'TextLayerRT.wipeReveal',",
        "\twipeMat = new THREE.ShaderMaterial( {\n\t\tname: 'TextLayerRT.wipeReveal',",
    )
    # set userData after create
    if "wipeMat.userData.__fccWipeV" not in tl:
        tl = tl.replace(
            "\twipeMesh = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), wipeMat );",
            "\twipeMat.userData.__fccWipeV = 19;\n"
            "\twipeMesh = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), wipeMat );",
        )
    tl_path.write_text(tl, encoding="utf-8")
    print("wipeMat v19 invalidate")

import subprocess
for f in ["ui/TextLayerRT.js", "ui/TextAnimRuntime.js", "Viewport.js"]:
    r = subprocess.run(["node", "--check", str(ROOT/f)], capture_output=True, text=True)
    print(("OK" if r.returncode==0 else "FAIL"), f, (r.stderr or "")[:200])
