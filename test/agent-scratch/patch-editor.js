const fs = require('fs');
let ed = fs.readFileSync('js/Editor.js', 'utf8');

if (!ed.includes('isLoadingState')) {
  ed = ed.replace(
    'this.storage = new _Storage();',
    "this.storage = new _Storage();\n\tthis.isLoadingState = false; // FreeFilmCut: block autosave while hydrating IndexedDB"
  );
  console.log('added isLoadingState');
}

const fromRe = /fromJSON:\s*async function\s*\(\s*json\s*\)\s*\{[\s\S]*?\n\t\},(?=\s*\n\s*toJSON:)/;
if (!fromRe.test(ed)) {
  console.error('fromJSON regex not found');
  process.exit(1);
}

const fromJSONNew = `fromJSON: async function ( json ) {

\t\tthis.isLoadingState = true;

\t\ttry {

\t\t\tvar loader = new THREE.ObjectLoader();
\t\t\tvar camera = await loader.parseAsync( json.camera );

\t\t\tthis.setCameraType( camera.isOrthographicCamera ? 'orthographic' : 'perspective' );

\t\t\tconst existingUuid = this.camera.uuid;
\t\t\tconst incomingUuid = camera.uuid;

\t\t\t// copy all properties, including uuid
\t\t\tthis.camera.copy( camera );
\t\t\tthis.camera.uuid = incomingUuid;

\t\t\tdelete this.cameras[ existingUuid ]; // remove old entry [existingUuid, this.camera]
\t\t\tthis.cameras[ incomingUuid ] = this.camera; // add new entry [incomingUuid, this.camera]

\t\t\tif ( json.controls !== undefined ) {

\t\t\t\tthis.controls.fromJSON( json.controls );

\t\t\t}

\t\t\tthis.signals.cameraResetted.dispatch();

\t\t\tthis.history.fromJSON( json.history );
\t\t\tthis.scripts = json.scripts;

\t\t\tconst scene = await loader.parseAsync( json.scene );

\t\t\tthis.backgroundType = json.backgroundType || 'Default';
\t\t\tthis.environmentType = json.environmentType || 'Default';

\t\t\tthis.setScene( scene );

\t\t} catch ( err ) {

\t\t\tconsole.error( 'Editor.fromJSON failed:', err );
\t\t\tthrow err;

\t\t} finally {

\t\t\tthis.isLoadingState = false;

\t\t}

\t},`;

ed = ed.replace(fromRe, fromJSONNew);
console.log('fromJSON replaced');

const toJSONMarker = 'scene: this.scene.toJSON(),';
if (ed.includes(toJSONMarker) && !ed.includes('FreeFilmCut: ShaderMaterial UI bridge')) {
  ed = ed.replace(
    toJSONMarker,
    `scene: ( function () {

\t\t\t\tconst sceneJSON = this.scene.toJSON();
\t\t\t\t// FreeFilmCut: ShaderMaterial UI bridge sets .color/.map for sidebar;
\t\t\t\t// strip duplicates so ObjectLoader keeps uniforms-only (avoids corrupt reloads).
\t\t\t\tif ( sceneJSON.materials ) {

\t\t\t\t\tfor ( const mat of Object.values( sceneJSON.materials ) ) {

\t\t\t\t\t\tif ( mat.type === 'ShaderMaterial' || mat.type === 'RawShaderMaterial' ) {

\t\t\t\t\t\t\tdelete mat.color;
\t\t\t\t\t\t\tdelete mat.map;

\t\t\t\t\t\t}

\t\t\t\t\t}

\t\t\t\t}

\t\t\t\treturn sceneJSON;

\t\t\t} ).call( this ),`
  );
  console.log('toJSON scrub added');
}

fs.writeFileSync('js/Editor.js', ed);
console.log('ok', ed.includes('isLoadingState'), ed.includes('Editor.fromJSON failed'));
