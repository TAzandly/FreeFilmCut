# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut")
changed = []

# ---------- PostProcessStack.js ----------
pps = ROOT / "three.js/editor/js/postprocessing/PostProcessStack.js"
text = pps.read_text(encoding="utf-8")

if "class LdrPreBloomClampPass" not in text:
    old = (
        " * Bloom needs LINEAR HDR from RenderPass. We force NoToneMapping for the beauty/bloom\n"
        " * stages and only apply the project's tone mapping inside OutputPass (see outputPass wrap).\n"
    )
    new = (
        " * Bloom needs LINEAR input from RenderPass. We force NoToneMapping for the beauty/bloom\n"
        " * stages and only apply the project's tone mapping inside OutputPass (see outputPass wrap).\n"
        " *\n"
        " * When OutputPass toneMapping is NoToneMapping (authoring \"none\"), insert an LDR clamp\n"
        " * pass immediately before bloom/deepGlow so wipe edgeIntensity etc. cannot create HDR\n"
        " * spikes that explode UnrealBloom. Neutral/ACES packs keep full HDR bloom (no clamp).\n"
    )
    if old not in text:
        raise SystemExit("PostProcessStack: header block not found")
    text = text.replace(old, new, 1)

    clamp_class = r'''
/**
 * Clamp beauty RGB to [0,1] before UnrealBloom / DeepGlow when OutputPass is NoToneMapping.
 * Enables none+Bloom authoring without Neutral remap: LDR bloom, OutputPass only sRGB.
 */
class LdrPreBloomClampPass extends Pass {

	constructor() {

		super();
		this.needsSwap = true;
		this.uniforms = {
			tDiffuse: { value: null },
		};
		this.material = new THREE.ShaderMaterial( {
			name: 'LdrPreBloomClampPass',
			uniforms: this.uniforms,
			vertexShader: /* glsl */`
				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = vec4( position.xy, 0.0, 1.0 );
				}
			`,
			fragmentShader: /* glsl */`
				uniform sampler2D tDiffuse;
				varying vec2 vUv;
				void main() {
					vec4 c = texture2D( tDiffuse, vUv );
					// Hard clamp: [0,1] unchanged; HDR peaks (wipe blade) -> LDR for bloom.
					gl_FragColor = vec4( clamp( c.rgb, 0.0, 1.0 ), c.a );
				}
			`,
			depthTest: false,
			depthWrite: false,
			toneMapped: false,
			transparent: false,
			blending: THREE.NoBlending,
		} );
		this._fsQuad = new FullScreenQuad( this.material );

	}

	render( renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */ ) {

		this.uniforms.tDiffuse.value = readBuffer.texture;
		renderer.setRenderTarget( this.renderToScreen ? null : writeBuffer );
		this._fsQuad.render( renderer );

	}

	dispose() {

		this.material.dispose();
		this._fsQuad.dispose();

	}

}

'''
    marker = "registerBuiltinEffects();\n"
    if marker not in text:
        raise SystemExit("PostProcessStack: registerBuiltinEffects marker missing")
    text = text.replace(marker, clamp_class + marker, 1)

old_loop_head = (
    "\tconst latePasses = []; // e.g. FXAA after OutputPass\n"
    "\tconst bindings = [];\n"
    "\tconst ctx = { THREE, width: w, height: h, scene, camera, renderer };\n"
    "\n"
    "\tfor ( const entry of stack.effects ) {\n"
)
new_loop_head = (
    "\tconst latePasses = []; // e.g. FXAA after OutputPass\n"
    "\tconst bindings = [];\n"
    "\tconst ctx = { THREE, width: w, height: h, scene, camera, renderer };\n"
    "\t// none => LDR bloom: clamp beauty before first bloom/deepGlow (HDR packs skip).\n"
    "\tconst useLdrBloom = outputToneMapping === THREE.NoToneMapping;\n"
    "\tlet ldrClampInserted = false;\n"
    "\n"
    "\tfor ( const entry of stack.effects ) {\n"
)
if old_loop_head not in text:
    raise SystemExit("PostProcessStack: loop head not found")
