# -*- coding: utf-8 -*-
"""Patch UIText.js for P1 FlowerStyle effect stack."""
from pathlib import Path
import re

path = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\UIText.js")
src = path.read_text(encoding="utf-8")

# 1) Update imports
old_import = """import { Text, configureTextBuilder } from 'troika-three-text';

// Default SDF margin is 1/16 of the glyph. Outline past that saturates and
// stops looking thicker. Reserve half the atlas cell so UI strokes can grow.
configureTextBuilder( { sdfMargin: 0.5 } );

import {
	DEFAULT_TEXT_FONT_URL,
	getFccUI,
	isUIText,
	getOwningCanvasRenderMode,
	RENDER_MODE_CAMERA,
	readLocalEulerDegrees,
	readLocalScale,
} from './UIConstants.js?v=fcc-ui-18';
"""

new_import = """import { Text, configureTextBuilder } from 'troika-three-text';
import { createDerivedMaterial } from 'troika-three-utils';
import * as THREE from 'three';

// Default SDF margin is 1/16 of the glyph. Outline past that saturates and
// stops looking thicker. Reserve half the atlas cell so UI strokes can grow.
configureTextBuilder( { sdfMargin: 0.5 } );

import {
	DEFAULT_TEXT_FONT_URL,
	getFccUI,
	isUIText,
	getOwningCanvasRenderMode,
	RENDER_MODE_CAMERA,
	readLocalEulerDegrees,
	readLocalScale,
} from './UIConstants.js?v=fcc-ui-55';
import {
	getEffectiveFlowerStyle,
	contentPrimaryColor,
	contentUsesGradient,
	normalizeFillContent,
	hexToRgb01,
} from './FlowerStyle.js?v=fcc-ui-55';
"""

# Original already imports THREE at top — avoid duplicate
if "import * as THREE from 'three';" in src and "import * as THREE from 'three';" in new_import:
    new_import = new_import.replace("import * as THREE from 'three';\n\n", "", 1)

if old_import not in src:
    # try without exact whitespace
    print("WARN: exact import block not found, trying flexible replace")
    src2 = src
    src2 = src2.replace(
        "from './UIConstants.js?v=fcc-ui-18';",
        "from './UIConstants.js?v=fcc-ui-55';",
    )
    if "FlowerStyle.js" not in src2:
        src2 = src2.replace(
            "import { Text, configureTextBuilder } from 'troika-three-text';",
            "import { Text, configureTextBuilder } from 'troika-three-text';\n"
            "import { createDerivedMaterial } from 'troika-three-utils';\n"
            "import {\n"
            "\tgetEffectiveFlowerStyle,\n"
            "\tcontentPrimaryColor,\n"
            "\tcontentUsesGradient,\n"
            "\tnormalizeFillContent,\n"
            "\thexToRgb01,\n"
            "} from './FlowerStyle.js?v=fcc-ui-55';",
        )
    src = src2
else:
    src = src.replace(old_import, new_import)

# Remove duplicate THREE import if we introduced one
# Count THREE imports
three_imports = list(re.finditer(r"^import \* as THREE from 'three';\s*$", src, re.M))
if len(three_imports) > 1:
    # keep first
    for m in three_imports[1:]:
        src = src[:m.start()] + src[m.end():]
        break

# 2) Add flower constants after FCC_TEXT_SHADOW
if "FCC_FLOWER_PREFIX" not in src:
    src = src.replace(
        "export const FCC_TEXT_SHADOW = '__fccTextShadow';",
        "export const FCC_TEXT_SHADOW = '__fccTextShadow';\n"
        "export const FCC_FLOWER_PREFIX = '__fccFlower_';\n"
        "export const FCC_FLOWER_FACE = '__fccFlower_face';",
    )

# 3) Replace applyTroikaFromUI through syncUITextContent with new implementations
# Find start of applyTroikaFromUI and end of syncUITextContent function

marker_start = "export function applyTroikaFromUI( troika, ui, rect, role = 'fill' ) {"
marker_end = "export function applyTextTransform( group, rect ) {"

