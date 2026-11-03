# -*- coding: utf-8 -*-
from pathlib import Path
import re

p = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.TextAnim.js")
s = p.read_text(encoding="utf-8")

s = s.replace(
    "} from './ui/TextAnim.js?v=fcc-ui-6';\nimport { clearTextAnimPreview } from './ui/TextAnimRuntime.js?v=fcc-ui-6';",
    "} from './ui/TextAnim.js?v=fcc-ui-7';\nimport { clearTextAnimPreview } from './ui/TextAnimRuntime.js?v=fcc-ui-7';",
)

s = s.replace(
    "ph.modulators.wipeReveal = { enabled: false, direction: 'ltr', soft: 0.12 };",
    "ph.modulators.wipeReveal = { enabled: false, direction: 'ltr', soft: 0.12, edgeIntensity: 2.5, edgeWidth: 0.04 };",
)

s = s.replace("Wipe reveal (per-glyph)", "Wipe reveal (text RT + edge)")

# Replace zh wipe head — find line with wipeHead
lines = s.splitlines(keepends=True)
out = []
for line in lines:
    if "const wipeHead = new UIText" in line and "Wipe reveal" in line:
        out.append(
            "\t\tconst wipeHead = new UIText( zh ? '扫光 wipeReveal（片元+刃光）' : 'Wipe reveal (text RT + edge)' )\n"
        )
    else:
        out.append(line)
s = "".join(out)

if "Edge intensity" not in s and "() => wipe.edgeIntensity" not in s:
    idx = s.find("() => wipe.soft")
    note_idx = s.find("const note = new UIText", idx)
    if idx < 0 or note_idx < 0:
        raise SystemExit(f"markers soft={idx} note={note_idx}")
    edge_controls = (
        "\t\tif ( wipe.edgeIntensity == null || ! Number.isFinite( Number( wipe.edgeIntensity ) ) ) {\n"
        "\t\t\twipe.edgeIntensity = 2.5;\n"
        "\t\t}\n"
        "\t\tif ( wipe.edgeWidth == null || ! Number.isFinite( Number( wipe.edgeWidth ) ) ) {\n"
        "\t\t\twipe.edgeWidth = 0.04;\n"
        "\t\t}\n"
        "\t\taddNum( params, zh ? '刃光强度' : 'Edge intensity',\n"
        "\t\t\t() => wipe.edgeIntensity,\n"
        "\t\t\t( v ) => { wipe.edgeIntensity = Math.max( 0, v ); },\n"
        "\t\t\t[ 0, 8 ], 2, 0.1 );\n"
        "\t\taddNum( params, zh ? '刃光宽度' : 'Edge width',\n"
        "\t\t\t() => wipe.edgeWidth,\n"
        "\t\t\t( v ) => { wipe.edgeWidth = Math.max( 0.005, Math.min( 0.25, v ) ); },\n"
        "\t\t\t[ 0.005, 0.25 ], 3, 0.005 );\n\n"
    )
    s = s[:note_idx] + edge_controls + s[note_idx:]

# Replace note — find English part
if "text-RT fragment reveal + edge glint" not in s:
    # Find note block starting at const note
    m = re.search(r"const note = new UIText\( zh\s*\n\s*\? .*?\n\s*: .*?\n\s*\)\.setFontSize", s, re.S)
    if not m:
        # try single-line-ish
        m = re.search(r"const note = new UIText\( zh[\s\S]*?\)\.setFontSize", s)
    if m:
        new_note = (
            "const note = new UIText( zh\n"
            "\t\t\t? '· wipe = 文字 RT 片元扫光 + 刃光（空区不发光）；软边/刃光为字串本地 UV。TextFx Deep Glow / Bloom 可吃过亮刃光。'\n"
            "\t\t\t: '· wipe = text-RT fragment reveal + edge glint; soft/edge are text-local UV. TextFx Deep Glow/Bloom can pick up overbright edge.'\n"
            "\t\t).setFontSize"
        )
        s = s[:m.start()] + new_note + s[m.end():]
    else:
        print("WARNING: note block not replaced")

s = s.replace(
    "wipeReveal on text RT; spring ease; Deep Glow = camera PP.",
    "wipeReveal = text-RT fragment + edge glint; spring ease; Deep Glow = camera/TextFx PP.",
)

p.write_text(s, encoding="utf-8")
print("Sidebar OK", "Edge intensity" in s, "刃光强度" in s)
