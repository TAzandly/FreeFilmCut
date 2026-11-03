/**
 * FreeFilmCut: bind the Editor project to a local folder via the File System Access API.
 * Chromium + localhost (or HTTPS): showDirectoryPicker + IndexedDB-persisted handle.
 *
 * New project layout (under a user-picked parent folder):
 *   {ProjectName}/
 *     project.json
 *     assets/{shaders,textures,videos,sequences,animations,timelines,meshes,fonts,audio}/
 *     exports/
 *     docs/
 */

const DB_NAME = 'freecapcut-editor-project';
const DB_VERSION = 1;
const STORE = 'handles';
const HANDLE_KEY = 'directory';

/** Standard asset subfolders created for every new FreeFilmCut project. */
/** Media folders live under assets/; exports/ and docs/ stay at project root. */
const ASSET_MEDIA_SUBDIRS = [
	'shaders',
	'textures',
	'videos',
	'sequences',
	'animations',
	'timelines',
	'meshes',
	'fonts',
	'audio',
];

const ROOT_SUBDIRS = [
	'exports',
	'docs',
];

/** Flat list of relative paths created for every new project (for docs / debugging). */
const ASSET_SUBDIRS = [
	'assets',
	...ASSET_MEDIA_SUBDIRS.map( ( n ) => 'assets/' + n ),
	...ROOT_SUBDIRS,
];

const GENERIC_FOLDER_NAMES = new Set( [
	'project', 'projects', 'new folder', 'newfolder', 'untitled', 'untitled folder',
	'docs', 'documents', 'desktop', 'downloads', 'download', 'tmp', 'temp', 'test',
	'work', 'workspace', 'repo', 'repos', 'src', 'source',
	'\u65b0\u5efa\u6587\u4ef6\u5939', '\u65b0\u5efa\u8cc7\u6599\u5939', '\u9879\u76ee', '\u5de5\u7a0b',
	'\u672a\u547d\u540d', '\u672a\u547d\u540d\u9879\u76ee', '\u7279\u6548', 'vfx', 'vfxpack', 'assets',
] );

function openDb() {

	return new Promise( ( resolve, reject ) => {

		if ( ! window.indexedDB ) {

			reject( new Error( 'IndexedDB unavailable' ) );
			return;

		}

		const req = indexedDB.open( DB_NAME, DB_VERSION );
		req.onupgradeneeded = function ( event ) {

			const db = event.target.result;
			if ( ! db.objectStoreNames.contains( STORE ) ) {

				db.createObjectStore( STORE );

			}

		};
		req.onsuccess = function () {

			resolve( req.result );

		};
		req.onerror = function () {

			reject( req.error || new Error( 'IndexedDB open failed' ) );

		};

	} );

}

function idbGet( db, key ) {

	return new Promise( ( resolve, reject ) => {

		const tx = db.transaction( [ STORE ], 'readonly' );
		const req = tx.objectStore( STORE ).get( key );
		req.onsuccess = () => resolve( req.result );
		req.onerror = () => reject( req.error );

	} );

}

function idbPut( db, key, value ) {

	return new Promise( ( resolve, reject ) => {

		const tx = db.transaction( [ STORE ], 'readwrite' );
		tx.objectStore( STORE ).put( value, key );
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject( tx.error );

	} );

}

function idbDelete( db, key ) {

	return new Promise( ( resolve, reject ) => {

		const tx = db.transaction( [ STORE ], 'readwrite' );
		tx.objectStore( STORE ).delete( key );
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject( tx.error );

	} );

}

async function ensurePermission( handle, mode = 'readwrite' ) {

	if ( ! handle ) return false;
	if ( typeof handle.queryPermission === 'function' ) {

		let state = await handle.queryPermission( { mode } );
		if ( state === 'granted' ) return true;
		if ( typeof handle.requestPermission === 'function' ) {

			state = await handle.requestPermission( { mode } );
			return state === 'granted';

		}

		return false;

	}

	return true;

}

