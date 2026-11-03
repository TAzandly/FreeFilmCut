# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut")
TYPES = ROOT / "freefilmcut" / "apps" / "web" / "src" / "vfxpack" / "types.ts"
LOAD_PACK = ROOT / "freefilmcut" / "apps" / "web" / "src" / "vfxpack" / "load-pack.ts"
COMPOSITOR = ROOT / "freefilmcut" / "apps" / "web" / "src" / "services" / "renderer" / "compositor" / "three-compositor.ts"

def patch_types():
    text = TYPES.read_text(encoding="utf-8")
    if "VfxPackRenderSettings" in text:
        print("types already patched")
        return
    old = """export interface VfxSceneFile {
	schema: string;
	name?: string;
	background?: unknown;
	activeCamera?: string | null;
	nodes: VfxSceneNode[];
	assets?: {
		textures?: Array<{ uuid: string; path: string; name?: string }>;
	};
}"""
    new = """export interface VfxPackRenderSettings {
	rendererType?: string;
	cameraType?: string;
	antialias?: boolean;
	shadows?: boolean;
	shadowType?: number;
	toneMapping?: number;
	toneMappingName?: string;
	toneMappingExposure?: number;
}

export interface VfxSceneBackground {
	type: string;
	color?: string;
	path?: string | null;
	uuid?: string;
	blurriness?: number;
	intensity?: number;
	rotation?: number[];
	exported?: boolean;
	colorSpace?: string;
	flipY?: boolean;
	value?: null;
	note?: string;
}

export interface VfxSceneEnvironment {
	type: string;
	path?: string | null;
	uuid?: string;
	intensity?: number;
	rotation?: number[];
	exported?: boolean;
	colorSpace?: string;
	value?: null;
	note?: string;
}

export interface VfxSceneFog {
	type: string;
	color?: string;
	near?: number;
	far?: number;
	density?: number;
}

export interface VfxSceneFile {
	schema: string;
	name?: string;
	background?: VfxSceneBackground | string | null | unknown;
	environment?: VfxSceneEnvironment | null;
	fog?: VfxSceneFog | null;
	render?: VfxPackRenderSettings;
	activeCamera?: string | null;
	nodes: VfxSceneNode[];
	assets?: {
		textures?: Array<{ uuid: string; path: string; name?: string }>;
		shaders?: Array<{
			name?: string;
			vertex?: string;
			fragment?: string;
			raw?: boolean;
		}>;
	};
	resolution?: { width: number; height: number };
}"""
    if old not in text:
        raise SystemExit("VfxSceneFile block not found")
    text = text.replace(old, new, 1)
    # Add render to VfxManifest (forward ref OK for interfaces)
    man_chunk = text.split("export interface VfxManifest")[1].split("export interface")[0]
    if "render?:" not in man_chunk:
        text = text.replace(
            "\tresolution?: { width: number; height: number };\n}\n\nexport interface VfxSceneNodeTransform",
            "\tresolution?: { width: number; height: number };\n\trender?: VfxPackRenderSettings;\n}\n\nexport interface VfxSceneNodeTransform",
            1,
        )
    TYPES.write_text(text, encoding="utf-8")
    print("patched types")

def patch_load_pack():
    text = LOAD_PACK.read_text(encoding="utf-8")
    if "isShader" in text:
        print("load-pack already patched")
        return
    old = """\tconst objectUrls = new Map<string, string>();
\tfor (const [path, bytes] of files) {
\t\tif (!/\\.(png|jpe?g|webp|gif|bmp)$/i.test(path)) continue;
\t\tconst copy = bytes.slice();
\t\tconst blob = new Blob([copy], { type: guessImageMime(path) });
\t\tobjectUrls.set(path, URL.createObjectURL(blob));
\t}"""
    new = """\tconst objectUrls = new Map<string, string>();
\tfor (const [path, bytes] of files) {
\t\tconst lower = path.toLowerCase();
\t\tconst isImage = /\\.(png|jpe?g|webp|gif|bmp)$/i.test(lower);
\t\tconst isShader =
\t\t\t/\\.(glsl|vert|frag|vs|fs)$/i.test(lower) ||
\t\t\tlower.includes(".vert.") ||
\t\t\tlower.includes(".frag.");
\t\tif (!isImage && !isShader) continue;
\t\tconst copy = bytes.slice();
\t\tconst blob = new Blob([copy], {
\t\t\ttype: isImage ? guessImageMime(path) : "text/plain",
\t\t});
\t\tobjectUrls.set(path, URL.createObjectURL(blob));
\t}"""
    if old not in text:
        raise SystemExit("objectUrls loop not found")
    LOAD_PACK.write_text(text.replace(old, new, 1), encoding="utf-8")
    print("patched load-pack")

def patch_compositor():
    text = COMPOSITOR.read_text(encoding="utf-8")
    if "built.render?.toneMapping" in text:
        print("compositor already patched")
        return
    old = """\t\tif (clearFirst) {
\t\t\trenderer.autoClear = true;
\t\t} else {
\t\t\trenderer.autoClear = false;
\t\t\trenderer.clearDepth();
\t\t}
\t\trenderer.render(built.root, built.camera);
\t\trenderer.autoClear = false;
\t}"""
    new = """\t\tif (clearFirst) {
\t\t\trenderer.autoClear = true;
\t\t} else {
\t\t\trenderer.autoClear = false;
\t\t\trenderer.clearDepth();
\t\t}

\t\tconst prevTone = renderer.toneMapping;
\t\tconst prevExposure = renderer.toneMappingExposure;
\t\tif (built.render?.toneMapping !== undefined) {
\t\t\trenderer.toneMapping = built.render.toneMapping as THREE.ToneMapping;
\t\t}
\t\tif (built.render?.toneMappingExposure !== undefined) {
\t\t\trenderer.toneMappingExposure = built.render.toneMappingExposure;
\t\t}

\t\trenderer.render(built.root, built.camera);

\t\trenderer.toneMapping = prevTone;
\t\trenderer.toneMappingExposure = prevExposure;
\t\trenderer.autoClear = false;
\t}"""
    if old not in text:
        raise SystemExit("renderOnePack tail not found")
    COMPOSITOR.write_text(text.replace(old, new, 1), encoding="utf-8")
    print("patched compositor")

patch_types()
patch_load_pack()
patch_compositor()
print("phase2 ok")
