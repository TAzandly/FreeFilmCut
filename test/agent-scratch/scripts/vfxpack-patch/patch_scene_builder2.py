# -*- coding: utf-8 -*-
from pathlib import Path

SCENE_BUILDER = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\scene-builder.ts")
text = SCENE_BUILDER.read_text(encoding="utf-8")

old_shader = """\t\tconst vertUrl = pack.objectUrls.get(shaderPaths.vertex);
\t\tconst fragUrl = pack.objectUrls.get(shaderPaths.fragment);
\t\tif (vertUrl && fragUrl) {
\t\t\tconst [vertexShader, fragmentShader] = await Promise.all([
\t\t\t\tfetch(vertUrl).then((r) => r.text()),
\t\t\t\tfetch(fragUrl).then((r) => r.text()),
\t\t\t]);"""
new_shader = """\t\tconst vertexShader = await readPackText(pack, shaderPaths.vertex);
\t\tconst fragmentShader = await readPackText(pack, shaderPaths.fragment);
\t\tif (vertexShader && fragmentShader) {"""

if "function readPackText" not in text:
    if old_shader not in text:
        raise SystemExit("shader block still not found")
    text = text.replace(old_shader, new_shader, 1)
    print("patched shader load")
else:
    print("shader already patched")

helper = r'''
async function readPackText(
	pack: LoadedVfxPack,
	relPath: string | undefined,
): Promise<string | null> {
	if (!relPath) return null;
	const url = pack.objectUrls.get(relPath);
	if (url) {
		try {
			return await fetch(url).then((r) => r.text());
		} catch {
			/* fall through */
		}
	}
	const bytes = pack.files.get(relPath);
	if (!bytes) return null;
	return new TextDecoder("utf-8").decode(bytes);
}

async function applySceneRenderSettings({
	root,
	sceneFile,
	loadTexture,
}: {
	root: THREE.Scene;
	sceneFile: NonNullable<LoadedVfxPack["scene"]>;
	loadTexture: (rel: string) => Promise<THREE.Texture | null>;
}) {
	const bg = sceneFile.background as
		| {
				type?: string;
				color?: string;
				path?: string | null;
				blurriness?: number;
				intensity?: number;
		  }
		| string
		| null
		| undefined;

	if (typeof bg === "string") {
		root.background = new THREE.Color(bg);
	} else if (bg && typeof bg === "object") {
		if (bg.type === "Color" && bg.color) {
			root.background = new THREE.Color(bg.color);
		} else if (
			(bg.type === "Texture" || bg.type === "Equirectangular") &&
			bg.path
		) {
			const tex = await loadTexture(bg.path);
			if (tex) {
				if (bg.type === "Equirectangular") {
					tex.mapping = THREE.EquirectangularReflectionMapping;
				}
				root.background = tex;
			}
		} else if (bg.type === "None") {
			root.background = null;
		}
		if (typeof bg.blurriness === "number") {
			root.backgroundBlurriness = bg.blurriness;
		}
		if (typeof bg.intensity === "number") {
			root.backgroundIntensity = bg.intensity;
		}
	}

	const env = sceneFile.environment as
		| { type?: string; path?: string | null; intensity?: number }
		| null
		| undefined;
	if (env && env.type === "Equirectangular" && env.path) {
		const tex = await loadTexture(env.path);
		if (tex) {
			tex.mapping = THREE.EquirectangularReflectionMapping;
			root.environment = tex;
		}
		if (typeof env.intensity === "number") {
			(
				root as THREE.Scene & { environmentIntensity?: number }
			).environmentIntensity = env.intensity;
		}
	} else if (env && env.type === "None") {
		root.environment = null;
	}

	const fog = sceneFile.fog;
	if (fog && fog.type === "Fog") {
		root.fog = new THREE.Fog(
			fog.color ?? "#000000",
			fog.near ?? 1,
			fog.far ?? 1000,
		);
	} else if (fog && fog.type === "FogExp2") {
		root.fog = new THREE.FogExp2(
			fog.color ?? "#000000",
			fog.density ?? 0.00025,
		);
	}
}

'''
if "function readPackText" not in text:
    insert_at = text.find("function createGeometry")
    if insert_at < 0:
        raise SystemExit("createGeometry not found")
    text = text[:insert_at] + helper + text[insert_at:]
    print("inserted helpers")

if "applySceneRenderSettings({" not in text:
    idx = text.find("new THREE.AmbientLight")
    if idx < 0:
        raise SystemExit("AmbientLight not found")
    idx = text.rfind("\n", 0, idx) + 1
    # include any comment line above AmbientLight
    prev = text.rfind("\n", 0, idx - 1)
    line_before = text[prev+1:idx]
    if "Default lights" in line_before or "lights" in line_before.lower():
        idx = prev + 1
    call = "\tawait applySceneRenderSettings({ root, sceneFile, loadTexture });\n\n"
    text = text[:idx] + call + text[idx:]
    print("inserted apply call")
else:
    print("apply call already present")

old_ret = """\treturn {
\t\tpackId: pack.id,
\t\troot,
\t\tcamera,
\t\tdisposables,
\t};
}"""
new_ret = """\treturn {
\t\tpackId: pack.id,
\t\troot,
\t\tcamera,
\t\tdisposables,
\t\trender: sceneFile.render
\t\t\t? {
\t\t\t\t\ttoneMapping: sceneFile.render.toneMapping,
\t\t\t\t\ttoneMappingExposure: sceneFile.render.toneMappingExposure,
\t\t\t\t\tshadows: sceneFile.render.shadows,
\t\t\t\t\tshadowType: sceneFile.render.shadowType,
\t\t\t\t\tantialias: sceneFile.render.antialias,
\t\t\t  }
\t\t\t: undefined,
\t};
}"""
if "render: sceneFile.render" not in text:
    if old_ret not in text:
        raise SystemExit("return not found")
    text = text.replace(old_ret, new_ret, 1)
    print("patched return")
else:
    print("return already patched")

SCENE_BUILDER.write_text(text, encoding="utf-8")
print("OK", SCENE_BUILDER.stat().st_size)
