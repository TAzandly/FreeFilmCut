from pathlib import Path
import zipfile, json, os

comp = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\services\renderer\compositor\three-compositor.ts")
t = comp.read_text(encoding="utf-8")

marker = "function resolvePackOutputToneMapping("
if marker not in t:
    raise SystemExit("resolvePackOutputToneMapping not found")

# Insert text-anim helper after resolvePackOutputExposure
insert_after = "function resolvePackOutputExposure("
idx = t.find(insert_after)
if idx < 0:
    raise SystemExit("resolvePackOutputExposure not found")
# find end of resolvePackOutputExposure function (next "\nclass ThreeCompositor")
end = t.find("\nclass ThreeCompositor", idx)
if end < 0:
    raise SystemExit("class ThreeCompositor not found after exposure fn")

helper = '''
/**
 * Text-anim pack PP tone mapping (editor Viewport OutputPass parity).
 * Pack "none" white-washes HDR wipe+bloom into a huge blown halo. Editor live
 * Config defaults to Neutral, and fromJSON historically did not restore
 * project.toneMapping — so packs often say none while the editor viewport
 * still tonemaps with Neutral. Map none/0 → Neutral for text-anim PP only.
 */
function resolveTextAnimPackOutputToneMapping(
	payload: { output?: { toneMapping?: string | number }; toneMapping?: string | number } | null | undefined,
): THREE.ToneMapping {
	const raw =
		payload?.output?.toneMapping ??
		payload?.toneMapping ??
		"neutral";
	if (typeof raw === "number" && Number.isFinite(raw)) {
		if (raw === 0) return THREE.NeutralToneMapping;
		return raw as THREE.ToneMapping;
	}
	const key = String(raw).toLowerCase();
	if (key === "none" || key === "notonemapping") {
		return THREE.NeutralToneMapping;
	}
	return resolvePackOutputToneMapping(payload);
}

'''

if "resolveTextAnimPackOutputToneMapping" not in t:
    t = t[:end] + helper + t[end:]

old_pp = "\t\t\tconst packId = TIMELINE_FLOWER_TEXT_PACK_PREFIX + item.elementId;\n\t\t\tconst ppRT = this.ensureTextLayerTarget(rtW, rtH);"
new_pp = "\t\t\tconst packId = TIMELINE_FLOWER_TEXT_PACK_PREFIX + item.elementId;\n\t\t\t// Bloom kernels are texel-sized (UnrealBloomPass). Match editor Viewport:\n\t\t\t// composer FBO = authored project/safe-frame pixels, not preview undersample.\n\t\t\t// (previewScale still applies to the final compose blit via target size.)\n\t\t\tconst ppRT = this.ensureTextLayerTarget(resW, resH);"
if old_pp not in t:
    raise SystemExit("ppRT block not found")
t = t.replace(old_pp, new_pp, 1)

# Replace width/height rt -> res in textanim-pp call only (first occurrence after ppRT change)
old_wh = "\t\t\t\t\twidth: Math.max(1, rtW),\n\t\t\t\t\theight: Math.max(1, rtH),"
# Find the one near textanim-pp (after ensureFlowerPpOrtho)
pos = t.find("const ortho = this.ensureFlowerPpOrtho(resW, resH);")
if pos < 0:
    raise SystemExit("ortho ensure not found")
wh_pos = t.find(old_wh, pos)
if wh_pos < 0:
    raise SystemExit("rtW/rtH width block after ortho not found")
t = t[:wh_pos] + "\t\t\t\t\twidth: Math.max(1, resW),\n\t\t\t\t\theight: Math.max(1, resH)," + t[wh_pos+len(old_wh):]

# Also fix comment about rtW/rtH if present near this call
t = t.replace(
    "// Layout / placeCanvasInFrontOfCamera must use authored pixels.\n\t\t\t\t\t\t// rtW/rtH only size the composer + RT (preview undersample).",
    "// Layout / placeCanvasInFrontOfCamera + bloom setSize: authored pixels.",
    1,
)

old_tm_call = "outputToneMapping: resolvePackOutputToneMapping(activePack?.payload),"
new_tm_call = "outputToneMapping: resolveTextAnimPackOutputToneMapping(activePack?.payload),"
# Only replace the one for text anim (activePack)
count = t.count(old_tm_call)
if count < 1:
    raise SystemExit("tone mapping call not found")
t = t.replace(old_tm_call, new_tm_call, 1)

t = t.replace(
    "// Prefer pack-authored toneMapping when present.",
    "// none/0 remapped to Neutral (see resolveTextAnimPackOutputToneMapping).",
    1,
)

comp.write_text(t, encoding="utf-8")
print("OK three-compositor.ts")

