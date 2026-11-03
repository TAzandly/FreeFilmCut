from pathlib import Path

path = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\services\renderer\compositor\three-compositor.ts")
text = path.read_text(encoding="utf-8")

old = '''\t\tconst textAnimPayloadForPack = (packId: string) => {
\t\t\tconst pack = getPackRegistrySnapshot().packs.find((entry) => entry.id === packId);
\t\t\tif (!pack) return null;
\t\t\tconst ta = (pack.manifest.textAnim || null) as
\t\t\t\t| import("@/vfxpack/text-anim-motion").TextAnimPackPayload
\t\t\t\t| null;
\t\t\tif (!ta) return null;
\t\t\t// Prefer textAnim.postProcess; fall back to top-level manifest.postProcess.
\t\t\tif (!ta.postProcess && pack.manifest.postProcess) {
\t\t\t\treturn { ...ta, postProcess: pack.manifest.postProcess };
\t\t\t}
\t\t\treturn ta;
\t\t};'''

new = '''\t\tconst textAnimPayloadForPack = (packId: string) => {
\t\t\tconst pack = getPackRegistrySnapshot().packs.find((entry) => entry.id === packId);
\t\t\tif (!pack) return null;
\t\t\tconst ta = (pack.manifest.textAnim || null) as
\t\t\t\t| import("@/vfxpack/text-anim-motion").TextAnimPackPayload
\t\t\t\t| null;
\t\t\tif (!ta) return null;
\t\t\tconst manifestBg = (
\t\t\t\tpack.manifest as { background?: { type?: string; color?: string }; postProcess?: unknown }
\t\t\t).background;
\t\t\tlet out = ta;
\t\t\t// Prefer textAnim.postProcess; fall back to top-level manifest.postProcess.
\t\t\tif (!out.postProcess && pack.manifest.postProcess) {
\t\t\t\tout = { ...out, postProcess: pack.manifest.postProcess as typeof out.postProcess };
\t\t\t}
\t\t\tif (!out.background && manifestBg) {
\t\t\t\tout = { ...out, background: manifestBg };
\t\t\t}
\t\t\treturn out;
\t\t};'''

if old not in text:
    raise SystemExit("textAnimPayloadForPack not found exactly")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("OK payload merge background")

# bump sigRev for awareness (optional) + flowerWithChar
sb = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\scene-builder.ts")
sbt = sb.read_text(encoding="utf-8")
old_sig = "sigRev: 15, // fcc-tl-flower-15: prepend uFcc* at fragment top (char flower shader)"
new_sig = "sigRev: 16, // fcc-tl-flower-16: pack PP BeautyClear + NoToneMapping OutputPass"
if old_sig in sbt:
    sb.write_text(sbt.replace(old_sig, new_sig, 1), encoding="utf-8")
    print("OK sigRev 16")
else:
    print("sigRev skip", [line for line in sbt.splitlines() if "sigRev:" in line][:3])

rt = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\textanim\TextAnimRuntime.js")
rtt = rt.read_text(encoding="utf-8")
# no need to bump flowerWithChar for bloom - skip

# Verify composer still has no ACES force
ct = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\postprocess\composer.ts").read_text(encoding="utf-8")
if "ACESFilmicToneMapping" in ct and "Never force ACESFilmic" not in ct:
    # check if still forcing
    if "? THREE.ACESFilmicToneMapping" in ct:
        raise SystemExit("ACES force still present")
print("ACES force gone:", "? THREE.ACESFilmicToneMapping" not in ct)
print("has Never force comment:", "Never force ACESFilmic" in ct)
