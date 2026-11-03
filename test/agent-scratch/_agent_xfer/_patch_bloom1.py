from pathlib import Path
import re

# --- 1) composer.ts: stop forcing ACESFilmic (editor parity) ---
comp = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\postprocess\composer.ts")
ct = comp.read_text(encoding="utf-8")

old_tm = '''\tconst outputToneMapping =
\t\trenderer.toneMapping === THREE.NoToneMapping
\t\t\t? THREE.ACESFilmicToneMapping
\t\t\t: renderer.toneMapping;
\tconst outputExposure =
\t\trenderer.toneMappingExposure > 0 ? renderer.toneMappingExposure : 1;'''

new_tm = '''\t// Tone mapping ONLY in OutputPass, and only the caller's setting.
\t// NoToneMapping stays NoToneMapping (sRGB encode still runs).
\t// Never force ACESFilmic here — that washed text-anim bloom (惨白) vs editor.
\tconst outputToneMapping =
\t\toptsOutputToneMapping !== undefined
\t\t\t? optsOutputToneMapping
\t\t\t: renderer.toneMapping;
\tconst outputExposure =
\t\toptsOutputExposure !== undefined
\t\t\t? optsOutputExposure
\t\t\t: renderer.toneMappingExposure > 0
\t\t\t\t? renderer.toneMappingExposure
\t\t\t\t: 1;'''

# Need to add opts params to buildPackComposer signature first
old_sig = '''export function buildPackComposer({
\trenderer,
\tscene,
\tcamera,
\twidth,
\theight,
\tstack,
\texposed,
\tliveParams,
}: {
\trenderer: THREE.WebGLRenderer;
\tscene: THREE.Scene;
\tcamera: THREE.Camera;
\twidth: number;
\theight: number;
\tstack: PostProcessStackData;
\texposed: ExposedParam[];
\tliveParams?: ParamValues | null;
}): BuiltPostProcess | null {'''

new_sig = '''export function buildPackComposer({
\trenderer,
\tscene,
\tcamera,
\twidth,
\theight,
\tstack,
\texposed,
\tliveParams,
\toutputToneMapping: optsOutputToneMapping,
\toutputExposure: optsOutputExposure,
}: {
\trenderer: THREE.WebGLRenderer;
\tscene: THREE.Scene;
\tcamera: THREE.Camera;
\twidth: number;
\theight: number;
\tstack: PostProcessStackData;
\texposed: ExposedParam[];
\tliveParams?: ParamValues | null;
\t/** Override OutputPass tone mapping (e.g. NoToneMapping for UI text packs). */
\toutputToneMapping?: THREE.ToneMapping;
\toutputExposure?: number;
}): BuiltPostProcess | null {'''

if old_sig not in ct:
    raise SystemExit("buildPackComposer sig not found")
if old_tm not in ct:
    raise SystemExit("outputToneMapping block not found")
ct = ct.replace(old_sig, new_sig, 1).replace(old_tm, new_tm, 1)
comp.write_text(ct, encoding="utf-8")
print("OK composer.ts")