idx_s = src.find(marker_start)
idx_e = src.find(marker_end)
if idx_s < 0 or idx_e < 0:
    raise SystemExit(f"markers not found start={idx_s} end={idx_e}")

new_core = r'''
function baseLayoutOnTroika( troika, ui, rect ) {

	const fontSize = Number( ui.fontSize ) > 0 ? Number( ui.fontSize ) : 48;
	const align = ui.align || 'center';
	const vAlign = ui.verticalAlign || 'middle';

	troika.font = resolveFontUrl( ui );
	troika.fontSize = fontSize;
	troika.anchorX = mapAnchorX( align );
	troika.anchorY = mapAnchorY( vAlign );
	troika.textAlign = align === 'left' || align === 'right' || align === 'justify'
		? align
		: 'center';
	troika.letterSpacing = Number( ui.letterSpacing ) || 0;
	troika.lineHeight = Number( ui.lineHeight ) > 0 ? Number( ui.lineHeight ) : 1.2;
	troika.maxWidth = rect && rect.w > 0 ? rect.w : ( ui.sizeDelta && ui.sizeDelta[ 0 ] ) || 400;
	troika.overflowWrap = 'break-word';
	troika.frustumCulled = false;
	troika.text = ui.text != null ? String( ui.text ) : '';

}

/**
 * Apply fccUI text fields + layout rect onto a Troika Text instance.
 * Legacy fill/shadow roles kept for callers; flower path uses applyFlowerPass.
 * @param {import('troika-three-text').Text} troika
 * @param {object} ui
 * @param {{w:number,h:number}|null} rect
 * @param {'fill'|'shadow'} role
 */
export function applyTroikaFromUI( troika, ui, rect, role = 'fill' ) {

	baseLayoutOnTroika( troika, ui, rect );
	troika.depthOffset = role === 'shadow' ? 0.1 : 0;

	if ( role === 'shadow' ) {

		const sh = ui.shadow || {};
		troika.color = colorToTroika( sh.color || '#000000' );
		troika.fillOpacity = sh.opacity != null ? Number( sh.opacity ) : 0.75;
		troika.outlineWidth = 0;
		troika.outlineOpacity = 0;
		troika.outlineBlur = Math.max( 0, Number( sh.blur ) || 0 );
		troika.outlineOffsetX = 0;
		troika.outlineOffsetY = 0;
		const ox = Number( sh.offsetX ) || 0;
		const oy = Number( sh.offsetY ) || 0;
		troika.position.set( ox, oy, - 0.01 );

	} else {

		troika.color = colorToTroika( ui.color || '#ffffff' );
		troika.fillOpacity = 1;
		troika.position.set( 0, 0, 0 );

		const ol = ui.outline || {};
		if ( ol.enabled ) {

			const px = Math.max( 0, Number( ol.width ) || 0 );
			troika.outlineWidth = px;
			troika.outlineColor = colorToTroika( ol.color || '#000000' );
			troika.outlineOpacity = ol.opacity != null ? Number( ol.opacity ) : 1;
			troika.outlineBlur = 0;
			troika.outlineOffsetX = 0;
			troika.outlineOffsetY = 0;

		} else {

			troika.outlineWidth = 0;
			troika.outlineOpacity = 0;
			troika.outlineBlur = 0;

		}

	}

}

function tuneMaterial( troika, mode ) {

	const mats = troika.material
		? ( Array.isArray( troika.material ) ? troika.material : [ troika.material ] )
		: [];
	for ( const m of mats ) {

		if ( ! m ) continue;
		m.depthTest = mode === RENDER_MODE_CAMERA;
		m.depthWrite = false;
		m.toneMapped = false;
		m.transparent = true;

	}

}

function makeTroika( name ) {

	const t = new Text();
	t.name = name;
	t.frustumCulled = false;
	t.castShadow = false;
	t.receiveShadow = false;
	return t;

}

function disposeFlowerChildren( group ) {

	const toRemove = [];
	for ( let i = 0; i < group.children.length; i ++ ) {

		const c = group.children[ i ];
		if ( ! c || ! c.name ) continue;
		if ( c.name === FCC_TEXT_MESH || c.name === FCC_TEXT_SHADOW
			|| c.name.indexOf( FCC_FLOWER_PREFIX ) === 0 ) {

			toRemove.push( c );

		}

	}

	for ( const child of toRemove ) {

		group.remove( child );
		try {

			if ( typeof child.dispose === 'function' ) child.dispose();

		} catch ( e ) { /* ignore */ }

	}

}

/**
 * Patch Troika material for linear gradient fill (uses vUv ~ totalBounds UV).
 */
function applyGradientMaterial( troika, content, opacity, mode ) {

	const c = normalizeFillContent( content );
	const g = c.gradient;
	const rgbA = hexToRgb01( g.colors[ 0 ] );
	const rgbB = hexToRgb01( g.colors[ 1 ] );

	troika.color = g.colors[ 0 ];
	troika.fillOpacity = opacity;

	const baseMat = troika.material;
	if ( ! baseMat || ! baseMat.isTroikaTextMaterial ) {

		tuneMaterial( troika, mode );
		return;

	}

	if ( baseMat.userData && baseMat.userData.fccGradientMat ) {

		const u = baseMat.userData.fccGradientUniforms;
		if ( u ) {

			u.uFccGA.value.setRGB( rgbA[ 0 ], rgbA[ 1 ], rgbA[ 2 ] );
			u.uFccGB.value.setRGB( rgbB[ 0 ], rgbB[ 1 ], rgbB[ 2 ] );
			u.uFccGAngle.value = Number( g.angle ) || 90;
			u.uFccGStop0.value = Number( g.stops[ 0 ] ) || 0;
			u.uFccGStop1.value = Number( g.stops[ 1 ] ) || 1;
			u.uFccGUse.value = 1;

		}

		tuneMaterial( troika, mode );
		return;

	}

	const uniforms = {
		uFccGA: { value: new THREE.Color().setRGB( rgbA[ 0 ], rgbA[ 1 ], rgbA[ 2 ] ) },
		uFccGB: { value: new THREE.Color().setRGB( rgbB[ 0 ], rgbB[ 1 ], rgbB[ 2 ] ) },
		uFccGAngle: { value: Number( g.angle ) || 90 },
		uFccGStop0: { value: Number( g.stops[ 0 ] ) || 0 },
		uFccGStop1: { value: Number( g.stops[ 1 ] ) || 1 },
		uFccGUse: { value: 1 },
	};

	let derived;
	try {

		derived = createDerivedMaterial( baseMat, {
			chained: true,
			uniforms,
			fragmentDefs: `
uniform vec3 uFccGA;
uniform vec3 uFccGB;
uniform float uFccGAngle;
uniform float uFccGStop0;
uniform float uFccGStop1;
uniform float uFccGUse;
`,
			fragmentColorTransform: `
if (uFccGUse > 0.5) {
  float rad = radians(uFccGAngle);
  vec2 dir = vec2(cos(rad), sin(rad));
  float t = dot(vUv - vec2(0.5), dir) + 0.5;
  t = (t - uFccGStop0) / max(uFccGStop1 - uFccGStop0, 1e-5);
  t = clamp(t, 0.0, 1.0);
  gl_FragColor.rgb = mix(uFccGA, uFccGB, t);
}
`,
		} );

	} catch ( e ) {

		console.warn( '[FreeFilmCut] gradient material failed, solid fallback', e );
		tuneMaterial( troika, mode );
		return;

	}

	derived.userData = derived.userData || {};
	derived.userData.fccGradientMat = true;
	derived.userData.fccGradientUniforms = uniforms;
	derived.transparent = true;
	derived.depthWrite = false;
	derived.toneMapped = false;
	derived.depthTest = mode === RENDER_MODE_CAMERA;
	troika.material = derived;

}

function applyContentToTroika( troika, content, layerAlpha, mode ) {

	const c = normalizeFillContent( content );
	const solidA = c.solid.alpha != null ? Number( c.solid.alpha ) : 1;
	const opacity = Math.max( 0, Math.min( 1, ( layerAlpha != null ? Number( layerAlpha ) : 1 ) * solidA ) );

	if ( c.renderType === 'gradient' ) {

		applyGradientMaterial( troika, c, opacity, mode );
		return;

	}

	// texture stub → solid fallback
	troika.color = colorToTroika( contentPrimaryColor( c ) );
	troika.fillOpacity = opacity;
	if ( c.renderType === 'texture' ) {

		troika.fillOpacity *= ( c.texture && c.texture.alpha != null ) ? Number( c.texture.alpha ) : 1;

	}

	tuneMaterial( troika, mode );

}

/**
 * Configure one flower Effect-stack pass on a Troika mesh.
 * kinds: 'shadow' | 'stroke' | 'face' | 'inner'
 */
function applyFlowerPass( troika, ui, rect, pass, z ) {

	baseLayoutOnTroika( troika, ui, rect );
	troika.depthOffset = 0;
	troika.outlineWidth = 0;
	troika.outlineOpacity = 0;
	troika.outlineBlur = 0;
	troika.outlineOffsetX = 0;
	troika.outlineOffsetY = 0;
	troika.position.set( 0, 0, z );

	const mode = getOwningCanvasRenderMode( troika.parent || { parent: null } );

	if ( pass.kind === 'shadow' || pass.kind === 'inner' ) {

		const sh = pass.layer;
		troika.position.set( Number( sh.offsetX ) || 0, Number( sh.offsetY ) || 0, z );
		troika.outlineBlur = Math.max( 0, Number( sh.diffuse ) || 0 );
		troika.outlineWidth = 0;
		applyContentToTroika( troika, sh.content, sh.alpha, mode );
		return;

	}

	if ( pass.kind === 'stroke' ) {

		const st = pass.layer;
		const w = Math.max( 0, Number( st.width ) || 0 );
		const col = contentPrimaryColor( st.content );
		// Thickened glyph under the face (TMP-style outer stroke).
		troika.outlineWidth = w;
		troika.outlineColor = colorToTroika( col );
		troika.outlineOpacity = st.alpha != null ? Number( st.alpha ) : 1;
		applyContentToTroika( troika, st.content, st.alpha, mode );
		return;

	}

	// face
	const fill = pass.layer;
	applyContentToTroika( troika, fill.content, fill.alpha, mode );

}

function buildFlowerPasses( style ) {

	const passes = [];
	const shadows = ( style.shadows || [] ).filter( ( s ) => s && s.enable );
	const strokes = ( style.strokes || [] ).filter( ( s ) => s && s.enable );
	const inners = ( style.innerShadows || [] ).filter( ( s ) => s && s.enable );

	// Back → front: outer shadows, outer strokes, face, inner shadows
	for ( let i = 0; i < shadows.length; i ++ ) {

		passes.push( { kind: 'shadow', name: FCC_FLOWER_PREFIX + 'shadow_' + i, layer: shadows[ i ] } );

	}

	for ( let i = 0; i < strokes.length; i ++ ) {

		passes.push( { kind: 'stroke', name: FCC_FLOWER_PREFIX + 'stroke_' + i, layer: strokes[ i ] } );

	}

	passes.push( {
		kind: 'face',
		name: FCC_FLOWER_FACE,
		layer: style.fill || { alpha: 1, content: { renderType: 'solid', solid: { color: '#ffffff', alpha: 1 } } },
	} );

	for ( let i = 0; i < inners.length; i ++ ) {

		passes.push( { kind: 'inner', name: FCC_FLOWER_PREFIX + 'inner_' + i, layer: inners[ i ] } );

	}

	return passes;

}

function flowerSyncSignature( ui, rect, mode, style ) {

	const w = rect && rect.w != null ? rect.w : '';
	const h = rect && rect.h != null ? rect.h : '';
	return JSON.stringify( {
		text: ui.text, font: ui.font, fontBold: ui.fontBold, fontSize: ui.fontSize, bold: ui.bold,
		color: ui.color, letterSpacing: ui.letterSpacing, lineHeight: ui.lineHeight,
		align: ui.align, verticalAlign: ui.verticalAlign,
		outline: ui.outline, shadow: ui.shadow,
		flowerStyle: ui.flowerStyle || null,
		style, w, h, mode,
	} );

}

/**
 * Ensure Troika flower Effect-stack children match fccUI.
 * Order: outer shadows → outer strokes → face → inner shadows.
 * Does NOT rely on Troika single outline/shadow for flowerStyle.
 * @param {THREE.Object3D} group text root (fccUI.type === 'text')
 * @param {{w:number,h:number}|null} [rect]
 */
export function syncUITextContent( group, rect = null ) {

	const ui = getFccUI( group );
	if ( ! ui || ui.type !== 'text' ) return;

	const mode = getOwningCanvasRenderMode( group );
	const fontUrl = resolveFontUrl( ui );
	const prevFontUrl = group.userData && group.userData.__fccTextFontUrl;
	const fontChanged = prevFontUrl !== fontUrl;
	const style = getEffectiveFlowerStyle( ui );

	const sig = flowerSyncSignature( ui, rect, mode, style );
	if ( ! fontChanged && group.userData.__fccTextSig === sig
		&& group.getObjectByName( FCC_FLOWER_FACE ) ) return;

	group.userData.__fccTextSig = sig;
	group.userData.__fccTextFontUrl = fontUrl;

	if ( fontChanged ) {

		disposeFlowerChildren( group );

	}

	const passes = buildFlowerPasses( style );
	const existing = {};
	for ( let i = 0; i < group.children.length; i ++ ) {

		const c = group.children[ i ];
		if ( c && c.name ) existing[ c.name ] = c;

	}

	const keep = new Set( passes.map( ( p ) => p.name ) );
	for ( const name of Object.keys( existing ) ) {

		if ( name === FCC_TEXT_MESH || name === FCC_TEXT_SHADOW
			|| ( name.indexOf( FCC_FLOWER_PREFIX ) === 0 && ! keep.has( name ) ) ) {

			const child = existing[ name ];
			group.remove( child );
			try {

				if ( typeof child.dispose === 'function' ) child.dispose();

			} catch ( e ) { /* ignore */ }

			delete existing[ name ];

		}

	}

	// Re-add in order (back → front)
	const zStep = 0.001;
	for ( let i = 0; i < passes.length; i ++ ) {

		const pass = passes[ i ];
		let mesh = existing[ pass.name ];
		if ( ! mesh || ! mesh.sync ) {

			if ( mesh ) {

				group.remove( mesh );
				try {

					if ( typeof mesh.dispose === 'function' ) mesh.dispose();

				} catch ( e ) { /* ignore */ }

			}

			mesh = makeTroika( pass.name );
			existing[ pass.name ] = mesh;

		}

		if ( mesh.parent === group ) group.remove( mesh );
		group.add( mesh );

		const z = ( i - passes.length ) * zStep;
		applyFlowerPass( mesh, ui, rect, pass, z );
		mesh.layers.mask = group.layers.mask;
		mesh.visible = true;

		const passMode = mode;
		mesh.sync( () => {

			if ( pass.kind === 'face' || pass.kind === 'stroke'
				|| pass.kind === 'shadow' || pass.kind === 'inner' ) {

				const content = pass.layer && pass.layer.content;
				const layerA = pass.layer && pass.layer.alpha;
				if ( content && contentUsesGradient( content ) ) {

					applyContentToTroika( mesh, content, layerA, passMode );

				} else {

					tuneMaterial( mesh, passMode );

				}

			} else {

				tuneMaterial( mesh, passMode );

			}

			if ( pass.kind === 'face' && ! mesh.textRenderInfo ) {

				console.warn( '[FreeFilmCut] Troika text sync finished without textRenderInfo; font may have failed to load:', fontUrl );

			}

		} );

	}

}

'''

