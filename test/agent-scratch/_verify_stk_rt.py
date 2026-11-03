from pathlib import Path
import sys
sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(r'D:\GrokbotWork\FreeFilmCut')
checks = []

def check(name, ok):
    checks.append((name, ok))

t = (ROOT/'three.js/editor/js/ui/TextStickers.js').read_text(encoding='utf-8')
check('editor import RT', 'textureForRenderTextureUuid' in t)
check('editor isStickerRtPath', 'function isStickerRtPath' in t)
check('editor stamp', 'stampStickerTexRtSlot' in t)
check('editor live RT load', 'Live MediaFrame RT' in t)
check('editor normalize rt', 'rtTargetUuid' in t and 'fromPath' in t)
check('editor serialize rt', 'out.rtTargetUuid' in t)

t = (ROOT/'three.js/editor/js/Sidebar.Object.TextStickers.js').read_text(encoding='utf-8')
check('sidebar listRT', 'listRenderTextureOptions' in t)
check('sidebar rtSelect', 'const rtSelect' in t)
check('sidebar import 205', 'TextStickers.js?v=fcc-ui-205' in t)
check('sidebar set rt', 'st.texturePath = curPath' in t)

t = (ROOT/'freefilmcut/apps/web/src/vfxpack/text-stickers.js').read_text(encoding='utf-8')
check('clip skip rt', 'never TextureLoader on rt:' in t)
check('clip derive rt', 'fromPath' in t)

t = (ROOT/'freefilmcut/apps/web/src/vfxpack/apply-text-template.ts').read_text(encoding='utf-8')
check('remap rt', 'Sprite sticker authored against a live RenderTexture' in t)
check('scene spriteTex', 'spriteTex.startsWith' in t)

t = (ROOT/'freefilmcut/apps/web/src/vfxpack/text-template-media.ts').read_text(encoding='utf-8')
check('collect addRtPath', 'addRtPath(tp)' in t)
check('bind rtFromPath', 'rtFromPath' in t)
# verify packPath regex still correct
idx = t.find('packPathRaw.replace')
snippet = t[idx:idx+80]
check('packPath regex ok', r'replace(/\\/g' in t or 'replace(/\\\\/g' in snippet)
print('packPath snippet:', repr(snippet))

t = (ROOT/'three.js/editor/index.html').read_text(encoding='utf-8')
check('index 205', 'fcc-ui-205' in t)
check('index no 204', 'fcc-ui-204' not in t)

t = (ROOT/'freefilmcut/apps/web/src/vfxpack/timeline-flower-text.ts').read_text(encoding='utf-8')
check('flower rev 44', 'rev: 44' in t)

# remaining 204 for stickers chain
for rel in ['Sidebar.Object.UI.js','Sidebar.Object.js','TextTemplatePackExporter.js','Viewport.js','UIOverlay.js']:
    hits = []
    for p in ROOT.rglob(rel):
        if 'node_modules' in str(p): continue
        tt = p.read_text(encoding='utf-8')
        if 'fcc-ui-204' in tt:
            hits.append(str(p))
    check(f'no 204 in {rel}', not hits)

for name, ok in checks:
    print(('OK' if ok else 'FAIL'), name)
print('FAILS', sum(1 for _, ok in checks if not ok))
