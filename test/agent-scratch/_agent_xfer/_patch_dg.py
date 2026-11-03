# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")

# ========== BuiltinEffects.js — deepGlow color ==========
be = (ROOT / "postprocessing/BuiltinEffects.js").read_text(encoding="utf-8")
be = be.replace(
    "import { DeepGlowPass } from './DeepGlowPass.js?v=fcc-ui-11';",
    "import { DeepGlowPass } from './DeepGlowPass.js?v=fcc-ui-12';",
)

# Add helper after imports if missing
if "function parseGlowColor" not in be:
    # Insert before registerBuiltinEffects or after imports
    # Find first registerEffect or export function
    marker = "export function registerBuiltinEffects"
    if marker not in be:
        marker = "function registerBuiltinEffects"
    helper = """
/** Parse Deep Glow tint: '#rrggbb' | [r,g,b] 0..1 | {r,g,b}. Default white. */
function parseGlowColor( v, target ) {

	const out = target || new THREE.Vector3( 1, 1, 1 );
	if ( v == null ) {
		out.set( 1, 1, 1 );
		return out;
	}
	if ( typeof v === 'string' ) {
		let hex = v.trim();
		if ( hex.charAt( 0 ) === '#' ) hex = hex.slice( 1 );
		if ( hex.length === 3 ) {
			hex = hex[ 0 ] + hex[ 0 ] + hex[ 1 ] + hex[ 1 ] + hex[ 2 ] + hex[ 2 ];
		}
		const n = parseInt( hex, 16 );
		if ( Number.isFinite( n ) ) {
			out.set(
				( ( n >> 16 ) & 255 ) / 255,
				( ( n >> 8 ) & 255 ) / 255,
				( n & 255 ) / 255,
			);
			return out;
		}
	}
	if ( Array.isArray( v ) && v.length >= 3 ) {
		out.set( Number( v[ 0 ] ) || 0, Number( v[ 1 ] ) || 0, Number( v[ 2 ] ) || 0 );
		return out;
	}
	if ( typeof v === 'object' ) {
		const r = v.r != null ? v.r : v.x;
		const g = v.g != null ? v.g : v.y;
		const b = v.b != null ? v.b : v.z;
		if ( r != null && g != null && b != null ) {
			out.set( Number( r ), Number( g ), Number( b ) );
			return out;
		}
	}
	out.set( 1, 1, 1 );
	return out;
}

"""
    be = be.replace(marker, helper + marker, 1)

old_dg = """	registerEffect( 'deepGlow', {
		label: 'Deep Glow',
		labelZh: '深发光 Deep Glow',
		inputs: [ 'camera', 'texture' ],
		createDefaultParams() {
			return {
				intensity: 1.2,
				threshold: 0.0,
				radius: 1.0,
			};
		},
		createPasses( ctx ) {
			const pass = new DeepGlowPass(
				new THREE.Vector2( Math.max( 1, ctx.width ), Math.max( 1, ctx.height ) ),
				1.2,
				0.0,
				1.0,
			);
			return [ pass ];
		},
		applyParams( passes, params ) {
			const pass = passes[ 0 ];
			if ( ! pass ) return;
			if ( params.intensity !== undefined ) pass.intensity = Number( params.intensity );
			if ( params.threshold !== undefined ) pass.threshold = Number( params.threshold );
			if ( params.radius !== undefined ) pass.radius = Number( params.radius );
		},
		paramSchema: [
			{ key: 'intensity', label: 'Intensity', labelZh: '强度', min: 0, max: 5, step: 0.01 },
			{ key: 'threshold', label: 'Threshold', labelZh: '阈值', min: 0, max: 1, step: 0.01 },
			{ key: 'radius', label: 'Radius', labelZh: '半径', min: 0.1, max: 3, step: 0.01 },
		],
	} );"""

# Chinese labels may be garbled — use regex
m = re.search(
    r"registerEffect\( 'deepGlow', \{.*?\n\t\} \);",
    be,
    re.S,
)
if not m:
    raise SystemExit('deepGlow registerEffect not found')