src = src[:idx_s] + new_core + "\n" + src[idx_e:]

# Fix applyFlowerPass mode resolution — troika.parent may be null before add.
# We'll leave as-is since we pass mode in sync callback; but applyFlowerPass
# calls getOwningCanvasRenderMode(troika.parent) which may be wrong before add.
# Patch applyFlowerPass to accept mode — do a small replace:

src = src.replace(
"""function applyFlowerPass( troika, ui, rect, pass, z ) {

	baseLayoutOnTroika( troika, ui, rect );
	troika.depthOffset = 0;
	troika.outlineWidth = 0;
	troika.outlineOpacity = 0;
	troika.outlineBlur = 0;
	troika.outlineOffsetX = 0;
	troika.outlineOffsetY = 0;
	troika.position.set( 0, 0, z );

	const mode = getOwningCanvasRenderMode( troika.parent || { parent: null } );
""",
"""function applyFlowerPass( troika, ui, rect, pass, z, mode ) {

	baseLayoutOnTroika( troika, ui, rect );
	troika.depthOffset = 0;
	troika.outlineWidth = 0;
	troika.outlineOpacity = 0;
	troika.outlineBlur = 0;
	troika.outlineOffsetX = 0;
	troika.outlineOffsetY = 0;
	troika.position.set( 0, 0, z );
""")

