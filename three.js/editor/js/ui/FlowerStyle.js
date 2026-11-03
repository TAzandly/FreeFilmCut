/**
 * FreeFilmCut FlowerStyle (花字) = Effect stack data on UI Text (fccUI.type === 'text').
 * NOT a separate object type / Add-menu item. Applied via fccUI.flowerStyle.
 * Aligned with CapCut artistEffect content. solid/gradient/texture; strokes.side outer|inner.
 * texture.range: CapCut horizontal atlas strips (default 1); char i uses strip i%range.
 */

export const FLOWER_STYLE_VERSION = 2;

/** @typedef {'face'|'stroke'|'shadow'|'inner'} FlowerStackKind */

let _flowerStackIdSeq = 0;

/** Stable-ish id for Effect-stack mesh names / reorder. */
export function newFlowerStackId( prefix = 'fx' ) {

	_flowerStackIdSeq += 1;
	return prefix + '_' + Date.now().toString( 36 ) + '_' + _flowerStackIdSeq;

}

export function createFaceStackEntry() {

	return { id: 'face', kind: 'face' };

}

export function createStrokeStackEntry( overrides = {} ) {

	const st = createStrokeLayer( overrides );
	return { id: newFlowerStackId( 'st' ), kind: 'stroke', ...st };

}

export function createInnerStrokeStackEntry( overrides = {} ) {

	return createStrokeStackEntry( { side: 'inner', width: 3, content: createSolidContent( '#ffffff', 1 ), ...overrides } );

}

export function createShadowStackEntry( overrides = {} ) {

	const sh = createShadowLayer( overrides );
	return { id: newFlowerStackId( 'sh' ), kind: 'shadow', ...sh };

}

export function createInnerShadowStackEntry( overrides = {} ) {

	const sh = createShadowLayer( overrides );
	return { id: newFlowerStackId( 'in' ), kind: 'inner', ...sh };

}

export function normalizeStackEntry( raw ) {

	if ( ! raw || typeof raw !== 'object' ) return null;
	const kind = raw.kind;
	if ( kind === 'face' ) return { id: 'face', kind: 'face' };
	if ( kind === 'stroke' ) {

		const st = normalizeStroke( raw );
		if ( ! st ) return null;
		return { id: typeof raw.id === 'string' && raw.id ? raw.id : newFlowerStackId( 'st' ), kind: 'stroke', ...st };

	}
	if ( kind === 'shadow' ) {

		const sh = normalizeShadow( raw );
		if ( ! sh ) return null;
		return { id: typeof raw.id === 'string' && raw.id ? raw.id : newFlowerStackId( 'sh' ), kind: 'shadow', ...sh };

	}
	if ( kind === 'inner' || kind === 'innerShadow' ) {

		const sh = normalizeShadow( raw );
		if ( ! sh ) return null;
		return { id: typeof raw.id === 'string' && raw.id ? raw.id : newFlowerStackId( 'in' ), kind: 'inner', ...sh };

	}
	return null;

}

/** Legacy buckets → ordered stack (back → front). */
export function migrateBucketsToStack( strokes, shadows, innerShadows ) {

	const stack = [];
	( shadows || [] ).forEach( ( sh ) => {

		const n = normalizeShadow( sh );
		if ( n ) stack.push( { id: newFlowerStackId( 'sh' ), kind: 'shadow', ...n } );

	} );
	( strokes || [] ).forEach( ( st ) => {

		const n = normalizeStroke( st );
		if ( n && n.side !== 'inner' ) stack.push( { id: newFlowerStackId( 'st' ), kind: 'stroke', ...n } );

	} );
	stack.push( createFaceStackEntry() );
	( strokes || [] ).forEach( ( st ) => {

		const n = normalizeStroke( st );
		if ( n && n.side === 'inner' ) stack.push( { id: newFlowerStackId( 'st' ), kind: 'stroke', ...n } );

	} );
	( innerShadows || [] ).forEach( ( sh ) => {

		const n = normalizeShadow( sh );
		if ( n ) stack.push( { id: newFlowerStackId( 'in' ), kind: 'inner', ...n } );

	} );
	return stack;

}

