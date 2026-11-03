from pathlib import Path
import sys
sys.stdout.reconfigure(encoding='utf-8')
p = Path(r'D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.TextStickers.js')
lines = p.read_text(encoding='utf-8').splitlines()
for i,l in enumerate(lines):
    if 'function mutate' in l or 'syncTextStickers' in l:
        print(f'{i+1}|{l}')
        for j in range(i, min(i+25, len(lines))):
            if j!=i: print(f'{j+1}|{lines[j]}')
            if j>i and lines[j].strip()=='}' and j>i+3:
                break
        print('---')
