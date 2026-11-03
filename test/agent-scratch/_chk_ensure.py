from pathlib import Path
import sys
sys.stdout.reconfigure(encoding='utf-8')
p = Path(r'D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\TextStickers.js')
lines = p.read_text(encoding='utf-8').splitlines()
# print ensureTextStickersOnUI and sidebar mutate path
for i,l in enumerate(lines):
    if 'ensureTextStickersOnUI' in l or 'Object.assign' in l or 'rtTargetUuid' in l:
        print(f'{i+1}|{l}')
print('====ENSURE BODY====')
start = next(i for i,l in enumerate(lines) if 'export function ensureTextStickersOnUI' in l)
for i in range(start, start+40):
    print(f'{i+1}|{lines[i]}')
