from pathlib import Path

path = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\scene-builder.ts")
text = path.read_text(encoding="utf-8")

start = text.find("\t\t\t\tconst createPlaneContentMaterial = (")
end = text.find("\t\t\t\tconst applySolidExpandMaterial = (", start)
if start < 0 or end < 0:
    raise SystemExit(f"markers missing start={start} end={end}")

new_block = r'''				const createPlaneContentMaterial = (
					baseMat: THREE.Material,
					opts: {
						uniforms: Record<string, { value: unknown }>;
						fragmentDefs?: string;
						contentGLSL?: string;
						fragmentColorTransform?: string;
					},
				) => {
					const uniforms = Object.assign(
						{
							uFccContentExpand: { value: 0 },
							uFccStrokeExpand: { value: 0 },
						},
						opts.uniforms || {},
					);
					// fragmentDefs inject before void main(), AFTER Troika's wrapped
					// troikaOrigMain. Rewriter hooks uFcc* into that earlier body =
					// use-before-declare (breaks per-glyph flower stacks on char-anim).
					// Prepend at file top; leave fragmentDefs empty so createDerivedMaterial
					// does not redefine them. (editor UIText createFccPlaneContentMaterial)
					const fragDefs =
						`
varying vec2 vFccGradUv;
uniform float uFccContentExpand;
uniform float uFccStrokeExpand;
` + (opts.fragmentDefs || "");
					return createDerivedMaterial(baseMat, {
						chained: true,
						uniforms,
						fragmentDefs: "",
						fragmentColorTransform: opts.fragmentColorTransform || "",
						customRewriter({
							vertexShader,
							fragmentShader,
						}: {
							vertexShader: string;
							fragmentShader: string;
						}) {
							if (vertexShader.indexOf("varying vec2 vFccGradUv") < 0) {
								vertexShader = "varying vec2 vFccGradUv;\n" + vertexShader;
							}
							if (vertexShader.indexOf("uniform float uFccContentExpand") < 0) {
								vertexShader =
									"uniform float uFccContentExpand;\n" + vertexShader;
							}
							if (vertexShader.indexOf("uniform float uFccStrokeExpand") < 0) {
								vertexShader =
									"uniform float uFccStrokeExpand;\n" + vertexShader;
							}
							if (fragmentShader.indexOf("uniform float uFccStrokeExpand") < 0) {
								fragmentShader = fragDefs + fragmentShader;
							}
							vertexShader = hookStrokeExpandVertex(vertexShader);
							vertexShader = hookLayerPlaneUv(vertexShader);
							fragmentShader = hookStrokeExpandFragment(fragmentShader);
							if (opts.contentGLSL) {
								fragmentShader = hookFillRGBA(fragmentShader, opts.contentGLSL);
							}
							return { vertexShader, fragmentShader };
						},
					});
				};

'''