ed = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Editor.js")
et = ed.read_text(encoding="utf-8")
old_title = """\t\t\t// FreeFilmCut: restore editable project name
\t\t\t{
\t\t\t\tconst p = json.project || {};
\t\t\t\tconst meta = json.metadata || {};
\t\t\t\tconst title = p.title || p.name || meta.title || '';
\t\t\t\tif ( title ) {
\t\t\t\t\tthis.config.setKey( 'project/title', title );
\t\t\t\t}
\t\t\t\tif ( this.signals.projectTitleChanged ) {
\t\t\t\t\tthis.signals.projectTitleChanged.dispatch( this.config.getKey( 'project/title' ) || '' );
\t\t\t\t}
\t\t\t}"""
new_title = """\t\t\t// FreeFilmCut: restore editable project name + renderer tone mapping.
\t\t\t// Without this, project.toneMapping in JSON was ignored on load while
\t\t\t// export still read live Config — packs could say "none" while the
\t\t\t// viewport kept Neutral and bloom looked tighter than clip.
\t\t\t{
\t\t\t\tconst p = json.project || {};
\t\t\t\tconst meta = json.metadata || {};
\t\t\t\tconst title = p.title || p.name || meta.title || '';
\t\t\t\tif ( title ) {
\t\t\t\t\tthis.config.setKey( 'project/title', title );
\t\t\t\t}
\t\t\t\tif ( this.signals.projectTitleChanged ) {
\t\t\t\t\tthis.signals.projectTitleChanged.dispatch( this.config.getKey( 'project/title' ) || '' );
\t\t\t\t}
\t\t\t\tif ( p.toneMapping !== undefined && p.toneMapping !== null ) {
\t\t\t\t\tthis.config.setKey( 'project/renderer/toneMapping', p.toneMapping );
\t\t\t\t}
\t\t\t\tif ( p.toneMappingExposure !== undefined && p.toneMappingExposure !== null ) {
\t\t\t\t\tconst exp = Number( p.toneMappingExposure );
\t\t\t\t\tif ( Number.isFinite( exp ) && exp > 0 ) {
\t\t\t\t\t\tthis.config.setKey( 'project/renderer/toneMappingExposure', exp );
\t\t\t\t\t}
\t\t\t\t}
\t\t\t}"""
if old_title not in et:
    raise SystemExit("fromJSON title block not found")
et = et.replace(old_title, new_title, 1)
ed.write_text(et, encoding="utf-8")
print("OK Editor.js")

idx_html = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\index.html")
ih = idx_html.read_text(encoding="utf-8")
if "Editor.js?v=fcc-ui-153" not in ih:
    raise SystemExit(f"Editor cache tag not found; has: {[x for x in ih.split() if 'Editor.js' in x]}")
ih = ih.replace("Editor.js?v=fcc-ui-153", "Editor.js?v=fcc-ui-161", 1)
idx_html.write_text(ih, encoding="utf-8")
print("OK index.html cache bump fcc-ui-161")

for proj in [
    Path(r"D:\GrokbotWork\FreeFilmCut\projects\sweep-demo\project.json"),
    Path(r"D:\GrokbotWork\FreeFilmCut\projects\sweep-demo\project-camera.json"),
]:
    if not proj.exists():
        continue
    data = json.loads(proj.read_text(encoding="utf-8"))
    if "project" in data and isinstance(data["project"], dict):
        if data["project"].get("toneMapping") == 0:
            data["project"]["toneMapping"] = 7
            proj.write_text(json.dumps(data, ensure_ascii=False, indent="\t") + "\n", encoding="utf-8")
            print("OK", proj.name, "toneMapping -> 7")
        else:
            print("skip", proj.name, "toneMapping=", data["project"].get("toneMapping"))

pack_path = Path(r"D:\GrokbotWork\FreeFilmCut\projects\sweep-demo\exports\freecapcut.text-anim.sweep.vfxpack")
if pack_path.exists():
    tmp = pack_path.with_suffix(".vfxpack.tmp")
    with zipfile.ZipFile(pack_path, "r") as zin, zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            if info.filename.endswith("manifest.json") or info.filename.endswith("textanim-pack.json"):
                obj = json.loads(data.decode("utf-8"))
                def fix(o):
                    if isinstance(o, dict):
                        out = o.get("output")
                        if isinstance(out, dict) and str(out.get("toneMapping", "")).lower() in ("none", "notonemapping", "0"):
                            out["toneMapping"] = "neutral"
                        ta = o.get("textAnim")
                        if isinstance(ta, dict):
                            fix(ta)
                fix(obj)
                data = json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")
            zout.writestr(info, data)
    os.replace(tmp, pack_path)
    print("OK patched export pack toneMapping -> neutral")

pub = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\public\vfxpacks\text-anims")
if pub.exists():
    for p in pub.rglob("*"):
        if "sweep" in p.name.lower():
            print("public sweep path:", p)
