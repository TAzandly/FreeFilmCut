from pathlib import Path
import re

checks = []

vp = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Viewport.js").read_text(encoding="utf-8")
checks.append(("VP applyWipeReveal", "applyWipeReveal" in vp))
checks.append(("VP wipe before Fx", vp.find("applyWipeReveal") < vp.find("applyTextLayerFx") and "applyWipeReveal" in vp))
checks.append(("VP force RT on wipe", "wipeInfo != null" in vp))

tl = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\TextLayerRT.js").read_text(encoding="utf-8")
checks.append(("shader reveal", "smoothstep( axis - soft, axis + soft, p )" in tl))
checks.append(("shader edge", "uEdgeIntensity" in tl and "uEdgeWidth" in tl))
checks.append(("HalfFloat", "HalfFloatType" in tl))
checks.append(("Linear color", "LinearSRGBColorSpace" in tl))

rt = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\TextAnimRuntime.js").read_text(encoding="utf-8")
checks.append(("no per-glyph wipe", "wipeAxisForChar" not in rt and "sampleWipeAxisMask" not in rt))

be = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\postprocessing\BuiltinEffects.js").read_text(encoding="utf-8")
checks.append(("DG color default", "color: '#ffffff'" in be))
checks.append(("DG apply color", "parseGlowColor( params.color" in be))
checks.append(("DG schema color", "type: 'color'" in be))

dg = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\postprocessing\DeepGlowPass.js").read_text(encoding="utf-8")
checks.append(("DG glowColor exists", "this.glowColor" in dg and "glowColor.value.copy" in dg))

oc = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\postprocess\registry.ts").read_text(encoding="utf-8")
checks.append(("OC color", 'color: "#ffffff"' in oc))

for name, ok in checks:
    print(("PASS" if ok else "FAIL"), name)
