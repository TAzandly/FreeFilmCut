from pathlib import Path

path = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\scene-builder.ts")
text = path.read_text(encoding="utf-8")
orig = text

# 1) baseLayout: take ui arg (editor parity) instead of closed-over parent fccUI
old_base = '''\t\t\t\tconst baseLayout = (
\t\t\t\t\ttroika: InstanceType<typeof TroikaText>,
\t\t\t\t\trectW: number,
\t\t\t\t) => {
\t\t\t\t\tconst fontSize = Number(fccUI.fontSize) > 0 ? Number(fccUI.fontSize) : 48;
\t\t\t\t\tconst align = String(fccUI.align || "center");
\t\t\t\t\tconst vAlign = String(fccUI.verticalAlign || "middle");
\t\t\t\t\tconst fontUrl =
\t\t\t\t\t\tfccUI.bold && fccUI.fontBold
\t\t\t\t\t\t\t? resolveFont(String(fccUI.fontBold))
\t\t\t\t\t\t\t: resolveFont(String(fccUI.font || ""));
\t\t\t\t\ttroika.font = fontUrl;
\t\t\t\t\ttroika.fontSize = fontSize;
\t\t\t\t\ttroika.sdfGlyphSize = Math.max(
\t\t\t\t\t\tNumber(troika.sdfGlyphSize) || 0,
\t\t\t\t\t\tFCC_TROIKA_SDF_GLYPH_SIZE,
\t\t\t\t\t);
\t\t\t\t\ttroika.anchorX =
\t\t\t\t\t\talign === "left" ? "left" : align === "right" ? "right" : "center";
\t\t\t\t\ttroika.anchorY =
\t\t\t\t\t\tvAlign === "top" ? "top" : vAlign === "bottom" ? "bottom" : "middle";
\t\t\t\t\ttroika.textAlign =
\t\t\t\t\t\talign === "left" || align === "right" || align === "justify"
\t\t\t\t\t\t\t? align
\t\t\t\t\t\t\t: "center";
\t\t\t\t\ttroika.letterSpacing = Number(fccUI.letterSpacing) || 0;
\t\t\t\t\ttroika.lineHeight =
\t\t\t\t\t\tNumber(fccUI.lineHeight) > 0 ? Number(fccUI.lineHeight) : 1.2;
\t\t\t\t\ttroika.maxWidth = rectW > 0 ? rectW : Number(fccUI.sizeDelta?.[0]) || 400;
\t\t\t\t\ttroika.overflowWrap = "break-word";
\t\t\t\t\ttroika.frustumCulled = false;
\t\t\t\t\ttroika.text = String(fccUI.text ?? "");
\t\t\t\t\ttroika.outlineWidth = 0;
\t\t\t\t\ttroika.outlineOpacity = 0;
\t\t\t\t\ttroika.outlineBlur = 0;
\t\t\t\t\ttroika.outlineOffsetX = 0;
\t\t\t\t\ttroika.outlineOffsetY = 0;
\t\t\t\t\ttroika.strokeWidth = 0;
\t\t\t\t\ttroika.strokeOpacity = 0;
\t\t\t\t\ttroika.position.set(0, 0, 0);
\t\t\t\t};'''

