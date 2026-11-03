const fs = require('fs');
const path = 'three.js/editor/index.html';
let html = fs.readFileSync(path, 'utf8');

const getRe = /editor\.storage\.get\(\s*async function\s*\(\s*state\s*\)\s*\{[\s\S]*?\n\t\t\t\t\} \);/;
if (!getRe.test(html)) {
  console.error('get block not found');
  const i = html.indexOf('editor.storage.get');
  console.log(html.slice(i, i + 500));
  process.exit(1);
}

const newGet = `editor.storage.get( async function ( state ) {

					if ( isLoadingFromHash ) return;

					try {

						if ( state !== undefined ) {

							await editor.fromJSON( state );

						} else {

							editor.signals.sceneEnvironmentChanged.dispatch( 'Default' );

						}

					} catch ( err ) {

						console.error( 'FreeFilmCut: failed to restore autosave, starting empty scene.', err );
						alert( 'Autosave scene failed to load (often a bad ShaderMaterial save).\\nStarting with an empty scene. Re-import your last .vfxpack from Downloads if needed.' );
						editor.storage.clear();
						editor.signals.sceneEnvironmentChanged.dispatch( 'Default' );

					}

					const selected = editor.config.getKey( 'selected' );

					if ( selected !== undefined ) {

						editor.selectByUuid( selected );

					}

				} );`;

html = html.replace(getRe, newGet);

const saveRe = /function saveState\(\) \{\s*\n\s*if \( editor\.config\.getKey\( 'autosave' \) === false \) \{\s*\n\s*return;\s*\n\s*\}/;
if (!saveRe.test(html)) {
  console.error('saveState not found');
  process.exit(1);
}

html = html.replace(saveRe, `function saveState() {

					if ( editor.config.getKey( 'autosave' ) === false ) {

						return;

					}

					// FreeFilmCut: never persist mid-hydration (cameraResetted raced empty scene into IndexedDB)
					if ( editor.isLoadingState ) {

						return;

					}`);

fs.writeFileSync(path, html);
console.log('index ok', html.includes('isLoadingState'), html.includes('failed to restore autosave'));
