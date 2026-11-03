from pathlib import Path
path = Path(r"freefilmcut/apps/web/src/vfxpack/text-layer-aabb.ts")
text = path.read_text(encoding="utf-8")
old = """\troot.traverse((obj) => {
\t\tif (!isFccTroikaTextMesh(obj)) return;
\t\tif (!obj.visible) return;
"""
new = """\troot.traverse((obj) => {
\t\tconst mesh = obj as THREE.Mesh & {
\t\t\ttextRenderInfo?: { visibleBounds?: number[]; blockBounds?: number[] };
\t\t};
\t\tconst named = isFccTroikaTextMesh(obj);
\t\tconst hasInfo = !!(mesh as { textRenderInfo?: unknown }).textRenderInfo;
\t\tif (!named && !hasInfo) return;
\t\tif (!obj.visible) return;
"""
if old not in text:
    raise SystemExit("traverse start missing")
text = text.replace(old, new, 1)
# remove duplicate `const mesh = obj as THREE.Mesh` later in block
old2 = """\t\tconst mesh = obj as THREE.Mesh;
\t\tconst geom = mesh.geometry;
"""
new2 = """\t\tconst geom = mesh.geometry;
"""
if old2 not in text:
    raise SystemExit("mesh const missing")
text = text.replace(old2, new2, 1)
# simplify textRenderInfo cast already on mesh
old3 = """\t\tconst info = (
\t\t\tmesh as THREE.Mesh & {
\t\t\t\ttextRenderInfo?: { visibleBounds?: number[]; blockBounds?: number[] };
\t\t\t}
\t\t).textRenderInfo;
"""
new3 = """\t\tconst info = mesh.textRenderInfo;
"""
if old3 not in text:
    raise SystemExit("info cast missing")
text = text.replace(old3, new3, 1)
path.write_text(text, encoding="utf-8")
print("aabb collect widened")
