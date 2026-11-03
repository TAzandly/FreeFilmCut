/**
 * Export selected Text FlowerStyle as an OpenCut flower pack folder (zip).
 * Unpack into: freefilmcut/apps/web/public/flower/<dir>/
 * then run: node scripts/sync-flower-packs.mjs
 * (or rely on index.json inside the zip).
 */
import JSZip from 'jszip';

function slugify( name ) {

	return String( name || 'flower' )
		.trim()
		.toLowerCase()
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /^-+|-+$/g, '' )
		.slice( 0, 48 ) || 'flower';

}

function findFlowerText( editor ) {

	const selected = editor.selected;
	if ( selected ) {
		const ui = selected.userData && selected.userData.fccUI;
		if ( ui && ui.type === 'text' && ui.flowerStyle ) return selected;
		let found = null;
		selected.traverse( ( o ) => {
			if ( found ) return;
			const u = o.userData && o.userData.fccUI;
			if ( u && u.type === 'text' && u.flowerStyle ) found = o;
		} );
		if ( found ) return found;
	}
	let found = null;
	editor.scene.traverse( ( o ) => {
		if ( found ) return;
		const u = o.userData && o.userData.fccUI;
		if ( u && u.type === 'text' && u.flowerStyle ) found = o;
	} );
	return found;

}

async function embedTexture( editor, zipRoot, path, preferredName, map, idxRef ) {

	if ( ! path || typeof path !== 'string' ) return '';
	if ( map.has( path ) ) return map.get( path );
	// Live RenderTexture ref — keep as rt:<uuid>, do not rasterize.
	if ( path.startsWith( 'rt:' ) ) {
		map.set( path, path );
		return path;
	}

	let buffer = null;
	let fileName = preferredName || ( 'tex_' + idxRef.i + '.png' );

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
				const last = path.split( '/' ).pop();
				if ( last && /\.(png|jpe?g|webp|gif)$/i.test( last ) ) fileName = last;
			}
		} catch ( e ) {
			console.warn( '[FreeFilmCut] flower pack texture fetch failed', path, e );
		}
	}

	const safe = String( fileName ).replace( /[^\w.\-]+/g, '_' );
	if ( ! buffer ) {
		map.set( path, safe );
		return safe;
	}
	zipRoot.file( safe, buffer );
	map.set( path, safe );
	idxRef.i += 1;
	return safe;

}

async function rewriteContent( editor, zipRoot, content, map, idxRef ) {

	if ( ! content || typeof content !== 'object' ) return content;
	const c = JSON.parse( JSON.stringify( content ) );
	const rt = c.renderType || c.render_type;
	if ( rt === 'texture' && c.texture && c.texture.path ) {
		const file = await embedTexture(
			editor,
			zipRoot,
			c.texture.path,
			c.texture.fileName || c.texture.name || '',
			map,
			idxRef,
		);
		// OpenCut public URL rewritten by sync / catalog using /flower/<dir>/<file>
		c.texture.path = file;
		c.texture.fileName = file;
	}
	return c;

}

async function rewriteStyle( editor, zipRoot, style, map, idxRef ) {

	if ( ! style || typeof style !== 'object' ) return style;
	const s = JSON.parse( JSON.stringify( style ) );
	if ( s.fill && s.fill.content ) {
		s.fill.content = await rewriteContent( editor, zipRoot, s.fill.content, map, idxRef );
	}
	if ( Array.isArray( s.strokes ) ) {
		for ( let i = 0; i < s.strokes.length; i ++ ) {
			if ( s.strokes[ i ] && s.strokes[ i ].content ) {
				s.strokes[ i ].content = await rewriteContent(
					editor,
					zipRoot,
					s.strokes[ i ].content,
					map,
					idxRef,
				);
			}
		}
	}
	for ( const key of [ 'shadows', 'innerShadows', 'inner_shadows', 'stack' ] ) {
		if ( ! Array.isArray( s[ key ] ) ) continue;
		for ( let i = 0; i < s[ key ].length; i ++ ) {
			const layer = s[ key ][ i ];
			if ( ! layer ) continue;
			if ( layer.content ) {
				layer.content = await rewriteContent( editor, zipRoot, layer.content, map, idxRef );
			}
			if ( Array.isArray( layer.strokes ) ) {
				for ( let j = 0; j < layer.strokes.length; j ++ ) {
					if ( layer.strokes[ j ] && layer.strokes[ j ].content ) {
						layer.strokes[ j ].content = await rewriteContent(
							editor,
							zipRoot,
							layer.strokes[ j ].content,
							map,
							idxRef,
						);
					}
				}
			}
		}
	}
	return s;

}

/**
 * Rewrite texture paths in style to /flower/<dir>/<file> for OpenCut public/.
 */
function absolutizeStylePaths( style, dir ) {

	const s = JSON.parse( JSON.stringify( style ) );
	const prefix = '/flower/' + dir + '/';
	function fixContent( content ) {
		if ( ! content || typeof content !== 'object' ) return;
		const rt = content.renderType || content.render_type;
		if ( rt === 'texture' && content.texture && content.texture.path ) {
			const p = String( content.texture.path );
			if ( p.startsWith( 'rt:' ) ) return;
			if ( ! p.startsWith( '/' ) && ! p.startsWith( 'http' ) && ! p.startsWith( 'blob:' ) ) {
				content.texture.path = prefix + p.replace( /^\/+/, '' );
			}
		}
	}
	if ( s.fill ) fixContent( s.fill.content );
	for ( const st of s.strokes || [] ) fixContent( st && st.content );
	for ( const key of [ 'shadows', 'innerShadows', 'inner_shadows' ] ) {
		for ( const sh of s[ key ] || [] ) {
			if ( ! sh ) continue;
			fixContent( sh.content );
			for ( const nest of sh.strokes || [] ) fixContent( nest && nest.content );
		}
	}
	return s;

}

