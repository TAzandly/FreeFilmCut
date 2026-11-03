# -*- coding: utf-8 -*-
"""Patch OpenCut scene-builder.ts Face RT mask + bump editor cache versions."""
from pathlib import Path
import re

SB = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\scene-builder.ts")
text = SB.read_text(encoding="utf-8")

start = text.find("\t\t\t\tconst applyInnerShadowFaceMask = (")
if start < 0:
    raise SystemExit("applyInnerShadowFaceMask not found in scene-builder")

end = text.find("\t\t\t\tconst applyPass = (", start)
if end < 0:
    raise SystemExit("applyPass not found after mask")

NEW = r'''				const FCC_FACE_MASK_LAYER = 31;
				let capturingFaceMask = false;
				const maskSize = new THREE.Vector2();
				const maskViewport = new THREE.Vector4();
				const maskScissor = new THREE.Vector4();
				const maskClearColor = new THREE.Color();
				let emptyFaceMaskTex: THREE.DataTexture | null = null;

				const getEmptyFaceMaskTexture = () => {
					if (emptyFaceMaskTex) return emptyFaceMaskTex;
					const data = new Uint8Array([0, 0, 0, 0]);
					emptyFaceMaskTex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
					emptyFaceMaskTex.needsUpdate = true;
					disposables.push(emptyFaceMaskTex);
					return emptyFaceMaskTex;
				};

				const disposeFaceMaskRT = () => {
					const ud = group.userData as {
						__fccFaceMaskRT?: THREE.WebGLRenderTarget;
						__fccFaceMaskFrameId?: number;
					};
					if (ud.__fccFaceMaskRT) {
						try {
							ud.__fccFaceMaskRT.dispose();
						} catch {
							/* ignore */
						}
						delete ud.__fccFaceMaskRT;
					}
					delete ud.__fccFaceMaskFrameId;
				};
				disposables.push({ dispose: disposeFaceMaskRT });

				const captureFaceMaskToRT = (
					renderer: THREE.WebGLRenderer,
					scene: THREE.Scene,
					camera: THREE.Camera,
					faceMesh: THREE.Object3D,
				) => {
					if (capturingFaceMask || !renderer || !faceMesh) return null;
					capturingFaceMask = true;
					try {
						const currentRT = renderer.getRenderTarget();
						if (currentRT) {
							maskSize.set(currentRT.width, currentRT.height);
						} else {
							renderer.getDrawingBufferSize(maskSize);
						}
						const w = Math.max(1, Math.floor(maskSize.x));
						const h = Math.max(1, Math.floor(maskSize.y));
						const ud = group.userData as {
							__fccFaceMaskRT?: THREE.WebGLRenderTarget;
						};
						let maskRT = ud.__fccFaceMaskRT;
						if (!maskRT || maskRT.width !== w || maskRT.height !== h) {
							if (maskRT) {
								try {
									maskRT.dispose();
								} catch {
									/* ignore */
								}
							}
							maskRT = new THREE.WebGLRenderTarget(w, h, {
								format: THREE.RGBAFormat,
								type: THREE.UnsignedByteType,
								minFilter: THREE.NearestFilter,
								magFilter: THREE.NearestFilter,
								depthBuffer: true,
								stencilBuffer: false,
							});
							maskRT.texture.generateMipmaps = false;
							ud.__fccFaceMaskRT = maskRT;
						}
						renderer.getViewport(maskViewport);
						renderer.getScissor(maskScissor);
						const prevScissorTest = renderer.getScissorTest();
						const prevAutoClear = renderer.autoClear;
						const prevClearAlpha = renderer.getClearAlpha();
						renderer.getClearColor(maskClearColor);
						const prevFaceLayers = faceMesh.layers.mask;
						const prevCamLayers = camera.layers.mask;
						faceMesh.layers.set(FCC_FACE_MASK_LAYER);
						camera.layers.set(FCC_FACE_MASK_LAYER);
						renderer.setRenderTarget(maskRT);
						renderer.setScissorTest(false);
						renderer.setViewport(0, 0, w, h);
						renderer.autoClear = false;
						renderer.setClearColor(0x000000, 0);
						renderer.clear(true, true, true);
						renderer.setViewport(
							maskViewport.x,
							maskViewport.y,
							maskViewport.z,
							maskViewport.w,
						);
						renderer.setScissor(
							maskScissor.x,
							maskScissor.y,
							maskScissor.z,
							maskScissor.w,
						);
						renderer.setScissorTest(prevScissorTest);
						renderer.render(scene, camera);
						faceMesh.layers.mask = prevFaceLayers;
						camera.layers.mask = prevCamLayers;
						renderer.setRenderTarget(currentRT);
						renderer.setViewport(
							maskViewport.x,
							maskViewport.y,
							maskViewport.z,
							maskViewport.w,
						);
						renderer.setScissor(
							maskScissor.x,
							maskScissor.y,
							maskScissor.z,
							maskScissor.w,
						);
						renderer.setScissorTest(prevScissorTest);
						renderer.autoClear = prevAutoClear;
						renderer.setClearColor(maskClearColor, prevClearAlpha);
						return maskRT;
					} catch (e) {
						console.warn("[FreeFilmCut] OpenCut face mask RT capture failed", e);
						return null;
					} finally {
						capturingFaceMask = false;
					}
				};

				const syncFaceMaskUniforms = (
					uniforms: {
						uFccFaceMask: { value: THREE.Texture };
						uFccFaceMaskSize: { value: THREE.Vector2 };
						uFccFaceMaskOn: { value: number };
					},
					maskRT: THREE.WebGLRenderTarget | null,
				) => {
					if (maskRT?.texture) {
						uniforms.uFccFaceMask.value = maskRT.texture;
						uniforms.uFccFaceMaskSize.value.set(maskRT.width, maskRT.height);
						uniforms.uFccFaceMaskOn.value = 1;
					} else {
						uniforms.uFccFaceMask.value = getEmptyFaceMaskTexture();
						uniforms.uFccFaceMaskSize.value.set(1, 1);
						uniforms.uFccFaceMaskOn.value = 0;
					}
				};

				const applyInnerShadowFaceMask = (
					troika: InstanceType<typeof TroikaText>,
				) => {
					troika.userData = {
						...(troika.userData || {}),
						fccHadInnerMask: true,
					};
					let baseMat = troika.material as
						| THREE.Material
						| THREE.Material[]
						| null;
					if (Array.isArray(baseMat)) {
						baseMat = baseMat.length ? baseMat[baseMat.length - 1] : null;
					}
					const faceMat = baseMat as
						| (THREE.Material & {
								isTroikaTextMaterial?: boolean;
								userData: Record<string, unknown>;
						  })
						| null;
					if (!faceMat || !faceMat.isTroikaTextMaterial) {
						tuneMaterial(troika);
						return;
					}
					const ud = faceMat.userData as {
						fccFaceMaskRT?: boolean;
						fccFaceMaskUniforms?: {
							uFccFaceMask: { value: THREE.Texture };
							uFccFaceMaskSize: { value: THREE.Vector2 };
							uFccFaceMaskOn: { value: number };
						};
						fccGradientMat?: boolean;
						fccGradUv?: boolean;
						fccGradientUniforms?: unknown;
						fccTextureMat?: boolean;
						fccTextureUniforms?: unknown;
					};
					const uniforms =
						ud.fccFaceMaskUniforms ||
						({
							uFccFaceMask: { value: getEmptyFaceMaskTexture() },
							uFccFaceMaskSize: { value: new THREE.Vector2(1, 1) },
							uFccFaceMaskOn: { value: 1 },
						} as {
							uFccFaceMask: { value: THREE.Texture };
							uFccFaceMaskSize: { value: THREE.Vector2 };
							uFccFaceMaskOn: { value: number };
						});

					if (!ud.fccFaceMaskRT) {
						try {
							const derived = createDerivedMaterial(faceMat, {
								chained: true,
								uniforms,
								fragmentDefs: `
uniform sampler2D uFccFaceMask;
uniform vec2 uFccFaceMaskSize;
uniform float uFccFaceMaskOn;
`,
								fragmentColorTransform: `
if (uFccFaceMaskOn > 0.5) {
  vec2 mu = gl_FragCoord.xy / max(uFccFaceMaskSize, vec2(1.0));
  float faceA = texture2D(uFccFaceMask, mu).a;
  gl_FragColor.a *= faceA;
  if (gl_FragColor.a < 0.001) discard;
}
`,
							}) as THREE.Material & {
								userData: Record<string, unknown>;
								transparent: boolean;
								depthWrite: boolean;
								toneMapped: boolean;
								depthTest: boolean;
							};
							derived.userData = derived.userData || {};
							derived.userData.fccFaceMaskRT = true;
							derived.userData.fccFaceMaskUniforms = uniforms;
							if (ud.fccGradientMat) derived.userData.fccGradientMat = true;
							if (ud.fccGradUv) derived.userData.fccGradUv = true;
							if (ud.fccGradientUniforms)
								derived.userData.fccGradientUniforms = ud.fccGradientUniforms;
							if (ud.fccTextureMat) derived.userData.fccTextureMat = true;
							if (ud.fccTextureUniforms)
								derived.userData.fccTextureUniforms = ud.fccTextureUniforms;
							derived.transparent = true;
							derived.depthWrite = false;
							derived.toneMapped = false;
							derived.depthTest = false;
							Object.defineProperty(derived, "isTroikaTextMaterial", {
								value: true,
							});
							troika.material = derived as typeof troika.material;
						} catch (e) {
							console.warn(
								"[FreeFilmCut] OpenCut inner-shadow face mask RT wrap failed",
								e,
							);
						}
					} else {
						syncFaceMaskUniforms(
							uniforms,
							(group.userData as { __fccFaceMaskRT?: THREE.WebGLRenderTarget })
								.__fccFaceMaskRT ?? null,
						);
					}

					troika.onBeforeRender = (
						renderer: THREE.WebGLRenderer,
						scene: THREE.Scene,
						camera: THREE.Camera,
					) => {
						if (capturingFaceMask) return;
						const faceMesh = group.getObjectByName(FCC_FLOWER_FACE);
						if (!faceMesh) return;
						const gud = group.userData as {
							__fccFaceMaskRT?: THREE.WebGLRenderTarget;
							__fccFaceMaskFrameId?: number;
						};
						const frameId = renderer?.info?.render?.frame ?? -1;
						let maskRT = gud.__fccFaceMaskRT;
						if (frameId < 0 || gud.__fccFaceMaskFrameId !== frameId || !maskRT) {
							maskRT =
								captureFaceMaskToRT(renderer, scene, camera, faceMesh) ??
								undefined;
							gud.__fccFaceMaskFrameId = frameId;
						}
						syncFaceMaskUniforms(uniforms, maskRT ?? null);
						const mats = troika.material
							? Array.isArray(troika.material)
								? troika.material
								: [troika.material]
							: [];
						for (const m of mats) {
							const mu = (
								m as THREE.Material & {
									userData?: {
										fccFaceMaskUniforms?: typeof uniforms;
									};
								}
							)?.userData?.fccFaceMaskUniforms;
							if (mu) syncFaceMaskUniforms(mu, maskRT ?? null);
						}
					};

					tuneMaterial(troika);
				};

'''

