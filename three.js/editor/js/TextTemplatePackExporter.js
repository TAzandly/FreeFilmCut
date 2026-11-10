/**
 * Export selected Text as a clip-side text-template library pack (.vfxpack).
 *
 * A text-template is a full authored look: text content + flowerStyle + optional
 * textAnim (embedded freecapcut.textanim-pack/1) + textFx / camera postProcess
 * + stickers (textStickers) + MediaFramePlayers (gif / imageSequence / video).
 *
 * Unpack into:
 *   freefilmcut/apps/web/public/vfxpacks/text-templates/
 * and list the filename in that folder's index.json.
 *
 * Format: freecapcut.vfxpack/1 type=text-template + freecapcut.text-template/1 payload.
 * Spec: docs/text-template-pack.md
 */
import JSZip from 'jszip';
import { serializeTextStickersForExport } from './ui/TextStickers.js?v=fcc-ui-211';
import { buildVfxPack } from './VfxPackExporter.js?v=fcc-ui-237';
import { getTextAnimDescriptor } from './textanim/TextAnimRegistry.js';
import { normalizeTextAnim } from './textanim/TextAnimTypes.js?v=fcc-tanim-24';
import { serializeAnimClip } from './anim/FreeCapCutAnimCore.js?v=fcc-anim-20';

function slugify( name ) {

	return String( name || 'text-template' )
		.trim()
		.toLowerCase()
		.replace( /[^a-z0-9._-]+/g, '-' )
		.replace( /^-+|-+$/g, '' )
		.slice( 0, 64 ) || 'text-template';

}

/** Prefer selected Text; else first Text in selection/scene. */
function findTextObject( editor ) {

	const selected = editor.selected;
	if ( selected ) {

		const ui = selected.userData && selected.userData.fccUI;
		if ( ui && ui.type === 'text' ) return selected;
		let found = null;
		selected.traverse( ( o ) => {

			if ( found ) return;
			const u = o.userData && o.userData.fccUI;
			if ( u && u.type === 'text' ) found = o;

		} );
		if ( found ) return found;

	}
	let found = null;
	editor.scene.traverse( ( o ) => {

		if ( found ) return;
		const u = o.userData && o.userData.fccUI;
		if ( u && u.type === 'text' ) found = o;

	} );
	return found;

}

function collectTracksForObject( editor, objectUuid ) {

	const clips = [];
	if ( editor.activeFreecapcutAnim ) clips.push( editor.activeFreecapcutAnim );
	if ( Array.isArray( editor.freecapcutAnims ) ) {

		for ( const a of editor.freecapcutAnims ) {

			if ( a && ! clips.includes( a ) ) clips.push( a );

		}

	}

	const out = [];
	let maxT = 0;
	for ( const clip of clips ) {

		const ser = serializeAnimClip( clip );
		if ( ! ser ) continue;
		for ( const target of ser.targets || [] ) {

			if ( ! target ) continue;
			for ( const tr of target.tracks || [] ) {

				if ( ! tr || ! tr.path || ! tr.keys || ! tr.keys.length ) continue;
				const p = tr.path;
				const keepText =
					target.objectUuid === objectUuid && (
						p.startsWith( 'textAnim.' ) ||
						p.startsWith( 'ui.anchoredPosition' ) ||
						p.startsWith( 'ui.localEulerAngles' ) ||
						p.startsWith( 'ui.localScale' ) ||
						p.startsWith( 'ui.opacity' )
					);
				const keepPp = p.startsWith( 'postProcess.' );
				if ( ! keepText && ! keepPp ) continue;
				const track = {
					path: p,
					keys: tr.keys.map( ( k ) => {

						const o = { t: k.t, v: k.v };
						if ( k.ease ) o.ease = k.ease;
						return o;

					} ),
				};
				if ( tr.interp === 'step' ) track.interp = 'step';
				if ( p.startsWith( 'ui.' ) ) track.relative = 'add';
				out.push( track );
				for ( const k of track.keys ) {

					if ( k.t > maxT ) maxT = k.t;

				}

			}

		}

	}
	return { tracks: out, durationHint: maxT };

}

function stripComponents( anim ) {

	const comps = [];
	for ( const c of ( anim && anim.components ) || [] ) {

		if ( ! c ) continue;
		comps.push( {
			id: c.id,
			type: c.type,
			scope: c.scope,
			enabled: c.enabled !== false,
			params: c.params ? JSON.parse( JSON.stringify( c.params ) ) : {},
			channels: c.channels ? JSON.parse( JSON.stringify( c.channels ) ) : undefined,
			selector: c.selector ? JSON.parse( JSON.stringify( c.selector ) ) : undefined,
			suppressCharPose: !! c.suppressCharPose,
		} );

	}
	return comps;

}

function inferCategory( anim ) {

	const comps = ( anim && anim.components ) || [];
	const votes = { in: 0, out: 0, loop: 0 };
	for ( const c of comps ) {

		if ( ! c || ! c.enabled ) continue;
		const d = getTextAnimDescriptor( c.type );
		const cat = ( d && d.category ) || 'in';
		if ( votes[ cat ] != null ) votes[ cat ] ++;

	}
	let best = 'in';
	let n = - 1;
	for ( const k of [ 'in', 'out', 'loop' ] ) {

		if ( votes[ k ] > n ) { n = votes[ k ]; best = k; }

	}
	return best;

}

