# -*- coding: utf-8 -*-
from pathlib import Path

sb_path = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\scene-builder.ts")
src = sb_path.read_text(encoding="utf-8")

# 1) imports
if "troika-three-utils" not in src:
    src = src.replace(
        'import { Text as TroikaText, configureTextBuilder } from "troika-three-text";',
        'import { Text as TroikaText, configureTextBuilder } from "troika-three-text";\n'
        'import { createDerivedMaterial } from "troika-three-utils";',
    )
if "flower-style" not in src:
    src = src.replace(
        '} from "@/vfxpack/ui-overlay";',
        '} from "@/vfxpack/ui-overlay";\n'
        'import {\n'
        '\tgetEffectiveFlowerStyle,\n'
        '\tnormalizeFillContent,\n'
        '\tcontentPrimaryColor,\n'
        '\tcontentUsesGradient,\n'
        '\thexToRgb01,\n'
        '\ttype FlowerStyle,\n'
        '} from "@/vfxpack/flower-style";',
    )

# 2) bump rev
src = src.replace(
    "export const PACK_SCENE_BUILD_REV = 10;",
    "export const PACK_SCENE_BUILD_REV = 11;",
)

# 3) add flowerStyle to fccUI construction
if "flowerStyle:" not in src.split("const fccUI: FccUIData")[1][:1200]:
    needle = """\t\t\t\tshadow: (fccFromNode.shadow ?? node.ui?.shadow ?? {
\t\t\t\t\tenabled: false,
\t\t\t\t\toffsetX: 2,
\t\t\t\t\toffsetY: -2,
\t\t\t\t\tblur: 4,
\t\t\t\t\tcolor: \"#000000\",
\t\t\t\t\topacity: 0.75,
\t\t\t\t}) as FccUIData[\"shadow\"],
\t\t\t};
"""
    repl = """\t\t\t\tshadow: (fccFromNode.shadow ?? node.ui?.shadow ?? {
\t\t\t\t\tenabled: false,
\t\t\t\t\toffsetX: 2,
\t\t\t\t\toffsetY: -2,
\t\t\t\t\tblur: 4,
\t\t\t\t\tcolor: \"#000000\",
\t\t\t\t\topacity: 0.75,
\t\t\t\t}) as FccUIData[\"shadow\"],
\t\t\t\tflowerStyle: (fccFromNode.flowerStyle ?? node.ui?.flowerStyle ?? null) as FccUIData[\"flowerStyle\"],
\t\t\t};
"""
    if needle not in src:
        raise SystemExit("fccUI shadow block not found")
    src = src.replace(needle, repl)

# 4) Replace entire text UI block
start_marker = '\t\t\tif (uiType === "text") {'
end_marker = '\t\t\t// Image: Group (fccUI + Euler) + __fccImageMesh (pixel size via scale).'
si = src.find(start_marker)
ei = src.find(end_marker)
if si < 0 or ei < 0:
    raise SystemExit("text block markers not found %s %s" % (si, ei))