async function buildFlowerPack( editor, opts = {} ) {

	const object = findFlowerText( editor );
	if ( ! object ) {
		throw new Error( 'Select a Text with FlowerStyle (Effects stack) first.' );
	}
	const ui = object.userData.fccUI;
	const designFontSize =
		Number( ui.flowerBaseFontSize ) > 0
			? Number( ui.flowerBaseFontSize )
			: Number( ui.fontSize ) > 0
				? Number( ui.fontSize )
				: 48;
	const displayName = String( opts.displayName || object.name || 'Flower' ).trim() || 'Flower';
	const dir = String( opts.dir || slugify( displayName ) ).trim() || slugify( displayName );
	const id = String( opts.id || ( 'flower.' + dir ) ).trim();

	const zip = new JSZip();
	const root = zip.folder( dir );
	const map = new Map();
	const idxRef = { i: 0 };

	let style = await rewriteStyle( editor, root, ui.flowerStyle, map, idxRef );
	style = absolutizeStylePaths( style, dir );
	// Authoring debug flag — packs always ship with Effects on.
	if ( style && typeof style === 'object' ) style.effectsEnabled = true;

	const packMeta = {
		id,
		name: displayName,
		designFontSize,
		dir,
	};
	root.file( 'pack.json', JSON.stringify( packMeta, null, 2 ) );
	root.file( 'flowerStyle.json', JSON.stringify( style, null, 2 ) );

	// Prefer existing cover from editor assets if user already has one in memory
	let hasCover = false;
	if ( editor._fccFlowerTexBytes ) {
		for ( const [ path, entry ] of editor._fccFlowerTexBytes ) {
			const n = ( entry && entry.name ) || path;
			if ( /cover_icon\.png$/i.test( String( n ) ) || /cover\.png$/i.test( String( n ) ) ) {
				root.file( 'cover_icon.png', entry.buffer );
				hasCover = true;
				break;
			}
		}
	}
	if ( ! hasCover ) {
		// Tiny placeholder PNG note — OpenCut falls back to label if missing; write README tip
		root.file(
			'COVER.txt',
			'Add cover_icon.png (square) and optional preview.gif for hover, matching OpenCut asset cards.\n',
		);
	}

	const index = {
		version: 1,
		packs: [
			{
				id,
				name: displayName,
				dir,
				cover: hasCover ? 'cover_icon.png' : null,
				preview: null,
				style: 'flowerStyle.json',
				designFontSize,
			},
		],
	};
	zip.file(
		'INSTALL.txt',
		[
			'FreeFilmCut flower pack',
			'',
			'1. Unzip so the folder "' + dir + '/" lands in:',
			'   D:\\GrokbotWork\\FreeFilmCut\\freefilmcut\\apps\\web\\public\\flower\\',
			'2. From repo root run:',
			'   node scripts/sync-flower-packs.mjs',
			'   (merges this pack into index.json)',
			'3. Hard-refresh OpenCut → Assets → Text → Effects',
			'',
			'Optional: add cover_icon.png and preview.gif inside the pack folder',
			'(same card size as other OpenCut effect icons; gif plays on hover).',
			'',
		].join( '\n' ),
	);
	zip.file( 'index.fragment.json', JSON.stringify( index, null, 2 ) );

	const blob = await zip.generateAsync( { type: 'blob' } );
	const filename = 'flower-pack-' + dir + '.zip';
	return {
		blob,
		filename,
		id,
		dir,
		displayName,
		designFontSize,
		hasCover,
	};

}

async function exportFlowerPack( editor, saveFn, opts = {} ) {

	const result = await buildFlowerPack( editor, opts );
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
			console.warn( '[FreeFilmCut] flower pack exports/ write failed:', e );
		}
	}
	saveFn( result.blob, result.filename );
	result.savedToProject = false;
	return result;

}

function promptFlowerPackOptions( editor ) {

	const object = findFlowerText( editor );
	const defaultName = ( object && object.name ) || 'Flower';
	const entered = window.prompt( 'Flower pack name', defaultName );
	if ( entered === null ) return null;
	const displayName = entered.trim() || defaultName;
	const dir = slugify( displayName );
	return { displayName, dir, id: 'flower.' + dir };

}

function formatFlowerPackExportMessage( result ) {

	const where = result.savedToProject
		? ( result.projectPath || result.filename )
		: result.filename;
	return [
		'Saved: ' + where,
		'Unpack folder "' + result.dir + '" into:',
		'D:\\GrokbotWork\\FreeFilmCut\\freefilmcut\\apps\\web\\public\\flower\\',
		'Then run: node scripts/sync-flower-packs.mjs',
		'OpenCut → Text → Effects will auto-list it (cover + optional preview.gif).',
	].join( '\n' );

}

export {
	buildFlowerPack,
	exportFlowerPack,
	promptFlowerPackOptions,
	formatFlowerPackExportMessage,
	findFlowerText,
};
