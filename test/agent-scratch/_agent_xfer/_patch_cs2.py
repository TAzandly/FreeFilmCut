from pathlib import Path

path = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\services\renderer\compositor\three-compositor.ts")
text = path.read_text(encoding="utf-8")

# Find a good insertion point — after imports, before class
# Look for "export class ThreeCompositor" or similar
idx = text.find("export class ThreeCompositor")
if idx < 0:
    idx = text.find("class ThreeCompositor")
if idx < 0:
    raise SystemExit("ThreeCompositor class not found")

helpers = '''
/** Editor Config default is NeutralToneMapping (key value 7 in three r15x+/r18x). */
function resolvePackOutputToneMapping(
\tpayload: { output?: { toneMapping?: string | number }; toneMapping?: string | number } | null | undefined,
): THREE.ToneMapping {
\tconst raw =
\t\tpayload?.output?.toneMapping ??
\t\tpayload?.toneMapping ??
\t\t"neutral";
\tif (typeof raw === "number" && Number.isFinite(raw)) {
\t\treturn raw as THREE.ToneMapping;
\t}
\tconst key = String(raw).toLowerCase();
\tswitch (key) {
\t\tcase "none":
\t\tcase "notonemapping":
\t\t\treturn THREE.NoToneMapping;
\t\tcase "linear":
\t\t\treturn THREE.LinearToneMapping;
\t\tcase "reinhard":
\t\t\treturn THREE.ReinhardToneMapping;
\t\tcase "cineon":
\t\t\treturn THREE.CineonToneMapping;
\t\tcase "aces":
\t\tcase "acesfilmic":
\t\t\treturn THREE.ACESFilmicToneMapping;
\t\tcase "agx":
\t\t\treturn THREE.AgXToneMapping;
\t\tcase "neutral":
\t\tdefault:
\t\t\treturn THREE.NeutralToneMapping;
\t}
}

function resolvePackOutputExposure(
\tpayload: { output?: { toneMappingExposure?: number }; toneMappingExposure?: number } | null | undefined,
): number {
\tconst v = payload?.output?.toneMappingExposure ?? payload?.toneMappingExposure;
\tconst n = Number(v);
\treturn Number.isFinite(n) && n > 0 ? n : 1;
}

'''

if "function resolvePackOutputToneMapping" not in text:
    text = text[:idx] + helpers + text[idx:]
    path.write_text(text, encoding="utf-8")
    print("OK helpers inserted")
else:
    print("helpers already present")

# Verify isTransparentBg in scope for final blit — read that section
t = path.read_text(encoding="utf-8")
# Check NeutralToneMapping reference compiles conceptually
assert "THREE.NeutralToneMapping" in t
assert "resolvePackOutputToneMapping(activePack?.payload)" in t
assert "straightAlphaFromPremul" in t
assert "outputColorSpace = THREE.SRGBColorSpace" in t
print("verified compositor symbols")

# Scope check: isTransparentBg used after try/finally
i = t.find("straightAlphaFromPremul: isTransparentBg")
print("final blit uses isTransparentBg at", i)
# show a bit of context — find nearest const isTransparentBg before it
j = t.rfind("const isTransparentBg", 0, i)
print("decl at", j, "distance", i-j if j>=0 else None)