export function deriveBucketsFromStack( stack ) {

	const strokes = [];
	const shadows = [];
	const innerShadows = [];
	( stack || [] ).forEach( ( e ) => {

		if ( ! e || ! e.kind ) return;
		if ( e.kind === 'stroke' ) {

			const st = normalizeStroke( e );
			if ( st ) strokes.push( st );

		} else if ( e.kind === 'shadow' ) {

			const sh = normalizeShadow( e );
			if ( sh ) shadows.push( sh );

		} else if ( e.kind === 'inner' ) {

			const sh = normalizeShadow( e );
			if ( sh ) innerShadows.push( sh );

		}

	} );
	return { strokes, shadows, innerShadows };

}

/**
 * Normalize Effect stack; migrate from strokes/shadows/innerShadows when stack missing.
 * Exactly one `face` entry is guaranteed.
 */
export function normalizeFlowerStack( rawStack, buckets = {} ) {

	let stack = Array.isArray( rawStack )
		? rawStack.map( normalizeStackEntry ).filter( Boolean )
		: [];
	if ( ! stack.length ) {

		stack = migrateBucketsToStack( buckets.strokes, buckets.shadows, buckets.innerShadows );

	}

	const faceCount = stack.filter( ( e ) => e.kind === 'face' ).length;
	if ( faceCount === 0 ) {

		let insertAt = stack.length;
		for ( let i = 0; i < stack.length; i ++ ) {

			const e = stack[ i ];
			if ( e.kind === 'inner' || ( e.kind === 'stroke' && e.side === 'inner' ) ) {

				insertAt = i;
				break;

			}

		}
		stack.splice( insertAt, 0, createFaceStackEntry() );

	} else if ( faceCount > 1 ) {

		let kept = false;
		stack = stack.filter( ( e ) => {

			if ( e.kind !== 'face' ) return true;
			if ( kept ) return false;
			kept = true;
			return true;

		} );

	}

	return stack.map( ( e ) => ( e.kind === 'face' ? createFaceStackEntry() : e ) );

}

/** Move stack entry by delta (−1 up / +1 down). Face may move freely. */
export function moveFlowerStackEntry( stack, index, delta ) {

	const arr = Array.isArray( stack ) ? stack.slice() : [];
	const j = index + delta;
	if ( index < 0 || index >= arr.length || j < 0 || j >= arr.length ) return arr;
	const tmp = arr[ index ];
	arr[ index ] = arr[ j ];
	arr[ j ] = tmp;
	return arr;

}

/** @typedef {'solid'|'gradient'|'texture'} FccRenderType */

/**
 * @returns {object}
 */

/**
 * Fill / gradient / texture plane UV mode.
 * per-char = each glyph AABB; whole-text = string totalBounds AABB.
 * Missing / unknown → per-char (user default).
 * @param {unknown} raw
 * @param {unknown} [legacyGradientMode]
 * @returns {'per-char'|'whole-text'}
 */
export function normalizeUvMode( raw, legacyGradientMode ) {

	const n = raw != null ? String( raw ).toLowerCase().replace( /_/g, '-' ).trim() : '';
	if ( n === 'per-char' || n === 'perchar' || n === 'char' || n === 'character' || n === 'glyph' ) {

		return 'per-char';

	}
	if ( n === 'whole-text' || n === 'wholetext' || n === 'whole' || n === 'text' || n === 'block' ) {

		return 'whole-text';

	}
	const gm = legacyGradientMode != null
		? String( legacyGradientMode ).toLowerCase().replace( /_/g, '-' ).trim()
		: '';
	if ( gm === 'text' || gm === 'whole' || gm === 'whole-text' || gm === 'block' ) {

		return 'whole-text';

	}
	if ( gm === 'character' || gm === 'char' || gm === 'per-char' || gm === 'glyph' ) {

		return 'per-char';

	}
	return 'per-char';

}

export function uvModeToGradientMode( uvMode ) {

	return normalizeUvMode( uvMode ) === 'whole-text' ? 'text' : 'character';

}

export function uvModeToPerCharUniform( uvMode ) {

	return normalizeUvMode( uvMode ) === 'whole-text' ? 0 : 1;

}

export function createSolidContent( color = '#ffffff', alpha = 1, opts = {} ) {

	const uvMode = normalizeUvMode( opts && opts.uvMode );
	const g = defaultGradient();
	g.mode = uvModeToGradientMode( uvMode );
	return {
		renderType: 'solid',
		uvMode,
		solid: { color: normalizeHex( color ), alpha: clamp01( alpha ) },
		gradient: g,
		texture: defaultTextureStub(),
	};

}

/**
 * @returns {object}
 */
