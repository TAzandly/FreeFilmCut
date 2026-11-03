from pathlib import Path
import sys
sys.stdout.reconfigure(encoding='utf-8')
for rel in [
 'three.js/editor/js/ui/TextStickers.js',
 'freefilmcut/apps/web/src/vfxpack/text-stickers.js',
]:
 p = Path(r'D:\GrokbotWork\FreeFilmCut')/rel
 lines = p.read_text(encoding='utf-8').splitlines()
 print('====', rel)
 for i,l in enumerate(lines):
  if 'rtTargetUuid' in l or 'texturePackPath' in l or 'textureFileName' in l:
   if 100 < i < 250 or i > 1400:
    print(f'{i+1}|{l}')
