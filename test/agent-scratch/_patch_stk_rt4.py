from pathlib import Path

ROOT = Path(r'D:\GrokbotWork\FreeFilmCut')

def read(p):
    return Path(p).read_text(encoding='utf-8')

def write(p, s):
    Path(p).write_bytes(s.encode('utf-8'))
    print('wrote', p)

# ---------- bindLiveMedia: derive rt from texturePath ----------
p = ROOT / 'freefilmcut/apps/web/src/vfxpack/text-template-media.ts'
s = read(p)

old = """\t\tconst packPathRaw = String(
\t\t\tud.__fccStickerData.texturePackPath || \"\",
\t\t);
\t\tconst packPath = packPathRaw.replace(/\\\\/g, \"/\").replace(/\\/$/, \"\");
\t\tconst rtUuid = String(ud.__fccStickerData.rtTargetUuid || \"\");"""

# Build from actual file slice to avoid escape issues
start = s.find('\t\tconst packPathRaw = String(')
end = s.find('\t\t// fcc-tl-flower-21:', start)
if start < 0 or end < 0:
    raise SystemExit(f'bind markers missing {start} {end}')
chunk = s[start:end]
print('CHUNK:\\n', repr(chunk))

new_chunk = """\t\tconst packPathRaw = String(
\t\t\tud.__fccStickerData.texturePackPath || \"\",
\t\t);
\t\tconst packPath = packPathRaw.replace(/\\\\/g, \"/\").replace(/\\/$/, \"\");
\t\tconst texPath = String(ud.__fccStickerData.texturePath || \"\");
\t\tconst rtFromPath = texPath.startsWith(\"rt:\") ? texPath.slice(3) : \"\";
\t\tconst rtUuid = String(
\t\t\tud.__fccStickerData.rtTargetUuid || rtFromPath || \"\",
\t\t);
"""

# Use exact chunk from file
desired = (
    '\t\tconst packPathRaw = String(\n'
    '\t\t\tud.__fccStickerData.texturePackPath || "",\n'
    '\t\t);\n'
    '\t\tconst packPath = packPathRaw.replace(/\\\\/g, "/").replace(/\\/$/, "");\n'
    '\t\tconst texPath = String(ud.__fccStickerData.texturePath || "");\n'
    '\t\tconst rtFromPath = texPath.startsWith("rt:") ? texPath.slice(3) : "";\n'
    '\t\tconst rtUuid = String(\n'
    '\t\t\tud.__fccStickerData.rtTargetUuid || rtFromPath || "",\n'
    '\t\t);\n'
)

# The file's packPath line - extract exact
lines = chunk.splitlines(keepends=True)
# Replace only the rtUuid line region within chunk
if 'rtFromPath' in chunk:
    print('already patched bind')
else:
    # Replace chunk with desired - need exact packPath line from file
    # Reconstruct from file lines 0..packPath then new rt lines
    # Find rtUuid line
    new_lines = []
    i = 0
    while i < len(lines):
        if lines[i].lstrip().startswith('const rtUuid = String('):
            # skip until closing );
            new_lines.append('\t\tconst texPath = String(ud.__fccStickerData.texturePath || "");\n')
            new_lines.append('\t\tconst rtFromPath = texPath.startsWith("rt:") ? texPath.slice(3) : "";\n')
            new_lines.append('\t\tconst rtUuid = String(\n')
            new_lines.append('\t\t\tud.__fccStickerData.rtTargetUuid || rtFromPath || "",\n')
            new_lines.append('\t\t);\n')
            # skip old rtUuid statement
            while i < len(lines) and ');' not in lines[i]:
                i += 1
            i += 1
            continue
        new_lines.append(lines[i])
        i += 1
    new_chunk_exact = ''.join(new_lines)
    s = s[:start] + new_chunk_exact + s[end:]
    write(p, s)
    print('bindLiveMedia patched')

# ---------- bump fcc-ui-204 -> 205 for sticker chain ----------
bump_files = [
    'three.js/editor/index.html',
    'three.js/editor/js/Sidebar.js',
    'three.js/editor/js/Sidebar.Object.js',
    'three.js/editor/js/Sidebar.Object.UI.js',
    'three.js/editor/js/Sidebar.Properties.js',
    'three.js/editor/js/TextTemplatePackExporter.js',
    'three.js/editor/js/Viewport.js',
    'three.js/editor/js/preview/PreviewCapture.js',
    'three.js/editor/js/preview/PreviewExportDialog.js',
    'three.js/editor/js/ui/UIOverlay.js',
]
for rel in bump_files:
    fp = ROOT / rel
    t = read(fp)
    # Only bump TextStickers-related and top-level chain refs that were 204
    # Safer: bump all fcc-ui-204 in these files since that was the sticker rev chain
    n = t.count('fcc-ui-204')
    if n:
        t2 = t.replace('fcc-ui-204', 'fcc-ui-205')
        # Also bump Sidebar.Object.TextStickers import in UI if still 204 after our earlier patch
        write(fp, t2)
        print(f'bumped {rel}: {n}')

# Ensure Sidebar.Object.UI points to TextStickers 205
p = ROOT / 'three.js/editor/js/Sidebar.Object.UI.js'
s = read(p)
s2 = s.replace('Sidebar.Object.TextStickers.js?v=fcc-ui-204', 'Sidebar.Object.TextStickers.js?v=fcc-ui-205')
s2 = s2.replace('Sidebar.Object.TextStickers.js?v=fcc-ui-205', 'Sidebar.Object.TextStickers.js?v=fcc-ui-205')  # noop safe
if s2 != s:
    write(p, s2)

# ---------- flower rev 44 ----------
p = ROOT / 'freefilmcut/apps/web/src/vfxpack/timeline-flower-text.ts'
s = read(p)
s2 = s.replace('rev: 43, // fcc-tl-flower-43: sticker follow char=each', 'rev: 44, // fcc-tl-flower-44: sprite sticker texturePath=rt:<uuid>')
if s2 == s:
    # try broader
    import re
    s2, n = re.subn(r'rev:\s*43,', 'rev: 44,', s, count=1)
    print('rev replace via regex', n)
write(p, s2)

p = ROOT / 'freefilmcut/apps/web/src/services/renderer/compositor/three-compositor.ts'
s = read(p)
s2 = s.replace('fcc-tl-flower-43: each+textureRange', 'fcc-tl-flower-44: sprite RT texture')
if s2 != s:
    write(p, s2)
else:
    print('three-compositor comment unchanged')

print('DONE bumps')