function resolveDuration( category, tracks, durationHint, components ) {

	let d = Number( durationHint ) || 0;
	for ( const tr of tracks ) {

		for ( const k of tr.keys || [] ) {

			if ( k.t > d ) d = k.t;

		}

	}
	if ( d < 0.05 ) {

		for ( const c of components ) {

			const desc = getTextAnimDescriptor( c.type );
			const dd = desc && Number( desc.defaultDuration );
			if ( dd > d ) d = dd;

		}

	}
	if ( d < 0.05 ) d = category === 'loop' ? 1 : 0.8;
	return Math.round( d * 1000 ) / 1000;

}

function dataUrlToBytes( dataUrl ) {

	const comma = dataUrl.indexOf( ',' );
	if ( comma < 0 ) return null;
	const binary = atob( dataUrl.slice( comma + 1 ) );
	const bytes = new Uint8Array( binary.length );
	for ( let i = 0; i < binary.length; i ++ ) bytes[ i ] = binary.charCodeAt( i );
	return bytes;

}

async function posterToPngBytes( dataUrl ) {

	if ( typeof dataUrl !== 'string' || ! dataUrl.startsWith( 'data:image/' ) ) return null;
	if ( dataUrl.startsWith( 'data:image/png' ) ) return dataUrlToBytes( dataUrl );
	return new Promise( ( resolve, reject ) => {

		const image = new Image();
		image.onload = () => {

			const canvas = document.createElement( 'canvas' );
			canvas.width = image.naturalWidth || image.width;
			canvas.height = image.naturalHeight || image.height;
			const ctx = canvas.getContext( '2d' );
			ctx.drawImage( image, 0, 0 );
			canvas.toBlob( ( blob ) => {

				if ( ! blob ) {

					reject( new Error( 'poster encode failed' ) );
					return;

				}
				blob.arrayBuffer().then( ( buf ) => resolve( new Uint8Array( buf ) ), reject );

			}, 'image/png' );

		};
		image.onerror = () => reject( new Error( 'preview image failed to load' ) );
		image.src = dataUrl;

	} );

}

async function addLibraryPreview( editor, pack ) {

	const preview = {};
	const posterUrl = editor.config && editor.config.getKey( 'project/vfxpack/previewPoster' );
	if ( typeof posterUrl === 'string' && posterUrl.startsWith( 'data:image/' ) ) {

		try {

			const bytes = await posterToPngBytes( posterUrl );
			if ( bytes && bytes.length > 0 ) {

				pack.file( 'preview/poster.png', bytes );
				preview.poster = 'preview/poster.png';

			}

		} catch ( error ) {

			console.warn( '[TextTemplatePack] poster export failed', error );

		}

	}

	const hoverUrl = editor.config && editor.config.getKey( 'project/vfxpack/previewHover' );
	if ( typeof hoverUrl === 'string' && hoverUrl.startsWith( 'data:image/gif' ) ) {

		const bytes = dataUrlToBytes( hoverUrl );
		if ( bytes && bytes.length > 0 ) {

			pack.file( 'preview/hover.gif', bytes );
			preview.hover = 'preview/hover.gif';

		}

	}

	return preview.poster || preview.hover ? preview : null;

}

function serializeEffectStack( stack ) {

	if ( ! stack || typeof stack !== 'object' ) return null;
	const effects = Array.isArray( stack.effects )
		? stack.effects.map( ( e ) => {

			if ( ! e || ! e.type ) return null;
			const params = { ...( e.params || {} ) };
			if ( e.type === 'bloom' && 'blurIterations' in params ) delete params.blurIterations;
			const row = {
				id: e.id,
				type: e.type,
				enabled: e.enabled !== false,
				params,
				exposed: ( e.exposed && typeof e.exposed === 'object' ) ? { ...e.exposed } : {},
			};
			if ( e.definition && typeof e.definition === 'object' ) {

				row.definition = JSON.parse( JSON.stringify( e.definition ) );

			}

			return row;

		} ).filter( Boolean )
		: [];
	if ( ! effects.length && stack.enabled === false ) return null;
	return {
		enabled: stack.enabled !== false,
		effects,
	};

}

function collectAuthoringOutput( editor ) {

	const TONE_NAMES = {
		0: 'none',
		1: 'linear',
		2: 'reinhard',
		3: 'cineon',
		4: 'acesfilmic',
		5: 'agx',
		6: 'neutral',
		7: 'neutral',
	};
	let toneMapping = 'neutral';
	let toneMappingExposure = 1;
	try {

		const cfg = editor && editor.config;
		if ( cfg && typeof cfg.getKey === 'function' ) {

			const tm = cfg.getKey( 'project/renderer/toneMapping' );
			const exp = cfg.getKey( 'project/renderer/toneMappingExposure' );
			if ( tm != null && TONE_NAMES[ tm ] ) toneMapping = TONE_NAMES[ tm ];
			else if ( typeof tm === 'string' ) toneMapping = tm;
			if ( Number( exp ) > 0 ) toneMappingExposure = Number( exp );

		}

	} catch ( e ) { /* keep defaults */ }
	return { toneMapping, toneMappingExposure };

}

