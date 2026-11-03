from pathlib import Path
path = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\UIText.js")
src = path.read_text(encoding="utf-8")
old = """\tfor ( let i = 0; i < strokes.length; i ++ ) {

\t\tpasses.push( { kind: 'stroke', name: FCC_FLOWER_PREFIX + 'stroke_' + i, layer: strokes[ i ] } );

\t}

\tpasses.push( {
\t\tkind: 'face',
\t\tname: FCC_FLOWER_FACE,
\t\tlayer: style.fill || { alpha: 1, content: { renderType: 'solid', solid: { color: '#ffffff', alpha: 1 } } },
\t} );

\tfor ( let i = 0; i < inners.length; i ++ ) {

\t\tpasses.push( { kind: 'inner', name: FCC_FLOWER_PREFIX + 'inner_' + i, layer: inners[ i ] } );

\t}
"""
new = """\tfor ( let i = 0; i < strokes.length; i ++ ) {

\t\tpasses.push( { kind: 'stroke', name: FCC_FLOWER_PREFIX + 'stroke_' + i, layer: strokes[ i ] } );

\t}

\t// Inner shadows before face (P1 approx — true SDF inset is P2+)
\tfor ( let i = 0; i < inners.length; i ++ ) {

\t\tpasses.push( { kind: 'inner', name: FCC_FLOWER_PREFIX + 'inner_' + i, layer: inners[ i ] } );

\t}

\tpasses.push( {
\t\tkind: 'face',
\t\tname: FCC_FLOWER_FACE,
\t\tlayer: style.fill || { alpha: 1, content: { renderType: 'solid', solid: { color: '#ffffff', alpha: 1 } } },
\t} );
"""
if old not in src:
    raise SystemExit('buildFlowerPasses block not found')
path.write_bytes(src.replace(old, new).replace('\r\n','\n').encode('utf-8'))
print('inner order fixed')