function isGenericFolderName( name ) {

	const n = String( name || '' ).trim().toLowerCase();
	if ( ! n ) return true;
	if ( GENERIC_FOLDER_NAMES.has( n ) ) return true;
	if ( /^project(\s*\d+)?$/.test( n ) ) return true;
	if ( /^new folder(\s*\(\d+\))?$/.test( n ) ) return true;
	if ( /^\u65b0\u5efa\u6587\u4ef6\u5939(\s*\(\d+\))?$/.test( n ) ) return true;
	return false;

}

function shortStamp() {

	const d = new Date();
	const p = ( n ) => String( n ).padStart( 2, '0' );
	return `${ d.getFullYear() }${ p( d.getMonth() + 1 ) }${ p( d.getDate() ) }_${ p( d.getHours() ) }${ p( d.getMinutes() ) }`;

}

/**
 * Strip characters illegal in Windows folder names: <>:"/\|?* and controls.
 */
function safeProjectDirName( name ) {

	let s = String( name || '' ).trim();
	s = s.replace( /[<>:"/\\|?*\u0000-\u001f]/g, '_' );
	s = s.replace( /[. ]+$/g, '' ); // Windows: no trailing dots/spaces
	s = s.replace( /_+/g, '_' ).replace( /^_+|_+$/g, '' );
	if ( ! s ) s = 'VFX_Project_' + shortStamp();
	// Avoid Windows reserved device names
	if ( /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test( s ) ) s = s + '_proj';
	if ( s.length > 80 ) s = s.slice( 0, 80 ).replace( /[. ]+$/g, '' );
	return s;

}

/**
 * Suggest a distinguishable VFX project title from the picked parent folder name.
 * Generic folders get a date/time suffix.
 */
function suggestProjectTitle( folderName, untitled ) {

	const base = String( folderName || '' ).trim() || ( untitled || 'Untitled Project' );
	if ( isGenericFolderName( base ) ) {

		const safe = String( folderName || 'project' ).trim() || 'project';
		return `${ safe }_${ shortStamp() }`;

	}

	return base;

}

/** Map a file extension to an asset subfolder (or null to skip copy). */
function assetCategoryForExtension( ext ) {

	const e = String( ext || '' ).toLowerCase().replace( /^\./, '' );
	if ( [ 'bmp', 'gif', 'jpg', 'jpeg', 'png', 'tga', 'webp', 'exr', 'hdr', 'ktx', 'ktx2' ].includes( e ) ) return 'assets/textures';
	if ( [ 'mp4', 'webm', 'mov', 'mkv', 'avi' ].includes( e ) ) return 'assets/videos';
	if ( [ 'mp3', 'wav', 'ogg', 'flac', 'm4a' ].includes( e ) ) return 'assets/audio';
	if ( [ 'ttf', 'otf', 'woff', 'woff2' ].includes( e ) ) return 'assets/fonts';
	if ( [ 'glsl', 'frag', 'vert', 'vs', 'fs' ].includes( e ) ) return 'assets/shaders';
	if ( [ 'obj', 'fbx', 'glb', 'gltf', 'stl', 'ply', 'dae', '3ds', '3mf', '3dm', 'amf', 'pcd', 'vox', 'usd', 'usda', 'usdc', 'usdz', 'wrl', 'xyz', 'md2', 'ldr', 'mpd' ].includes( e ) ) return 'assets/meshes';
	if ( [ 'vfxpack', 'zip' ].includes( e ) ) return 'exports';
	return null;

}

/**
 * @param {import('./Editor.js').Editor} editor
 */
function createProjectFolder( editor ) {

	let directoryHandle = null;
	let folderName = '';

	function dispatch() {

		if ( editor.signals.projectFolderChanged ) {

			editor.signals.projectFolderChanged.dispatch( folderName || '' );

		}

	}

	async function persistHandle( handle ) {

		try {

			const db = await openDb();
			await idbPut( db, HANDLE_KEY, handle );
			db.close();

		} catch ( e ) {

			console.warn( '[FreeFilmCut] Could not persist project folder handle:', e );

		}

	}

	async function clearPersisted() {

		try {

			const db = await openDb();
			await idbDelete( db, HANDLE_KEY );
			db.close();

		} catch ( e ) {

			/* ignore */

		}

	}

	async function setDirectoryHandle( handle ) {

		directoryHandle = handle;
		folderName = handle ? ( handle.name || '' ) : '';
		if ( handle ) await persistHandle( handle );
		else await clearPersisted();
		dispatch();
		return handle;

	}

	/**
	 * Pick a directory without binding it (used as parent for New Project).
	 * @returns {Promise<FileSystemDirectoryHandle|null>}
	 */
	async function pickParentDirectory() {

		if ( typeof window.showDirectoryPicker !== 'function' ) return null;

		try {

			return await window.showDirectoryPicker( {
				id: 'freecapcut-project-parent',
				mode: 'readwrite',
				startIn: 'documents',
			} );

		} catch ( e ) {

			if ( e && ( e.name === 'AbortError' || e.name === 'NotAllowedError' ) ) return null;
			console.error( '[FreeFilmCut] showDirectoryPicker failed:', e );
			throw e;

		}

	}

	/**
	 * Prompt user to pick a project directory and bind it.
	 * @returns {Promise<FileSystemDirectoryHandle|null>}
	 */
	async function pickDirectory() {

		if ( typeof window.showDirectoryPicker !== 'function' ) return null;

		try {

			const handle = await window.showDirectoryPicker( {
				id: 'freecapcut-project',
				mode: 'readwrite',
				startIn: 'documents',
			} );
			await setDirectoryHandle( handle );
			await ensureAssetSubdirs();
			return handle;

		} catch ( e ) {

			if ( e && ( e.name === 'AbortError' || e.name === 'NotAllowedError' ) ) return null;
			console.error( '[FreeFilmCut] showDirectoryPicker failed:', e );
			throw e;

		}

	}

	/**
	 * Ensure standard asset subfolders exist under the bound project folder.
	 */
	async function ensureAssetSubdirs( handle = directoryHandle ) {

		if ( ! handle ) return false;
		const ok = await ensurePermission( handle, 'readwrite' );
		if ( ! ok ) return false;

		const assetsDir = await handle.getDirectoryHandle( 'assets', { create: true } );
		for ( const name of ASSET_MEDIA_SUBDIRS ) {

			await assetsDir.getDirectoryHandle( name, { create: true } );

		}

		for ( const name of ROOT_SUBDIRS ) {

			await handle.getDirectoryHandle( name, { create: true } );

		}

		return true;

	}

	/**
	 * Create `{safeName}/` + asset subdirs under parent, bind to the new project folder.
	 * @returns {Promise<{ projectHandle: FileSystemDirectoryHandle, dirName: string }|null>}
	 */
	async function createProjectUnderParent( parentHandle, projectTitle ) {

		if ( ! parentHandle ) return null;

		const ok = await ensurePermission( parentHandle, 'readwrite' );
		if ( ! ok ) throw new Error( 'No write permission for parent folder' );

		let dirName = safeProjectDirName( projectTitle );

		// If the name already exists, append a stamp to avoid clobbering another project.
		try {

			await parentHandle.getDirectoryHandle( dirName ); // exists
			dirName = safeProjectDirName( projectTitle + '_' + shortStamp() );

		} catch ( e ) {

			// NotFoundError → free to create
		}

		const projectHandle = await parentHandle.getDirectoryHandle( dirName, { create: true } );
		await ensureAssetSubdirs( projectHandle );
		await setDirectoryHandle( projectHandle );
		return { projectHandle, dirName };

	}

		/**
		 * Recursively copy files/folders from one directory handle into another.
		 * Used by Save As so relative asset paths keep working.
		 * @param {FileSystemDirectoryHandle} fromHandle
		 * @param {FileSystemDirectoryHandle} toHandle
		 * @param {{ skipNames?: string[] }} [opts] names skipped only at this root level
		 * @returns {Promise<boolean>}
		 */
		async function copyDirectoryContents( fromHandle, toHandle, opts = {} ) {

			if ( ! fromHandle || ! toHandle ) return false;
			if ( fromHandle === toHandle ) return true;

			const okFrom = await ensurePermission( fromHandle, 'readwrite' );
			const okTo = await ensurePermission( toHandle, 'readwrite' );
			if ( ! okFrom || ! okTo ) return false;

			const skip = new Set( opts.skipNames || [] );

			try {

				for await ( const entry of fromHandle.values() ) {

					if ( skip.has( entry.name ) ) continue;

					if ( entry.kind === 'file' ) {

						const file = await entry.getFile();
						const fileHandle = await toHandle.getFileHandle( entry.name, { create: true } );
						const writable = await fileHandle.createWritable();
						await writable.write( file );
						await writable.close();

					} else if ( entry.kind === 'directory' ) {

						const next = await toHandle.getDirectoryHandle( entry.name, { create: true } );
						const nestedOk = await copyDirectoryContents( entry, next );
						if ( ! nestedOk ) return false;

					}

				}

				return true;

			} catch ( e ) {

				console.warn( '[FreeFilmCut] copyDirectoryContents failed:', e );
				return false;

			}

		}

		/**
		 * Write project JSON into the bound folder as project.json.
		 */
		async function saveProjectJson( json ) {

		if ( ! directoryHandle ) return false;

		const ok = await ensurePermission( directoryHandle, 'readwrite' );
		if ( ! ok ) {

			console.warn( '[FreeFilmCut] No write permission for project folder' );
			return false;

		}

		await ensureAssetSubdirs();

		const fileHandle = await directoryHandle.getFileHandle( 'project.json', { create: true } );
		const writable = await fileHandle.createWritable();
		await writable.write( JSON.stringify( json, null, '\t' ) );
		await writable.close();
		return true;

	}

	/**
	 * Write a Blob/File/string into `{subdir}/{filename}` under the project root.
	 * @returns {Promise<boolean>}
	 */
	async function saveBlob( subdir, filename, data ) {

		if ( ! directoryHandle ) return false;

		const ok = await ensurePermission( directoryHandle, 'readwrite' );
		if ( ! ok ) return false;

		const safeFile = String( filename || 'file' ).replace( /[<>:"/\\|?*]/g, '_' );
		if ( ! safeFile ) return false;

		// Support nested paths e.g. assets/textures
		const parts = String( subdir || '' ).replace( /\\/g, '/' ).split( '/' ).filter( Boolean )
			.map( ( p ) => p.replace( /[<>:"/\\|?*]/g, '' ) )
			.filter( Boolean );
		if ( ! parts.length ) return false;

		let dir = directoryHandle;
		for ( const part of parts ) {

			dir = await dir.getDirectoryHandle( part, { create: true } );

		}
		const fileHandle = await dir.getFileHandle( safeFile, { create: true } );
		const writable = await fileHandle.createWritable();
		await writable.write( data );
		await writable.close();
		return true;

	}

	/**
	 * Copy an imported File into the matching asset subfolder when a project is bound.
	 * @returns {Promise<string|null>} relative path like "assets/textures/foo.png" or null
	 */
	async function importAssetFile( file ) {

		if ( ! directoryHandle || ! file ) return null;

		const name = file.name || 'asset';
		const ext = name.split( '.' ).pop();
		const category = assetCategoryForExtension( ext );
		if ( ! category ) return null;

		try {

			const ok = await saveBlob( category, name, file );
			return ok ? ( category + '/' + name ) : null;

		} catch ( e ) {

			console.warn( '[FreeFilmCut] importAssetFile failed:', e );
			return null;

		}

	}

	async function tryRestore() {

		try {

			const db = await openDb();
			const handle = await idbGet( db, HANDLE_KEY );
			db.close();
			if ( ! handle ) return false;

			let state = 'prompt';
			if ( typeof handle.queryPermission === 'function' ) {

				state = await handle.queryPermission( { mode: 'readwrite' } );

			}

			directoryHandle = handle;
			folderName = handle.name || '';
			dispatch();

			if ( state === 'granted' ) {

				try { await ensureAssetSubdirs(); } catch ( e ) { /* ignore */ }

			}

			return true;

		} catch ( e ) {

			console.warn( '[FreeFilmCut] restore project folder failed:', e );
			return false;

		}

	}

	async function requestPermissionOnGesture() {

		if ( ! directoryHandle ) return false;
		return ensurePermission( directoryHandle, 'readwrite' );

	}

	async function readProjectJson() {

		if ( ! directoryHandle ) return null;
		const ok = await ensurePermission( directoryHandle, 'readwrite' );
		if ( ! ok ) return null;
		try {

			const fileHandle = await directoryHandle.getFileHandle( 'project.json' );
			const file = await fileHandle.getFile();
			return JSON.parse( await file.text() );

		} catch ( e ) {

			return null;

		}

	}

	async function clear() {

		directoryHandle = null;
		folderName = '';
		await clearPersisted();
		dispatch();

	}

	function hasFolder() {

		return directoryHandle !== null;

	}

	function getName() {

		return folderName;

	}

	function getHandle() {

		return directoryHandle;

	}

	function isSupported() {

		return typeof window.showDirectoryPicker === 'function';

	}


	/**
	 * List filenames in an asset subdir (e.g. assets/animations).
	 * @returns {Promise<string[]>}
	 */
	/**
	 * List immediate subdirectory names under an asset path (e.g. assets/sequences).
	 * @returns {Promise<string[]>}
	 */
	async function listAssetDirs( subdir ) {

		if ( ! directoryHandle ) return [];
		const ok = await ensurePermission( directoryHandle, 'readwrite' );
		if ( ! ok ) return [];
		const parts = String( subdir || '' ).replace( /\\/g, '/' ).split( '/' ).filter( Boolean )
			.map( ( p ) => p.replace( /[<>:"/\\|?*]/g, '' ) )
			.filter( Boolean );
		if ( ! parts.length ) return [];
		try {

			let dir = directoryHandle;
			for ( const part of parts ) {

				dir = await dir.getDirectoryHandle( part );

			}
			const names = [];
			for await ( const entry of dir.values() ) {

				if ( entry.kind === 'directory' ) names.push( entry.name );

			}
			names.sort( ( a, b ) => a.localeCompare( b, undefined, { numeric: true, sensitivity: 'base' } ) );
			return names;

		} catch ( e ) {

			return [];

		}

	}

	async function listAssetFiles( subdir ) {

		if ( ! directoryHandle ) return [];
		const ok = await ensurePermission( directoryHandle, 'readwrite' );
		if ( ! ok ) return [];
		const parts = String( subdir || '' ).replace( /\\/g, '/' ).split( '/' ).filter( Boolean )
			.map( ( p ) => p.replace( /[<>:"/\\|?*]/g, '' ) )
			.filter( Boolean );
		if ( ! parts.length ) return [];
		try {

			let dir = directoryHandle;
			for ( const part of parts ) {

				dir = await dir.getDirectoryHandle( part );

			}
			const names = [];
			for await ( const entry of dir.values() ) {

				if ( entry.kind === 'file' ) names.push( entry.name );

			}
			return names;

		} catch ( e ) {

			return [];

		}

	}

	/**
	 * Delete a file under the project root (relative path with /).
	 * @returns {Promise<boolean>}
	 */
	async function deleteFile( relPath ) {

		if ( ! directoryHandle || ! relPath ) return false;
		const ok = await ensurePermission( directoryHandle, 'readwrite' );
		if ( ! ok ) return false;
		const parts = String( relPath ).replace( /\\/g, '/' ).split( '/' ).filter( Boolean );
		if ( ! parts.length ) return false;
		try {

			let dir = directoryHandle;
			for ( let i = 0; i < parts.length - 1; i ++ ) {

				dir = await dir.getDirectoryHandle( parts[ i ] );

			}
			await dir.removeEntry( parts[ parts.length - 1 ] );
			return true;

		} catch ( e ) {

			return false;

		}

	}

	/**
	 * Read a text file under the project root (relative path with /).
	 * @returns {Promise<string|null>}
	 */
	async function readTextFile( relPath ) {

		if ( ! directoryHandle || ! relPath ) return null;
		const ok = await ensurePermission( directoryHandle, 'readwrite' );
		if ( ! ok ) return null;
		const parts = String( relPath ).replace( /\\/g, '/' ).split( '/' ).filter( Boolean );
		if ( ! parts.length ) return null;
		try {

			let dir = directoryHandle;
			for ( let i = 0; i < parts.length - 1; i ++ ) {

				dir = await dir.getDirectoryHandle( parts[ i ] );

			}
			const fileHandle = await dir.getFileHandle( parts[ parts.length - 1 ] );
			const file = await fileHandle.getFile();
			return await file.text();

		} catch ( e ) {

			return null;

		}

	}

	/**
	 * Read a binary file under the project root (relative path with /).
	 * Used to rebuild Troika font blob URLs after reopening a project.
	 * @returns {Promise<{ buffer: ArrayBuffer, name: string, mime: string }|null>}
	 */
	async function readBinaryFile( relPath ) {

		if ( ! directoryHandle || ! relPath ) return null;
		const ok = await ensurePermission( directoryHandle, 'readwrite' );
		if ( ! ok ) return null;
		const parts = String( relPath ).replace( /\\/g, '/' ).split( '/' ).filter( Boolean );
		if ( ! parts.length ) return null;
		try {

			let dir = directoryHandle;
			for ( let i = 0; i < parts.length - 1; i ++ ) {

				dir = await dir.getDirectoryHandle( parts[ i ] );

			}
			const fileName = parts[ parts.length - 1 ];
			const fileHandle = await dir.getFileHandle( fileName );
			const file = await fileHandle.getFile();
			const buffer = await file.arrayBuffer();
			const lower = fileName.toLowerCase();
			let mime = 'application/octet-stream';
			if ( lower.endsWith( '.ttf' ) ) mime = 'font/ttf';
			else if ( lower.endsWith( '.otf' ) ) mime = 'font/otf';
			else if ( lower.endsWith( '.woff' ) ) mime = 'font/woff';
			else if ( lower.endsWith( '.woff2' ) ) mime = 'font/woff2';
			return { buffer, name: fileName, mime };

		} catch ( e ) {

			return null;

		}

	}

	return {
		pickDirectory,
		pickParentDirectory,
		createProjectUnderParent,
		ensureAssetSubdirs,
		setDirectoryHandle,
		copyDirectoryContents,
		saveProjectJson,
		saveBlob,
		deleteFile,
		listAssetFiles,
		listAssetDirs,
		readTextFile,
		readBinaryFile,
		importAssetFile,
		readProjectJson,
		tryRestore,
		requestPermissionOnGesture,
		clear,
		hasFolder,
		getName,
		getHandle,
		isSupported,
		ASSET_SUBDIRS,
	};

}

export {
	createProjectFolder,
	suggestProjectTitle,
	isGenericFolderName,
	safeProjectDirName,
	assetCategoryForExtension,
	ASSET_SUBDIRS,
	ASSET_MEDIA_SUBDIRS,
	ROOT_SUBDIRS,
};
