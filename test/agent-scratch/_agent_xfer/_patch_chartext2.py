from pathlib import Path

# Force char-preview rebuild after glyph-text fix
p = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\textanim\TextAnimRuntime.js")
t = p.read_text(encoding="utf-8")
old = "\t\tflowerWithChar: 1,"
new = "\t\tflowerWithChar: 2, // rebuild after charUI.text fix (was painting full parent string)"
if old not in t:
    raise SystemExit("flowerWithChar not found")
p.write_text(t.replace(old, new, 1), encoding="utf-8")
print("OK TextAnimRuntime buildSig bump")

# Defense: applyTroikaTextMeshLayers must not re-enable layers on parked originals
u = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\ui-overlay.ts")
ut = u.read_text(encoding="utf-8")
old_fn = '''export function applyTroikaTextMeshLayers(
\troot: THREE.Object3D,
\tmode: FccUIRenderMode | string = RENDER_MODE_OVERLAY,
) {
\tconst layer = mode === RENDER_MODE_CAMERA ? UI_CAMERA_LAYER : UI_LAYER;
\troot.traverse((child) => {
\t\tif (!isFccTroikaTextMesh(child)) return;
\t\tchild.layers.set(layer);
\t\tchild.frustumCulled = false;
\t\tmarkMeshFlags(child, mode);
\t});
}'''
new_fn = '''export function applyTroikaTextMeshLayers(
\troot: THREE.Object3D,
\tmode: FccUIRenderMode | string = RENDER_MODE_OVERLAY,
) {
\tconst layer = mode === RENDER_MODE_CAMERA ? UI_CAMERA_LAYER : UI_LAYER;
\tconst hideOrig = !!(root.userData as { __fccTextAnimHideOriginals?: boolean })
\t\t?.__fccTextAnimHideOriginals;
\troot.traverse((child) => {
\t\tif (!isFccTroikaTextMesh(child)) return;
\t\t// Skip parked / hidden originals while char-split owns drawing.
\t\tlet p: THREE.Object3D | null = child.parent;
\t\twhile (p && p !== root) {
\t\t\tif (p.name === "__fccTextAnimPark") return;
\t\t\tp = p.parent;
\t\t}
\t\tif (
\t\t\thideOrig &&
\t\t\tchild.parent === root &&
\t\t\t(child.name === "__fccText" ||
\t\t\t\tchild.name === "__fccTextShadow" ||
\t\t\t\tchild.name.startsWith("__fccFlower_"))
\t\t) {
\t\t\tchild.visible = false;
\t\t\tchild.layers.disableAll();
\t\t\treturn;
\t\t}
\t\tchild.layers.set(layer);
\t\tchild.frustumCulled = false;
\t\tmarkMeshFlags(child, mode);
\t});
}'''
if old_fn not in ut:
    raise SystemExit("applyTroikaTextMeshLayers not found exactly")
u.write_text(ut.replace(old_fn, new_fn, 1), encoding="utf-8")
print("OK ui-overlay applyTroikaTextMeshLayers park-safe")
