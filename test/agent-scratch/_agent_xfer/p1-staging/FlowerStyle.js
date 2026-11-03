/**
 * FreeFilmCut FlowerStyle (花字) schema — aligned with CapCut artistEffect content.
 * P1: solid + linear gradient fully; texture schema stub only.
 */

export const FLOWER_STYLE_VERSION = 1;

/** @typedef {'solid'|'gradient'|'texture'} FccRenderType */

/**
 * @returns {object}
 */
export function createSolidContent( color = '#ffffff', alpha = 1 ) {

	return {
		renderType: 'solid',
		solid: { color: normalizeHex( color ), alpha: clamp01( alpha ) },
		gradient: defaultGradient(),
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
	return {
		renderType: 'gradient',
		solid: { color: colors[ 0 ], alpha: alphas[ 0 ] },
		gradient: {
			style: 'linear',
			angle: opts.angle != null ? Number( opts.angle ) : 90,
			colors,
			alphas,
			stops,
			mode: opts.mode || 'character',
		},
		texture: defaultTextureStub(),
	};

}

/**
 * Texture stub (P2) — schema-ready, rendered as solid fallback.
 * @returns {object}
 */
export function createTextureContent( opts = {} ) {

	return {
		renderType: 'texture',
		solid: { color: normalizeHex( opts.fallbackColor || '#ffffff' ), alpha: 1 },
		gradient: defaultGradient(),
		texture: {
			...defaultTextureStub(),
			path: opts.path || '',
			alpha: opts.alpha != null ? clamp01( opts.alpha ) : 1,
		},
	};

}

export function createStrokeLayer( overrides = {} ) {

	return normalizeStroke( {
		enable: true,
		width: 4,
		alpha: 1,
		content: createSolidContent( '#000000', 1 ),
		...overrides,
	} );

}

export function createShadowLayer( overrides = {} ) {

	return normalizeShadow( {
		enable: true,
		angle: - 45,
		distance: 4,
		diffuse: 2,
		alpha: 0.75,
		content: createSolidContent( '#000000', 1 ),
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
	const style = createDefaultFlowerStyle( {
		fill: { alpha: 1, content: createSolidContent( fillColor, 1 ) },
	} );

	const ol = ui.outline || {};
	if ( ol.enabled ) {

		style.strokes.push( createStrokeLayer( {
			enable: true,
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

		style.shadows.push( createShadowLayer( {
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

	return style;

}

/**
 * Prefer explicit flowerStyle; else synthesize from legacy fields.
 */
export function getEffectiveFlowerStyle( ui ) {

	if ( ! ui ) return createDefaultFlowerStyle();
	if ( ui.flowerStyle && typeof ui.flowerStyle === 'object' ) {

		return normalizeFlowerStyle( ui.flowerStyle );

	}

	return flowerStyleFromLegacy( ui );

}

export function normalizeFlowerStyle( raw ) {

	const src = raw && typeof raw === 'object' ? raw : {};
	const fillSrc = src.fill && typeof src.fill === 'object' ? src.fill : {};
	return {
		version: Number( src.version ) || FLOWER_STYLE_VERSION,
		id: src.id != null ? src.id : null,
		fill: {
			alpha: fillSrc.alpha != null ? clamp01( fillSrc.alpha ) : 1,
			content: normalizeFillContent( fillSrc.content ),
		},
		strokes: Array.isArray( src.strokes )
			? src.strokes.map( normalizeStroke ).filter( Boolean )
			: [],
		shadows: Array.isArray( src.shadows )
			? src.shadows.map( normalizeShadow ).filter( Boolean )
			: ( Array.isArray( src.outerShadows )
				? src.outerShadows.map( normalizeShadow ).filter( Boolean )
				: [] ),
		innerShadows: Array.isArray( src.innerShadows )
			? src.innerShadows.map( normalizeShadow ).filter( Boolean )
			: ( Array.isArray( src.inner_shadows )
				? src.inner_shadows.map( normalizeShadow ).filter( Boolean )
				: [] ),
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

	return {
		renderType,
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
			mode: gradSrc.mode || 'character',
		},
		texture: {
			...defaultTextureStub(),
			path: texSrc.path || '',
			alpha: texSrc.alpha != null ? clamp01( texSrc.alpha ) : 1,
			angle: texSrc.angle != null ? Number( texSrc.angle ) : 0,
			scale: texSrc.scale != null ? Number( texSrc.scale ) : 1,
		},
	};

}

export function normalizeStroke( raw ) {

	if ( ! raw || typeof raw !== 'object' ) return null;
	return {
		enable: raw.enable !== false && raw.enabled !== false,
		width: Math.max( 0, Number( raw.width ) || 0 ),
		alpha: raw.alpha != null ? clamp01( raw.alpha ) : 1,
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
	return {
		enable: raw.enable !== false && raw.enabled !== false,
		angle,
		distance,
		diffuse: Math.max( 0, Number( raw.diffuse != null ? raw.diffuse : raw.blur ) || 0 ),
		alpha: raw.alpha != null ? clamp01( raw.alpha ) : 1,
		offsetX: ox,
		offsetY: oy,
		content: normalizeFillContent( raw.content ),
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

function defaultTextureStub() {

	return {
		path: '',
		alpha: 1,
		angle: 0,
		scale: 1,
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