function collectAuthoringBackground( editor ) {

	const t = editor && editor.backgroundType;
	if ( ! t || t === 'Default' || t === 'default' ) {

		return { type: 'Default' };

	}
	if ( t === 'Color' ) {

		let hex = '#000000';
		const bg = editor.scene && editor.scene.background;
		if ( bg && bg.isColor && typeof bg.getHexString === 'function' ) {

			hex = '#' + bg.getHexString();

		} else if ( editor.viewportColor && editor.viewportColor.isColor
			&& typeof editor.viewportColor.getHexString === 'function' ) {

			hex = '#' + editor.viewportColor.getHexString();

		}
		return { type: 'Color', color: hex };

	}
	return { type: 'Color', color: '#000000' };

}

function collectAuthoringPostProcess( editor ) {

	const seen = new Set();
	const cams = [];
	const push = ( cam ) => {

		if ( ! cam || seen.has( cam ) ) return;
		seen.add( cam );
		cams.push( cam );

	};
	push( editor.viewportCamera );
	if ( editor.scene ) {

		editor.scene.traverse( ( o ) => {

			if ( o && ( o.isCamera || o.isPerspectiveCamera || o.isOrthographicCamera ) ) push( o );

		} );

	}
	for ( const cam of cams ) {

		const stack = cam.userData && cam.userData.postProcessStack;
		const serialized = serializeEffectStack( stack );
		if ( serialized && serialized.effects && serialized.effects.length ) return serialized;

	}
	return null;

}


/**
 * Embed custom text fonts into pack/fonts/ and rewrite text.font / text.fontBold
 * to pack-relative paths (same contract as VfxPackExporter.collectFonts).
 * Without this, textTemplate.text.font stays a blob: URL that dies on clip load.
 */
async function embedTextFonts( editor, pack, textObject, text ) {

	if ( ! text || typeof text !== 'object' ) return text;

	const fontsFolder = pack.folder( 'fonts' );
	const fontMap = new Map();
	let idx = 0;

	async function embedFont( url, preferredName ) {

		if ( ! url ) return '';
		if ( fontMap.has( url ) ) return fontMap.get( url );
		if ( typeof url === 'string' && url.startsWith( 'fonts/' ) ) {

			fontMap.set( url, url );
			return url;

		}
		if ( typeof url === 'string' && url.startsWith( '/fonts/' ) ) {

			// Site default (msyh) — keep absolute path; do not re-pack.
			fontMap.set( url, url );
			return url;

		}

		let buffer = null;
		let fileName = preferredName || ( 'font_' + idx + '.ttf' );

		try {

			if ( url.startsWith( 'blob:' ) || url.startsWith( 'http://' ) || url.startsWith( 'https://' ) || url.startsWith( 'data:' ) ) {

				const res = await fetch( url );
				buffer = await res.arrayBuffer();
				const guess = ( preferredName || '' ).toLowerCase();
				if ( guess.endsWith( '.otf' ) || guess.endsWith( '.ttf' ) || guess.endsWith( '.woff' ) ) fileName = preferredName;
				else if ( url.includes( '.woff' ) ) fileName = 'font_' + idx + '.woff';
				else if ( url.includes( '.otf' ) ) fileName = 'font_' + idx + '.otf';
				else fileName = 'font_' + idx + '.ttf';

			}

		} catch ( e ) {

			console.warn( '[TextTemplatePack] font fetch failed', url, e );
			fontMap.set( url, url );
			return url;

		}

		if ( ! buffer ) {

			fontMap.set( url, url );
			return url;

		}

		const safe = String( fileName ).replace( /[^\w.\-]+/g, '_' );
		const rel = 'fonts/' + safe;
		fontsFolder.file( safe, buffer );
		fontMap.set( url, rel );
		idx += 1;
		return rel;

	}

	// Prefer in-memory bytes keyed by text object uuid (editor UIText cache).
	let embedded = null;
	if ( editor && editor._fccFontBytes && textObject && textObject.uuid && editor._fccFontBytes.has( textObject.uuid ) ) {

		const entry = editor._fccFontBytes.get( textObject.uuid );
		const safe = ( entry.name || ( 'font_' + idx + '.ttf' ) ).replace( /[^\w.\-]+/g, '_' );
		const rel = 'fonts/' + safe;
		fontsFolder.file( safe, entry.buffer );
		embedded = rel;
		idx += 1;
		if ( text.font ) fontMap.set( text.font, rel );
		text.font = rel;
		if ( entry.name ) text.fontFileName = entry.name;

	} else if ( text.font ) {

		const rel = await embedFont( text.font, text.fontFileName || '' );
		text.font = rel;

	}

	if ( text.fontBold ) {

		const relB = await embedFont( text.fontBold, '' );
		text.fontBold = relB;

	}

	if ( embedded ) {

		console.log( '[TextTemplatePack] embedded font', embedded );

	}

	return text;

}

