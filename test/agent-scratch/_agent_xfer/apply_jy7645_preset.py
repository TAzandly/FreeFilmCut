# -*- coding: utf-8 -*-
"""Append Jianying 7645 FlowerStyle preset + wire sidebar + bump fcc-ui-72."""
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut")
EDITOR = ROOT / "three.js" / "editor"
FS = EDITOR / "js" / "ui" / "FlowerStyle.js"
SIDEBAR = EDITOR / "js" / "Sidebar.Object.UI.js"
INDEX = EDITOR / "index.html"
ASSETS = EDITOR / "assets" / "flower" / "7645"

PRESET_JS = r'''
/**
 * CapCut artistEffect pack id 7645318555541638462 (花字库).
 * Textures live under editor/assets/flower/7645/ (relative URLs for the editor server).
 */
export const JIANYING_7645_PACK_ID = '7645318555541638462';
export const JIANYING_7645_ASSET_DIR = 'assets/flower/7645';

/** CapCut stroke width is ~em fraction → Troika outlineWidth in world units. */
export function capcutStrokeWidthToFcc( width, fontSize = 48 ) {

	const fs = Number( fontSize ) > 0 ? Number( fontSize ) : 48;
	return Math.max( 0, Number( width ) || 0 ) * fs;

}

/** CapCut diffuse is small relative → Troika outlineBlur. */
export function capcutDiffuseToFcc( diffuse, fontSize = 48 ) {

	const fs = Number( fontSize ) > 0 ? Number( fontSize ) : 48;
	return Math.max( 0, Number( diffuse ) || 0 ) * fs;

}

/**
 * CapCut shadow distance looks absolute at design size (~fontSize 48);
 * scale linearly with current fontSize.
 */
export function capcutDistanceToFcc( distance, fontSize = 48 ) {

	const fs = Number( fontSize ) > 0 ? Number( fontSize ) : 48;
	return Math.max( 0, Number( distance ) || 0 ) * ( fs / 48 );

}

function jy7645Tex( fileName, opts = {} ) {

	const path = JIANYING_7645_ASSET_DIR + '/' + fileName;
	return createTextureContent( {
		path,
		fileName,
		fallbackColor: opts.fallbackColor || '#ffffff',
		alpha: opts.alpha != null ? opts.alpha : 1,
		angle: opts.angle != null ? opts.angle : 0,
		scale: opts.scale != null ? opts.scale : 1,
	} );

}

/**
 * Build FlowerStyle approximating CapCut pack 7645318555541638462.
 * CapCut uses shadows-with-nested-strokes for offset multi-rings; we flatten to
 * concentric outer strokes + outer shadows + fill + inner shadow (data).
 *
 * @param {number} [fontSize=48] current Text fontSize for unit mapping
 * @returns {object} normalized FlowerStyle
 */
export function createJianying7645FlowerStyle( fontSize = 48 ) {

	const fs = Number( fontSize ) > 0 ? Number( fontSize ) : 48;

	// CapCut fill: solid white
	const fill = { alpha: 1, content: createSolidContent( '#ffffff', 1 ) };

	// CapCut top-level strokes: []; rings come from shadow[*].strokes — flatten outer→inner (wide→narrow)
	const strokes = [
		// shadow[3] nested: white ring (widest)
		createStrokeLayer( {
			enable: true,
			side: 'outer',
			width: capcutStrokeWidthToFcc( 0.14500875656742557, fs ),
			alpha: 1,
			content: createSolidContent( '#ffffff', 1 ),
		} ),
		// shadow[2] nested: deep blue ring
		createStrokeLayer( {
			enable: true,
			side: 'outer',
			width: capcutStrokeWidthToFcc( 0.12, fs ),
			alpha: 1,
			content: createSolidContent( '#024479', 1 ),
		} ),
		// shadow[1] nested stroke #2: purple texture (1780131838447)
		createStrokeLayer( {
			enable: true,
			side: 'outer',
			width: capcutStrokeWidthToFcc( 0.102276707530648, fs ),
			alpha: 1,
			content: jy7645Tex( '1780131838447.png', { fallbackColor: '#472fd3', angle: 0, scale: 1 } ),
		} ),
		// shadow[1] nested stroke #1: magenta texture (1780131613632)
		createStrokeLayer( {
			enable: true,
			side: 'outer',
			width: capcutStrokeWidthToFcc( 0.0574430823117338, fs ),
			alpha: 1,
			content: jy7645Tex( '1780131613632.png', { fallbackColor: '#d94895', angle: 9, scale: 1 } ),
		} ),
	];

	// Outer shadows (back → front). CapCut shadow[1] texture body approximated as underlay at dist 0.
	const shadows = [
		// shadow[4]: pink soft drop
		createShadowLayer( {
			enable: true,
			angle: - 89.99,
			distance: capcutDistanceToFcc( 4.548161120840636, fs ),
			diffuse: capcutDiffuseToFcc( 0.059836544074722706, fs ),
			alpha: 0.9,
			content: createSolidContent( '#fb9ffb', 1 ),
		} ),
		// shadow[0]: purple gradient glow (distance 0)
		createShadowLayer( {
			enable: true,
			angle: - 45,
			distance: 0,
			diffuse: capcutDiffuseToFcc( 0.005545826036193811, fs ),
			alpha: 0.8861646234676007,
			content: createGradientContent( {
				colors: [ '#a018a0', '#1c000b' ],
				alphas: [ 1, 1 ],
				stops: [ 0.4668141592920354, 0.7411504424778761 ],
				angle: 90,
			} ),
		} ),
		// shadow[1]: textured underlay (body) — peeks under thicker stroke bands
		createShadowLayer( {
			enable: true,
			angle: - 45,
			distance: 0,
			diffuse: 0,
			alpha: 1,
			content: jy7645Tex( '1780131613632.png', { fallbackColor: '#d94895', angle: 0, scale: 1 } ),
		} ),
	];

	// CapCut inner_shadows[0]: texture inset (stencil path still imperfect — keep data)
	const innerShadows = [
		createShadowLayer( {
			enable: true,
			angle: - 45,
			distance: capcutDistanceToFcc( 5.0, fs ),
			diffuse: capcutDiffuseToFcc( 0.025, fs ),
			alpha: 0.9,
			content: jy7645Tex( '1780131462621.png', {
				fallbackColor: '#fdd3ef',
				angle: 0,
				scale: 1.3,
			} ),
		} ),
	];

	return normalizeFlowerStyle( {
		version: FLOWER_STYLE_VERSION,
		id: JIANYING_7645_PACK_ID,
		name: '剪映样例',
		fill,
		strokes,
		shadows,
		innerShadows,
		anims: { in: null, out: null, loop: null },
	} );

}

/** Named presets for sidebar / future 花字库 panel. */
export const FLOWER_PRESETS = [
	{
		id: JIANYING_7645_PACK_ID,
		name: '剪映样例',
		cover: JIANYING_7645_ASSET_DIR + '/cover_icon.png',
		create: createJianying7645FlowerStyle,
	},
];

/**
 * Collect texture path URLs used by a FlowerStyle (for prefetch / export seed).
 * @param {object} style
 * @returns {string[]}
 */
export function collectFlowerTexturePaths( style ) {

	const out = [];
	const seen = new Set();

	function addContent( content ) {

		const c = normalizeFillContent( content );
		if ( c.renderType === 'texture' && c.texture && c.texture.path ) {

			const p = c.texture.path;
			if ( ! seen.has( p ) ) {

				seen.add( p );
				out.push( p );

			}

		}

	}

	const s = normalizeFlowerStyle( style );
	addContent( s.fill && s.fill.content );
	( s.strokes || [] ).forEach( ( st ) => addContent( st.content ) );
	( s.shadows || [] ).forEach( ( sh ) => addContent( sh.content ) );
	( s.innerShadows || [] ).forEach( ( sh ) => addContent( sh.content ) );
	return out;

}
'''