if "useLdrBloom" not in text:
    text = text.replace(old_loop_head, new_loop_head, 1)

old_add = (
    "\t\t\tpass.enabled = true;\n"
    "\t\t\tif ( entry.type === 'fxaa' ) {\n"
    "\n"
    "\t\t\t\tlatePasses.push( { pass, entry, desc, params } );\n"
    "\n"
    "\t\t\t} else {\n"
    "\n"
    "\t\t\t\tcomposer.addPass( pass );\n"
)
new_add = (
    "\t\t\tpass.enabled = true;\n"
    "\t\t\tif ( entry.type === 'fxaa' ) {\n"
    "\n"
    "\t\t\t\tlatePasses.push( { pass, entry, desc, params } );\n"
    "\n"
    "\t\t\t} else {\n"
    "\n"
    "\t\t\t\tif ( useLdrBloom && ! ldrClampInserted && ( entry.type === 'bloom' || entry.type === 'deepGlow' ) ) {\n"
    "\n"
    "\t\t\t\t\tcomposer.addPass( new LdrPreBloomClampPass() );\n"
    "\t\t\t\t\tldrClampInserted = true;\n"
    "\n"
    "\t\t\t\t}\n"
    "\n"
    "\t\t\t\tcomposer.addPass( pass );\n"
)
if "ldrClampInserted" not in text.split("buildComposerForCamera")[1][:2500] if False else True:
    pass
if "LdrPreBloomClampPass()" not in text:
    if old_add not in text:
        raise SystemExit("PostProcessStack: addPass block not found: " + repr(text[text.find("pass.enabled = true"):text.find("pass.enabled = true")+300]))
    text = text.replace(old_add, new_add, 1)

pps.write_text(text, encoding="utf-8")
changed.append(str(pps))
print("OK PostProcessStack", "LdrPreBloomClampPass" in text, "useLdrBloom" in text)

# ---------- composer.ts ----------
comp = ROOT / "freefilmcut/apps/web/src/vfxpack/postprocess/composer.ts"
ct = comp.read_text(encoding="utf-8")

old_c_header = (
    " * HDR contract (same as Editor PostProcessStack / Viewport):\n"
    " * - Capture project/pack toneMapping at build time for OutputPass.\n"
    " * - Caller MUST set renderer.toneMapping = NoToneMapping for the full\n"
    " *   composer.render() (see three-compositor renderPackWithPostProcess).\n"
    " * - OutputPass wrap temporarily restores captured tone mapping.\n"
    " * - Bloom materials use toneMapped=false (registry) so they stay linear.\n"
)
new_c_header = (
    " * HDR/LDR contract (same as Editor PostProcessStack / Viewport):\n"
    " * - Capture project/pack toneMapping at build time for OutputPass.\n"
    " * - Caller MUST set renderer.toneMapping = NoToneMapping for the full\n"
    " *   composer.render() (see three-compositor renderPackWithPostProcess).\n"
    " * - OutputPass wrap temporarily restores captured tone mapping.\n"
    " * - Bloom materials use toneMapped=false (registry) so they stay linear.\n"
    " * - When OutputPass is NoToneMapping (pack/project \"none\"), insert LDR clamp\n"
    " *   before bloom/deepGlow so wipe edgeIntensity spikes do not explode bloom.\n"
    " *   Neutral/ACES keep HDR bloom. Bloom does NOT require tonemap if beauty is LDR.\n"
)
if old_c_header not in ct:
    raise SystemExit("composer.ts: header not found")
if "LDR clamp" not in ct:
    ct = ct.replace(old_c_header, new_c_header, 1)

