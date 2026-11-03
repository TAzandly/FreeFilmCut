from pathlib import Path
tl_path = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\TextLayerRT.js")
tl = tl_path.read_text(encoding="utf-8")
old = """	// Fully revealed with no soft leftover ? skip (identity). Mid-progress always runs for edge.
	if ( progress >= 0.999 && soft <= 0.021 && edgeIntensity <= 1e-4 ) {

		return inputTexture;

	}"""
# encoding of dash may vary
import re
m = re.search(
    r"\tif \( progress >= 0\.999 && soft <= 0\.021 && edgeIntensity <= 1e-4 \) \{\n\n\t\treturn inputTexture;\n\n\t\}",
    tl,
)
if not m:
    # try single newline
    m = re.search(
        r"\tif \( progress >= 0\.999 && soft <= 0\.021 && edgeIntensity <= 1e-4 \) \{\s*return inputTexture;\s*\}",
        tl,
    )
if not m:
    raise SystemExit("skip block not found")
new = """\tif ( ! args.debugMask && progress >= 0.999 && soft <= 0.021 && edgeIntensity <= 1e-4 ) {

\t\treturn inputTexture;

\t}"""
tl = tl[:m.start()] + new + tl[m.end():]
tl_path.write_text(tl, encoding="utf-8")
print("skip respects debugMask")

# Also force wantTextRT when debug even without wipe? optional - if debug on with wipe off nothing to show.
# When debug on, still need wipe enabled for wipeInfo. OK.

# Verify fragments
assert "uDebug" in tl and "args.debugMask" in tl
print("ok")