# Normalize tabs: new_block used spaces from the raw string - convert leading
# indentation. The file uses tabs. Rebuild with tabs explicitly.
new_block = """\t\t\t\tconst createPlaneContentMaterial = (
\t\t\t\t\tbaseMat: THREE.Material,
\t\t\t\t\topts: {
\t\t\t\t\t\tuniforms: Record<string, { value: unknown }>;
\t\t\t\t\t\tfragmentDefs?: string;
\t\t\t\t\t\tcontentGLSL?: string;
\t\t\t\t\t\tfragmentColorTransform?: string;
\t\t\t\t\t},
\t\t\t\t) => {
\t\t\t\t\tconst uniforms = Object.assign(
\t\t\t\t\t\t{
\t\t\t\t\t\t\tuFccContentExpand: { value: 0 },
\t\t\t\t\t\t\tuFccStrokeExpand: { value: 0 },
\t\t\t\t\t\t},
\t\t\t\t\t\topts.uniforms || {},
\t\t\t\t\t);
\t\t\t\t\t// fragmentDefs inject before void main(), AFTER Troika's wrapped
\t\t\t\t\t// troikaOrigMain. Rewriter hooks uFcc* into that earlier body =
\t\t\t\t\t// use-before-declare (breaks per-glyph flower stacks on char-anim).
\t\t\t\t\t// Prepend at file top; leave fragmentDefs empty so createDerivedMaterial
\t\t\t\t\t// does not redefine them. (editor UIText createFccPlaneContentMaterial)
\t\t\t\t\tconst fragDefs =
\t\t\t\t\t\t`
varying vec2 vFccGradUv;
uniform float uFccContentExpand;
uniform float uFccStrokeExpand;
` + (opts.fragmentDefs || "");
\t\t\t\t\treturn createDerivedMaterial(baseMat, {
\t\t\t\t\t\tchained: true,
\t\t\t\t\t\tuniforms,
\t\t\t\t\t\tfragmentDefs: "",
\t\t\t\t\t\tfragmentColorTransform: opts.fragmentColorTransform || "",
\t\t\t\t\t\tcustomRewriter({
\t\t\t\t\t\t\tvertexShader,
\t\t\t\t\t\t\tfragmentShader,
\t\t\t\t\t\t}: {
\t\t\t\t\t\t\tvertexShader: string;
\t\t\t\t\t\t\tfragmentShader: string;
\t\t\t\t\t\t}) {
\t\t\t\t\t\t\tif (vertexShader.indexOf("varying vec2 vFccGradUv") < 0) {
\t\t\t\t\t\t\t\tvertexShader = "varying vec2 vFccGradUv;\\n" + vertexShader;
\t\t\t\t\t\t\t}
\t\t\t\t\t\t\tif (vertexShader.indexOf("uniform float uFccContentExpand") < 0) {
\t\t\t\t\t\t\t\tvertexShader =
\t\t\t\t\t\t\t\t\t"uniform float uFccContentExpand;\\n" + vertexShader;
\t\t\t\t\t\t\t}
\t\t\t\t\t\t\tif (vertexShader.indexOf("uniform float uFccStrokeExpand") < 0) {
\t\t\t\t\t\t\t\tvertexShader =
\t\t\t\t\t\t\t\t\t"uniform float uFccStrokeExpand;\\n" + vertexShader;
\t\t\t\t\t\t\t}
\t\t\t\t\t\t\tif (fragmentShader.indexOf("uniform float uFccStrokeExpand") < 0) {
\t\t\t\t\t\t\t\tfragmentShader = fragDefs + fragmentShader;
\t\t\t\t\t\t\t}
\t\t\t\t\t\t\tvertexShader = hookStrokeExpandVertex(vertexShader);
\t\t\t\t\t\t\tvertexShader = hookLayerPlaneUv(vertexShader);
\t\t\t\t\t\t\tfragmentShader = hookStrokeExpandFragment(fragmentShader);
\t\t\t\t\t\t\tif (opts.contentGLSL) {
\t\t\t\t\t\t\t\tfragmentShader = hookFillRGBA(fragmentShader, opts.contentGLSL);
\t\t\t\t\t\t\t}
\t\t\t\t\t\t\treturn { vertexShader, fragmentShader };
\t\t\t\t\t\t},
\t\t\t\t\t});
\t\t\t\t};

"""

# Fix: in the Python string above I doubled backslashes for \\n inside JS strings.
# The source file should have actual \n escape in the JS string literal, i.e. "\n" as two chars backslash-n
# Wait - in the original file it's: vertexShader = "varying vec2 vFccGradUv;\n" + vertexShader;
# which is backslash-n inside a double-quoted JS string. In my Python triple-quoted string with \\n,
# that becomes \n in the output file which is correct for JS.

text2 = text[:start] + new_block + text[end:]

# bump sigRev 14 -> 15 to force flower material rebuild
old_sig = "sigRev: 14, // fcc-tl-flower-14: char sync uses charUI.text (not parent fccUI)"
new_sig = "sigRev: 15, // fcc-tl-flower-15: prepend uFcc* at fragment top (char flower shader)"
if old_sig not in text2:
    # try find current
    import re
    m = re.search(r"sigRev:\s*\d+,[^\n]*", text2)
    print("sigRev line:", m.group(0) if m else None)
    raise SystemExit("sigRev 14 not found")
text2 = text2.replace(old_sig, new_sig, 1)

# also bump flowerWithChar so char preview rebuilds materials
rt = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\textanim\TextAnimRuntime.js")
rtt = rt.read_text(encoding="utf-8")
old_fw = "\t\tflowerWithChar: 2, // rebuild after charUI.text fix (was painting full parent string)"
new_fw = "\t\tflowerWithChar: 3, // rebuild after fragment uFcc* prepend fix"
if old_fw not in rtt:
    raise SystemExit("flowerWithChar 2 not found")
rt.write_text(rtt.replace(old_fw, new_fw, 1), encoding="utf-8")

path.write_text(text2, encoding="utf-8")
print("OK patched createPlaneContentMaterial + sigRev 15 + flowerWithChar 3")
# verify
t = path.read_text(encoding="utf-8")
assert 'fragmentDefs: ""' in t or "fragmentDefs: ''" in t
assert "fragmentShader = fragDefs + fragmentShader" in t
assert "Fragment uniform: fragmentDefs only" not in t[t.find("createPlaneContentMaterial"):t.find("applySolidExpandMaterial")]
print("verified")