export function createGradientContent( opts = {} ) {

	const colors = Array.isArray( opts.colors ) && opts.colors.length >= 2
		? [ normalizeHex( opts.colors[ 0 ] ), normalizeHex( opts.colors[ 1 ] ) ]
		: [ '#ffffff', '#afafaf' ];
	const alphas = Array.isArray( opts.alphas ) && opts.alphas.length >= 2
		? [ clamp01( opts.alphas[ 0 ] ), clamp01( opts.alphas[ 1 ] ) ]
		: [ 1, 1 ];
	const stops = Array.isArray( opts.stops ) && opts.stops.length >= 2
		? [ Number( opts.stops[ 0 ] ) || 0, Number( opts.stops[ 1 ] ) || 1 ]
		: [ 0, 1 ];
	const uvMode = normalizeUvMode( opts.uvMode, opts.mode );
	return {
		renderType: 'gradient',
		uvMode,
		solid: { color: colors[ 0 ], alpha: alphas[ 0 ] },
		gradient: {
			style: 'linear',
			angle: opts.angle != null ? Number( opts.angle ) : 90,
			colors,
			alphas,
			stops,
			mode: opts.mode != null ? String( opts.mode ) : uvModeToGradientMode( uvMode ),
		},
		texture: defaultTextureStub(),
	};

}

/**
 * Texture stub (P2) — schema-ready, rendered as solid fallback.
 * @returns {object}
 */
export function createTextureContent( opts = {} ) {

	const uvMode = normalizeUvMode( opts.uvMode );
	const g = defaultGradient();
	g.mode = uvModeToGradientMode( uvMode );
	return {
		renderType: 'texture',
		uvMode,
		solid: { color: normalizeHex( opts.fallbackColor || '#ffffff' ), alpha: 1 },
		gradient: g,
		texture: {
			...defaultTextureStub(),
			path: opts.path || '',
			fileName: opts.fileName || opts.name || '',
			alpha: opts.alpha != null ? clamp01( opts.alpha ) : 1,
			angle: opts.angle != null ? Number( opts.angle ) : 0,
			scale: opts.scale != null ? Number( opts.scale ) : 1,
			range: normalizeTexRange( opts.range ),
		},
	};

}

export function createStrokeLayer( overrides = {} ) {

	return normalizeStroke( {
		enable: true,
		width: 4,
		alpha: 1,
		side: 'outer',
		content: createSolidContent( '#000000', 1 ),
		...overrides,
	} );

}

/** Inner stroke (吃进字形 / CapCut-style inset outline). */
export function createInnerStrokeLayer( overrides = {} ) {

	return createStrokeLayer( {
		side: 'inner',
		width: 3,
		content: createSolidContent( '#ffffff', 1 ),
		...overrides,
	} );

}

export function createShadowLayer( overrides = {} ) {

	return normalizeShadow( {
		enable: true,
		angle: - 45,
		distance: 4,
		/** TMP Underlay Dilate — expand shadow silhouette (same units as stroke width). */
		width: 0,
		diffuse: 2,
		alpha: 0.75,
		content: createSolidContent( '#000000', 1 ),
		/** CapCut nested strokes on this shadow silhouette (投影上挂描边). */
		strokes: [],
		...overrides,
	} );

}

/**
 * Empty / identity flower style (white solid fill, no FX).
 */
export function createDefaultFlowerStyle( overrides = {} ) {

	return normalizeFlowerStyle( {
		version: FLOWER_STYLE_VERSION,
		id: null,
		fill: { alpha: 1, content: createSolidContent( '#ffffff', 1 ) },
		stack: [ createFaceStackEntry() ],
		strokes: [],
		shadows: [],
		innerShadows: [],
		anims: { in: null, out: null, loop: null },
		...overrides,
	} );

}

/**
 * Build FlowerStyle from legacy MVP outline / shadow / color.
 */
