# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")

# ========== Viewport: pass debugMask + bump cache ==========
vp_path = ROOT / "Viewport.js"
vp = vp_path.read_text(encoding="utf-8")
vp = vp.replace("TextLayerRT.js?v=fcc-ui-13", "TextLayerRT.js?v=fcc-ui-14")
vp = vp.replace("TextAnimRuntime.js?v=fcc-ui-8", "TextAnimRuntime.js?v=fcc-ui-8")  # unchanged

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
					} ) || outTex;"""

new_call = """					outTex = applyWipeReveal( {
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
    raise SystemExit("applyWipeReveal call not found")
vp = vp.replace(old_call, new_call)

# When debug on, still force RT even if wipe somehow off - already tied to wipeInfo
# Also: when debug on, skip TextFx so mask isn't bloomed away? Better skip Fx in debug for clarity.
old_fx = """				outTex = applyTextLayerFx( {
					renderer,
					target: textRT,
					stack: textFxStack,
					inputTexture: outTex,
				} ) || outTex;"""
new_fx = """				// Skip TextFx while wipe-debug so mask colors stay readable.
				if ( ! ( wipeInfo && editor.textAnimWipeDebug ) ) {
					outTex = applyTextLayerFx( {
						renderer,
						target: textRT,
						stack: textFxStack,
						inputTexture: outTex,
					} ) || outTex;
				}"""
if old_fx not in vp:
    raise SystemExit("applyTextLayerFx block not found")
vp = vp.replace(old_fx, new_fx)
vp_path.write_text(vp, encoding="utf-8")
print("Viewport OK")

# ========== Sidebar checkbox ==========
side_path = ROOT / "Sidebar.Object.TextAnim.js"
side = side_path.read_text(encoding="utf-8")

# Init editor flag from config
if "textAnimWipeDebug" not in side:
    # After textAnimPlaying init
    side = side.replace(
        "\tif ( editor.textAnimPlaying == null ) editor.textAnimPlaying = false;\n",
        "\tif ( editor.textAnimPlaying == null ) editor.textAnimPlaying = false;\n"
        "\tif ( editor.textAnimWipeDebug == null ) {\n"
        "\t\teditor.textAnimWipeDebug = editor.config.getKey( 'sidebar/text/wipeDebug' ) === true;\n"
        "\t}\n",
    )

# Insert checkbox after edge width addNum, before note
marker = "() => wipe.edgeWidth"
idx = side.find(marker)
if idx < 0:
    raise SystemExit("edgeWidth marker not found")
note_idx = side.find("const note = new UIText", idx)
if note_idx < 0:
    raise SystemExit("note after edgeWidth not found")

if "调试：显示扫光遮罩" not in side and "wipeDebug" not in side[note_idx-400:note_idx]:
    dbg = (
        "\t\tconst wipeDbgRow = new UIRow().setMarginTop( '6px' );\n"
        "\t\tconst wipeDbgCb = new UICheckbox( !! editor.textAnimWipeDebug ).onChange( () => {\n"
        "\t\t\teditor.textAnimWipeDebug = wipeDbgCb.getValue();\n"
        "\t\t\teditor.config.setKey( 'sidebar/text/wipeDebug', editor.textAnimWipeDebug );\n"
        "\t\t\tif ( editor.textAnimWipeDebug && wipe.enabled ) {\n"
        "\t\t\t\teditor.textAnimTime = 0;\n"
        "\t\t\t\ttimeNum.setValue( 0 );\n"
        "\t\t\t}\n"
        "\t\t\tdirty( false );\n"
        "\t\t} );\n"
        "\t\twipeDbgRow.add( new UIText( zh ? '调试：显示扫光遮罩' : 'Debug: show wipe mask' )"
        ".setClass( 'Label' ).setWidth( '140px' ) );\n"
        "\t\twipeDbgRow.add( wipeDbgCb );\n"
        "\t\tparams.add( wipeDbgRow );\n"
        "\t\tconst wipeDbgHint = new UIText( zh\n"
        "\t\t\t? '灰=axis 绿=reveal 青=刃光 深红=布局框外'\n"
        "\t\t\t: 'Gray=axis Green=reveal Cyan=edge DarkRed=outside layout'\n"
        "\t\t).setFontSize( '10px' ).setColor( '#8af' ).setMarginTop( '2px' );\n"
        "\t\tparams.add( wipeDbgHint );\n\n"
    )
    side = side[:note_idx] + dbg + side[note_idx:]

# Bump imports for TextLayerRT is via Viewport; bump Sidebar self via UI.js
side = side.replace("TextAnimRuntime.js?v=fcc-ui-8", "TextAnimRuntime.js?v=fcc-ui-8")
side_path.write_text(side, encoding="utf-8")
print("Sidebar OK", "调试：显示扫光遮罩" in side)

# Bump Sidebar.Object.TextAnim in UI.js
ui = (ROOT / "Sidebar.Object.UI.js").read_text(encoding="utf-8")
ui2 = ui.replace("Sidebar.Object.TextAnim.js?v=fcc-ui-9", "Sidebar.Object.TextAnim.js?v=fcc-ui-10")
if ui2 == ui:
    # try other versions
    ui2 = re.sub(r"Sidebar\.Object\.TextAnim\.js\?v=fcc-ui-\d+", "Sidebar.Object.TextAnim.js?v=fcc-ui-10", ui)
(ROOT / "Sidebar.Object.UI.js").write_text(ui2, encoding="utf-8")
print("UI.js bump", "fcc-ui-10" in ui2)

# TEXTANIM.md short note
md_path = ROOT / "ui/TEXTANIM.md"
md = md_path.read_text(encoding="utf-8")
if "wipeDebug" not in md:
    md = md.replace(
        "## 缓存",
        "## 调试遮罩\n"
        "- 侧栏「调试：显示扫光遮罩」→ `editor.textAnimWipeDebug` / config `sidebar/text/wipeDebug`\n"
        "- 全 RT：灰=axis0..1，绿=reveal，青=刃光，深红=布局框外；调试时跳过 TextFx\n\n"
        "## 缓存",
    )
    md = md.replace("TextLayerRT.js?v=fcc-ui-13", "TextLayerRT.js?v=fcc-ui-14")
    md = md.replace("Sidebar.Object.TextAnim.js?v=fcc-ui-9", "Sidebar.Object.TextAnim.js?v=fcc-ui-10")
    md_path.write_text(md, encoding="utf-8")

# syntax check
import subprocess
for f in ["ui/TextLayerRT.js", "Viewport.js", "Sidebar.Object.TextAnim.js"]:
    r = subprocess.run(["node", "--check", str(ROOT/f)], capture_output=True, text=True)
    print(("OK" if r.returncode==0 else "FAIL"), f, (r.stderr or "")[:300])
