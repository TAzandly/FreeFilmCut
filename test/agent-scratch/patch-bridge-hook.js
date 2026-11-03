const fs = require('fs');
const path = 'three.js/editor/index.html';
let html = fs.readFileSync(path, 'utf8');
if (html.includes('syncShaderMaterialBridge')) {
  console.log('bridge hook already present');
  process.exit(0);
}
const needle = "window.THREE = THREE; // Expose THREE to APP Scripts and Console";
if (!html.includes(needle)) { console.error('needle missing'); process.exit(1); }
const inject = `window.THREE = THREE; // Expose THREE to APP Scripts and Console

			// FreeFilmCut: after autosave restore, re-attach ShaderMaterial sidebar bridge (color/map)
			import( './js/FreeCapCutShaders.js' ).then( ( { syncShaderMaterialBridge } ) => {

				function rebridge( object ) {

					if ( ! object ) return;
					const mats = Array.isArray( object.material ) ? object.material : ( object.material ? [ object.material ] : [] );
					for ( const m of mats ) syncShaderMaterialBridge( m );
					object.traverse( ( child ) => {

						const cm = Array.isArray( child.material ) ? child.material : ( child.material ? [ child.material ] : [] );
						for ( const m of cm ) syncShaderMaterialBridge( m );

					} );

				}

				editor.signals.objectAdded.add( rebridge );
				editor.signals.materialChanged.add( function ( object ) { rebridge( object ); } );

			} ).catch( ( e ) => console.warn( 'FreeCapCutShaders bridge hook failed', e ) );
`;
html = html.replace(needle, inject);
fs.writeFileSync(path, html);
console.log('index bridge hook added');