export function flowerStyleFromLegacy( ui = {} ) {

	const fillColor = normalizeHex( ui.color || '#ffffff' );
	const strokes = [];
	const shadows = [];

	const ol = ui.outline || {};
	if ( ol.enabled ) {

		strokes.push( createStrokeLayer( {
			enable: true,
			side: 'outer',
			width: Number( ol.width ) || 2,
			alpha: ol.opacity != null ? clamp01( ol.opacity ) : 1,
			content: createSolidContent( ol.color || '#000000', 1 ),
		} ) );

	}

	const sh = ui.shadow || {};
	if ( sh.enabled ) {

		const ox = Number( sh.offsetX ) || 0;
		const oy = Number( sh.offsetY ) || 0;
		const dist = Math.sqrt( ox * ox + oy * oy );
		let angle = - 45;
		if ( dist > 1e-4 ) {

			angle = Math.atan2( oy, ox ) * 180 / Math.PI;

		}

		shadows.push( createShadowLayer( {
			enable: true,
			angle,
			distance: dist || 4,
			diffuse: Number( sh.blur ) || 0,
			alpha: sh.opacity != null ? clamp01( sh.opacity ) : 0.75,
			offsetX: ox,
			offsetY: oy,
			content: createSolidContent( sh.color || '#000000', 1 ),
		} ) );

	}

	// No stack yet → normalize migrates buckets into ordered stack.
	return normalizeFlowerStyle( {
		fill: { alpha: 1, content: createSolidContent( fillColor, 1 ) },
		strokes,
		shadows,
		innerShadows: [],
	} );

}

/**
 * Scale font-relative linear measures on one stroke layer (width only).
 * Colors / alphas / sides unchanged.
 */
function scaleStrokeLinearMeasures( st, factor ) {

	if ( ! st || typeof st !== 'object' ) return;
	const f = Number( factor );
	if ( ! ( f > 0 ) || Math.abs( f - 1 ) < 1e-12 ) return;
	if ( st.width != null ) st.width = Math.max( 0, ( Number( st.width ) || 0 ) * f );

}

/**
 * Scale font-relative linear measures on one shadow / inner-shadow layer.
 * distance, dilate width, diffuse, offsetX/Y, and nested strokes[].width.
 */
function scaleShadowLinearMeasures( sh, factor ) {

	if ( ! sh || typeof sh !== 'object' ) return;
	const f = Number( factor );
	if ( ! ( f > 0 ) || Math.abs( f - 1 ) < 1e-12 ) return;
	if ( sh.distance != null ) sh.distance = Math.max( 0, ( Number( sh.distance ) || 0 ) * f );
	if ( sh.width != null ) sh.width = Math.max( 0, ( Number( sh.width ) || 0 ) * f );
	if ( sh.diffuse != null ) sh.diffuse = Math.max( 0, ( Number( sh.diffuse ) || 0 ) * f );
	if ( sh.blur != null ) sh.blur = Math.max( 0, ( Number( sh.blur ) || 0 ) * f );
	if ( sh.offsetX != null ) sh.offsetX = ( Number( sh.offsetX ) || 0 ) * f;
	if ( sh.offsetY != null ) sh.offsetY = ( Number( sh.offsetY ) || 0 ) * f;
	if ( Array.isArray( sh.strokes ) ) {

		for ( let i = 0; i < sh.strokes.length; i ++ ) {

			scaleStrokeLinearMeasures( sh.strokes[ i ], f );

		}

	}

}

/**
 * Multiply all font-relative px on a FlowerStyle by factor (in place on a clone).
 * Does not touch colors, alphas, angles, or texture UV scale.
 *
 * @param {object} style
 * @param {number} factor
 * @returns {object} normalized clone
 */
export function rescaleFlowerStyleByFactor( style, factor ) {

	const f = Number( factor );
	const out = cloneFlowerStyle( style );
	if ( ! ( f > 0 ) || Math.abs( f - 1 ) < 1e-12 ) return out;

	if ( Array.isArray( out.stack ) ) {

		for ( let i = 0; i < out.stack.length; i ++ ) {

			const e = out.stack[ i ];
			if ( ! e || typeof e !== 'object' ) continue;
			if ( e.kind === 'stroke' ) scaleStrokeLinearMeasures( e, f );
			else if ( e.kind === 'shadow' || e.kind === 'inner' || e.kind === 'innerShadow' ) {

				scaleShadowLinearMeasures( e, f );

			}

		}

	}

	if ( Array.isArray( out.strokes ) ) {

		for ( let i = 0; i < out.strokes.length; i ++ ) scaleStrokeLinearMeasures( out.strokes[ i ], f );

	}

	if ( Array.isArray( out.shadows ) ) {

		for ( let i = 0; i < out.shadows.length; i ++ ) scaleShadowLinearMeasures( out.shadows[ i ], f );

	}

	if ( Array.isArray( out.innerShadows ) ) {

		for ( let i = 0; i < out.innerShadows.length; i ++ ) scaleShadowLinearMeasures( out.innerShadows[ i ], f );

	}

	return normalizeFlowerStyle( out );

}

