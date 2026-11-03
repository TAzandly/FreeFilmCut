import pathlib
p = pathlib.Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\scene-builder.ts")
t = p.read_text(encoding="utf-8")
marker = "const applyGradientMaterial = ("
idx = t.find(marker)
if idx < 0:
    raise SystemExit("marker not found")
# find end at "};\n\n\t\t\t\tconst applyContent"
end_marker = "\t\t\t\tconst applyContent = ("
end = t.find(end_marker, idx)
if end < 0:
    raise SystemExit("end not found")

new_fn = r'''				const resolveTroikaFaceMaterial = (
					troika: InstanceType<typeof TroikaText>,
				) => {
					const m = troika.material as THREE.Material | THREE.Material[] | null;
					if (Array.isArray(m))
						return (m.length ? m[m.length - 1] : null) as
							| (THREE.Material & {
									isTroikaTextMaterial?: boolean;
									userData: Record<string, unknown>;
							  })
							| null;
					return (m || null) as
						| (THREE.Material & {
								isTroikaTextMaterial?: boolean;
								userData: Record<string, unknown>;
						  })
						| null;
				};

				const applyGradientMaterial = (
					troika: InstanceType<typeof TroikaText>,
					content: ReturnType<typeof normalizeFillContent>,
					opacity: number,
				) => {
					const g = content.gradient;
					const rgbA = hexToRgb01(g.colors[0]);
					const rgbB = hexToRgb01(g.colors[1]);
					const angle = Number(g.angle);
					const stop0 = Number(g.stops[0]);
					const stop1 = Number(g.stops[1]);
					const angleVal = Number.isFinite(angle) ? angle : 90;
					const stop0Val = Number.isFinite(stop0) ? stop0 : 0;
					const stop1Val = Number.isFinite(stop1) ? stop1 : 1;
					// White diffuse so a failed/disabled gradient frame is not stuck on color0 black.
					troika.color = "#ffffff";
					troika.fillOpacity = opacity;

					let baseMat = resolveTroikaFaceMaterial(troika);
					if (!baseMat || !baseMat.isTroikaTextMaterial) {
						troika.material = new THREE.MeshBasicMaterial({
							color: 0xffffff,
							transparent: true,
							depthWrite: false,
							toneMapped: false,
							side: THREE.DoubleSide,
						});
						baseMat = resolveTroikaFaceMaterial(troika);
					}
					if (!baseMat || !baseMat.isTroikaTextMaterial) {
						tuneMaterial(troika);
						return;
					}

					// Drop pre-fix wraps that sampled undeclared vUv.
					if (baseMat.userData?.fccGradientMat && !baseMat.userData?.fccGradUv) {
						troika.material = new THREE.MeshBasicMaterial({
							color: 0xffffff,
							transparent: true,
							depthWrite: false,
							toneMapped: false,
							side: THREE.DoubleSide,
						});
						baseMat = resolveTroikaFaceMaterial(troika);
						if (!baseMat || !baseMat.isTroikaTextMaterial) {
							tuneMaterial(troika);
							return;
						}
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
					if (
						baseMat.userData?.fccGradientMat &&
						baseMat.userData?.fccGradUv &&
						prevU
					) {
						prevU.uFccGA.value.setRGB(rgbA[0], rgbA[1], rgbA[2]);
						prevU.uFccGB.value.setRGB(rgbB[0], rgbB[1], rgbB[2]);
						prevU.uFccGAngle.value = angleVal;
						prevU.uFccGStop0.value = stop0Val;
						prevU.uFccGStop1.value = stop1Val;
						prevU.uFccGUse.value = 1;
						tuneMaterial(troika);
						return;
					}
					const uniforms = {
						uFccGA: { value: new THREE.Color().setRGB(rgbA[0], rgbA[1], rgbA[2]) },
						uFccGB: { value: new THREE.Color().setRGB(rgbB[0], rgbB[1], rgbB[2]) },
						uFccGAngle: { value: angleVal },
						uFccGStop0: { value: stop0Val },
						uFccGStop1: { value: stop1Val },
						uFccGUse: { value: 1 },
					};
					try {
						const derived = createDerivedMaterial(baseMat, {
							chained: true,
							uniforms,
							vertexDefs: `
varying vec2 vFccGradUv;
`,
							vertexTransform: `
{
  vec4 fccB = aTroikaGlyphBounds;
  fccB.xz += uTroikaPositionOffset.x;
  fccB.yw -= uTroikaPositionOffset.y;
  vec2 fccLocal = mix( fccB.xy, fccB.zw, position.xy );
  vec2 fccSpan = max( uTroikaTotalBounds.zw - uTroikaTotalBounds.xy, vec2( 1e-5 ) );
  vFccGradUv = ( fccLocal - uTroikaTotalBounds.xy ) / fccSpan;
}
`,
							fragmentDefs: `
varying vec2 vFccGradUv;
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
  float t = dot(vFccGradUv - vec2(0.5), dir) + 0.5;
  t = (t - uFccGStop0) / max(uFccGStop1 - uFccGStop0, 1e-5);
  t = clamp(t, 0.0, 1.0);
  gl_FragColor.rgb = mix(uFccGA, uFccGB, t);
}
`,
						});
						derived.userData = derived.userData || {};
						derived.userData.fccGradientMat = true;
						derived.userData.fccGradUv = true;
						derived.userData.fccGradientUniforms = uniforms;
						derived.transparent = true;
						derived.depthWrite = false;
						derived.toneMapped = false;
						derived.depthTest = false;
						// Prevent Troika Text setter from double-wrapping SDF.
						Object.defineProperty(derived, "isTroikaTextMaterial", {
							value: true,
						});
						troika.material = derived;
						tuneMaterial(troika);
					} catch (e) {
						console.warn("[FreeFilmCut] OpenCut gradient material failed", e);
						tuneMaterial(troika);
					}
				};

'''

t2 = t[:idx] + new_fn + t[end:]

# Fix solid path unwrap
old_apply = '''					if (c.renderType === "gradient") {
						applyGradientMaterial(troika, c, opacity);
						return;
					}
					troika.color = contentPrimaryColor(c);
					troika.fillOpacity = opacity;'''

new_apply = '''					if (c.renderType === "gradient") {
						applyGradientMaterial(troika, c, opacity);
						return;
					}
					// Fully unwrap any prior gradient-derived mat (vUv-broken or current).
					{
						const face = resolveTroikaFaceMaterial(troika);
						if (face?.userData?.fccGradientMat) {
							troika.material = new THREE.MeshBasicMaterial({
								color: 0xffffff,
								transparent: true,
								depthWrite: false,
								toneMapped: false,
								side: THREE.DoubleSide,
							});
						}
					}
					troika.color = contentPrimaryColor(c);
					troika.fillOpacity = opacity;'''

if old_apply not in t2:
    raise SystemExit("applyContent solid path not found")
t2 = t2.replace(old_apply, new_apply, 1)
p.write_text(t2, encoding="utf-8")
print("patched", p.stat().st_size)
print("vFccGradUv", t2.count("vFccGradUv"))
print("dot(vUv", t2.count("dot(vUv"))
print("fccGradUv", t2.count("fccGradUv"))