function collectTextContent( ui ) {

	return {
		content: ui.text != null ? String( ui.text ) : '',
		font: ui.font || '',
		fontBold: ui.fontBold || '',
		fontFileName: ui.fontFileName || '',
		fontSize: Number( ui.fontSize ) || 48,
		bold: !! ui.bold,
		color: ui.color || '#ffffff',
		letterSpacing: Number( ui.letterSpacing ) || 0,
		lineHeight: Number( ui.lineHeight ) > 0 ? Number( ui.lineHeight ) : 1.2,
		align: ui.align || 'center',
		verticalAlign: ui.verticalAlign || 'middle',
		outline: ui.outline ? JSON.parse( JSON.stringify( ui.outline ) ) : { enabled: false, width: 2, color: '#000000', opacity: 1 },
		shadow: ui.shadow ? JSON.parse( JSON.stringify( ui.shadow ) ) : { enabled: false, offsetX: 2, offsetY: - 2, blur: 4, color: '#000000', opacity: 0.75 },
	};

}

async function embedFlowerTextures( editor, pack, style ) {

	if ( ! style || typeof style !== 'object' ) return style;
	const texturesFolder = pack.folder( 'textures' );
	const map = new Map();
	let idx = 0;

	async function embedOne( path, preferredName ) {

		if ( ! path || typeof path !== 'string' ) return '';
		if ( map.has( path ) ) return map.get( path );
		if ( path.startsWith( 'rt:' ) ) {
			map.set( path, path );
			return path;
		}
		if ( path.startsWith( 'textures/' ) ) {

			map.set( path, path );
			return path;

		}

		let buffer = null;
		let fileName = preferredName || ( 'flower_tex_' + idx + '.png' );

		if ( editor && editor._fccFlowerTexBytes && editor._fccFlowerTexBytes.has( path ) ) {

			const entry = editor._fccFlowerTexBytes.get( path );
			buffer = entry.buffer;
			if ( entry.name ) fileName = entry.name;

		} else {

			try {

				if (
					path.startsWith( 'blob:' ) ||
					path.startsWith( 'http://' ) ||
					path.startsWith( 'https://' ) ||
					path.startsWith( 'data:' ) ||
					path.startsWith( '/' )
				) {

					const res = await fetch( path );
					buffer = await res.arrayBuffer();

				}

			} catch ( e ) {

				console.warn( '[TextTemplatePack] flower texture fetch failed', path, e );

			}

		}

		if ( ! buffer ) {

			map.set( path, path );
			return path;

		}

		const safe = String( fileName ).replace( /[^\w.\-]+/g, '_' );
		const unique = 'flower_' + idx + '_' + safe;
		const rel = 'textures/' + unique;
		texturesFolder.file( unique, buffer );
		map.set( path, rel );
		idx += 1;
		return rel;

	}

	async function rewriteContent( content ) {

		if ( ! content || typeof content !== 'object' ) return content;
		const c = JSON.parse( JSON.stringify( content ) );
		const rt = c.renderType || c.render_type;
		if ( rt === 'texture' && c.texture && c.texture.path ) {

			const rel = await embedOne( c.texture.path, c.texture.fileName || c.texture.name || '' );
			c.texture.path = rel;

		}
		return c;

	}

	async function rewriteStyle( s ) {

		const out = JSON.parse( JSON.stringify( s ) );
		if ( out.fill && out.fill.content ) out.fill.content = await rewriteContent( out.fill.content );
		if ( Array.isArray( out.strokes ) ) {

			for ( let i = 0; i < out.strokes.length; i ++ ) {

				if ( out.strokes[ i ] && out.strokes[ i ].content ) {

					out.strokes[ i ].content = await rewriteContent( out.strokes[ i ].content );

				}

			}

		}
		for ( const key of [ 'shadows', 'innerShadows', 'inner_shadows' ] ) {

			if ( ! Array.isArray( out[ key ] ) ) continue;
			for ( let i = 0; i < out[ key ].length; i ++ ) {

				if ( out[ key ][ i ] && out[ key ][ i ].content ) {

					out[ key ][ i ].content = await rewriteContent( out[ key ][ i ].content );

				}

			}

		}
		return out;

	}

	return rewriteStyle( style );

}


async function embedStickerTextures( editor, pack, stickers ) {

	if ( ! Array.isArray( stickers ) || ! stickers.length ) return stickers;
	const texturesFolder = pack.folder( 'textures' );
	const map = new Map();
	let idx = 0;

	async function embedOne( path, preferredName ) {

		if ( ! path || typeof path !== 'string' ) return '';
		if ( map.has( path ) ) return map.get( path );
		if ( path.startsWith( 'rt:' ) ) {
			map.set( path, path );
			return path;
		}
		if ( path.startsWith( 'textures/' ) ) {

			map.set( path, path );
			return path;

		}

		let buffer = null;
		let fileName = preferredName || ( 'sticker_tex_' + idx + '.png' );

		if ( editor && editor._fccFlowerTexBytes && editor._fccFlowerTexBytes.has( path ) ) {

			const entry = editor._fccFlowerTexBytes.get( path );
			buffer = entry.buffer;
			if ( entry.name ) fileName = entry.name;

		} else {

			try {

				if (
					path.startsWith( 'blob:' ) ||
					path.startsWith( 'http://' ) ||
					path.startsWith( 'https://' ) ||
					path.startsWith( 'data:' ) ||
					path.startsWith( '/' )
				) {

					const res = await fetch( path );
					buffer = await res.arrayBuffer();

				}

			} catch ( e ) {

				console.warn( '[TextTemplatePack] sticker texture fetch failed', path, e );

			}

		}

		if ( ! buffer ) {

			map.set( path, path );
			return path;

		}

		const safe = String( fileName ).replace( /[^\w.\-]+/g, '_' );
		const unique = 'sticker_' + idx + '_' + safe;
		const rel = 'textures/' + unique;
		texturesFolder.file( unique, buffer );
		map.set( path, rel );
		idx += 1;
		return rel;

	}

	const out = [];
	for ( let i = 0; i < stickers.length; i ++ ) {

		const s = { ...stickers[ i ] };
		if ( s.texturePath ) {

			s.texturePath = await embedOne( s.texturePath, s.textureFileName || '' );

		}
		out.push( s );

	}
	return out;

}