text = FS.read_text(encoding='utf-8')
if 'createJianying7645FlowerStyle' not in text:
    FS.write_text(text.rstrip() + '\n' + PRESET_JS, encoding='utf-8')
    print('FlowerStyle.js: appended preset')
else:
    print('FlowerStyle.js: preset already there')

# --- Sidebar: import + button ---
sb = SIDEBAR.read_text(encoding='utf-8')
old_import = """import {
	createDefaultFlowerStyle,
	createStrokeLayer,
	createInnerStrokeLayer,
	createShadowLayer,
	createSolidContent,
	createGradientContent,
	createTextureContent,
	cloneFlowerStyle,
	normalizeFlowerStyle,
	flowerStyleFromLegacy,
	normalizeFillContent,
} from './ui/FlowerStyle.js?v=fcc-ui-71';"""

new_import = """import {
	createDefaultFlowerStyle,
	createStrokeLayer,
	createInnerStrokeLayer,
	createShadowLayer,
	createSolidContent,
	createGradientContent,
	createTextureContent,
	cloneFlowerStyle,
	normalizeFlowerStyle,
	flowerStyleFromLegacy,
	normalizeFillContent,
	createJianying7645FlowerStyle,
	collectFlowerTexturePaths,
	JIANYING_7645_ASSET_DIR,
} from './ui/FlowerStyle.js?v=fcc-ui-72';"""

