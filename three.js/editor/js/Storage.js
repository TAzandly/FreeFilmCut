function Storage() {

	const indexedDB = window.indexedDB;

	if ( indexedDB === undefined ) {

		console.warn( 'Storage: IndexedDB not available.' );
		return { init: function () {}, get: function () {}, set: function () {}, clear: function () {} };

	}

	const name = 'threejs-editor';
	const version = 1;

	let database;

	/**
	 * FreeFilmCut: editor.toJSON() can still hold live DOM nodes via userData
	 * references (e.g. HTMLImageElement inside a Texture hung off material
	 * userData). IndexedDB structured-clone throws DataCloneError on those;
	 * JSON.stringify quietly turns them into {}. Strip/replace before put.
	 */
	function isDomImageLike( value ) {

		if ( ! value || typeof value !== 'object' ) return false;
		try {

			if ( typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement ) return true;
			if ( typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement ) return true;
			if ( typeof HTMLVideoElement !== 'undefined' && value instanceof HTMLVideoElement ) return true;
			if ( typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap ) return true;
			if ( typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas ) return true;

		} catch ( e ) { /* ignore */ }

		return false;

	}

	function imageLikeToStorable( value ) {

		try {

			if ( typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement ) {

				const src = value.src || '';
				if ( typeof src === 'string' && src.length > 0 ) return src;
				return null;

			}

			if ( typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement ) {

				try {

					return value.toDataURL( 'image/png' );

				} catch ( e ) {

					return null;

				}

			}

			if ( typeof HTMLVideoElement !== 'undefined' && value instanceof HTMLVideoElement ) {

				return value.currentSrc || value.src || null;

			}

		} catch ( e ) { /* ignore */ }

		return null;

	}

	function sanitizeForIdb( value, seen ) {

		if ( value === null || value === undefined ) return value;

		const t = typeof value;
		if ( t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint' ) return value;
		if ( t === 'function' || t === 'symbol' ) return undefined;

		if ( isDomImageLike( value ) ) return imageLikeToStorable( value );

		// Typed arrays / ArrayBuffer are cloneable — keep as-is
		if ( typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer ) return value;
		if ( typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView( value ) ) return value;

		// Date / RegExp are cloneable
		if ( value instanceof Date || value instanceof RegExp ) return value;

		if ( ! seen ) seen = new WeakSet();
		if ( seen.has( value ) ) return null;
		seen.add( value );

		if ( Array.isArray( value ) ) {

			const out = [];
			for ( let i = 0; i < value.length; i ++ ) {

				const v = sanitizeForIdb( value[ i ], seen );
				out.push( v === undefined ? null : v );

			}

			return out;

		}

		// Plain / class objects: copy enumerable own keys only (skips
		// non-enumerable fccTextureUniforms etc.)
		const out = {};
		let keys;
		try {

			keys = Object.keys( value );

		} catch ( e ) {

			return null;

		}

		for ( let i = 0; i < keys.length; i ++ ) {

			const k = keys[ i ];
			let v;
			try {

				v = value[ k ];

			} catch ( e ) {

				continue;

			}

			const cleaned = sanitizeForIdb( v, seen );
			if ( cleaned !== undefined ) out[ k ] = cleaned;

		}

		return out;

	}

	return {

		init: function ( callback ) {

			const request = indexedDB.open( name, version );
			request.onupgradeneeded = function ( event ) {

				const db = event.target.result;

				if ( db.objectStoreNames.contains( 'states' ) === false ) {

					db.createObjectStore( 'states' );

				}

			};

			request.onsuccess = function ( event ) {

				database = event.target.result;

				callback();

			};

			request.onerror = function ( event ) {

				console.error( 'Storage: IndexedDB', event );

			};


		},

		get: function ( callback ) {

			const retrievalStart = performance.now();

			const transaction = database.transaction( [ 'states' ], 'readonly' );
			const objectStore = transaction.objectStore( 'states' );

			transaction.onerror = function ( event ) {

				console.error( 'Storage: IndexedDB get failed:', event.target.error );

			};

			const request = objectStore.get( 0 );
			request.onsuccess = function ( event ) {

				const retrievalDuration = performance.now() - retrievalStart;

				const hydrationStart = performance.now();

				// FreeFilmCut: await async callbacks so fromJSON finishes before we log / continue
				Promise.resolve( callback( event.target.result ) ).then( function () {

					const hydrationDuration = performance.now() - hydrationStart;
					const restorationDuration = retrievalDuration + hydrationDuration;

					// Diagnostic only (was noisy on every load).
					if ( globalThis.__FCC_STORAGE_DEBUG === true ) {

						console.log(
							'[' + /\d\d\:\d\d\:\d\d/.exec( new Date() )[ 0 ] + ']',
							`Restored state. ${ restorationDuration.toFixed( 2 ) } ms. ( Retrieval: ${ retrievalDuration.toFixed( 2 ) } ms, Hydration: ${ hydrationDuration.toFixed( 2 ) } ms )`
						);

					}

				} ).catch( function ( err ) {

					console.error( 'Storage: state hydration failed:', err );

				} );

			};

		},

		set: function ( data ) {

			const start = performance.now();

			let payload = data;
			try {

				payload = sanitizeForIdb( data );

			} catch ( e ) {

				console.warn( 'Storage: sanitizeForIdb failed, trying JSON round-trip', e );
				try {

					payload = JSON.parse( JSON.stringify( data ) );

				} catch ( e2 ) {

					console.error( 'Storage: cannot prepare state for IndexedDB', e2 );
					return;

				}

			}

			try {

				const transaction = database.transaction( [ 'states' ], 'readwrite' );
				const objectStore = transaction.objectStore( 'states' );

				transaction.oncomplete = function () {

					// Autosave can fire often — keep write, drop console spam.
				if ( globalThis.__FCC_STORAGE_DEBUG === true ) {

					console.log( '[' + /\d\d\:\d\d\:\d\d/.exec( new Date() )[ 0 ] + ']', 'Saved state to IndexedDB. ' + ( performance.now() - start ).toFixed( 2 ) + 'ms' );

				}

				};

				transaction.onerror = function ( event ) {

					console.error( 'Storage: IndexedDB put failed:', event.target.error );

				};

				objectStore.put( payload, 0 );

			} catch ( e ) {

				console.error( 'Storage: IndexedDB put threw:', e );

			}

		},

		clear: function () {

			if ( database === undefined ) return;

			const transaction = database.transaction( [ 'states' ], 'readwrite' );
			const objectStore = transaction.objectStore( 'states' );

			transaction.oncomplete = function () {

				if ( globalThis.__FCC_STORAGE_DEBUG === true ) {

					console.log( '[' + /\d\d\:\d\d\:\d\d/.exec( new Date() )[ 0 ] + ']', 'Cleared IndexedDB.' );

				}

			};

			transaction.onerror = function ( event ) {

				console.error( 'Storage: IndexedDB clear failed:', event.target.error );

			};

			objectStore.clear();

		}

	};

}

export { Storage };