function buildEmbeddedTextAnim( editor, object, ui ) {

	if ( ! ui || ! ui.textAnim ) return null;
	const anim = normalizeTextAnim( ui.textAnim );
	const components = stripComponents( anim );
	if ( ! components.length ) return null;
	const category = inferCategory( anim );
	const { tracks, durationHint } = collectTracksForObject( editor, object.uuid );
	const duration = resolveDuration( category, tracks, durationHint, components );
	return {
		format: 'freecapcut.textanim-pack/1',
		name: ( object && object.name ) || 'Text animation',
		category,
		duration,
		components,
		tracks,
	};

}


/**
 * Pack scene MediaFramePlayers (gif / imageSequence / video) into pack/media and pack/sequences.
 * Mirrors VfxPackExporter so clip-side pack-video / text-template apply can restore players.
 * @returns {{ players: object[], assetPaths: string[] }}
 */
async function embedMediaPlayers( editor, pack ) {

	const players = [];
	const assetPaths = [];
	if ( ! editor || ! editor.scene || ! pack ) return { players, assetPaths };

	const videoPlayers = [];
	editor.scene.traverse( ( object ) => {

		if ( object.userData && object.userData.fccVideoPlayer ) videoPlayers.push( object );

	} );
	if ( ! videoPlayers.length ) return { players, assetPaths };

	const pathByUuid = new Map();
	const frameNamesByUuid = new Map();
	const pf = editor.projectFolder;

	for ( const object of videoPlayers ) {

		const vp = object.userData.fccVideoPlayer || {};
		if ( vp.kind === 'gif' || vp.kind === 'imageSequence' ) continue;
		let bytes = object.__fccVideoBytes;
		const tryPaths = [];
		if ( vp.projectPath ) tryPaths.push( vp.projectPath );
		if ( vp.fileName ) tryPaths.push( 'assets/videos/' + String( vp.fileName ).split( /[/\\]/ ).pop() );
		if ( ! bytes && pf && typeof pf.readBinaryFile === 'function' ) {

			for ( const rel of tryPaths ) {

				try {

					const bin = await pf.readBinaryFile( rel );
					if ( bin && bin.buffer ) {

						bytes = bin.buffer;
						if ( bin.name ) vp.fileName = bin.name;
						vp.projectPath = rel;
						object.__fccVideoBytes = bytes;
						break;

					}

				} catch ( e ) { /* next */ }

			}

		}
		if ( ! bytes ) continue;
		const rawName = String( vp.fileName || 'video.mp4' ).split( /[/\\]/ ).pop() || 'video.mp4';
		const extMatch = rawName.match( /\.(mp4|webm|mov|ogv|ogg)$/i );
		const ext = extMatch ? extMatch[ 0 ].toLowerCase() : '.mp4';
		const base = slugify( rawName.replace( /\.[^.]+$/, '' ) ) || 'video';
		const fileName = object.uuid.slice( 0, 8 ) + '_' + base + ext;
		const rel = 'videos/' + fileName;
		pack.folder( 'videos' ).file( fileName, new Uint8Array( bytes ) );
		pathByUuid.set( object.uuid, rel );
		assetPaths.push( rel );

	}

	for ( const object of videoPlayers ) {

		const vp = object.userData.fccVideoPlayer || {};
		if ( vp.kind !== 'gif' ) continue;
		if ( pathByUuid.has( object.uuid ) ) continue;
		let bytes = object.__fccGifBytes;
		const tryPaths = [];
		if ( vp.projectPath ) tryPaths.push( vp.projectPath );
		if ( vp.fileName ) tryPaths.push( 'assets/textures/' + String( vp.fileName ).split( /[/\\]/ ).pop() );
		if ( ! bytes && pf && typeof pf.readBinaryFile === 'function' ) {

			for ( const rel of tryPaths ) {

				try {

					const bin = await pf.readBinaryFile( rel );
					if ( bin && bin.buffer ) {

						bytes = bin.buffer;
						vp.fileName = bin.name || vp.fileName;
						vp.projectPath = rel;
						object.__fccGifBytes = bytes;
						break;

					}

				} catch ( e ) { /* next */ }

			}

		}
		if ( ! bytes ) {

			console.warn( '[TextTemplatePack] gif player has no media', object.name || object.uuid );
			continue;

		}
		const rawName = String( vp.fileName || 'anim.gif' ).split( /[/\\]/ ).pop() || 'anim.gif';
		const base = slugify( rawName.replace( /\.[^.]+$/, '' ) ) || 'gif';
		const fileName = object.uuid.slice( 0, 8 ) + '_' + base + '.gif';
		const rel = 'media/' + fileName;
		pack.folder( 'media' ).file( fileName, new Uint8Array( bytes ) );
		pathByUuid.set( object.uuid, rel );
		assetPaths.push( rel );

	}

	for ( const object of videoPlayers ) {

		const vp = object.userData.fccVideoPlayer || {};
		if ( vp.kind !== 'imageSequence' ) continue;
		if ( pathByUuid.has( object.uuid ) ) continue;
		const seq = object.__fccSeq;
		const names = seq && seq.names ? seq.names.slice() : [];
		const dir = vp.sequenceDir || vp.projectPath || '';
		if ( ! names.length && pf && dir && typeof pf.listAssetFiles === 'function' ) {

			const listed = await pf.listAssetFiles( dir );
			for ( const n of listed || [] ) {

				if ( /\.(png|jpe?g|webp|bmp|gif)$/i.test( n ) ) names.push( n );

			}
			names.sort( ( a, b ) => a.localeCompare( b, undefined, { numeric: true, sensitivity: 'base' } ) );

		}
		if ( ! names.length ) {

			console.warn( '[TextTemplatePack] sequence player has no frames', object.name || object.uuid );
			continue;

		}
		const seqFolderName = object.uuid.slice( 0, 8 ) + '_seq';
		const seqFolder = pack.folder( 'sequences/' + seqFolderName );
		let packed = 0;
		for ( const name of names ) {

			let bytes = null;
			if ( seq && seq.fileMap && seq.fileMap.has( name ) ) {

				const f = seq.fileMap.get( name );
				if ( f && typeof f.arrayBuffer === 'function' ) bytes = await f.arrayBuffer();
				else if ( f instanceof ArrayBuffer ) bytes = f;

			}
			if ( ! bytes && pf && dir && typeof pf.readBinaryFile === 'function' ) {

				try {

					const bin = await pf.readBinaryFile( dir.replace( /\\/g, '/' ).replace( /\/$/, '' ) + '/' + name );
					if ( bin && bin.buffer ) bytes = bin.buffer;

				} catch ( e ) { /* skip */ }

			}
			if ( ! bytes ) continue;
			seqFolder.file( name, new Uint8Array( bytes ) );
			packed ++;

		}
		if ( ! packed ) continue;
		const rel = 'sequences/' + seqFolderName + '/';
		pathByUuid.set( object.uuid, rel );
		frameNamesByUuid.set( object.uuid, names.slice() );
		assetPaths.push( rel );

	}

	for ( const object of videoPlayers ) {

		const path = pathByUuid.get( object.uuid );
		if ( ! path ) continue;
		const vp = object.userData.fccVideoPlayer || {};
		const mediaKind = vp.kind === 'gif' || vp.kind === 'imageSequence' ? vp.kind : 'video';
		let playbackRate = Number( vp.playbackRate );
		if ( ! Number.isFinite( playbackRate ) || playbackRate <= 0 ) playbackRate = 1;
		const packedNames = frameNamesByUuid.get( object.uuid );
		players.push( {
			uuid: object.uuid,
			name: object.name || '',
			kind: mediaKind,
			path,
			loop: vp.loop !== false,
			muted: vp.muted === true,
			volume: Number.isFinite( Number( vp.volume ) ) ? Number( vp.volume ) : 1,
			playbackRate,
			autoplay: vp.autoplay === true,
			targetUuid: vp.targetUuid || '',
			fileName: vp.fileName || '',
			sequenceFps: Number( vp.sequenceFps ) || 30,
			sequenceDir: mediaKind === 'imageSequence' ? path : ( vp.sequenceDir || '' ),
			sequenceStart: Number( vp.sequenceStart ) || 0,
			sequenceEnd: Number.isFinite( Number( vp.sequenceEnd ) ) ? Number( vp.sequenceEnd ) : - 1,
			frameNames: mediaKind === 'imageSequence'
				? ( packedNames && packedNames.length
					? packedNames.slice()
					: ( object.__fccSeq && object.__fccSeq.names ? object.__fccSeq.names.slice() : undefined ) )
				: undefined,
		} );

	}

	return { players, assetPaths };

}

