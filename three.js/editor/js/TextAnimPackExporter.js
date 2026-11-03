/**
 * Export selected Text's textAnim stack + matching .anim tracks as a clip-side
 * text-anim library pack (.vfxpack).
 *
 * Unpack into:
 *   freefilmcut/apps/web/public/vfxpacks/text-anims/<in|out|loop>/
 * and list the filename in that folder's index.json.
 *
 * Format: freecapcut.vfxpack/1 type=text-anim + freecapcut.textanim-pack/1 payload.
 * Payload includes optional camera postProcess snapshot + postProcess.* keyframe tracks (Bloom/DeepGlow/…); never flowerStyle.
 * Spec: docs/superpowers/specs/2026-10-22-textanim-keyframes-design.md §4
 * Duo doc: docs/textanim-pack-export.md
 */
import JSZip from 'jszip';
import { getTextAnimDescriptor } from './textanim/TextAnimRegistry.js';
import { normalizeTextAnim } from './textanim/TextAnimTypes.js?v=fcc-tanim-24';
import { serializeAnimClip } from './anim/FreeCapCutAnimCore.js?v=fcc-anim-20';

const PHASE_FOLDERS = {
	in: 'in',
	out: 'out',
	loop: 'loop',
};

function slugify( name ) {

	return String( name || 'text-anim' )
		.trim()
		.toLowerCase()
		.replace( /[^a-z0-9._-]+/g, '-' )
		.replace( /^-+|-+$/g, '' )
		.slice( 0, 64 ) || 'text-anim';

}

function findTextWithAnim( editor ) {

	const selected = editor.selected;
	if ( selected ) {
		const ui = selected.userData && selected.userData.fccUI;
		if ( ui && ui.type === 'text' && ui.textAnim ) return selected;
		let found = null;
		selected.traverse( ( o ) => {
			if ( found ) return;
			const u = o.userData && o.userData.fccUI;
			if ( u && u.type === 'text' && u.textAnim ) found = o;
		} );
		if ( found ) return found;
	}
	let found = null;
	editor.scene.traverse( ( o ) => {
		if ( found ) return;
		const u = o.userData && o.userData.fccUI;
		if ( u && u.type === 'text' && u.textAnim ) found = o;
	} );
	return found;

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
				// textAnim/ui: only the selected text. postProcess.*: beauty-camera
				// tracks (path is postProcess.{effectId}.{param}, no object filter).
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
				// Pack-relative: ui.* is authored absolute in editor; clip applies as delta.
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

/** Same as VfxPackExporter.addLibraryPreview — poster + hover GIF from project config. */
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

			console.warn( '[TextAnimPack] poster export failed', error );

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


/**
 * Snapshot camera.userData.postProcessStack (same shape as VfxPackExporter).
 * Prefers viewportCamera, then any scene camera with a stack.
 * Does NOT change canvas/camera renderMode.
 */
function serializePostProcessStack( stack ) {

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
			// Keep custom definition (shaders inline) so text-anim packs can carry PP.
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


/**
 * Snapshot editor beauty background (BeautyClear: Default transparent vs Color opaque).
 * IMPORTANT: do NOT use editor.viewportColor — that is seeded from the viewport
 * chrome clear (#aaaaaa light / #333333 dark), NOT the Scene background color.
 * Prefer scene.background when type is Color.
 */

/**
 * Snapshot project OutputPass tone mapping (editor Config / renderer).
 * Pack output is truth: write whatever Config says (including none).
 * Do not force Neutral — text-anim authors often tune Bloom under none.
 */
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

			// Fallback only; Viewport now syncs viewportColor from scene Color bg.
			hex = '#' + editor.viewportColor.getHexString();

		}
		return { type: 'Color', color: hex };

	}
	// Texture / Equirect: clip text PP uses opaque black plate (editor Color-like).
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
		const serialized = serializePostProcessStack( stack );
		if ( serialized && serialized.effects && serialized.effects.length ) return serialized;

	}
	return null;

}