text = text[:start] + NEW + text[end:]

# Update call site
text = text.replace(
    "applyInnerShadowFaceMask(m, ox, oy);",
    "applyInnerShadowFaceMask(m);",
)
text = text.replace(
    "innerFaceMask: 1,",
    "innerFaceMask: 2, // fcc-ui-67 Face RT mask",
)

SB.write_text(text, encoding="utf-8")
print("scene-builder patched, len", len(text))
assert "uFccFaceMask" in text
assert "applyInnerShadowFaceMask(m);" in text
assert "troikaGlyphUvToDistance" not in text
print("scene-builder sanity OK")

# Bump editor import cache versions to fcc-ui-67
files = [
    Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Editor.js"),
    Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Menubar.File.js"),
    Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.UI.js"),
    Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\UIFactory.js"),
    Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\UIRectLayout.js"),
    Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\index.html"),
]
for f in files:
    t = f.read_text(encoding="utf-8")
    t2 = t.replace("UIText.js?v=fcc-ui-66", "UIText.js?v=fcc-ui-67")
    # also bump Editor/Sidebar entry in index if present
    if f.name == "index.html":
        t2 = t2.replace("Editor.js?v=fcc-ui-66", "Editor.js?v=fcc-ui-67")
        t2 = t2.replace("Sidebar.js?v=fcc-ui-66", "Sidebar.js?v=fcc-ui-67")
    if t2 != t:
        f.write_text(t2, encoding="utf-8")
        print("bumped", f.name)
    else:
        print("no change", f.name)

print("done")