if 'createJianying7645FlowerStyle' not in sb:
    if old_import not in sb:
        # try flexible replace
        sb2 = re.sub(
            r"import \{\n\tcreateDefaultFlowerStyle,[\s\S]*?\} from '\./ui/FlowerStyle\.js\?v=fcc-ui-\d+';",
            new_import,
            sb,
            count=1,
        )
        if sb2 == sb:
            raise SystemExit('Sidebar import block not found')
        sb = sb2
    else:
        sb = sb.replace(old_import, new_import)
    print('Sidebar: import updated')
else:
    sb = sb.replace("FlowerStyle.js?v=fcc-ui-71", "FlowerStyle.js?v=fcc-ui-72")
    print('Sidebar: import already has preset, bump version')

# Add prefetch helper once near writeFlowerStyle
prefetch_fn = r'''
	async function prefetchFlowerTextures( style ) {

		const paths = collectFlowerTexturePaths( style );
		if ( ! paths.length ) return;
		if ( ! editor._fccFlowerTexBytes ) editor._fccFlowerTexBytes = new Map();
		for ( let i = 0; i < paths.length; i ++ ) {

			const path = paths[ i ];
			if ( editor._fccFlowerTexBytes.has( path ) ) continue;
			if ( path.startsWith( 'blob:' ) || path.startsWith( 'data:' ) ) continue;
			try {

				const res = await fetch( path );
				if ( ! res.ok ) throw new Error( 'HTTP ' + res.status );
				const buf = await res.arrayBuffer();
				const name = path.split( '/' ).pop() || ( 'flower_' + i + '.png' );
				editor._fccFlowerTexBytes.set( path, { name: name, buffer: buf, type: 'image/png' } );

			} catch ( e ) {

				console.warn( '[FreeFilmCut] prefetch flower texture failed', path, e );

			}

		}

	}

'''

if 'prefetchFlowerTextures' not in sb:
    # insert before function writeFlowerStyle
    if 'function writeFlowerStyle( style, opts )' not in sb:
        raise SystemExit('writeFlowerStyle not found')
    sb = sb.replace(
        'function writeFlowerStyle( style, opts )',
        prefetch_fn + '\tfunction writeFlowerStyle( style, opts )',
        1,
    )
    print('Sidebar: prefetch helper added')

# Insert 剪映样例 button after resetBtn toolRow.add( resetBtn );
btn_snip = r'''
		const jyBtn = new UIButton( '剪映样例' ).setMarginLeft( '4px' ).onClick( function () {

			const object = editor.selected;
			if ( ! isUIText( object ) ) return;
			const cur = getFccUI( object ) || {};
			const fs = Number( cur.fontSize ) > 0 ? Number( cur.fontSize ) : 48;
			const style = createJianying7645FlowerStyle( fs );
			prefetchFlowerTextures( style ).then( function () {

				writeFlowerStyle( style, { rebuild: true } );

			} ).catch( function () {

				writeFlowerStyle( style, { rebuild: true } );

			} );

		} );
		toolRow.add( jyBtn );
'''

