from pathlib import Path
import re

root = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor")

# --- Builtins hint ---
builtins = root / "js/textanim/TextAnimBuiltins.js"
bt = builtins.read_text(encoding="utf-8")
bt2 = bt.replace(
    "hintZh: '在动画编辑器里对通道与进度打 K；错开会按字延迟同一条曲线（不是整体乘权重）。'",
    "hintZh: '在动画编辑器里对通道与进度打 K；错开=按字延迟同一条「起点→静息」曲线（不是整段共用当前插值）。'",
)
# Keep paramsMapped branch for safety but Engine no longer sets it for charIn.
# Soften mapped apply: use ctx.amount when present so p can stay as weight.
old_mix = """\t\t\tfunction mixOffset( v ) {

\t\t\t\tconst x = Number( v ) || 0;
\t\t\t\tif ( mapped ) return x * u;
\t\t\t\treturn isIn ? x * ( 1 - u ) : x * u;

\t\t\t}

\t\t\tfunction mixOpacity( v ) {

\t\t\t\tconst o = Number.isFinite( Number( v ) ) ? clamp01( Number( v ) ) : 1;
\t\t\t\tif ( mapped ) return 1 + ( o - 1 ) * u;
\t\t\t\t// in: lerp(start, 1, u); out: lerp(1, end, u)
\t\t\t\treturn isIn ? ( o + ( 1 - o ) * u ) : ( 1 + ( o - 1 ) * u );

\t\t\t}

\t\t\tfunction mixScale( v ) {

\t\t\t\tconst s0 = Number.isFinite( Number( v ) ) ? Number( v ) : 1;
\t\t\t\tif ( mapped ) return 1 + ( s0 - 1 ) * u;
\t\t\t\treturn isIn ? ( s0 + ( 1 - s0 ) * u ) : ( 1 + ( s0 - 1 ) * u );

\t\t\t}

\t\t\tfunction mixRot( v ) {

\t\t\t\tconst x = Number( v ) || 0;
\t\t\t\tif ( mapped ) return x * u;
\t\t\t\treturn isIn ? x * ( 1 - u ) : x * u;

\t\t\t}"""

new_mix = """\t\t\tconst amp = ( ctx.amount != null && Number.isFinite( Number( ctx.amount ) ) )
\t\t\t\t? Number( ctx.amount ) : 1;

\t\t\tfunction mixOffset( v ) {

\t\t\t\tconst x = Number( v ) || 0;
\t\t\t\t// mapped: absolute curve sample * intensity (legacy path)
\t\t\t\tif ( mapped ) return x * amp;
\t\t\t\treturn isIn ? x * ( 1 - u ) : x * u;

\t\t\t}

\t\t\tfunction mixOpacity( v ) {

\t\t\t\tconst o = Number.isFinite( Number( v ) ) ? clamp01( Number( v ) ) : 1;
\t\t\t\tif ( mapped ) return 1 + ( o - 1 ) * amp;
\t\t\t\t// in: lerp(start, 1, u); out: lerp(1, end, u)
\t\t\t\treturn isIn ? ( o + ( 1 - o ) * u ) : ( 1 + ( o - 1 ) * u );

\t\t\t}

\t\t\tfunction mixScale( v ) {

\t\t\t\tconst s0 = Number.isFinite( Number( v ) ) ? Number( v ) : 1;
\t\t\t\tif ( mapped ) return 1 + ( s0 - 1 ) * amp;
\t\t\t\treturn isIn ? ( s0 + ( 1 - s0 ) * u ) : ( 1 + ( s0 - 1 ) * u );

\t\t\t}

\t\t\tfunction mixRot( v ) {

\t\t\t\tconst x = Number( v ) || 0;
\t\t\t\tif ( mapped ) return x * amp;
\t\t\t\treturn isIn ? x * ( 1 - u ) : x * u;

\t\t\t}"""

if old_mix not in bt2:
    raise SystemExit('mix block not found in builtins')
bt2 = bt2.replace(old_mix, new_mix, 1)
builtins.write_text(bt2, encoding='utf-8')
print('builtins OK')

# --- bump versions ---
replacements = [
    ("fcc-tanim-21", "fcc-tanim-22"),
    ("fcc-anim-17", "fcc-anim-18"),
    ("fcc-ui-143", "fcc-ui-144"),
]

files = [
    root / "js/textanim/TextAnimTypes.js",
    root / "js/textanim/TextAnimEngine.js",
    root / "js/ui/TextAnim.js",
    root / "js/ui/TextAnimRuntime.js",
    root / "js/ui/TextAnimKeys.js",
    root / "js/ui/TextGeomFx.js",
    root / "js/Animation.js",
    root / "js/Viewport.js",
    root / "js/Sidebar.js",
    root / "js/anim/ThreeClipBridge.js",
    root / "js/timeline/FccTimelineCore.js",
    root / "index.html",
    root / "test/textanim-keys.test.mjs",
]

# Also bump sidebar object textanim if present
for p in (root / "js").rglob("Sidebar.Object.TextAnim.js"):
    files.append(p)