new_dg = """registerEffect( 'deepGlow', {
		label: 'Deep Glow',
		labelZh: '深发光 Deep Glow',
		inputs: [ 'camera', 'texture' ],
		createDefaultParams() {
			return {
				intensity: 1.2,
				threshold: 0.0,
				radius: 1.0,
				color: '#ffffff',
			};
		},
		createPasses( ctx ) {
			const pass = new DeepGlowPass(
				new THREE.Vector2( Math.max( 1, ctx.width ), Math.max( 1, ctx.height ) ),
				1.2,
				0.0,
				1.0,
			);
			return [ pass ];
		},
		applyParams( passes, params ) {
			const pass = passes[ 0 ];
			if ( ! pass ) return;
			if ( params.intensity !== undefined ) pass.intensity = Number( params.intensity );
			if ( params.threshold !== undefined ) pass.threshold = Number( params.threshold );
			if ( params.radius !== undefined ) pass.radius = Number( params.radius );
			if ( params.color !== undefined && pass.glowColor ) {
				parseGlowColor( params.color, pass.glowColor );
			}
		},
		paramSchema: [
			{ key: 'intensity', label: 'Intensity', labelZh: '强度', min: 0, max: 5, step: 0.01 },
			{ key: 'threshold', label: 'Threshold', labelZh: '阈值', min: 0, max: 1, step: 0.01 },
			{ key: 'radius', label: 'Radius', labelZh: '半径', min: 0.1, max: 3, step: 0.01 },
			{ key: 'color', label: 'Glow Color', labelZh: '发光颜色', type: 'color' },
		],
	} );"""

be = be[:m.start()] + new_dg + be[m.end():]
(ROOT / "postprocessing/BuiltinEffects.js").write_text(be, encoding="utf-8")
print("BuiltinEffects OK", "color: '#ffffff'" in be, "parseGlowColor" in be)

# ========== Sidebar.Object.PostProcess.js — color picker ==========
pp = (ROOT / "Sidebar.Object.PostProcess.js").read_text(encoding="utf-8")
# Ensure UIColor imported
if "UIColor" not in pp.split("from './libs/ui.js'")[0]:
    pp = pp.replace(
        "import { UIPanel, UIRow, UIText, UIButton, UISelect, UICheckbox, UINumber, UIDiv } from './libs/ui.js';",
        "import { UIPanel, UIRow, UIText, UIButton, UISelect, UICheckbox, UINumber, UIDiv, UIColor } from './libs/ui.js';",
    )
    # try other import variants
    if "UIColor" not in pp[:500]:
        pp = re.sub(
            r"(from '\./libs/ui\.js';)",
            lambda m: m.group(0) if "UIColor" in pp[:m.start()] else None,
            pp,
            count=1,
        )
        # Force: find import from libs/ui
        mimp = re.search(r"import \{([^}]+)\} from '\./libs/ui\.js';", pp)
        if mimp and "UIColor" not in mimp.group(1):
            pp = pp[:mimp.start(1)] + mimp.group(1).rstrip() + ", UIColor " + pp[mimp.end(1):]

# Add color branch in paramSchema loop
old_bool = """					if ( schema.type === 'boolean' ) {
						const cb = new UICheckbox( !! entry.params[ schema.key ] ).onChange( () => {
							entry.params[ schema.key ] = cb.getValue();
							dirty( cam );
						} );
						row.add( cb );
					} else {"""

new_bool = """					if ( schema.type === 'boolean' ) {
						const cb = new UICheckbox( !! entry.params[ schema.key ] ).onChange( () => {
							entry.params[ schema.key ] = cb.getValue();
							dirty( cam );
						} );
						row.add( cb );
					} else if ( schema.type === 'color' ) {
						const col = new UIColor().setValue( entry.params[ schema.key ] || '#ffffff' ).onInput( () => {
							entry.params[ schema.key ] = col.getValue();
							dirty( cam );
						} );
						row.add( col );
					} else {"""

if "schema.type === 'color'" not in pp:
    if old_bool not in pp:
        # whitespace flexible
        m = re.search(
            r"if \( schema\.type === 'boolean' \) \{.*?row\.add\( cb \);\n\t\t\t\t\t\} else \{",
            pp,
            re.S,
        )
        if not m:
            raise SystemExit('PostProcess boolean branch not found')
        pp = pp[:m.start()] + """if ( schema.type === 'boolean' ) {
						const cb = new UICheckbox( !! entry.params[ schema.key ] ).onChange( () => {
							entry.params[ schema.key ] = cb.getValue();
							dirty( cam );
						} );
						row.add( cb );
					} else if ( schema.type === 'color' ) {
						const col = new UIColor().setValue( entry.params[ schema.key ] || '#ffffff' ).onInput( () => {
							entry.params[ schema.key ] = col.getValue();
							dirty( cam );
						} );
						row.add( col );
					} else {""" + pp[m.end():]
    else:
        pp = pp.replace(old_bool, new_bool)

# Bump BuiltinEffects import
pp = pp.replace("BuiltinEffects.js?v=fcc-ui-11", "BuiltinEffects.js?v=fcc-ui-12")

(ROOT / "Sidebar.Object.PostProcess.js").write_text(pp, encoding="utf-8")
print("PostProcess sidebar OK", "schema.type === 'color'" in pp, "UIColor" in pp[:800])
