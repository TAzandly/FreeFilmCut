from pathlib import Path
import re

def write(path, text):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)

# 1) scene-builder.ts
p = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\scene-builder.ts")
text = p.read_text(encoding="utf-8")
old = """\t\tconst sceneUuids = new Set<string>();
\t\troot.traverse((o) => {
\t\t\tif (o.uuid) sceneUuids.add(o.uuid);
\t\t});
\t\tlet matched = 0;
\t\tlet missing = 0;
\t\tfor (const clip of animClips) {
\t\t\tfor (const t of clip.targets || []) {
\t\t\t\tif (sceneUuids.has(t.objectUuid)) matched++;
\t\t\t\telse missing++;
\t\t\t}
\t\t}
\t\tconsole.info(
\t\t\t`[FreeFilmCut] pack anims loaded=${animClips.length} targets matched=${matched} missing=${missing}`,
\t\t);
"""
if old in text:
    text = text.replace(old, "", 1)
    write(p, text)
    print("scene-builder: removed pack anims log block")
else:
    idx = text.find("pack anims loaded")
    print("scene-builder miss", idx)
    print(repr(text[idx - 350 : idx + 180]) if idx >= 0 else "not found")

# 2) freecapcut-anim.ts
p2 = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\freecapcut-anim.ts")
t2 = p2.read_text(encoding="utf-8")
t2, n_decl = re.subn(r"let _animLogLastMs\s*=\s*0;\s*\n", "", t2, count=1)
print("removed _animLogLastMs decl", n_decl)
# also drop samplePosY if only used for logging - check later
old2 = """\tconst now = typeof performance !== \"undefined\" ? performance.now() : Date.now();
\tif (now - _animLogLastMs > 1000) {
\t\t_animLogLastMs = now;
\t\tconsole.info(
\t\t\t`[FreeFilmCut anim] clipLocalTime=${t.toFixed(4)}s sampleT=${tc.toFixed(4)}s applied=${n}` +
\t\t\t\t(samplePosY === null ? \"\" : ` position.y=${samplePosY.toFixed(4)}`),
\t\t);
\t}
\treturn n;
"""
if old2 in t2:
    t2 = t2.replace(old2, "\treturn n;\n", 1)
    print("freecapcut-anim: removed playback log")
else:
    idx = t2.find("[FreeFilmCut anim]")
    print("anim miss", idx)
    print(repr(t2[idx - 250 : idx + 200]) if idx >= 0 else "missing")
write(p2, t2)

# 3) three-compositor
p3 = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\services\renderer\compositor\three-compositor.ts")
t3 = p3.read_text(encoding="utf-8")
old3 = """\t\t\t// Mesh-UV path: snapshot full below stack, bind uInput, keep composite under the mesh.
\t\t\t// Re-arm a few debug logs when multiple below layers are present
\t\t\tif (layersBelowCount >= 2 && this.belowDebugFrames > 8) {
\t\t\t\tthis.belowDebugFrames = 0;
\t\t\t}
\t\t\tif (this.belowDebugFrames <= 5) {
\t\t\t\tconsole.info(\"[FreeFilmCut uInput] snapshot before bind\", {
\t\t\t\t\tpackId,
\t\t\t\t\tlayersBelowCount,
\t\t\t\t\taccumSize: `${accumRT.width}x${accumRT.height}`,
\t\t\t\t});
\t\t\t}
\t\t\tconst belowTex = this.snapshotBelowSource();
\t\t\tif (belowTex) {
\t\t\t\tthis.bindBelowInputTexture({ built, texture: belowTex });
\t\t\t\tif (this.belowDebugFrames <= 3) {
\t\t\t\t\tconsole.info(\"[FreeFilmCut uInput] bound\", {
\t\t\t\t\t\tpackId,
\t\t\t\t\t\tlayersBelowCount,
\t\t\t\t\t\tnames: built.belowInputUniformNames,
\t\t\t\t\t\tneedsBelow: built.needsBelowInput,
\t\t\t\t\t\ttexType: belowTex.constructor?.name,
\t\t\t\t\t});
\t\t\t\t}
\t\t\t} else {
\t\t\t\tconsole.warn(\"[FreeFilmCut] below snapshot empty for\", packId);
\t\t\t}
"""
new3 = """\t\t\t// Mesh-UV path: snapshot full below stack, bind uInput, keep composite under the mesh.
\t\t\tconst belowTex = this.snapshotBelowSource();
\t\t\tif (belowTex) {
\t\t\t\tthis.bindBelowInputTexture({ built, texture: belowTex });
\t\t\t}
"""
if old3 in t3:
    t3 = t3.replace(old3, new3, 1)
    print("three-compositor: removed uInput info spam")
else:
    idx = t3.find("snapshot before bind")
    print("uInput miss", idx)
    print(repr(t3[idx - 200 : idx + 550]) if idx >= 0 else "missing")

pat = re.compile(
    r"private debugBelowPixels\(tex: THREE\.Texture, tag: string\) \{.*?\n\t\}",
    re.S,
)
m = pat.search(t3)
if m:
    t3 = (
        t3[: m.start()]
        + "private debugBelowPixels(_tex: THREE.Texture, _tag: string) {\n\t\t// silenced: was spamming console during playback\n\t}"
        + t3[m.end() :]
    )
    print("debugBelowPixels no-op")
else:
    print("debugBelowPixels pattern miss")

write(p3, t3)

for path, needle in [
    (p, "pack anims loaded"),
    (p2, "[FreeFilmCut anim]"),
    (p3, "snapshot before bind"),
]:
    body = path.read_text(encoding="utf-8")
    print(path.name, needle, "STILL PRESENT" if needle in body else "gone")