for f in files:
    if not f.exists():
        print('skip missing', f)
        continue
    t = f.read_text(encoding='utf-8')
    orig = t
    for a, b in replacements:
        t = t.replace(a, b)
    if t != orig:
        f.write_text(t, encoding='utf-8')
        print('bumped', f.name)
    else:
        print('no bump marks', f.name)

# --- update test for far-amp stagger ---
test = root / "test/textanim-keys.test.mjs"
tt = test.read_text(encoding='utf-8')
old_test = '''test( 'keyed offsetY+progress with delay: per-char delayed curve, not global*u', () => {

	const { anim, c } = charInAnim();
	c.selector.delay = 0.6;
	c.selector.amount = 1;
	c.selector.ease = 'linear';
	const n = 5;
	const progKeys = [ { t: 0, v: 0 }, { t: 1, v: 1 } ];
	const yKeys = [ { t: 0, v: - 36 }, { t: 1, v: 0 } ];
	const values = new Map( [ [ c.id + '.progress', 0.5 ] ] );
	const keys = new Map( [
		[ c.id + '.progress', progKeys ],
		[ c.id + '.offsetY', yKeys ],
	] );
	const s = sampleTextAnim( anim, n, { values, keys } );
	const ys = s.charPoses.map( ( p ) => p.offsetY );
	// With delay 0.6 at global progress 0.5, ranks span different local u → different Y.
	assert.ok( ys[ 0 ] > ys[ n - 1 ] - 1e-6, 'earlier chars closer to rest (0) than later: ' + ys );
	assert.ok( Math.abs( ys[ 0 ] - ys[ n - 1 ] ) > 5, 'visible stagger, not rigid: ' + ys );
	// First rank at localP=1 → Y≈0; last still near start.
	near( ys[ 0 ], 0, 0.5 );
	assert.ok( ys[ n - 1 ] < - 10, 'late char still below: ' + ys[ n - 1 ] );

} );'''

new_test = '''test( 'keyed offsetY+progress with delay: far-amp x weight stagger, not global*u', () => {

	const { anim, c } = charInAnim();
	c.selector.delay = 0.6;
	c.selector.amount = 1;
	c.selector.ease = 'linear';
	const n = 5;
	const progKeys = [ { t: 0, v: 0 }, { t: 1, v: 1 } ];
	const yKeys = [ { t: 0, v: - 36 }, { t: 1, v: 0 } ];
	const values = new Map( [ [ c.id + '.progress', 0.5 ] ] );
	const keys = new Map( [
		[ c.id + '.progress', progKeys ],
		[ c.id + '.offsetY', yKeys ],
	] );
	const s = sampleTextAnim( anim, n, { values, keys } );
	const ys = s.charPoses.map( ( p ) => p.offsetY );
	// Far amp is -36 (key at progress 0); each char gets -36*(1-u_i).
	assert.ok( ys[ 0 ] > ys[ n - 1 ] - 1e-6, 'earlier chars closer to rest (0) than later: ' + ys );
	assert.ok( Math.abs( ys[ 0 ] - ys[ n - 1 ] ) > 5, 'visible stagger, not rigid: ' + ys );
	near( ys[ 0 ], 0, 0.5 );
	assert.ok( ys[ n - 1 ] < - 10, 'late char still below: ' + ys[ n - 1 ] );

	// Live global Y must NOT be used as amplitude (would compress to ~-18 span).
	values.set( c.id + '.offsetY', - 18 );
	const s2 = sampleTextAnim( anim, n, { values, keys } );
	near( s2.charPoses[ n - 1 ].offsetY, ys[ n - 1 ], 0.5 );

	// Without keys map, still staggers from first-key fallback via values? 
	// No keys → far falls back to static params (rest 0) unless sidebar set.
	c.params.offsetY = - 36;
	const s3 = sampleTextAnim( anim, n, { values: new Map( [ [ c.id + '.progress', 0.5 ] ] ) } );
	assert.ok( Math.abs( s3.charPoses[ 0 ].offsetY - s3.charPoses[ n - 1 ].offsetY ) > 5, 'sidebar far amp staggers' );

} );

test( 'regression: paramsMapped absolute path must not zero motion if engaged', () => {

	const { anim, c } = charInAnim();
	c.selector.delay = 0;
	const values = new Map( [ [ c.id + '.progress', 0 ], [ c.id + '.offsetY', - 36 ] ] );
	const keys = new Map( [
		[ c.id + '.progress', [ { t: 0, v: 0 }, { t: 1, v: 1 } ] ],
		[ c.id + '.offsetY', [ { t: 0, v: - 36 }, { t: 1, v: 0 } ] ],
	] );
	const s0 = sampleTextAnim( anim, 3, { values, keys } );
	near( s0.charPoses[ 0 ].offsetY, - 36, 0.5 );
	values.set( c.id + '.progress', 1 );
	values.set( c.id + '.offsetY', 0 );
	const s1 = sampleTextAnim( anim, 3, { values, keys } );
	near( s1.charPoses[ 0 ].offsetY, 0, 0.5 );

} );'''

if old_test not in tt:
    # try after version bump already applied
    if 'far-amp x weight stagger' in tt:
        print('test already updated')
    else:
        raise SystemExit('old test block not found')
else:
    tt = tt.replace(old_test, new_test, 1)
    test.write_text(tt, encoding='utf-8')
    print('test OK')

print('done')
