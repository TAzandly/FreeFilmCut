function Config() {

	const name = 'threejs-editor';

	const userLanguage = navigator.language.split( '-' )[ 0 ];

	const suggestedLanguage = [ 'fr', 'ja', 'zh', 'ko', 'fa' ].includes( userLanguage ) ? userLanguage : 'en';

	const storage = {
		'language': suggestedLanguage,

		'autosave': true,

		'project/title': '',
		'project/editable': false,
		'project/vr': false,

		'project/camera': 'perspective',

		'project/resolution/width': 1920,
		'project/resolution/height': 1080,
		'project/resolution/showFrame': true,

		'project/vfxpack/type': 'effect',
		'project/vfxpack/stickerAnimPhase': 'in',
		'project/vfxpack/previewPoster': '',
		'project/vfxpack/previewPosterName': '',
		'project/vfxpack/previewHover': '',
		'project/vfxpack/previewHoverName': '',

		'project/previewExport/width': 256,
		'project/previewExport/height': 256,
		'project/previewExport/fps': 10,
		'project/previewExport/maxKB': 800,
		'project/previewExport/speed': 1,
		'project/previewExport/pingpong': false,

		'project/renderer/type': 'WebGLRenderer',
		'project/renderer/antialias': true,
		'project/renderer/shadows': true,
		'project/renderer/shadowType': 1, // PCF
		'project/renderer/toneMapping': 7, // NeutralToneMapping
		'project/renderer/toneMappingExposure': 1,

		'settings/history': false,

		'settings/shortcuts/translate': 'w',
		'settings/shortcuts/rotate': 'e',
		'settings/shortcuts/scale': 'r',
		'settings/shortcuts/undo': 'z',
		'settings/shortcuts/focus': 'f',
		'settings/shortcuts/perspective': 'p',
		'settings/shortcuts/orthographic': 'o',
		'settings/shortcuts/selectAll': 'a',

		'sidebar/text/flowerCollapsed': true,
		'sidebar/text/animCollapsed': true,
		'sidebar/text/fxCollapsed': true
	};

	if ( window.localStorage[ name ] === undefined ) {

		window.localStorage[ name ] = JSON.stringify( storage );

	} else {

		const data = JSON.parse( window.localStorage[ name ] );

		for ( const key in data ) {

			storage[ key ] = data[ key ];

		}

	}

	return {

		getKey: function ( key ) {

			return storage[ key ];

		},

		setKey: function () { // key, value, key, value ...

			let changed = false;

			for ( let i = 0, l = arguments.length; i < l; i += 2 ) {

				const key = arguments[ i ];
				const value = arguments[ i + 1 ];
				if ( storage[ key ] !== value ) {

					storage[ key ] = value;
					changed = true;

				}

			}

			// Skip no-op writes (selection / fold toggles often re-set same value).
			if ( ! changed ) return;

			window.localStorage[ name ] = JSON.stringify( storage );
			// Hot path: do not console.log here (was flooding editor DevTools / FPS).

		},

		clear: function () {

			delete window.localStorage[ name ];

		}

	};

}

export { Config };
