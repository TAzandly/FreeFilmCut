from pathlib import Path
vp_path = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Viewport.js")
vp = vp_path.read_text(encoding="utf-8")

old = """					if ( layout ) {
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
					} ) || outTex;
				}
				// Skip TextFx while wipe-debug so mask colors stay readable."""

new = """					if ( layout ) {

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
						} ) || outTex;

					}

				}
				// Skip TextFx while wipe-debug so mask colors stay readable."""

if old not in vp:
    raise SystemExit("brace block not found")
vp = vp.replace(old, new)
vp_path.write_text(vp, encoding="utf-8")

import subprocess
r = subprocess.run(["node", "--check", str(vp_path)], capture_output=True, text=True)
print("syntax", r.returncode, (r.stderr or "")[:400])

# show fixed region
i = vp.find("if ( layout )")
print(vp[i:i+550])