/**
 * Rescale FlowerStyle linear measures from one fontSize to another.
 * CapCut model: width/diffuse ~ em; distance ~ proportional to fontSize.
 * Stored FCC values are already px, so all scale by (toFs / fromFs).
 *
 * @param {object} style
 * @param {number} fromFs fontSize the px were authored at
 * @param {number} toFs target fontSize
 * @returns {object} normalized clone
 */
export function rescaleFlowerStyleForFontSize( style, fromFs, toFs ) {

	const from = Number( fromFs ) > 0 ? Number( fromFs ) : 0;
	const to = Number( toFs ) > 0 ? Number( toFs ) : 0;
	if ( ! from || ! to ) return cloneFlowerStyle( style );
	return rescaleFlowerStyleByFactor( style, to / from );

}

/**
 * Prefer explicit flowerStyle; else synthesize from legacy fields.
 * If ui.flowerBaseFontSize differs from ui.fontSize, return a clone
 * rescaled to the current fontSize (render-time safety net).
 */
export function getEffectiveFlowerStyle( ui ) {

	if ( ! ui ) return createDefaultFlowerStyle();
	let style;
	if ( ui.flowerStyle && typeof ui.flowerStyle === 'object' ) {

		style = normalizeFlowerStyle( ui.flowerStyle );

	} else {

		style = flowerStyleFromLegacy( ui );

	}

	const base = Number( ui.flowerBaseFontSize ) > 0 ? Number( ui.flowerBaseFontSize ) : 0;
	const fs = Number( ui.fontSize ) > 0 ? Number( ui.fontSize ) : 48;
	if ( base > 0 && Math.abs( fs - base ) > 1e-6 ) {

		return rescaleFlowerStyleForFontSize( style, base, fs );

	}

	return style;

}

export function normalizeFlowerStyle( raw ) {

	const src = raw && typeof raw === 'object' ? raw : {};
	const fillSrc = src.fill && typeof src.fill === 'object' ? src.fill : {};
	const bucketStrokes = Array.isArray( src.strokes )
		? src.strokes.map( normalizeStroke ).filter( Boolean )
		: [];
	const bucketShadows = Array.isArray( src.shadows )
		? src.shadows.map( normalizeShadow ).filter( Boolean )
		: ( Array.isArray( src.outerShadows )
			? src.outerShadows.map( normalizeShadow ).filter( Boolean )
			: [] );
	const bucketInners = Array.isArray( src.innerShadows )
		? src.innerShadows.map( normalizeShadow ).filter( Boolean )
		: ( Array.isArray( src.inner_shadows )
			? src.inner_shadows.map( normalizeShadow ).filter( Boolean )
			: [] );
	const stack = normalizeFlowerStack( src.stack, {
		strokes: bucketStrokes,
		shadows: bucketShadows,
		innerShadows: bucketInners,
	} );
	const derived = deriveBucketsFromStack( stack );
	return {
		version: Math.max( Number( src.version ) || 0, FLOWER_STYLE_VERSION ),
		id: src.id != null ? src.id : null,
		fill: {
			alpha: fillSrc.alpha != null ? clamp01( fillSrc.alpha ) : 1,
			content: normalizeFillContent( fillSrc.content ),
			/** false = hide face pass (inspect strokes/shadows underneath). Default true. */
			visible: fillSrc.visible !== false,
		},
		/** Master authoring switch: false = fill only (no stroke/shadow/inner). Default true. */
		effectsEnabled: src.effectsEnabled !== false,
		/** Ordered Effect stack (back → front). Canonical for render / reorder. */
		stack,
		/** Derived mirrors for older readers / texture collect. */
		strokes: derived.strokes,
		shadows: derived.shadows,
		innerShadows: derived.innerShadows,
		anims: normalizeAnimsStub( src.anims ),
	};

}

