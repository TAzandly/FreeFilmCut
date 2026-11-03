import { TIMELINE_FORMAT, TL_KEY, createEmptyTimelineAsset } from './FccTimelineCore.js?v=fcc-ui-107';

function slugify( name ) {

	return String( name || 'timeline' )
		.trim().toLowerCase()
		.replace( /[^a-z0-9._-]+/g, '-' )
		.replace( /^-+|-+$/g, '' )
		.slice( 0, 64 ) || 'timeline';

}

export async function saveTimelineAsset( editor, object, asset ) {

	const pf = editor.projectFolder;
	if ( ! pf || typeof pf.hasFolder !== 'function' || ! pf.hasFolder() || typeof pf.saveBlob !== 'function' ) {

		throw new Error( 'No project folder bound' );

	}
	const ud = object.userData[ TL_KEY ];
	if ( ! ud ) throw new Error( 'Not a Timeline object' );
	const safe = slugify( asset.name || object.name || 'timeline' );
	const filename = safe + '.timeline.json';
	asset.format = TIMELINE_FORMAT;
	const body = JSON.stringify( asset, null, 2 );
	const ok = await pf.saveBlob( 'assets/timelines', filename, body );
	if ( ! ok ) throw new Error( 'Failed to save timeline' );
	const rel = 'assets/timelines/' + filename;
	ud.projectPath = rel;
	ud.duration = asset.duration;
	ud.fps = asset.fps;
	ud.loop = asset.loop;
	return rel;

}

export async function loadTimelineAsset( editor, object ) {

	const pf = editor.projectFolder;
	const ud = object && object.userData && object.userData[ TL_KEY ];
	if ( ! pf || ! ud || ! ud.projectPath || typeof pf.readTextFile !== 'function' ) {

		return createEmptyTimelineAsset( object && object.name );

	}
	try {

		const text = await pf.readTextFile( ud.projectPath );
		if ( ! text ) return createEmptyTimelineAsset( object.name );
		const asset = JSON.parse( text );
		if ( ! asset || asset.format !== TIMELINE_FORMAT ) {

			return createEmptyTimelineAsset( object.name );

		}
		return asset;

	} catch ( e ) {

		console.warn( '[FreeFilmCut] timeline load', e );
		return createEmptyTimelineAsset( object && object.name );

	}

}

export async function flushTimelinesToProject( editor ) {

	const pf = editor && editor.projectFolder;
	if ( ! pf || typeof pf.hasFolder !== 'function' || ! pf.hasFolder() ) {

		return { saved: 0 };

	}
	const scene = editor.scene;
	if ( ! scene ) return { saved: 0 };
	let saved = 0;
	const list = [];
	scene.traverse( ( o ) => {

		if ( o.userData && o.userData[ TL_KEY ] ) list.push( o );

	} );
	for ( const object of list ) {

		const asset = object.__fccTimelineAsset;
		if ( ! asset || ! asset.tracks ) continue;
		try {

			await saveTimelineAsset( editor, object, asset );
			saved ++;

		} catch ( e ) {

			console.warn( '[FreeFilmCut] flush timeline', object.name, e );

		}

	}
	return { saved };

}
