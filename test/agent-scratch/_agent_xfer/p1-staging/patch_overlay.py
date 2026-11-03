# -*- coding: utf-8 -*-
from pathlib import Path

# ui-overlay: add flowerStyle type
p = Path(r'D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\ui-overlay.ts')
src = p.read_text(encoding='utf-8')
if 'flowerStyle' not in src:
    old = '''\tshadow?: {
\t\tenabled?: boolean;
\t\toffsetX?: number;
\t\toffsetY?: number;
\t\tblur?: number;
\t\tcolor?: string;
\t\topacity?: number;
\t};
};

export type FccUIData = FccUIRect & { type: string };
'''
    new = '''\tshadow?: {
\t\tenabled?: boolean;
\t\toffsetX?: number;
\t\toffsetY?: number;
\t\tblur?: number;
\t\tcolor?: string;
\t\topacity?: number;
\t};
\t/** FlowerStyle (花字) Effect stack — see flower-style.ts */
\tflowerStyle?: unknown;
};

export type FccUIData = FccUIRect & { type: string };
'''
    if old not in src:
        raise SystemExit('ui-overlay type block not found')
    src = src.replace(old, new)
    p.write_bytes(src.replace('\r\n','\n').encode('utf-8'))
    print('ui-overlay OK')
else:
    print('ui-overlay already')