clamp_ts = r'''
/**
 * Clamp beauty RGB to [0,1] before UnrealBloom / DeepGlow when OutputPass is NoToneMapping.
 * Parity with editor PostProcessStack LdrPreBloomClampPass.
 */
class LdrPreBloomClampPass extends Pass {
	uniforms: { tDiffuse: { value: THREE.Texture | null } };
	material: THREE.ShaderMaterial;
	_fsQuad: FullScreenQuad;

	constructor() {
		super();
		this.needsSwap = true;
		this.uniforms = { tDiffuse: { value: null } };
		this.material = new THREE.ShaderMaterial({
			name: "LdrPreBloomClampPass",
			uniforms: this.uniforms,
			vertexShader: /* glsl */ `
				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = vec4(position.xy, 0.0, 1.0);
				}
			`,
			fragmentShader: /* glsl */ `
				uniform sampler2D tDiffuse;
				varying vec2 vUv;
				void main() {
					vec4 c = texture2D(tDiffuse, vUv);
					gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
				}
			`,
			depthTest: false,
			depthWrite: false,
			toneMapped: false,
			transparent: false,
			blending: THREE.NoBlending,
		});
		this._fsQuad = new FullScreenQuad(this.material);
	}

	render(
		renderer: THREE.WebGLRenderer,
		writeBuffer: THREE.WebGLRenderTarget,
		readBuffer: THREE.WebGLRenderTarget,
	) {
		this.uniforms.tDiffuse.value = readBuffer.texture;
		renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
		this._fsQuad.render(renderer);
	}

	dispose() {
		this.material.dispose();
		this._fsQuad.dispose();
	}
}

'''

# Insert class after imports / before export type BuiltPostProcess
marker_c = "export type BuiltPostProcess = {"
if "class LdrPreBloomClampPass" not in ct:
    if marker_c not in ct:
        raise SystemExit("composer.ts: BuiltPostProcess marker missing")
    ct = ct.replace(marker_c, clamp_ts + marker_c, 1)

old_c_loop = (
    "\tconst latePasses: Pass[] = [];\n"
    "\tconst bindings: BuiltPostProcess[\"bindings\"] = [];\n"
    "\n"
    "\tfor (const entry of liveStack.effects || []) {\n"
)
new_c_loop = (
    "\tconst latePasses: Pass[] = [];\n"
    "\tconst bindings: BuiltPostProcess[\"bindings\"] = [];\n"
    "\tconst useLdrBloom = outputToneMapping === THREE.NoToneMapping;\n"
    "\tlet ldrClampInserted = false;\n"
    "\n"
    "\tfor (const entry of liveStack.effects || []) {\n"
)
if "useLdrBloom" not in ct:
    if old_c_loop not in ct:
        raise SystemExit("composer.ts: loop head not found")
    ct = ct.replace(old_c_loop, new_c_loop, 1)

old_c_add = (
    "\t\tfor (const pass of passes) {\n"
    "\t\t\tpass.enabled = true;\n"
    "\t\t\tif (entry.type === \"fxaa\") latePasses.push(pass);\n"
    "\t\t\telse composer.addPass(pass);\n"
    "\t\t}\n"
)
new_c_add = (
    "\t\tfor (const pass of passes) {\n"
    "\t\t\tpass.enabled = true;\n"
    "\t\t\tif (entry.type === \"fxaa\") {\n"
    "\t\t\t\tlatePasses.push(pass);\n"
    "\t\t\t} else {\n"
    "\t\t\t\tif (\n"
    "\t\t\t\t\tuseLdrBloom &&\n"
    "\t\t\t\t\t!ldrClampInserted &&\n"
    "\t\t\t\t\t(entry.type === \"bloom\" || entry.type === \"deepGlow\")\n"
    "\t\t\t\t) {\n"
    "\t\t\t\t\tcomposer.addPass(new LdrPreBloomClampPass());\n"
    "\t\t\t\t\tldrClampInserted = true;\n"
    "\t\t\t\t}\n"
    "\t\t\t\tcomposer.addPass(pass);\n"
    "\t\t\t}\n"
    "\t\t}\n"
)
if "new LdrPreBloomClampPass()" not in ct:
    if old_c_add not in ct:
        raise SystemExit("composer.ts: addPass block not found")
    ct = ct.replace(old_c_add, new_c_add, 1)

comp.write_text(ct, encoding="utf-8")
changed.append(str(comp))
print("OK composer.ts")

# ---------- three-compositor.ts: remove remap ----------
tc = ROOT / "freefilmcut/apps/web/src/services/renderer/compositor/three-compositor.ts"
tt = tc.read_text(encoding="utf-8")

