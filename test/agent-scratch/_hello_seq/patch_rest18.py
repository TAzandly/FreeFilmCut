from pathlib import Path

# ---- text-stickers.js: preserve rtTargetUuid + texturePackPath ----
p = Path(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/text-stickers.js")
s = p.read_text(encoding="utf-8")

old = """\t\ttexturePath: raw.texturePath != null ? String( raw.texturePath ) : '',
\t\ttextureFileName: raw.textureFileName != null ? String( raw.textureFileName ) : '',
\t\topacity: Math.max( 0, Math.min( 1, Number( raw.opacity ) != null && ! Number.isNaN( Number( raw.opacity ) )
\t\t\t? Number( raw.opacity ) : 1 ) ),
\t\tcolor: typeof raw.color === 'string' && raw.color ? raw.color : d.color,
\t};"""

new = """\t\ttexturePath: raw.texturePath != null ? String( raw.texturePath ) : '',
\t\ttextureFileName: raw.textureFileName != null ? String( raw.textureFileName ) : '',
\t\topacity: Math.max( 0, Math.min( 1, Number( raw.opacity ) != null && ! Number.isNaN( Number( raw.opacity ) )
\t\t\t? Number( raw.opacity ) : 1 ) ),
\t\tcolor: typeof raw.color === 'string' && raw.color ? raw.color : d.color,
\t\t// Live media (fcc-tl-flower-18): keep RT / pack path for bindLiveMediaToStickers.
\t\t...( typeof raw.texturePackPath === 'string' && raw.texturePackPath
\t\t\t? { texturePackPath: raw.texturePackPath } : {} ),
\t\t...( typeof raw.rtTargetUuid === 'string' && raw.rtTargetUuid
\t\t\t? { rtTargetUuid: raw.rtTargetUuid } : {} ),
\t};"""

if old not in s:
    raise SystemExit("normalizeTextSticker return block not found")
s = s.replace(old, new, 1)
p.write_text(s, encoding="utf-8")
print("text-stickers normalize patched")

# ---- bump rev / sigRev to 18 ----
tf = Path(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/timeline-flower-text.ts")
st = tf.read_text(encoding="utf-8")
old_rev = "\t\trev: 17, // fcc-tl-flower-17: seq frameNames+MIME; sticker park layout; msyh fontUrl"
new_rev = "\t\trev: 18, // fcc-tl-flower-18: seq seek/sync time + RT wake; sticker rtTargetUuid preserve"
if old_rev not in st:
    raise SystemExit("rev 17 not found in timeline-flower-text")
tf.write_text(st.replace(old_rev, new_rev, 1), encoding="utf-8")
print("timeline-flower-text rev 18")

sb = Path(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/scene-builder.ts")
ss = sb.read_text(encoding="utf-8")
old_sig = "\t\t\t\t\t\tsigRev: 17, // fcc-tl-flower-17: seq frameNames + sticker park layout + msyh"
new_sig = "\t\t\t\t\t\tsigRev: 18, // fcc-tl-flower-18: seq seek/sync time + RT wake"
if old_sig not in ss:
    raise SystemExit("sigRev 17 not found")
sb.write_text(ss.replace(old_sig, new_sig, 1), encoding="utf-8")
print("scene-builder sigRev 18")

# ---- synthesizeTextTemplateFromScene: attach frameNames for imageSequence ----
at = Path(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/apply-text-template.ts")
a = at.read_text(encoding="utf-8")
old_syn = """\t\tif (kind === "imageSequence") {
\t\t\tout.sequenceDir = packPath || vp.sequenceDir || "";
\t\t}
\t\treturn out;
\t});"""

new_syn = """\t\tif (kind === "imageSequence") {
\t\t\tconst seqDir = String(packPath || vp.sequenceDir || "")
\t\t\t\t.replace(/\\\\/g, "/")
\t\t\t\t.replace(/\\/$/, "");
\t\t\tout.sequenceDir = seqDir ? seqDir + "/" : "";
\t\t\tout.path = out.sequenceDir || out.path;
\t\t\tconst names: string[] = [];
\t\t\tconst prefix = seqDir ? seqDir + "/" : "sequences/";
\t\t\tfor (const key of fileKeys) {
\t\t\t\tconst norm = key.replace(/^pack\\//, "");
\t\t\t\tif (!norm.startsWith(prefix)) continue;
\t\t\t\tconst base = norm.slice(prefix.length);
\t\t\t\tif (!base || base.includes("/")) continue;
\t\t\t\tif (/\\.(png|jpe?g|webp|bmp|gif)$/i.test(base)) names.push(base);
\t\t\t}
\t\t\tnames.sort((a, b) =>
\t\t\t\ta.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
\t\t\t);
\t\t\tif (names.length) out.frameNames = names;
\t\t}
\t\treturn out;
\t});"""

# Careful with escaping in the Python string for the file content
new_syn = '''\t\tif (kind === "imageSequence") {
\t\t\tconst seqDir = String(packPath || vp.sequenceDir || "")
\t\t\t\t.replace(/\\\\/g, "/")
\t\t\t\t.replace(/\\/$/, "");
\t\t\tout.sequenceDir = seqDir ? seqDir + "/" : "";
\t\t\tout.path = out.sequenceDir || out.path;
\t\t\tconst names: string[] = [];
\t\t\tconst prefix = seqDir ? seqDir + "/" : "sequences/";
\t\t\tfor (const key of fileKeys) {
\t\t\t\tconst norm = key.replace(/^pack\\//, "");
\t\t\t\tif (!norm.startsWith(prefix)) continue;
\t\t\t\tconst base = norm.slice(prefix.length);
\t\t\t\tif (!base || base.includes("/")) continue;
\t\t\t\tif (/\\.(png|jpe?g|webp|bmp|gif)$/i.test(base)) names.push(base);
\t\t\t}
\t\t\tnames.sort((a, b) =>
\t\t\t\ta.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
\t\t\t);
\t\t\tif (names.length) out.frameNames = names;
\t\t}
\t\treturn out;
\t});'''

# Fix: write correct JS source with proper backslash escapes
new_syn = (
    "\t\tif (kind === \"imageSequence\") {\n"
    "\t\t\tconst seqDir = String(packPath || vp.sequenceDir || \"\")\n"
    "\t\t\t\t.replace(/\\\\/g, \"/\")\n"
    "\t\t\t\t.replace(/\\/$/, \"\");\n"
    "\t\t\tout.sequenceDir = seqDir ? seqDir + \"/\" : \"\";\n"
    "\t\t\tout.path = out.sequenceDir || out.path;\n"
    "\t\t\tconst names: string[] = [];\n"
    "\t\t\tconst prefix = seqDir ? seqDir + \"/\" : \"sequences/\";\n"
    "\t\t\tfor (const key of fileKeys) {\n"
    "\t\t\t\tconst norm = key.replace(/^pack\\//, \"\");\n"
    "\t\t\t\tif (!norm.startsWith(prefix)) continue;\n"
    "\t\t\t\tconst base = norm.slice(prefix.length);\n"
    "\t\t\t\tif (!base || base.includes(\"/\")) continue;\n"
    "\t\t\t\tif (/\\.(png|jpe?g|webp|bmp|gif)$/i.test(base)) names.push(base);\n"
    "\t\t\t}\n"
    "\t\t\tnames.sort((a, b) =>\n"
    "\t\t\t\ta.localeCompare(b, undefined, { numeric: true, sensitivity: \"base\" }),\n"
    "\t\t\t);\n"
    "\t\t\tif (names.length) out.frameNames = names;\n"
    "\t\t}\n"
    "\t\treturn out;\n"
    "\t});"
)

if old_syn not in a:
    raise SystemExit("synthesize imageSequence block not found: " + repr(a[a.find('if (kind === \"imageSequence\")'):a.find('if (kind === \"imageSequence\")')+200] if 'imageSequence' in a else 'none'))
a = a.replace(old_syn, new_syn, 1)
at.write_text(a, encoding="utf-8")
print("synthesize frameNames patched")

# verify regex in new_syn file
snippet = at.read_text(encoding="utf-8")
i = snippet.find("const seqDir = String(packPath")
print("synthesize snippet", repr(snippet[i:i+120]))