async function buildTextAnimPack( editor, opts = {} ) {

	const object = findTextWithAnim( editor );
	if ( ! object ) {
		throw new Error( 'Select a Text object with text animation first' );
	}
	const ui = object.userData.fccUI;
	const anim = normalizeTextAnim( ui.textAnim );
	const components = stripComponents( anim );
	if ( ! components.length ) {
		throw new Error( 'This text has no animation components — add some in the sidebar first' );
	}

	const inferred = inferCategory( anim );
	const category = [ 'in', 'out', 'loop' ].includes( opts.category ) ? opts.category : inferred;
	const { tracks, durationHint } = collectTracksForObject( editor, object.uuid );
	const duration = Number( opts.duration ) > 0
		? Number( opts.duration )
		: resolveDuration( category, tracks, durationHint, components );

	const displayName = String( opts.displayName || object.name || 'Text animation' ).trim() || 'Text animation';
	let id = String( opts.id || ( 'freecapcut.text-anim.' + slugify( displayName ) ) ).trim();
	if ( ! id.startsWith( 'freecapcut.text-anim.' ) ) {

		id = 'freecapcut.text-anim.' + slugify( String( id ).replace( /^freecapcut\./, '' ) || displayName );

	}
	const version = opts.version || '1.0.0';
	const phaseFolder = PHASE_FOLDERS[ category ] || PHASE_FOLDERS.in;

	// Never embed flowerStyle / art-text Effect stack — clip keeps its own 花字.
	const postProcess = opts.postProcess !== undefined
		? opts.postProcess
		: collectAuthoringPostProcess( editor );
	const background = opts.background !== undefined
		? opts.background
		: collectAuthoringBackground( editor );
	const output = opts.output !== undefined
		? opts.output
		: collectAuthoringOutput( editor );

	const textAnimPack = {
		format: 'freecapcut.textanim-pack/1',
		name: displayName,
		category,
		duration,
		components,
		tracks,
	};
	if ( postProcess && postProcess.effects && postProcess.effects.length ) {

		textAnimPack.postProcess = postProcess;

	}
	if ( background && background.type ) {

		textAnimPack.background = background;

	}
	if ( output ) {

		textAnimPack.output = output;

	}

	const zip = new JSZip();
	const pack = zip.folder( 'pack' );
	pack.folder( 'preview' );
	const libraryPreview = await addLibraryPreview( editor, pack );
	const manifest = {
		schema: 'freecapcut.vfxpack/1',
		id,
		version,
		displayName,
		type: 'text-anim',
		phase: category,
		duration,
		textAnim: textAnimPack,
		i18n: { 'zh-CN': { displayName } },
	};
	if ( textAnimPack.postProcess ) manifest.postProcess = textAnimPack.postProcess;
	if ( textAnimPack.background ) manifest.background = textAnimPack.background;
	if ( textAnimPack.output ) manifest.output = textAnimPack.output;
	if ( libraryPreview ) manifest.preview = libraryPreview;
	pack.file( 'manifest.json', JSON.stringify( manifest, null, 2 ) );
	pack.file( 'textanim-pack.json', JSON.stringify( textAnimPack, null, 2 ) );

	zip.file(
		'INSTALL.txt',
		[
			'FreeFilmCut text-anim pack',
			'',
			'1. Place this .vfxpack in:',
			'   freefilmcut/apps/web/public/vfxpacks/text-anims/' + phaseFolder + '/',
			'2. Add the filename to that folder index.json (e.g. "' + slugify( id ) + '.vfxpack").',
			'3. Hard-refresh OpenCut → text clip → Animation → ' +
				( category === 'in' ? 'In' : category === 'out' ? 'Out' : 'Loop' ),
			'',
			'phase/category = ' + category + ' → folder ' + phaseFolder,
			'Includes postProcess + background (BeautyClear); no flowerStyle.',
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
		category,
		phaseFolder,
		duration,
		componentCount: components.length,
		trackCount: tracks.length,
		manifest,
		textAnimPack,
	};

}

async function exportTextAnimPack( editor, saveFn, opts = {} ) {

	const result = await buildTextAnimPack( editor, opts );
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
			console.warn( '[FreeFilmCut] text-anim pack exports/ write failed:', e );
		}
	}
	saveFn( result.blob, result.filename );
	result.savedToProject = false;
	return result;

}

function promptTextAnimPackOptions( editor ) {

	const object = findTextWithAnim( editor );
	if ( ! object ) {
		alert( 'Select a Text object with text animation first' );
		return null;
	}
	const ui = object.userData.fccUI;
	const anim = normalizeTextAnim( ui.textAnim );
	const inferred = inferCategory( anim );
	const defaultName = ( object && object.name ) || 'Text animation';
	const entered = window.prompt( 'Text animation pack name', defaultName );
	if ( entered === null ) return null;
	const displayName = entered.trim() || defaultName;
	const phaseHint = window.prompt(
		'Phase: in / out / loop (default ' + inferred + ')',
		inferred,
	);
	if ( phaseHint === null ) return null;
	const raw = String( phaseHint ).trim().toLowerCase();
	let category = inferred;
	if ( raw === 'in' || raw === '入场' ) category = 'in';
	else if ( raw === 'out' || raw === '出场' ) category = 'out';
	else if ( raw === 'loop' || raw === '循环' ) category = 'loop';
	else if ( [ 'in', 'out', 'loop' ].includes( raw ) ) category = raw;
	return {
		displayName,
		category,
		id: 'freecapcut.text-anim.' + slugify( displayName ),
	};

}

function formatTextAnimPackExportMessage( result ) {

	const where = result.savedToProject
		? ( result.projectPath || result.filename )
		: result.filename;
	return [
		'Saved: ' + where,
		'Type: text-anim',
		'Phase: ' + result.category + ' → folder ' + result.phaseFolder,
		'Components ' + result.componentCount + ' / tracks ' + result.trackCount + ' / duration ' + result.duration + 's',
		result.textAnimPack && result.textAnimPack.postProcess
			? ( 'Post-process: ' + ( result.textAnimPack.postProcess.effects || [] ).map( ( e ) => e.type ).join( ', ' ) )
			: 'Post-process: (none)',
		'No flowerStyle (clip keeps its flower template)',
		'Put in: freefilmcut/apps/web/public/vfxpacks/text-anims/' + result.phaseFolder + '/',
		'Add to that folder index.json (with .vfxpack extension), then hard-refresh OpenCut.',
	].join( '\n' );

}

export {
	PHASE_FOLDERS,
	buildTextAnimPack,
	exportTextAnimPack,
	promptTextAnimPackOptions,
	formatTextAnimPackExportMessage,
	findTextWithAnim,
	inferCategory,
};
