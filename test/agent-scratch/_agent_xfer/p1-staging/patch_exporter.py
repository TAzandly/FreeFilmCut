# -*- coding: utf-8 -*-
from pathlib import Path

# --- VfxPackExporter: export flowerStyle ---
p = Path(r'D:\GrokbotWork\FreeFilmCut\three.js\editor\js\VfxPackExporter.js')
src = p.read_text(encoding='utf-8')
old = """\t\t\t\tnode.ui.outline = fcc.outline ? { ...fcc.outline } : { enabled: false, width: 2, color: '#000000', opacity: 1 };
\t\t\t\tnode.ui.shadow = fcc.shadow ? { ...fcc.shadow } : { enabled: false, offsetX: 2, offsetY: -2, blur: 4, color: '#000000', opacity: 0.75 };

\t\t\t}
"""
new = """\t\t\t\tnode.ui.outline = fcc.outline ? { ...fcc.outline } : { enabled: false, width: 2, color: '#000000', opacity: 1 };
\t\t\t\tnode.ui.shadow = fcc.shadow ? { ...fcc.shadow } : { enabled: false, offsetX: 2, offsetY: -2, blur: 4, color: '#000000', opacity: 0.75 };
\t\t\t\tif ( fcc.flowerStyle && typeof fcc.flowerStyle === 'object' ) {

\t\t\t\t\ttry {

\t\t\t\t\t\tnode.ui.flowerStyle = JSON.parse( JSON.stringify( fcc.flowerStyle ) );

\t\t\t\t\t} catch ( e ) {

\t\t\t\t\t\tnode.ui.flowerStyle = fcc.flowerStyle;

\t\t\t\t\t}

\t\t\t\t}

\t\t\t}
"""
if old not in src:
    raise SystemExit('exporter block not found')
if 'flowerStyle' not in src:
    src = src.replace(old, new)
    p.write_bytes(src.replace('\r\n','\n').encode('utf-8'))
    print('exporter OK')
else:
    print('exporter already has flowerStyle')