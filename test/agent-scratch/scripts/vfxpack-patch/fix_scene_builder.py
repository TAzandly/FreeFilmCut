from pathlib import Path
p = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\scene-builder.ts")
text = p.read_text(encoding="utf-8")

# Fix BuiltPackScene type if missing toneMapping
if "export type BuiltPackScene" in text and "toneMapping?: number" not in text.split("export async function buildPackScene")[0]:
    old = """export type BuiltPackScene = {
	packId: string;
	root: THREE.Scene;
	camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
	disposables: Array<{ dispose: () => void }>;
};"""
    new = """export type BuiltPackScene = {
	packId: string;
	root: THREE.Scene;
	camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
	disposables: Array<{ dispose: () => void }>;
	render?: {
		toneMapping?: number;
		toneMappingExposure?: number;
		shadows?: boolean;
		shadowType?: number;
		antialias?: boolean;
	};
};"""
    if old in text:
        text = text.replace(old, new, 1)
        print("fixed BuiltPackScene type")
    else:
        # show current
        i = text.find("export type BuiltPackScene")
        print("TYPE BLOCK:", repr(text[i:i+250]))
        raise SystemExit("could not patch type")

# Insert await call before Default lights if missing
if "await applySceneRenderSettings" not in text:
    marker = "\t// Default lights"
    idx = text.find(marker)
    if idx < 0:
        idx = text.find("const ambient = new THREE.AmbientLight")
        if idx < 0:
            raise SystemExit("cannot find insert point")
        idx = text.rfind("\n", 0, idx) + 1
    call = "\tawait applySceneRenderSettings({ root, sceneFile, loadTexture });\n\n"
    text = text[:idx] + call + text[idx:]
    print("inserted await applySceneRenderSettings")
else:
    print("await already present")

p.write_text(text, encoding="utf-8")
# verify
text = p.read_text(encoding="utf-8")
print("await count", text.count("await applySceneRenderSettings"))
print("tone in type", "toneMapping?: number" in text.split("export async function buildPackScene")[0])