if '剪映样例' not in sb:
    needle = "toolRow.add( resetBtn );"
    if needle not in sb:
        raise SystemExit('toolRow.add( resetBtn ) not found')
    sb = sb.replace(needle, needle + '\n' + btn_snip, 1)
    print('Sidebar: 剪映样例 button added')
else:
    print('Sidebar: button already present')

# Bump UIText / UIConstants imports in Sidebar from 71 -> 72
sb = sb.replace("UIConstants.js?v=fcc-ui-71", "UIConstants.js?v=fcc-ui-72")
sb = sb.replace("UIRectLayout.js?v=fcc-ui-71", "UIRectLayout.js?v=fcc-ui-72")
sb = sb.replace("UIText.js?v=fcc-ui-71", "UIText.js?v=fcc-ui-72")
sb = sb.replace("FlowerStyle.js?v=fcc-ui-71", "FlowerStyle.js?v=fcc-ui-72")
SIDEBAR.write_text(sb, encoding='utf-8')
print('Sidebar.Object.UI.js written')

# UIText import bump
uit = (EDITOR / "js" / "ui" / "UIText.js").read_text(encoding='utf-8')
uit2 = uit.replace("FlowerStyle.js?v=fcc-ui-71", "FlowerStyle.js?v=fcc-ui-72")
if uit2 != uit:
    (EDITOR / "js" / "ui" / "UIText.js").write_text(uit2, encoding='utf-8')
    print('UIText.js: FlowerStyle import bumped')

# index.html + Sidebar chain bump to 72 for key modules
idx = INDEX.read_text(encoding='utf-8')
for a, b in [
    ("Editor.js?v=fcc-ui-71", "Editor.js?v=fcc-ui-72"),
    ("Viewport.js?v=fcc-ui-71", "Viewport.js?v=fcc-ui-72"),
    ("Sidebar.js?v=fcc-ui-71", "Sidebar.js?v=fcc-ui-72"),
    ("Menubar.js?v=fcc-ui-71", "Menubar.js?v=fcc-ui-72"),
]:
    idx = idx.replace(a, b)
INDEX.write_text(idx, encoding='utf-8')
print('index.html bumped')

for rel, old, new in [
    ("js/Sidebar.js", "Sidebar.Properties.js?v=fcc-ui-71", "Sidebar.Properties.js?v=fcc-ui-72"),
    ("js/Sidebar.Properties.js", "Sidebar.Object.js?v=fcc-ui-71", "Sidebar.Object.js?v=fcc-ui-72"),
    ("js/Sidebar.Object.js", "Sidebar.Object.UI.js?v=fcc-ui-71", "Sidebar.Object.UI.js?v=fcc-ui-72"),
    ("js/Menubar.js", "Menubar.Add.js?v=fcc-ui-70", "Menubar.Add.js?v=fcc-ui-72"),
    ("js/Menubar.Add.js", "UIFactory.js?v=fcc-ui-70", "UIFactory.js?v=fcc-ui-72"),
]:
    p = EDITOR / rel
    t = p.read_text(encoding='utf-8')
    t2 = t.replace(old, new)
    # also bump FlowerStyle if any
    t2 = t2.replace("FlowerStyle.js?v=fcc-ui-71", "FlowerStyle.js?v=fcc-ui-72")
    t2 = t2.replace("UIText.js?v=fcc-ui-71", "UIText.js?v=fcc-ui-72")
    if t2 != t:
        p.write_text(t2, encoding='utf-8')
        print('bumped', rel)

# README next to assets
readme = ASSETS / "README.md"
readme.write_text(
    """# CapCut 花字样例 7645318555541638462

来源：剪映 artistEffect 花字库包。

| 文件 | 用途 |
|------|------|
| cover_icon.png | 封面预览 |
| 1780131462621.png | 内投影贴图 |
| 1780131613632.png | 外层/描边贴图（洋红） |
| 1780131838447.png | 描边贴图（紫） |
| effectStyle.json | 原始 CapCut 参数 |

编辑器：选中 Text → 花字 · Effect 栈 → **剪映样例**。
""",
    encoding='utf-8',
)
print('assets README written')

# Verify syntax of FlowerStyle via node
print('done')