export function normalizeFillContent( raw ) {

	const src = raw && typeof raw === 'object' ? raw : {};
	let renderType = src.renderType || src.render_type || 'solid';
	if ( renderType !== 'solid' && renderType !== 'gradient' && renderType !== 'texture' ) {

		renderType = 'solid';

	}

	const solidSrc = src.solid && typeof src.solid === 'object' ? src.solid : {};
	const gradSrc = src.gradient && typeof src.gradient === 'object' ? src.gradient : {};
	const texSrc = src.texture && typeof src.texture === 'object' ? src.texture : {};

	const solidColor = colorAnyToHex( solidSrc.color, '#ffffff' );
	const gColors = normalizeGradientColors( gradSrc );
	const gAlphas = Array.isArray( gradSrc.alpha ) && gradSrc.alpha.length >= 2
		? [ clamp01( gradSrc.alpha[ 0 ] ), clamp01( gradSrc.alpha[ 1 ] ) ]
		: ( Array.isArray( gradSrc.alphas ) && gradSrc.alphas.length >= 2
			? [ clamp01( gradSrc.alphas[ 0 ] ), clamp01( gradSrc.alphas[ 1 ] ) ]
			: [ 1, 1 ] );
	const gStops = Array.isArray( gradSrc.percent ) && gradSrc.percent.length >= 2
		? [ Number( gradSrc.percent[ 0 ] ) || 0, Number( gradSrc.percent[ 1 ] ) || 1 ]
		: ( Array.isArray( gradSrc.stops ) && gradSrc.stops.length >= 2
			? [ Number( gradSrc.stops[ 0 ] ) || 0, Number( gradSrc.stops[ 1 ] ) || 1 ]
			: [ 0, 1 ] );

	const uvMode = normalizeUvMode( src.uvMode ?? src.uv_mode, gradSrc.mode );
	return {
		renderType,
		uvMode,
		solid: {
			color: solidColor,
			alpha: solidSrc.alpha != null ? clamp01( solidSrc.alpha ) : 1,
		},
		gradient: {
			style: 'linear',
			angle: gradSrc.angle != null ? Number( gradSrc.angle ) : 90,
			colors: gColors,
			alphas: gAlphas,
			stops: gStops,
			mode: gradSrc.mode != null ? String( gradSrc.mode ) : uvModeToGradientMode( uvMode ),
		},
		texture: {
			...defaultTextureStub(),
			path: texSrc.path || '',
			fileName: texSrc.fileName || texSrc.name || '',
			alpha: texSrc.alpha != null ? clamp01( texSrc.alpha ) : 1,
			angle: texSrc.angle != null ? Number( texSrc.angle ) : 0,
			scale: texSrc.scale != null ? Number( texSrc.scale ) : 1,
			range: normalizeTexRange( texSrc.range ),
		},
	};

}

export function normalizeStroke( raw ) {

	if ( ! raw || typeof raw !== 'object' ) return null;
	let side = raw.side === 'inner' || raw.side === 'outer' ? raw.side : null;
	if ( ! side ) {
		// CapCut stroke.mode: 0 outer (common), 1 often inset — treat 1 as inner.
		if ( raw.mode === 1 || raw.mode === 'inner' || raw.inset === true ) side = 'inner';
		else side = 'outer';
	}
	return {
		enable: raw.enable !== false && raw.enabled !== false,
		width: Math.max( 0, Number( raw.width ) || 0 ),
		alpha: raw.alpha != null ? clamp01( raw.alpha ) : 1,
		side,
		content: normalizeFillContent( raw.content ),
	};

}

export function normalizeShadow( raw ) {

	if ( ! raw || typeof raw !== 'object' ) return null;
	const angle = raw.angle != null ? Number( raw.angle ) : - 45;
	const distance = Math.max( 0, Number( raw.distance ) || 0 );
	const rad = angle * Math.PI / 180;
	const ox = raw.offsetX != null ? Number( raw.offsetX ) : Math.cos( rad ) * distance;
	const oy = raw.offsetY != null ? Number( raw.offsetY ) : Math.sin( rad ) * distance;
	// width / dilate: TMP-style underlay expand (also accept legacy `dilate`).
	const widthRaw = raw.width != null ? raw.width : raw.dilate;
	const nestedStrokes = Array.isArray( raw.strokes )
		? raw.strokes.map( normalizeStroke ).filter( Boolean )
		: [];
	return {
		enable: raw.enable !== false && raw.enabled !== false,
		angle,
		distance,
		width: Math.max( 0, Number( widthRaw ) || 0 ),
		diffuse: Math.max( 0, Number( raw.diffuse != null ? raw.diffuse : raw.blur ) || 0 ),
		alpha: raw.alpha != null ? clamp01( raw.alpha ) : 1,
		offsetX: ox,
		offsetY: oy,
		content: normalizeFillContent( raw.content ),
		/** CapCut: strokes hung on this shadow pass (same offset; not face concentric). */
		strokes: nestedStrokes,
	};

}