src = src.replace(
	"applyFlowerPass( mesh, ui, rect, pass, z );",
	"applyFlowerPass( mesh, ui, rect, pass, z, mode );",
)

# Also update disposeTroikaChild usages for font restore to dispose flower children
src = src.replace(
"""	disposeTroikaChild( group, FCC_TEXT_MESH );
	disposeTroikaChild( group, FCC_TEXT_SHADOW );
	if ( group.userData ) {

		delete group.userData.__fccTextSig;
		delete group.userData.__fccTextFontUrl;

	}

	group.userData = { ...group.userData, fccUI: { ...ui } };
	delete group.userData.__fccTextSig;
	delete group.userData.__fccTextFontUrl;

}

/**
 * After fromJSON / open project: rebuild live blob: URLs for UI Text fonts
""",
"""	disposeFlowerChildren( group );
	if ( group.userData ) {

		delete group.userData.__fccTextSig;
		delete group.userData.__fccTextFontUrl;

	}

	group.userData = { ...group.userData, fccUI: { ...ui } };
	delete group.userData.__fccTextSig;
	delete group.userData.__fccTextFontUrl;

}

/**
 * After fromJSON / open project: rebuild live blob: URLs for UI Text fonts
""")

# Second occurrence in restore clear path
src = src.replace(
"""			disposeTroikaChild( group, FCC_TEXT_MESH );
			disposeTroikaChild( group, FCC_TEXT_SHADOW );
			if ( group.userData ) {

				delete group.userData.__fccTextSig;
				delete group.userData.__fccTextFontUrl;

			}

			group.userData = { ...group.userData, fccUI: { ...ui } };
			delete group.userData.__fccTextSig;
			const w = ( ui.sizeDelta && ui.sizeDelta[ 0 ] ) || 400;
""",
"""			disposeFlowerChildren( group );
			if ( group.userData ) {

				delete group.userData.__fccTextSig;
				delete group.userData.__fccTextFontUrl;

			}

			group.userData = { ...group.userData, fccUI: { ...ui } };
			delete group.userData.__fccTextSig;
			const w = ( ui.sizeDelta && ui.sizeDelta[ 0 ] ) || 400;
""")

# disposeFlowerChildren is used before its definition in applyRestoredFontToGroup.
# In JS function declarations are not hoisted for const/function expressions —
# disposeFlowerChildren is a function declaration style `function disposeFlowerChildren`
# which IS hoisted. Good.

# But applyRestoredFontToGroup calls disposeFlowerChildren before it's defined in the file
# order — function declarations are hoisted within module scope in ES modules? 
# Actually in ES modules, `function foo()` declarations are hoisted to the top of the module.
# Yes.

path.write_bytes(src.replace("\r\n","\n").encode("utf-8"))
print("UIText.js patched, bytes", path.stat().st_size)
# sanity checks
text = path.read_text(encoding="utf-8")
for needle in ["getEffectiveFlowerStyle", "FCC_FLOWER_FACE", "applyFlowerPass", "createDerivedMaterial", "syncUITextContent"]:
    print(needle, "OK" if needle in text else "MISSING")