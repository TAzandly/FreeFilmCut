import { UIElement, UIPanel, UIText, UIButton } from './libs/ui.js';

import { SetScriptValueCommand } from './commands/SetScriptValueCommand.js';
import { SetMaterialValueCommand } from './commands/SetMaterialValueCommand.js';
import { normalizeShaderUniforms, serializeProgramInfo } from './FreeCapCutShaders.js?v=fcc-screen-1';

import buildThreeDefs from './libs/tern-threejs/build-defs.js';

function Script( editor ) {

	const signals = editor.signals;
	const strings = editor.strings;

	const container = new UIPanel();
	container.setId( 'script' );
	container.setPosition( 'absolute' );
	container.setBackgroundColor( '#1e1f1c' ); // FreeFilmCut: solid opaque panel (was translucent wash)
	container.setDisplay( 'none' );

	const header = new UIPanel();
	header.setPadding( '10px' );
	container.add( header );

	const title = new UIText().setColor( '#fff' );

	header.add( title );

	const saveBtn = new UIButton( strings.getKey( 'script/button/save' ) || 'Save' );
	saveBtn.setPosition( 'absolute' );
	saveBtn.setTop( '6px' );
	saveBtn.setRight( '40px' );
	saveBtn.setBackgroundColor( '#3a7bd5' );
	saveBtn.setColor( '#fff' );
	saveBtn.setPadding( '4px 10px' );
	saveBtn.setCursor( 'pointer' );
	header.add( saveBtn );

	const saveStatus = new UIText( '' ).setColor( '#8f8' );
	saveStatus.setPosition( 'absolute' );
	saveStatus.setTop( '10px' );
	saveStatus.setRight( '110px' );
	saveStatus.setFontSize( '12px' );
	header.add( saveStatus );

	let saveStatusTimer = null;
	function showSaveStatus( msg ) {

		saveStatus.setValue( msg || '' );
		if ( saveStatusTimer ) clearTimeout( saveStatusTimer );
		saveStatusTimer = setTimeout( function () {

			saveStatus.setValue( '' );

		}, 2000 );

	}

	function writeActiveShaderFile( material, slotKey, source ) {

		const pf = editor.projectFolder;
		if ( ! pf || typeof pf.hasFolder !== 'function' || ! pf.hasFolder() ) return Promise.resolve( false );
		if ( ! material || ( ! material.isShaderMaterial && ! material.isRawShaderMaterial ) ) {

			return Promise.resolve( false );

		}

		let rel = null;
		const files = material.userData && material.userData.shaderFiles;
		if ( files ) {

			if ( slotKey === 'vertexShader' && files.vert ) rel = files.vert;
			if ( slotKey === 'fragmentShader' && files.frag ) rel = files.frag;

		}

		if ( ! rel ) {

			const base = String( material.name || 'CustomShader' )
				.replace( /[<>:"/\\|?*\s]+/g, '_' )
				.replace( /_+/g, '_' )
				.slice( 0, 48 ) || 'CustomShader';
			const name = slotKey === 'vertexShader' ? ( base + '.vert.glsl' ) : ( base + '.frag.glsl' );
			rel = 'assets/shaders/' + name;
			if ( ! material.userData ) material.userData = {};
			if ( ! material.userData.shaderFiles ) material.userData.shaderFiles = {};
			if ( slotKey === 'vertexShader' ) material.userData.shaderFiles.vert = rel;
			else material.userData.shaderFiles.frag = rel;

		}

		const parts = String( rel ).replace( /\\/g, '/' ).split( '/' ).filter( Boolean );
		const filename = parts.pop();
		const subdir = parts.join( '/' );
		return Promise.resolve( pf.saveBlob( subdir, filename, source ) )
			.then( function ( ok ) {

				return !! ok;

			} )
			.catch( function ( err ) {

				console.warn( '[FreeFilmCut] save shader file failed', err );
				return false;

			} );

	}

	function applySave() {

		if ( ! currentObject || currentScript === undefined || currentScript === null ) return;

		const value = codemirror.getValue();
		const slot = editor.selectedMaterialSlot || 0;

		if ( typeof ( currentScript ) === 'object' ) {

			if ( value !== currentScript.source ) {

				editor.execute( new SetScriptValueCommand( editor, currentObject, currentScript, 'source', value ) );

			}

			showSaveStatus( strings.getKey( 'script/status/saved' ) || 'Saved' );
			return;

		}

		if ( currentScript === 'vertexShader' || currentScript === 'fragmentShader' ) {

			const mat = editor.getObjectMaterial( currentObject, slot );
			if ( ! mat ) return;

			editor.execute( new SetMaterialValueCommand( editor, currentObject, currentScript, value, slot ) );
			mat[ currentScript ] = value;
			mat.needsUpdate = true;
			signals.materialChanged.dispatch( currentObject, slot );

			writeActiveShaderFile( mat, currentScript, value ).then( function ( wrote ) {

				const key = wrote ? 'script/status/savedFiles' : 'script/status/saved';
				showSaveStatus( strings.getKey( key ) || ( wrote ? 'Saved (material + files)' : 'Saved' ) );

			} );
			return;

		}

		if ( currentScript === 'programInfo' ) {

			if ( ! validate( value ) ) {

				showSaveStatus( 'JSON error' );
				return;

			}

			try {

				const json = JSON.parse( value );
				const matInfo = editor.getObjectMaterial( currentObject, slot );
				if ( ! matInfo ) return;

				if ( JSON.stringify( matInfo.defines ) !== JSON.stringify( json.defines ) ) {

					const cmd = new SetMaterialValueCommand( editor, currentObject, 'defines', json.defines, slot );
					cmd.updatable = false;
					editor.execute( cmd );

				}

				if ( JSON.stringify( matInfo.uniforms ) !== JSON.stringify( json.uniforms ) ) {

					const uniforms = normalizeShaderUniforms( json.uniforms );
					const cmd = new SetMaterialValueCommand( editor, currentObject, 'uniforms', uniforms, slot );
					cmd.updatable = false;
					editor.execute( cmd );

				}

				if ( JSON.stringify( matInfo.attributes ) !== JSON.stringify( json.attributes ) ) {

					const cmd = new SetMaterialValueCommand( editor, currentObject, 'attributes', json.attributes, slot );
					cmd.updatable = false;
					editor.execute( cmd );

				}

				showSaveStatus( strings.getKey( 'script/status/saved' ) || 'Saved' );

			} catch ( err ) {

				showSaveStatus( 'JSON error' );

			}

		}

	}

	saveBtn.onClick( function () {

		applySave();

	} );

	const buttonSVG = ( function () {

		const svg = document.createElementNS( 'http://www.w3.org/2000/svg', 'svg' );
		svg.setAttribute( 'width', 32 );
		svg.setAttribute( 'height', 32 );
		const path = document.createElementNS( 'http://www.w3.org/2000/svg', 'path' );
		path.setAttribute( 'd', 'M 12,12 L 22,22 M 22,12 12,22' );
		path.setAttribute( 'stroke', '#fff' );
		svg.appendChild( path );
		return svg;

	} )();

	const close = new UIElement( buttonSVG );
	close.setPosition( 'absolute' );
	close.setTop( '3px' );
	close.setRight( '1px' );
	close.setCursor( 'pointer' );
	close.onClick( function () {

		container.setDisplay( 'none' );

	} );
	header.add( close );


	let renderer;

	signals.rendererCreated.add( function ( newRenderer ) {

		renderer = newRenderer;

	} );


	let delay;
	let currentMode;
	let currentScript;
	let currentObject;

	const codemirror = CodeMirror( container.dom, {
		value: '',
		lineNumbers: true,
		matchBrackets: true,
		indentWithTabs: true,
		tabSize: 4,
		indentUnit: 4,
		hintOptions: {
			completeSingle: false
		}
	} );
	codemirror.setOption( 'theme', 'monokai' );
	codemirror.on( 'change', function () {

		if ( codemirror.state.focused === false ) return;

		clearTimeout( delay );
		delay = setTimeout( function () {

			const value = codemirror.getValue();

			if ( ! validate( value ) ) return;

			if ( typeof ( currentScript ) === 'object' ) {

				if ( value !== currentScript.source ) {

					editor.execute( new SetScriptValueCommand( editor, currentObject, currentScript, 'source', value ) );

				}

				return;

			}

			if ( currentScript !== 'programInfo' ) return;

			const json = JSON.parse( value );
			const slot = editor.selectedMaterialSlot || 0;
			const matInfo = editor.getObjectMaterial( currentObject, slot );
			if ( ! matInfo ) return;

			if ( JSON.stringify( matInfo.defines ) !== JSON.stringify( json.defines ) ) {

				const cmd = new SetMaterialValueCommand( editor, currentObject, 'defines', json.defines, slot );
				cmd.updatable = false;
				editor.execute( cmd );

			}

			if ( JSON.stringify( matInfo.uniforms ) !== JSON.stringify( json.uniforms ) ) {

				const uniforms = normalizeShaderUniforms( json.uniforms );
				const cmd = new SetMaterialValueCommand( editor, currentObject, 'uniforms', uniforms, slot );
				cmd.updatable = false;
				editor.execute( cmd );

			}

			if ( JSON.stringify( matInfo.attributes ) !== JSON.stringify( json.attributes ) ) {

				const cmd = new SetMaterialValueCommand( editor, currentObject, 'attributes', json.attributes, slot );
				cmd.updatable = false;
				editor.execute( cmd );

			}

		}, 300 );

	} );

	// prevent backspace from deleting objects
	const wrapper = codemirror.getWrapperElement();
	wrapper.addEventListener( 'keydown', function ( event ) {

		event.stopPropagation();

	} );

	// validate

	const errorLines = [];
	const widgets = [];

	const validate = function ( string ) {

		let valid;
		let errors = [];

		return codemirror.operation( function () {

			while ( errorLines.length > 0 ) {

				codemirror.removeLineClass( errorLines.shift(), 'background', 'errorLine' );

			}

			while ( widgets.length > 0 ) {

				codemirror.removeLineWidget( widgets.shift() );

			}

			//

			switch ( currentMode ) {

				case 'javascript':

					try {

						const syntax = esprima.parse( string, { tolerant: true } );
						errors = syntax.errors;

					} catch ( error ) {

						errors.push( {

							lineNumber: error.lineNumber - 1,
							message: error.message

						} );

					}

					for ( let i = 0; i < errors.length; i ++ ) {

						const error = errors[ i ];
						error.message = error.message.replace( /Line [0-9]+: /, '' );

					}

					break;

				case 'json':

					errors = [];

					jsonlint.parseError = function ( message, info ) {

						message = message.split( '\n' )[ 3 ];

						errors.push( {

							lineNumber: info.loc.first_line - 1,
							message: message

						} );

					};

					try {

						jsonlint.parse( string );

					} catch ( error ) {

						// ignore failed error recovery

					}

					break;

				case 'glsl':

					const slotG = editor.selectedMaterialSlot || 0;
					const matG = editor.getObjectMaterial( currentObject, slotG );
					if ( ! matG ) break;

					matG[ currentScript ] = string;
					matG.needsUpdate = true;
					signals.materialChanged.dispatch( currentObject, slotG );

					const programs = renderer.info.programs;

					valid = true;
					const parseMessage = /^(?:ERROR|WARNING): \d+:(\d+): (.*)/g;

					for ( let i = 0, n = programs.length; i !== n; ++ i ) {

						const diagnostics = programs[ i ].diagnostics;

						if ( diagnostics === undefined ||
								diagnostics.material !== matG ) continue;

						if ( ! diagnostics.runnable ) valid = false;

						const shaderInfo = diagnostics[ currentScript ];
						const lineOffset = shaderInfo.prefix.split( /\r\n|\r|\n/ ).length;

						while ( true ) {

							const parseResult = parseMessage.exec( shaderInfo.log );
							if ( parseResult === null ) break;

							errors.push( {

								lineNumber: parseResult[ 1 ] - lineOffset,
								message: parseResult[ 2 ]

							} );

						} // messages

						break;

					} // programs

			} // mode switch

			for ( let i = 0; i < errors.length; i ++ ) {

				const error = errors[ i ];

				const message = document.createElement( 'div' );
				message.className = 'esprima-error';
				message.textContent = error.message;

				const lineNumber = Math.max( error.lineNumber, 0 );
				errorLines.push( lineNumber );

				codemirror.addLineClass( lineNumber, 'background', 'errorLine' );

				const widget = codemirror.addLineWidget( lineNumber, message );

				widgets.push( widget );

			}

			return valid !== undefined ? valid : errors.length === 0;

		} );

	};

	// tern js autocomplete

	const server = new CodeMirror.TernServer( {
		caseInsensitive: true
	} );

	// The three.js API definitions are built lazily from the JSDoc in the library
	// build the first time the script editor is opened.

	let threeDefsRequested = false;

	async function loadThreeDefs() {

		if ( threeDefsRequested ) return;
		threeDefsRequested = true;

		try {

			const url = new URL( '../build/three.core.js', document.baseURI ).href;
			const source = await ( await fetch( url ) ).text();

			server.server.defs.push( buildThreeDefs( source ) );
			server.server.reset();

		} catch ( error ) {

			console.warn( 'Script: Failed to build three.js autocomplete defs.', error );

		}

	}

	codemirror.setOption( 'extraKeys', {
		'Ctrl-Space': function ( cm ) {

			server.complete( cm );

		},
		'Ctrl-I': function ( cm ) {

			server.showType( cm );

		},
		'Ctrl-O': function ( cm ) {

			server.showDocs( cm );

		},
		'Alt-.': function ( cm ) {

			server.jumpToDef( cm );

		},
		'Alt-,': function ( cm ) {

			server.jumpBack( cm );

		},
		'Ctrl-Q': function ( cm ) {

			server.rename( cm );

		},
		'Ctrl-.': function ( cm ) {

			server.selectName( cm );

		}
	} );

	codemirror.on( 'cursorActivity', function ( cm ) {

		if ( currentMode !== 'javascript' ) return;
		server.updateArgHints( cm );

	} );

	codemirror.on( 'keypress', function ( cm, kb ) {

		if ( currentMode !== 'javascript' ) return;
		if ( /[\w\.]/.exec( kb.key ) ) {

			server.complete( cm );

		}

	} );


	//

	signals.editorCleared.add( function () {

		container.setDisplay( 'none' );

	} );

	function setTitle( object, script ) {

		if ( typeof script === 'object' ) {

			title.setValue( object.name + ' / ' + script.name );

		} else {

			const matTitle = editor.getObjectMaterial( object, editor.selectedMaterialSlot || 0 );
			const matName = ( matTitle && matTitle.name ) || ( object.material && ! Array.isArray( object.material ) && object.material.name ) || 'Material';

			switch ( script ) {

				case 'vertexShader':

					title.setValue( matName + ' / ' + strings.getKey( 'script/title/vertexShader' ) );
					break;

				case 'fragmentShader':

					title.setValue( matName + ' / ' + strings.getKey( 'script/title/fragmentShader' ) );
					break;

				case 'programInfo':

					title.setValue( matName + ' / ' + strings.getKey( 'script/title/programInfo' ) );
					break;

				default:

					throw new Error( 'setTitle: Unknown script' );

			}

		}

	}

	signals.editScript.add( function ( object, script ) {

		let mode, source;

		if ( typeof ( script ) === 'object' ) {

			mode = 'javascript';
			source = script.source;

		} else {

			switch ( script ) {

				case 'vertexShader': {

					mode = 'glsl';
					const matV = editor.getObjectMaterial( object, editor.selectedMaterialSlot || 0 );
					source = ( matV && matV.vertexShader ) || '';

					break;

				}

				case 'fragmentShader': {

					mode = 'glsl';
					const matF = editor.getObjectMaterial( object, editor.selectedMaterialSlot || 0 );
					source = ( matF && matF.fragmentShader ) || '';

					break;

				}

				case 'programInfo': {

					mode = 'json';
					// FreeFilmCut: show colors as [r,g,b] arrays (not Color.toJSON hex ints)
					const matP = editor.getObjectMaterial( object, editor.selectedMaterialSlot || 0 );
					const json = serializeProgramInfo( matP || object.material );
					source = JSON.stringify( json, null, '\t' );

					break;

				}

				default:

					throw new Error( 'editScript: Unknown script' );

			}

		}

		setTitle( object, script );

		currentMode = mode;
		currentScript = script;
		currentObject = object;

		if ( mode === 'javascript' ) loadThreeDefs();

		container.setDisplay( '' );
		codemirror.setValue( source );
		codemirror.clearHistory();
		if ( mode === 'json' ) mode = { name: 'javascript', json: true };
		codemirror.setOption( 'mode', mode );

	} );

	signals.scriptRemoved.add( function ( script ) {

		if ( currentScript === script ) {

			container.setDisplay( 'none' );

		}

	} );

	signals.objectChanged.add( function ( object ) {

		if ( object !== currentObject ) return;

		if ( [ 'programInfo', 'vertexShader', 'fragmentShader' ].includes( currentScript ) ) return;

		setTitle( currentObject, currentScript );

	} );

	signals.scriptChanged.add( function ( script ) {

		if ( script === currentScript ) {

			setTitle( currentObject, currentScript );

		}

	} );

	signals.materialChanged.add( function ( object/*, slot */ ) {

		if ( object !== currentObject ) return;

		// TODO: Adds multi-material support

		setTitle( currentObject, currentScript );

	} );

	return container;

}

export { Script };
