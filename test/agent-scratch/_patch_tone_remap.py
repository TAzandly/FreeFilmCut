from pathlib import Path
import re

path = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\services\renderer\compositor\three-compositor.ts")
text = path.read_text(encoding="utf-8")

marker = "function resolvePackOutputToneMapping("
idx = text.find(marker)
if idx < 0:
    raise SystemExit("resolvePackOutputToneMapping not found")
# find end of function: next blank line after closing brace of switch/function
end = text.find("\n}\n\nfunction resolvePackOutputExposure(", idx)
if end < 0:
    raise SystemExit("end of resolvePackOutputToneMapping not found")
end += 2  # include closing brace newline position carefully
# end currently points at \n} — keep through that }
end = text.find("}", end - 5) + 1

old_block = text[idx:end]
# find start of comment before function
comment_start = text.rfind("/** Editor Config default", 0, idx)
if comment_start < 0:
    comment_start = idx
old_block = text[comment_start:end]

new_block = r'''/** Editor Config default is NeutralToneMapping (key value 7 in three r15x+/r18x). */
function resolvePackOutputToneMapping(
	payload: { output?: { toneMapping?: string | number }; toneMapping?: string | number } | null | undefined,
): THREE.ToneMapping {
	const raw =
		payload?.output?.toneMapping ??
		payload?.toneMapping ??
		"neutral";
	if (typeof raw === "number" && Number.isFinite(raw)) {
		return raw as THREE.ToneMapping;
	}
	const key = String(raw).toLowerCase();
	switch (key) {
		case "none":
		case "notonemapping":
			return THREE.NoToneMapping;
		case "linear":
			return THREE.LinearToneMapping;
		case "reinhard":
			return THREE.ReinhardToneMapping;
		case "cineon":
			return THREE.CineonToneMapping;
		case "aces":
		case "acesfilmic":
			return THREE.ACESFilmicToneMapping;
		case "agx":
			return THREE.AgXToneMapping;
		case "neutral":
		default:
			return THREE.NeutralToneMapping;
	}
}

/**
 * Text-anim pack PP OutputPass tone mapping.
 * Pack may author under Config none (NoToneMapping). Editor Viewport then
 * present-clamps composer rgb to [0,1] (see presentComposerToLetterbox _blitMat),
 * which softens HDR bloom. Clip historically blew out on the same none path
 * because the PP->layer blit did not clamp. Until none present paths fully match,
 * map pack none/0 -> Neutral for text-anim PP only (user-preferred clip look).
 * Other packs still use resolvePackOutputToneMapping (none stays none).
 */
function resolveTextAnimPackOutputToneMapping(
	payload: { output?: { toneMapping?: string | number }; toneMapping?: string | number } | null | undefined,
): THREE.ToneMapping {
	const raw = payload?.output?.toneMapping ?? payload?.toneMapping;
	if (raw === undefined || raw === null || raw === "") {
		return THREE.NeutralToneMapping;
	}
	if (typeof raw === "number" && Number.isFinite(raw)) {
		if (raw === 0 || raw === THREE.NoToneMapping) {
			return THREE.NeutralToneMapping;
		}
		return raw as THREE.ToneMapping;
	}
	const key = String(raw).toLowerCase();
	if (key === "none" || key === "notonemapping" || key === "0") {
		return THREE.NeutralToneMapping;
	}
	return resolvePackOutputToneMapping(payload);
}'''

text = text[:comment_start] + new_block + text[end:]

# Replace text-anim call site
old_snip = '''					// Pack output.toneMapping is truth (editor Config snapshot).
					// No silent remap: none -> NoToneMapping, same as other packs / editor OutputPass.
					outputToneMapping: resolvePackOutputToneMapping(activePack?.payload),
					outputExposure: resolvePackOutputExposure(activePack?.payload),'''

new_snip = '''					// Text-anim PP: pack none/0 -> Neutral until clip present matches editor clamp.
					outputToneMapping: resolveTextAnimPackOutputToneMapping(activePack?.payload),
					outputExposure: resolvePackOutputExposure(activePack?.payload),'''

if old_snip not in text:
    raise SystemExit("call site comment block not found")
text = text.replace(old_snip, new_snip, 1)

# Replace the straightAlphaFromPremul:false that follows textanim-pp blit.
# Anchor on unique nearby comments.
anchor = "ppRT.texture.colorSpace = THREE.SRGBColorSpace;"
# Find the occurrence after textanim-pp
ta = text.find('packId: packId + ":textanim-pp"')
if ta < 0:
    raise SystemExit("textanim-pp anchor not found")
pos = text.find(anchor, ta)
if pos < 0:
    raise SystemExit("ppRT colorSpace after textanim-pp not found")
# Replace the following comment + blit block once
old_blit = None
# Grab from colorSpace line through straightAlphaFromPremul line
chunk = text[pos:pos+900]
m = re.search(
    r"ppRT\.texture\.colorSpace = THREE\.SRGBColorSpace;\n"
    r"\t\t\t//[^\n]*\n"
    r"\t\t\t//[^\n]*\n"
    r"\t\t\t//[^\n]*\n"
    r"\t\t\tthis\.blitTextureToTarget\(\{\n"
    r"\t\t\t\tsource: ppRT\.texture,\n"
    r"\t\t\t\ttarget,\n"
    r"\t\t\t\tflipY: false,\n"
    r"\t\t\t\tclear: false,\n"
    r'\t\t\t\tblend: "alpha",\n'
    r"\t\t\t\topacity: item\.opacity \* \(props\.opacity > 0 \? props\.opacity : 1\),\n"
    r"\t\t\t\tstraightAlphaFromPremul: false,\n"
    r"\t\t\t\}\);",
    chunk,
)
if not m:
    print("CHUNK REPR START")
    print(repr(chunk))
    raise SystemExit("blit block regex failed")

new_blit = '''ppRT.texture.colorSpace = THREE.SRGBColorSpace;
			// Match editor presentComposerToLetterbox: clamp rgb + straight-alpha
			// (additive bloom often leaves a < max(rgb)). Needed for none parity;
			// harmless under Neutral (already compressed).
			this.blitTextureToTarget({
				source: ppRT.texture,
				target,
				flipY: false,
				clear: false,
				blend: "alpha",
				opacity: item.opacity * (props.opacity > 0 ? props.opacity : 1),
				straightAlphaFromPremul: true,
			});'''

text = text[:pos] + new_blit + text[pos+m.end():]
path.write_text(text, encoding="utf-8")
print("OK")
print("resolveTextAnim defs", text.count("function resolveTextAnimPackOutputToneMapping"))
print("resolveTextAnim calls", text.count("resolveTextAnimPackOutputToneMapping(activePack"))
print("has straight true after textanim", "straightAlphaFromPremul: true" in text[ta:ta+3500])