new_text = r'''
			if (uiType === "text") {
				const group = new THREE.Group();
				group.userData = { ...(node.userData || {}), fccUI };
				const DEFAULT_FONT =
					"https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-sc@5.2.5/chinese-simplified-400-normal.woff";
				const FCC_FLOWER_PREFIX = "__fccFlower_";
				const FCC_FLOWER_FACE = "__fccFlower_face";

				const resolveFont = (fontPath: string): string => {
					if (!fontPath) return DEFAULT_FONT;
					if (
						fontPath.startsWith("http") ||
						fontPath.startsWith("blob:") ||
						fontPath.startsWith("data:")
					) {
						return fontPath;
					}
					const fromUrl = pack.objectUrls.get(fontPath);
					if (fromUrl) return fromUrl;
					const bytes = pack.files.get(fontPath);
					if (bytes) {
						const copy = bytes.slice();
						const blob = new Blob([copy], { type: "font/ttf" });
						const url = URL.createObjectURL(blob);
						pack.objectUrls.set(fontPath, url);
						return url;
					}
					return fontPath;
				};

				const tuneMaterial = (troika: InstanceType<typeof TroikaText>) => {
					const mats = troika.material
						? Array.isArray(troika.material)
							? troika.material
							: [troika.material]
						: [];
					for (const m of mats) {
						if (!m) continue;
						m.depthTest = false;
						m.depthWrite = false;
						m.toneMapped = false;
						m.transparent = true;
					}
				};

				const applyGradientMaterial = (
					troika: InstanceType<typeof TroikaText>,
					content: ReturnType<typeof normalizeFillContent>,
					opacity: number,
				) => {
					const g = content.gradient;
					const rgbA = hexToRgb01(g.colors[0]);
					const rgbB = hexToRgb01(g.colors[1]);
					troika.color = g.colors[0];
					troika.fillOpacity = opacity;
					const baseMat = troika.material as THREE.Material & {
						isTroikaTextMaterial?: boolean;
						userData: Record<string, unknown>;
					};
					if (!baseMat || !baseMat.isTroikaTextMaterial) {
						tuneMaterial(troika);
						return;
					}
					const prevU = baseMat.userData?.fccGradientUniforms as
						| {
								uFccGA: { value: THREE.Color };
								uFccGB: { value: THREE.Color };
								uFccGAngle: { value: number };
								uFccGStop0: { value: number };
								uFccGStop1: { value: number };
								uFccGUse: { value: number };
						  }
						| undefined;
					if (baseMat.userData?.fccGradientMat && prevU) {
						prevU.uFccGA.value.setRGB(rgbA[0], rgbA[1], rgbA[2]);
						prevU.uFccGB.value.setRGB(rgbB[0], rgbB[1], rgbB[2]);
						prevU.uFccGAngle.value = Number(g.angle) || 90;
						prevU.uFccGStop0.value = Number(g.stops[0]) || 0;
						prevU.uFccGStop1.value = Number(g.stops[1]) || 1;
						prevU.uFccGUse.value = 1;
						tuneMaterial(troika);
						return;
					}
					const uniforms = {
						uFccGA: { value: new THREE.Color().setRGB(rgbA[0], rgbA[1], rgbA[2]) },
						uFccGB: { value: new THREE.Color().setRGB(rgbB[0], rgbB[1], rgbB[2]) },
						uFccGAngle: { value: Number(g.angle) || 90 },
						uFccGStop0: { value: Number(g.stops[0]) || 0 },
						uFccGStop1: { value: Number(g.stops[1]) || 1 },
						uFccGUse: { value: 1 },
					};
					try {
						const derived = createDerivedMaterial(baseMat, {
							chained: true,
							uniforms,
							fragmentDefs: `
uniform vec3 uFccGA;
uniform vec3 uFccGB;
uniform float uFccGAngle;
uniform float uFccGStop0;
uniform float uFccGStop1;
uniform float uFccGUse;
`,
							fragmentColorTransform: `
if (uFccGUse > 0.5) {
  float rad = radians(uFccGAngle);
  vec2 dir = vec2(cos(rad), sin(rad));
  float t = dot(vUv - vec2(0.5), dir) + 0.5;
  t = (t - uFccGStop0) / max(uFccGStop1 - uFccGStop0, 1e-5);
  t = clamp(t, 0.0, 1.0);
  gl_FragColor.rgb = mix(uFccGA, uFccGB, t);
}
`,
						});
						derived.userData = derived.userData || {};
						derived.userData.fccGradientMat = true;
						derived.userData.fccGradientUniforms = uniforms;
						derived.transparent = true;
						derived.depthWrite = false;
						derived.toneMapped = false;
						derived.depthTest = false;
						troika.material = derived;
					} catch (e) {
						console.warn("[FreeFilmCut] OpenCut gradient material failed", e);
						tuneMaterial(troika);
					}
				};

				const applyContent = (
					troika: InstanceType<typeof TroikaText>,
					contentRaw: unknown,
					layerAlpha: number,
				) => {
					const c = normalizeFillContent(contentRaw);
					const solidA = c.solid.alpha != null ? Number(c.solid.alpha) : 1;
					const opacity = Math.max(
						0,
						Math.min(1, (Number(layerAlpha) || 1) * solidA),
					);
					if (c.renderType === "gradient") {
						applyGradientMaterial(troika, c, opacity);
						return;
					}
					troika.color = contentPrimaryColor(c);
					troika.fillOpacity = opacity;
					if (c.renderType === "texture") {
						troika.fillOpacity *=
							c.texture.alpha != null ? Number(c.texture.alpha) : 1;
					}
					tuneMaterial(troika);
				};

				const baseLayout = (
					troika: InstanceType<typeof TroikaText>,
					rectW: number,
				) => {
					const fontSize = Number(fccUI.fontSize) > 0 ? Number(fccUI.fontSize) : 48;
					const align = String(fccUI.align || "center");
					const vAlign = String(fccUI.verticalAlign || "middle");
					const fontUrl =
						fccUI.bold && fccUI.fontBold
							? resolveFont(String(fccUI.fontBold))
							: resolveFont(String(fccUI.font || ""));
					troika.font = fontUrl;
					troika.fontSize = fontSize;
					troika.anchorX =
						align === "left" ? "left" : align === "right" ? "right" : "center";
					troika.anchorY =
						vAlign === "top" ? "top" : vAlign === "bottom" ? "bottom" : "middle";
					troika.textAlign =
						align === "left" || align === "right" || align === "justify"
							? align
							: "center";
					troika.letterSpacing = Number(fccUI.letterSpacing) || 0;
					troika.lineHeight =
						Number(fccUI.lineHeight) > 0 ? Number(fccUI.lineHeight) : 1.2;
					troika.maxWidth = rectW > 0 ? rectW : Number(fccUI.sizeDelta?.[0]) || 400;
					troika.overflowWrap = "break-word";
					troika.frustumCulled = false;
					troika.text = String(fccUI.text ?? "");
					troika.outlineWidth = 0;
					troika.outlineOpacity = 0;
					troika.outlineBlur = 0;
					troika.outlineOffsetX = 0;
					troika.outlineOffsetY = 0;
					troika.position.set(0, 0, 0);
				};

				type Pass = {
					kind: "shadow" | "stroke" | "face" | "inner";
					name: string;
					layer: {
						alpha?: number;
						width?: number;
						offsetX?: number;
						offsetY?: number;
						diffuse?: number;
						content?: unknown;
					};
				};

				const buildPasses = (style: FlowerStyle): Pass[] => {
					const passes: Pass[] = [];
					const shadows = (style.shadows || []).filter((s) => s && s.enable);
					const strokes = (style.strokes || []).filter((s) => s && s.enable);
					const inners = (style.innerShadows || []).filter((s) => s && s.enable);
					shadows.forEach((s, i) =>
						passes.push({
							kind: "shadow",
							name: FCC_FLOWER_PREFIX + "shadow_" + i,
							layer: s,
						}),
					);
					strokes.forEach((s, i) =>
						passes.push({
							kind: "stroke",
							name: FCC_FLOWER_PREFIX + "stroke_" + i,
							layer: s,
						}),
					);
					inners.forEach((s, i) =>
						passes.push({
							kind: "inner",
							name: FCC_FLOWER_PREFIX + "inner_" + i,
							layer: s,
						}),
					);
					passes.push({
						kind: "face",
						name: FCC_FLOWER_FACE,
						layer: style.fill,
					});
					return passes;
				};

				const applyPass = (
					troika: InstanceType<typeof TroikaText>,
					pass: Pass,
					rectW: number,
					z: number,
				) => {
					baseLayout(troika, rectW);
					troika.position.set(0, 0, z);
					if (pass.kind === "shadow" || pass.kind === "inner") {
						troika.position.set(
							Number(pass.layer.offsetX) || 0,
							Number(pass.layer.offsetY) || 0,
							z,
						);
						troika.outlineBlur = Math.max(0, Number(pass.layer.diffuse) || 0);
						applyContent(troika, pass.layer.content, Number(pass.layer.alpha) || 1);
						return;
					}
					if (pass.kind === "stroke") {
						const w = Math.max(0, Number(pass.layer.width) || 0);
						const col = contentPrimaryColor(
							normalizeFillContent(pass.layer.content),
						);
						troika.outlineWidth = w;
						troika.outlineColor = col;
						troika.outlineOpacity =
							pass.layer.alpha != null ? Number(pass.layer.alpha) : 1;
						applyContent(troika, pass.layer.content, Number(pass.layer.alpha) || 1);
						return;
					}
					applyContent(
						troika,
						pass.layer.content,
						pass.layer.alpha != null ? Number(pass.layer.alpha) : 1,
					);
				};

				let textSyncToken = 0;
				const syncText = (rect?: { w: number; h: number }) => {
					const w = rect?.w ?? Number(fccUI.sizeDelta?.[0]) ?? 400;
					const style = getEffectiveFlowerStyle(fccUI);
					const sig = JSON.stringify({
						text: fccUI.text ?? "",
						fontSize: fccUI.fontSize,
						bold: fccUI.bold,
						color: fccUI.color,
						letterSpacing: fccUI.letterSpacing,
						lineHeight: fccUI.lineHeight,
						align: fccUI.align,
						verticalAlign: fccUI.verticalAlign,
						font: fccUI.font,
						fontBold: fccUI.fontBold,
						outline: fccUI.outline,
						shadow: fccUI.shadow,
						flowerStyle: fccUI.flowerStyle ?? null,
						style,
						w,
					});
					const ud = group.userData as { __fccTextSig?: string };
					if (ud.__fccTextSig === sig) return;
					ud.__fccTextSig = sig;
					const token = ++textSyncToken;

					const passes = buildPasses(style);
					const keep = new Set(passes.map((p) => p.name));
					const toRemove: THREE.Object3D[] = [];
					for (const child of [...group.children]) {
						if (
							child.name === "__fccText" ||
							child.name === "__fccTextShadow" ||
							(child.name.startsWith(FCC_FLOWER_PREFIX) && !keep.has(child.name))
						) {
							toRemove.push(child);
						}
					}
					for (const child of toRemove) {
						group.remove(child);
						const t = child as InstanceType<typeof TroikaText> & {
							dispose?: () => void;
						};
						try {
							t.dispose?.();
						} catch {
							/* ignore */
						}
					}

					const zStep = 0.001;
					passes.forEach((pass, i) => {
						let mesh = group.getObjectByName(pass.name) as
							| InstanceType<typeof TroikaText>
							| undefined;
						if (!mesh || typeof (mesh as { sync?: unknown }).sync !== "function") {
							if (mesh) group.remove(mesh);
							mesh = new TroikaText();
							mesh.name = pass.name;
							mesh.frustumCulled = false;
							mesh.castShadow = false;
							mesh.receiveShadow = false;
						}
						if (mesh.parent === group) group.remove(mesh);
						group.add(mesh);
						mesh.visible = false;
						const z = (i - passes.length) * zStep;
						applyPass(mesh, pass, w, z);
						const m = mesh;
						const p = pass;
						m.sync(() => {
							if (token !== textSyncToken) return;
							if (p.layer.content && contentUsesGradient(normalizeFillContent(p.layer.content))) {
								applyContent(
									m,
									p.layer.content,
									p.layer.alpha != null ? Number(p.layer.alpha) : 1,
								);
							} else {
								tuneMaterial(m);
							}
							m.visible = true;
						});
					});
				};

				(
					group.userData as {
						__fccSyncText?: (r: { w: number; h: number }) => void;
					}
				).__fccSyncText = syncText;
				syncText();
				registerObject(group, node);
				group.position.set(0, 0, 0);
				group.scale.set(1, 1, 1);
				group.rotation.set(0, 0, 0);
				applyUIObjectFlags(group);
				continue;
			}

'''

src = src[:si] + new_text + src[ei:]
sb_path.write_bytes(src.replace("\r\n", "\n").encode("utf-8"))
print("scene-builder patched", sb_path.stat().st_size)
text = sb_path.read_text(encoding="utf-8")
for n in ["PACK_SCENE_BUILD_REV = 11", "getEffectiveFlowerStyle", "FCC_FLOWER_FACE", "createDerivedMaterial", "flowerStyle:"]:
    print(n, "OK" if n in text else "MISSING")