function normalizeAnimsStub( raw ) {

	const src = raw && typeof raw === 'object' ? raw : {};
	return {
		in: src.in != null ? src.in : null,
		out: src.out != null ? src.out : null,
		loop: src.loop != null ? src.loop : null,
	};

}

/** First usable solid/gradient color for previews / Troika solid path. */
export function contentPrimaryColor( content ) {

	const c = normalizeFillContent( content );
	if ( c.renderType === 'gradient' ) return c.gradient.colors[ 0 ];
	if ( c.renderType === 'texture' ) return c.solid.color;
	return c.solid.color;

}

export function contentUsesGradient( content ) {

	const c = normalizeFillContent( content );
	return c.renderType === 'gradient';

}

export function shadowOffsetPx( layer ) {

	const sh = normalizeShadow( layer );
	if ( ! sh ) return { x: 0, y: 0 };
	return { x: sh.offsetX, y: sh.offsetY };

}

export function cloneFlowerStyle( style ) {

	return normalizeFlowerStyle( JSON.parse( JSON.stringify( style || {} ) ) );

}

/** Deep-clone for export (JSON-safe). */
export function serializeFlowerStyle( style ) {

	if ( ! style ) return null;
	return cloneFlowerStyle( style );

}

// ---- helpers ----

function defaultGradient() {

	return {
		style: 'linear',
		angle: 90,
		colors: [ '#ffffff', '#afafaf' ],
		alphas: [ 1, 1 ],
		stops: [ 0, 1 ],
		mode: 'character',
	};

}

function normalizeTexRange( v ) {

	const n = Math.floor( Number( v ) );
	if ( ! Number.isFinite( n ) || n < 1 ) return 1;
	return n;

}

function defaultTextureStub() {

	return {
		path: '',
		fileName: '',
		alpha: 1,
		angle: 0,
		scale: 1,
		range: 1,
		flip: [ false, false ],
		wrapMode: 'repeat',
		stretchMode: 'fit',
	};

}

function clamp01( v ) {

	const n = Number( v );
	if ( ! Number.isFinite( n ) ) return 1;
	return Math.max( 0, Math.min( 1, n ) );

}