# Delete resolveTextAnimPackOutputToneMapping function
start = tt.find("/**\n * Text-anim pack PP OutputPass tone mapping.")
if start < 0:
    start = tt.find("function resolveTextAnimPackOutputToneMapping(")
if start < 0:
    raise SystemExit("three-compositor: remap fn not found")
# Find end: next function resolvePackOutputExposure
end = tt.find("function resolvePackOutputExposure(", start)
if end < 0:
    raise SystemExit("three-compositor: resolvePackOutputExposure not found after remap")
# Include any blank lines before resolvePackOutputExposure - keep the next function
tt = tt[:start] + tt[end:]

old_call = (
    "\t\t\t\t\t// Text-anim PP: pack none/0 -> Neutral until clip present matches editor clamp.\n"
    "\t\t\t\t\toutputToneMapping: resolveTextAnimPackOutputToneMapping(activePack?.payload),\n"
)
new_call = (
    "\t\t\t\t\t// Pack output.toneMapping is truth (none stays NoToneMapping).\n"
    "\t\t\t\t\t// LDR pre-bloom clamp in composer handles none+Bloom without Neutral remap.\n"
    "\t\t\t\t\toutputToneMapping: resolvePackOutputToneMapping(activePack?.payload),\n"
)
if "resolveTextAnimPackOutputToneMapping" in tt:
    # try alternate comment variants
    import re
    tt2, n = re.subn(
        r"\t\t\t\t\t// Text-anim PP:[^\n]*\n\t\t\t\t\toutputToneMapping: resolveTextAnimPackOutputToneMapping\(activePack\?\.payload\),\n",
        new_call,
        tt,
        count=1,
    )
    if n != 1:
        # simpler replace of just the call
        if "resolveTextAnimPackOutputToneMapping(activePack?.payload)" not in tt:
            raise SystemExit("three-compositor: call site not found")
        tt2 = tt.replace(
            "resolveTextAnimPackOutputToneMapping(activePack?.payload)",
            "resolvePackOutputToneMapping(activePack?.payload)",
            1,
        )
        # fix comment if present
        tt2 = tt2.replace(
            "// Text-anim PP: pack none/0 -> Neutral until clip present matches editor clamp.\n",
            "// Pack output.toneMapping is truth (none stays NoToneMapping); LDR clamp in composer.\n",
            1,
        )
    tt = tt2

if "resolveTextAnimPackOutputToneMapping" in tt:
    raise SystemExit("three-compositor: remap still referenced")

# Also fix numeric 0 in resolvePackOutputToneMapping to map to NoToneMapping
old_num = (
    "\tif (typeof raw === \"number\" && Number.isFinite(raw)) {\n"
    "\t\treturn raw as THREE.ToneMapping;\n"
    "\t}\n"
)
new_num = (
    "\tif (typeof raw === \"number\" && Number.isFinite(raw)) {\n"
    "\t\t// 0 === NoToneMapping in three; keep none as none (do not fall through to Neutral).\n"
    "\t\tif (raw === 0) return THREE.NoToneMapping;\n"
    "\t\treturn raw as THREE.ToneMapping;\n"
    "\t}\n"
)
# Only first occurrence in resolvePackOutputToneMapping
idx = tt.find("function resolvePackOutputToneMapping(")
if idx < 0:
    raise SystemExit("resolvePackOutputToneMapping missing")
chunk_end = tt.find("\nfunction ", idx + 10)
chunk = tt[idx:chunk_end]
if "if (raw === 0) return THREE.NoToneMapping" not in chunk:
    if old_num not in chunk:
        raise SystemExit("numeric raw block not found in resolvePackOutputToneMapping")
    chunk2 = chunk.replace(old_num, new_num, 1)
    tt = tt[:idx] + chunk2 + tt[chunk_end:]

tc.write_text(tt, encoding="utf-8")
changed.append(str(tc))
print("OK three-compositor.ts")

print("CHANGED", len(changed))
for c in changed:
    print(" -", c)