async function buildTextTemplatePack( editor, opts = {} ) {

	const object = findTextObject( editor );
	if ( ! object ) {

		throw new Error( 'Select a Text object first' );

	}
	const ui = object.userData.fccUI || {};
	const displayName = String( opts.displayName || object.name || 'Text template' ).trim() || 'Text template';
	let id = String( opts.id || ( 'freecapcut.text-template.' + slugify( displayName ) ) ).trim();
	if ( ! id.startsWith( 'freecapcut.text-template.' ) ) {

		id = 'freecapcut.text-template.' + slugify( String( id ).replace( /^freecapcut\./, '' ) || displayName );

	}
	const version = opts.version || '1.0.0';

	const zip = new JSZip();
	const pack = zip.folder( 'pack' );
	pack.folder( 'preview' );
	pack.folder( 'textures' );

	let text = collectTextContent( ui );
	try {

		text = await embedTextFonts( editor, pack, object, text );

	} catch ( e ) {

		console.warn( '[TextTemplatePack] font embed failed', e );

	}
	let flowerStyle = null;
	if ( ui.flowerStyle && typeof ui.flowerStyle === 'object' ) {

		try {

			flowerStyle = await embedFlowerTextures( editor, pack, ui.flowerStyle );

		} catch ( e ) {

			console.warn( '[TextTemplatePack] flowerStyle embed failed', e );
			try {

				flowerStyle = JSON.parse( JSON.stringify( ui.flowerStyle ) );

			} catch ( e2 ) {

				flowerStyle = ui.flowerStyle;

			}

		}

	}

	const textAnim = opts.textAnim !== undefined
		? opts.textAnim
		: buildEmbeddedTextAnim( editor, object, ui );

	// Prefer text-layer Fx stack; fall back to camera beauty PP (same as text-anim packs).
	const textFx = serializeEffectStack( ui.textFxStack );
	const cameraPp = opts.postProcess !== undefined
		? opts.postProcess
		: collectAuthoringPostProcess( editor );
	const postProcess = ( textFx && textFx.effects && textFx.effects.length )
		? textFx
		: cameraPp;

	const background = opts.background !== undefined
		? opts.background
		: collectAuthoringBackground( editor );
	const output = opts.output !== undefined
		? opts.output
		: collectAuthoringOutput( editor );

	const textTemplate = {
		format: 'freecapcut.text-template/1',
		name: displayName,
		text,
	};
	if ( flowerStyle ) textTemplate.flowerStyle = flowerStyle;
	if ( ui.flowerBaseFontSize != null && Number( ui.flowerBaseFontSize ) > 0 ) {

		textTemplate.flowerBaseFontSize = Number( ui.flowerBaseFontSize );

	}
	if ( textAnim ) textTemplate.textAnim = textAnim;
	if ( postProcess && postProcess.effects && postProcess.effects.length ) {

		textTemplate.postProcess = postProcess;

	}
	if ( textFx && textFx.effects && textFx.effects.length ) {

		textTemplate.textFxStack = textFx;

	}
	if ( background && background.type ) textTemplate.background = background;
	if ( output ) textTemplate.output = output;

	let stickers = serializeTextStickersForExport( ui );
	if ( stickers && stickers.length ) {

		try {

			stickers = await embedStickerTextures( editor, pack, stickers );

		} catch ( e ) {

			console.warn( '[TextTemplatePack] sticker embed failed', e );

		}
		// Prefer material-ball / shader stickers when materialUuid is authored.
		for ( let si = 0; si < stickers.length; si ++ ) {
			const s = stickers[ si ];
			if ( s && s.materialUuid ) s.material = 'material';
		}
		textTemplate.stickers = stickers;

	}

	let mediaPlayers = [];
	let mediaAssetPaths = [];
	try {

		const media = await embedMediaPlayers( editor, pack );
		mediaPlayers = media.players || [];
		mediaAssetPaths = media.assetPaths || [];
		if ( mediaPlayers.length ) textTemplate.mediaPlayers = mediaPlayers;
		if ( mediaAssetPaths.length ) textTemplate.mediaAssets = mediaAssetPaths;

	} catch ( e ) {

		console.warn( '[TextTemplatePack] mediaPlayers embed failed', e );

	}

	// Optional phase pack refs (stub-friendly; clip may resolve later).
	if ( opts.animRefs && typeof opts.animRefs === 'object' ) {

		textTemplate.animRefs = {
			in: opts.animRefs.in || null,
			out: opts.animRefs.out || null,
			loop: opts.animRefs.loop || null,
		};

	}

	const libraryPreview = await addLibraryPreview( editor, pack );
	const manifest = {
		schema: 'freecapcut.vfxpack/1',
		id,
		version,
		displayName,
		type: 'text-template',
		textTemplate,
		i18n: { 'zh-CN': { displayName } },
	};
	if ( textTemplate.postProcess ) manifest.postProcess = textTemplate.postProcess;
	if ( textTemplate.background ) manifest.background = textTemplate.background;
	if ( textTemplate.output ) manifest.output = textTemplate.output;
	if ( libraryPreview ) manifest.preview = libraryPreview;


	// Embed full scene.json (Box/Cube + lights + cameras + materials/shaders) so the
	// clip can graft prop meshes + materialsMap for shader stickers (fcc-ui-194).
	let hasSceneProps = false;
	try {
		const sceneResult = await buildVfxPack( editor, {
			type: 'effect',
			displayName: displayName + ' scene',
			id: id + '.scene-embed',
			version,
		} );
		const sceneZip = await JSZip.loadAsync( sceneResult.blob );
		const copyRe = /^(pack\/)?(scene\.json|geometries\/|shaders\/|textures\/|media\/|videos\/|sequences\/|fonts\/)/;
		for ( const [ path, entry ] of Object.entries( sceneZip.files ) ) {
			if ( entry.dir ) continue;
			const norm = path.replace( /^\/+/, '' );
			if ( ! copyRe.test( norm ) ) continue;
			const rel = norm.startsWith( 'pack/' ) ? norm.slice( 5 ) : norm;
			if ( rel === 'manifest.json' || rel === 'text-template.json' ) continue;
			// Do not overwrite media/sequences/videos already packed by text-template embed.
			const dest = 'pack/' + rel;
			if ( zip.file( dest ) && /^(media|videos|sequences|fonts)\//.test( rel ) ) continue;
			const data = await entry.async( 'uint8array' );
			zip.file( dest, data );
			if ( rel === 'scene.json' ) hasSceneProps = true;
		}
		manifest.entry = { scene: 'scene.json' };
		if ( ! manifest.assets ) manifest.assets = {};
		manifest.assets.scene = 'scene.json';
		manifest.meta = Object.assign( {}, manifest.meta || {}, {
			hasSceneEmbed: hasSceneProps,
			generator: 'FreeFilmCut TextTemplatePackExporter',
		} );
	} catch ( e ) {
		console.warn( '[TextTemplatePack] scene embed failed', e );
	}

	pack.file( 'manifest.json', JSON.stringify( manifest, null, 2 ) );
	pack.file( 'text-template.json', JSON.stringify( textTemplate, null, 2 ) );

	zip.file(
		'INSTALL.txt',
		[
			'FreeFilmCut text-template pack',
			'',
			'1. Place this .vfxpack in:',
			'   freefilmcut/apps/web/public/vfxpacks/text-templates/',
			'2. Add the filename to that folder index.json (include .vfxpack extension).',
			'3. Hard-refresh OpenCut -> Assets -> Text -> Text templates',
			'',
			'Includes text content + custom fonts/ + optional flowerStyle + embedded textAnim + postProcess/textFx + stickers + gif/seq mediaPlayers + scene.json (prop meshes).',
			'Optional: pack/preview/poster.png and hover.gif.',
			'',
		].join( '\n' ),
	);

	const blob = await zip.generateAsync( { type: 'blob', compression: 'DEFLATE' } );
	const filename = slugify( id ) + '.vfxpack';
	return {
		blob,
		filename,
		id,
		displayName,
		hasFlower: !! flowerStyle,
		hasTextAnim: !! textAnim,
		hasPostProcess: !!( textTemplate.postProcess && textTemplate.postProcess.effects && textTemplate.postProcess.effects.length ),
		hasStickers: !!( textTemplate.stickers && textTemplate.stickers.length ),
		hasMediaPlayers: !!( textTemplate.mediaPlayers && textTemplate.mediaPlayers.length ),
		hasSceneProps,
		manifest,
		textTemplate,
	};

}

async function exportTextTemplatePack( editor, saveFn, opts = {} ) {

	const result = await buildTextTemplatePack( editor, opts );
	const pf = editor.projectFolder;
	if ( pf && pf.hasFolder && pf.hasFolder() && pf.saveBlob ) {

		try {

			await pf.requestPermissionOnGesture();
			const ok = await pf.saveBlob( 'exports', result.filename, result.blob );
			if ( ok ) {

				result.savedToProject = true;
				result.projectPath = 'exports/' + result.filename;
				return result;

			}

		} catch ( e ) {

			console.warn( '[FreeFilmCut] text-template pack exports/ write failed:', e );

		}

	}
	saveFn( result.blob, result.filename );
	result.savedToProject = false;
	return result;

}

function promptTextTemplatePackOptions( editor ) {

	const object = findTextObject( editor );
	if ( ! object ) {

		alert( 'Select a Text object first' );
		return null;

	}
	const defaultName = ( object && object.name ) || 'Text template';
	const entered = window.prompt( 'Text template pack name', defaultName );
	if ( entered === null ) return null;
	const displayName = entered.trim() || defaultName;
	return {
		displayName,
		id: 'freecapcut.text-template.' + slugify( displayName ),
	};

}

function formatTextTemplatePackExportMessage( result ) {

	const where = result.savedToProject
		? ( result.projectPath || result.filename )
		: result.filename;
	return [
		'Saved: ' + where,
		'Type: text-template',
		'Flower: ' + ( result.hasFlower ? 'yes' : 'no' ),
		'Text anim: ' + ( result.hasTextAnim ? 'yes' : 'no' ),
		'Post-process: ' + ( result.hasPostProcess ? 'yes' : 'no' ),
		'Stickers: ' + ( result.hasStickers ? 'yes' : 'no' ),
		'Media (gif/seq/video): ' + ( result.hasMediaPlayers ? 'yes' : 'no' ),
		'Scene props (cube/meshes): ' + ( result.hasSceneProps ? 'yes' : 'no' ),
		'Put in: freefilmcut/apps/web/public/vfxpacks/text-templates/',
		'Add to that folder index.json (with .vfxpack extension), then hard-refresh OpenCut.',
	].join( '\n' );

}

export {
	buildTextTemplatePack,
	exportTextTemplatePack,
	promptTextTemplatePackOptions,
	formatTextTemplatePackExportMessage,
	findTextObject,
};