export function normalizeHex( hex ) {

	if ( typeof hex === 'string' ) {

		let h = hex.trim();
		if ( /^#[0-9a-fA-F]{3}$/.test( h ) ) {

			h = '#' + h[ 1 ] + h[ 1 ] + h[ 2 ] + h[ 2 ] + h[ 3 ] + h[ 3 ];

		}

		if ( /^#[0-9a-fA-F]{6}$/.test( h ) ) return h.toLowerCase();
		if ( /^[0-9a-fA-F]{6}$/.test( h ) ) return ( '#' + h ).toLowerCase();

	}

	return colorAnyToHex( hex, '#ffffff' );

}

function colorAnyToHex( c, fallback = '#ffffff' ) {

	if ( typeof c === 'string' ) {

		const h = normalizeHex( c );
		if ( h ) return h;

	}

	if ( Array.isArray( c ) && c.length >= 3 ) {

		const r = Math.round( clamp01( c[ 0 ] ) * 255 );
		const g = Math.round( clamp01( c[ 1 ] ) * 255 );
		const b = Math.round( clamp01( c[ 2 ] ) * 255 );
		return '#' + [ r, g, b ].map( ( x ) => x.toString( 16 ).padStart( 2, '0' ) ).join( '' );

	}

	return fallback;

}

function normalizeGradientColors( gradSrc ) {

	if ( Array.isArray( gradSrc.colors ) && gradSrc.colors.length >= 2 ) {

		return [
			colorAnyToHex( gradSrc.colors[ 0 ], '#ffffff' ),
			colorAnyToHex( gradSrc.colors[ 1 ], '#afafaf' ),
		];

	}

	if ( Array.isArray( gradSrc.color ) && gradSrc.color.length >= 2 ) {

		return [
			colorAnyToHex( gradSrc.color[ 0 ], '#ffffff' ),
			colorAnyToHex( gradSrc.color[ 1 ], '#afafaf' ),
		];

	}

	return [ '#ffffff', '#afafaf' ];

}

export function hexToRgb01( hex ) {

	const h = normalizeHex( hex ).slice( 1 );
	return [
		parseInt( h.slice( 0, 2 ), 16 ) / 255,
		parseInt( h.slice( 2, 4 ), 16 ) / 255,
		parseInt( h.slice( 4, 6 ), 16 ) / 255,
	];

}

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
 * CapCut nests strokes under shadows (投影上挂描边). Path1 keeps that nesting:
 * each shadow can carry strokes[] that share the shadow offset (not face concentric).
 *
 * @param {number} [fontSize=48] current Text fontSize for unit mapping
 * @returns {object} normalized FlowerStyle
 */
export function createJianying7645FlowerStyle( fontSize = 48 ) {

	const fs = Number( fontSize ) > 0 ? Number( fontSize ) : 48;

	// CapCut fill: solid white; top-level strokes remain empty.
	const fill = { alpha: 1, content: createSolidContent( '#ffffff', 1 ) };

	// CapCut shadows[] order ≈ back → front. Nested strokes stay on their shadow.
	const shadows = [
		// shadow[4]: pink soft drop (no nested strokes)
		createShadowLayer( {
			enable: true,
			angle: - 89.99,
			distance: capcutDistanceToFcc( 4.548161120840636, fs ),
			diffuse: capcutDiffuseToFcc( 0.059836544074722706, fs ),
			alpha: 0.9,
			content: createSolidContent( '#fb9ffb', 1 ),
			strokes: [],
		} ),
		// shadow[3]: alpha=0 fill + white offset ring (投影上挂描边)
		createShadowLayer( {
			enable: true,
			angle: - 89.99,
			distance: capcutDistanceToFcc( 2.446584938704033, fs ),
			diffuse: 0,
			alpha: 0,
			content: createSolidContent( '#000000', 1 ),
			strokes: [
				createStrokeLayer( {
					enable: true,
					side: 'outer',
					width: capcutStrokeWidthToFcc( 0.14500875656742557, fs ),
					alpha: 1,
					content: createSolidContent( '#ffffff', 1 ),
				} ),
			],
		} ),
		// shadow[2]: alpha=0 fill + deep-blue offset ring
		createShadowLayer( {
			enable: true,
			angle: - 89.99,
			distance: capcutDistanceToFcc( 2.9772329246935203, fs ),
			diffuse: 0,
			alpha: 0,
			content: createSolidContent( '#000000', 1 ),
			strokes: [
				createStrokeLayer( {
					enable: true,
					side: 'outer',
					width: capcutStrokeWidthToFcc( 0.12, fs ),
					alpha: 1,
					content: createSolidContent( '#024479', 1 ),
				} ),
			],
		} ),
		// shadow[1]: magenta texture underlay + nested texture rings (distance 0)
		createShadowLayer( {
			enable: true,
			angle: - 45,
			distance: 0,
			diffuse: 0,
			alpha: 1,
			content: jy7645Tex( '1780131613632.png', { fallbackColor: '#d94895', angle: 0, scale: 1 } ),
			strokes: [
				// CapCut order narrow→wide; buildFlowerPasses emits reverse (wide underlay first).
				createStrokeLayer( {
					enable: true,
					side: 'outer',
					width: capcutStrokeWidthToFcc( 0.0574430823117338, fs ),
					alpha: 1,
					content: jy7645Tex( '1780131613632.png', { fallbackColor: '#d94895', angle: 9, scale: 1 } ),
				} ),
				createStrokeLayer( {
					enable: true,
					side: 'outer',
					width: capcutStrokeWidthToFcc( 0.102276707530648, fs ),
					alpha: 1,
					content: jy7645Tex( '1780131838447.png', { fallbackColor: '#472fd3', angle: 0, scale: 1 } ),
				} ),
			],
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
			strokes: [],
		} ),
	];

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
			strokes: [],
		} ),
	];

	return normalizeFlowerStyle( {
		version: FLOWER_STYLE_VERSION,
		id: JIANYING_7645_PACK_ID,
		name: '剪映样例',
		fill,
		strokes: [],
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
			if ( String( p ).startsWith( 'rt:' ) ) return;
			if ( ! seen.has( p ) ) {

				seen.add( p );
				out.push( p );

			}

		}

	}

	const s = normalizeFlowerStyle( style );
	addContent( s.fill && s.fill.content );
	( s.strokes || [] ).forEach( ( st ) => addContent( st.content ) );
	( s.shadows || [] ).forEach( ( sh ) => {
		addContent( sh.content );
		( sh.strokes || [] ).forEach( ( st ) => addContent( st.content ) );
	} );
	( s.innerShadows || [] ).forEach( ( sh ) => {
		addContent( sh.content );
		( sh.strokes || [] ).forEach( ( st ) => addContent( st.content ) );
	} );
	return out;

}