new_base = '''\t\t\t\t// Must take `ui` (not closed-over parent fccUI): char-split calls
\t\t\t\t// syncText(rect, { group: charGroup, ui: charUI }) with one glyph.
\t\t\t\t// Using parent fccUI.text painted the full string on every char clone
\t\t\t\t// -> two animated full copies at caret offsets (stacked double text).
\t\t\t\tconst baseLayout = (
\t\t\t\t\ttroika: InstanceType<typeof TroikaText>,
\t\t\t\t\tui: typeof fccUI,
\t\t\t\t\trectW: number,
\t\t\t\t) => {
\t\t\t\t\tconst fontSize = Number(ui.fontSize) > 0 ? Number(ui.fontSize) : 48;
\t\t\t\t\tconst align = String(ui.align || "center");
\t\t\t\t\tconst vAlign = String(ui.verticalAlign || "middle");
\t\t\t\t\tconst fontUrl =
\t\t\t\t\t\tui.bold && ui.fontBold
\t\t\t\t\t\t\t? resolveFont(String(ui.fontBold))
\t\t\t\t\t\t\t: resolveFont(String(ui.font || ""));
\t\t\t\t\ttroika.font = fontUrl;
\t\t\t\t\ttroika.fontSize = fontSize;
\t\t\t\t\ttroika.sdfGlyphSize = Math.max(
\t\t\t\t\t\tNumber(troika.sdfGlyphSize) || 0,
\t\t\t\t\t\tFCC_TROIKA_SDF_GLYPH_SIZE,
\t\t\t\t\t);
\t\t\t\t\ttroika.anchorX =
\t\t\t\t\t\talign === "left" ? "left" : align === "right" ? "right" : "center";
\t\t\t\t\ttroika.anchorY =
\t\t\t\t\t\tvAlign === "top" ? "top" : vAlign === "bottom" ? "bottom" : "middle";
\t\t\t\t\ttroika.textAlign =
\t\t\t\t\t\talign === "left" || align === "right" || align === "justify"
\t\t\t\t\t\t\t? align
\t\t\t\t\t\t\t: "center";
\t\t\t\t\ttroika.letterSpacing = Number(ui.letterSpacing) || 0;
\t\t\t\t\ttroika.lineHeight =
\t\t\t\t\t\tNumber(ui.lineHeight) > 0 ? Number(ui.lineHeight) : 1.2;
\t\t\t\t\ttroika.maxWidth = rectW > 0 ? rectW : Number(ui.sizeDelta?.[0]) || 400;
\t\t\t\t\ttroika.overflowWrap = "break-word";
\t\t\t\t\ttroika.frustumCulled = false;
\t\t\t\t\ttroika.text = String(ui.text ?? "");
\t\t\t\t\ttroika.outlineWidth = 0;
\t\t\t\t\ttroika.outlineOpacity = 0;
\t\t\t\t\ttroika.outlineBlur = 0;
\t\t\t\t\ttroika.outlineOffsetX = 0;
\t\t\t\t\ttroika.outlineOffsetY = 0;
\t\t\t\t\ttroika.strokeWidth = 0;
\t\t\t\t\ttroika.strokeOpacity = 0;
\t\t\t\t\ttroika.position.set(0, 0, 0);
\t\t\t\t};'''

if old_base not in text:
    raise SystemExit("baseLayout block not found")
text = text.replace(old_base, new_base, 1)

# 2) applyPass: forward ui into baseLayout
old_apply = '''\t\t\t\tconst applyPass = (
\t\t\t\t\ttroika: InstanceType<typeof TroikaText>,
\t\t\t\t\tpass: Pass,
\t\t\t\t\trectW: number,
\t\t\t\t\tz: number,
\t\t\t\t) => {
\t\t\t\t\tbaseLayout(troika, rectW);'''

new_apply = '''\t\t\t\tconst applyPass = (
\t\t\t\t\ttroika: InstanceType<typeof TroikaText>,
\t\t\t\t\tpass: Pass,
\t\t\t\t\trectW: number,
\t\t\t\t\tz: number,
\t\t\t\t\tui: typeof fccUI,
\t\t\t\t) => {
\t\t\t\t\tbaseLayout(troika, ui, rectW);'''

if old_apply not in text:
    raise SystemExit("applyPass signature not found")
text = text.replace(old_apply, new_apply, 1)

# 3) call site inside syncText
old_call = "\t\t\t\t\t\tapplyPass(mesh, pass, w, z);"
new_call = "\t\t\t\t\t\tapplyPass(mesh, pass, w, z, ui);"
if text.count(old_call) != 1:
    raise SystemExit(f"applyPass call count={text.count(old_call)}")
text = text.replace(old_call, new_call, 1)

# 4) bump sig so existing flower scenes rebuild with single-glyph chars
old_sig = "sigRev: 13, // fcc-tl-flower-13: park originals while char-split (editor hideOrig)"
new_sig = "sigRev: 14, // fcc-tl-flower-14: char sync uses charUI.text (not parent fccUI)"
if old_sig not in text:
    raise SystemExit("sigRev not found")
text = text.replace(old_sig, new_sig, 1)

if text == orig:
    raise SystemExit("no changes made")
path.write_text(text, encoding="utf-8")
print("OK patched scene-builder.ts")
print("remaining fccUI.text in baseLayout area:", "troika.text = String(fccUI.text" in text)
print("has ui.text assign:", 'troika.text = String(ui.text ?? "")' in text)
