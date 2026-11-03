/**
 * FreeFilmCut .vfxpack exporter for Three.js Editor (MVP).
 * Builds zip: pack/manifest.json + scene.json + textures/ + shaders/placeholder.
 */
import JSZip from 'jszip';
import { isBelowInputUniformName, isTransitionInputUniformName } from './FreeCapCutShaders.js?v=fcc-ui-198';
import {
	collectExposedParamsFromScene,
	exposedParamsToManifestParams,
} from './ExposedParams.js?v=fcc-ui-228';
import { getEffectDescriptor } from './postprocessing/PostProcessRegistry.js?v=fcc-ui-124';
import { registerBuiltinEffects } from './postprocessing/BuiltinEffects.js?v=fcc-ui-124';
import { normalizeStickerMotion } from './sticker-motion/StickerMotion.js?v=fcc-ui-106';
import { buildTextAnimPack } from './TextAnimPackExporter.js?v=fcc-ui-164';

registerBuiltinEffects();

const TEXTURE_MAP_KEYS = [
	'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap',
	'aoMap', 'bumpMap', 'displacementMap', 'alphaMap', 'envMap', 'lightMap',
	'specularMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap',
	'sheenColorMap', 'sheenRoughnessMap', 'transmissionMap', 'thicknessMap',
	'iridescenceMap', 'iridescenceThicknessMap', 'anisotropyMap'
];

function slugify( name ) {

	return String( name || 'pack' )
		.trim()
		.toLowerCase()
		.replace( /[^a-z0-9._-]+/g, '-' )
		.replace( /^-+|-+$/g, '' )
		.slice( 0, 64 ) || 'pack';

}

const PACK_TYPES = [ 'sticker', 'transition', 'effect', 'filter', 'art-text', 'sticker-anim', 'text-anim', 'text-template', 'clip-anim' ];

function normalizePackType( value ) {

	return PACK_TYPES.includes( value ) ? value : 'effect';

}

function defaultScopeForType( type ) {

	// filter / effect / clip-anim consume layers below by default; others stay stack overlays for MVP.
	// clip-anim below is optional at authoring time — default matches effect.
	if ( type === 'filter' || type === 'effect' || type === 'clip-anim' ) return 'below';
	return 'stack';

}

function clipAnimPhaseFromConfig( editor ) {

	const raw = ( editor.config && editor.config.getKey( 'project/vfxpack/stickerAnimPhase' ) ) || 'in';
	return raw === 'out' || raw === 'combo' ? raw : 'in';

}

const TONE_MAPPING_NAMES = {
	0: 'NoToneMapping',
	1: 'LinearToneMapping',
	2: 'ReinhardToneMapping',
	3: 'CineonToneMapping',
	4: 'ACESFilmicToneMapping',
	6: 'AgXToneMapping',
	7: 'NeutralToneMapping'
};

function toneMappingName( value ) {

	const n = Number( value );
	return TONE_MAPPING_NAMES[ n ] || String( value );

}

function serializeRenderSettings( editor ) {

	const config = editor.config;
	const toneMapping = parseFloat( config.getKey( 'project/renderer/toneMapping' ) );
	const exposure = parseFloat( config.getKey( 'project/renderer/toneMappingExposure' ) );
	const shadows = !! config.getKey( 'project/renderer/shadows' );
	const shadowType = parseFloat( config.getKey( 'project/renderer/shadowType' ) );
	const antialias = !! config.getKey( 'project/renderer/antialias' );
	const rendererType = config.getKey( 'project/renderer/type' ) || 'WebGLRenderer';
	const cameraType = config.getKey( 'project/camera' ) || 'perspective';

	return {
		rendererType,
		cameraType,
		antialias,
		shadows,
		shadowType: Number.isFinite( shadowType ) ? shadowType : 1,
		toneMapping: Number.isFinite( toneMapping ) ? toneMapping : 7,
		toneMappingName: toneMappingName( Number.isFinite( toneMapping ) ? toneMapping : 7 ),
		toneMappingExposure: Number.isFinite( exposure ) ? exposure : 1
	};

}

async function serializeBackground( scene, textureRefs, texturesFolder ) {

	const bg = scene.background;
	if ( bg == null ) {

		return { type: 'None', value: null };

	}

	if ( bg.isColor ) {

		return {
			type: 'Color',
			color: colorToHex( bg ),
			blurriness: scene.backgroundBlurriness ?? 0,
			intensity: scene.backgroundIntensity ?? 1,
			rotation: scene.backgroundRotation
				? [ scene.backgroundRotation.x, scene.backgroundRotation.y, scene.backgroundRotation.z ]
				: [ 0, 0, 0 ]
		};

	}

	if ( bg.isTexture ) {

		const entry = await collectTexture( bg, textureRefs, texturesFolder );
		// THREE.EquirectangularReflectionMapping = 303, EquirectangularRefractionMapping = 304
		let type = 'Texture';
		if ( bg.mapping === 303 || bg.mapping === 304 ) type = 'Equirectangular';

		return {
			type,
			path: entry ? entry.path : null,
			uuid: bg.uuid,
			colorSpace: bg.colorSpace || undefined,
			flipY: bg.flipY,
			exported: !!( entry && entry.exported ),
			blurriness: scene.backgroundBlurriness ?? 0,
			intensity: scene.backgroundIntensity ?? 1,
			rotation: scene.backgroundRotation
				? [ scene.backgroundRotation.x, scene.backgroundRotation.y, scene.backgroundRotation.z ]
				: [ 0, 0, 0 ]
		};

	}

	return { type: 'Unknown', note: 'background type not exported' };

}

function isEditorPmremEnvironmentTexture( texture ) {

	if ( ! texture || texture.isTexture !== true ) return false;
	if ( texture.isRenderTargetTexture ) return true;
	if ( /pmrem/i.test( String( texture.name || '' ) ) ) return true;
	return false;

}

async function serializeEnvironment( editor, scene, textureRefs, texturesFolder ) {

	// Keep semantic type so NLE can rebuild RoomEnvironment/PMREM (do not dump PMREM RT).
	const envType = editor && editor.environmentType ? editor.environmentType : null;
	const env = scene.environment;
	const asDefault = () => ( {
		type: 'Default',
		intensity: scene.environmentIntensity ?? 1,
		rotation: scene.environmentRotation
			? [ scene.environmentRotation.x, scene.environmentRotation.y, scene.environmentRotation.z ]
			: [ 0, 0, 0 ]
	} );

	if ( envType === 'Default' || ( envType !== 'Equirectangular' && envType !== 'None' && isEditorPmremEnvironmentTexture( env ) ) ) {

		return asDefault();

	}

	if ( envType === 'None' || env == null ) {

		return { type: 'None', value: null };

	}

	if ( env && env.isTexture ) {

		// Even if sidebar says Equirectangular, never dump a live PMREM RT as PNG.
		if ( isEditorPmremEnvironmentTexture( env ) ) return asDefault();

		const entry = await collectTexture( env, textureRefs, texturesFolder );
		return {
			type: 'Equirectangular',
			path: entry ? entry.path : null,
			uuid: env.uuid,
			colorSpace: env.colorSpace || undefined,
			intensity: scene.environmentIntensity ?? 1,
			rotation: scene.environmentRotation
				? [ scene.environmentRotation.x, scene.environmentRotation.y, scene.environmentRotation.z ]
				: [ 0, 0, 0 ],
			exported: !!( entry && entry.exported )
		};

	}

	return { type: 'Unknown', note: 'environment type not exported' };

}

function serializeFog( fog ) {

	if ( ! fog ) return null;

	return {
		type: fog.isFogExp2 ? 'FogExp2' : 'Fog',
		color: colorToHex( fog.color ),
		near: fog.near,
		far: fog.far,
		density: fog.density
	};

}


function mat4ToArray( m ) {

	return m ? Array.from( m.elements ) : null;

}

function colorToHex( c ) {

	if ( ! c || typeof c.getHexString !== 'function' ) return null;
	return '#' + c.getHexString();

}

function vec3ToArray( v ) {

	if ( ! v ) return null;
	return [ v.x, v.y, v.z ];

}

function quatToArray( q ) {

	if ( ! q ) return null;
	return [ q.x, q.y, q.z, q.w ];

}

async function imageSourceToPngBlob( source ) {

	if ( ! source ) return null;

	// Already a Blob / File
	if ( typeof Blob !== 'undefined' && source instanceof Blob ) {

		return source;

	}

	let w = source.width || source.videoWidth || source.naturalWidth || 0;
	let h = source.height || source.videoHeight || source.naturalHeight || 0;

	if ( ! w || ! h ) {

		// DataTexture / typed array without drawable size
		if ( source.data && source.width && source.height ) {

			w = source.width;
			h = source.height;
			const canvas = document.createElement( 'canvas' );
			canvas.width = w;
			canvas.height = h;
			const ctx = canvas.getContext( '2d' );
			const imgData = ctx.createImageData( w, h );
			const src = source.data;
			const channels = ( src.length / ( w * h ) ) | 0;

			for ( let i = 0, p = 0; i < w * h; i ++, p += 4 ) {

				const s = i * channels;
				imgData.data[ p ] = src[ s ] || 0;
				imgData.data[ p + 1 ] = channels > 1 ? src[ s + 1 ] : imgData.data[ p ];
				imgData.data[ p + 2 ] = channels > 2 ? src[ s + 2 ] : imgData.data[ p ];
				imgData.data[ p + 3 ] = channels > 3 ? src[ s + 3 ] : 255;

			}

			ctx.putImageData( imgData, 0, 0 );
			return canvasToBlob( canvas );

		}

		return null;

	}

	const canvas = document.createElement( 'canvas' );
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext( '2d' );

	try {

		ctx.drawImage( source, 0, 0, w, h );

	} catch ( e ) {

		console.warn( '[VfxPack] drawImage failed (likely CORS):', e );
		return null;

	}

	return canvasToBlob( canvas );

}

function canvasToBlob( canvas ) {

	return new Promise( ( resolve ) => {

		if ( canvas.toBlob ) {

			canvas.toBlob( ( blob ) => resolve( blob ), 'image/png' );

		} else {

			const dataUrl = canvas.toDataURL( 'image/png' );
			const bin = atob( dataUrl.split( ',' )[ 1 ] );
			const arr = new Uint8Array( bin.length );
			for ( let i = 0; i < bin.length; i ++ ) arr[ i ] = bin.charCodeAt( i );
			resolve( new Blob( [ arr ], { type: 'image/png' } ) );

		}

	} );

}

async function collectTexture( texture, textureMap, zipFolder ) {

	if ( ! texture || texture.isTexture !== true ) return null;
	if ( textureMap.has( texture.uuid ) ) return textureMap.get( texture.uuid );

	const rtUuid = texture.userData && texture.userData.fccRenderTextureUuid;
	if ( rtUuid ) {

		const entry = {
			uuid: texture.uuid,
			name: texture.name || '',
			path: `rt:${ rtUuid }`,
			renderTextureUuid: rtUuid,
			exported: false
		};
		textureMap.set( texture.uuid, entry );
		return entry;

	}

	const fileName = `tex_${ textureMap.size }_${ slugify( texture.name || texture.uuid.slice( 0, 8 ) ) }.png`;
	const relPath = `textures/${ fileName }`;

	const image = texture.image || texture.source?.data;
	const blob = await imageSourceToPngBlob( image );

	const entry = {
		uuid: texture.uuid,
		name: texture.name || '',
		path: relPath,
		wrapS: texture.wrapS,
		wrapT: texture.wrapT,
		magFilter: texture.magFilter,
		minFilter: texture.minFilter,
		flipY: texture.flipY,
		colorSpace: texture.colorSpace || texture.encoding || undefined,
		exported: !! blob
	};

	if ( blob ) {

		zipFolder.file( fileName, blob );

	}

	textureMap.set( texture.uuid, entry );
	return entry;

}

function serializeUniformValue( value ) {

	if ( value === null || value === undefined ) return null;
	if ( value.isTexture ) return null; // handled via textures map
	if ( value.isColor ) return '#' + value.getHexString();
	if ( value.isVector2 ) return [ value.x, value.y ];
	if ( value.isVector3 ) return [ value.x, value.y, value.z ];
	if ( value.isVector4 ) return [ value.x, value.y, value.z, value.w ];
	if ( typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string' ) return value;
	return null;

}

function serializeMaterial( material, textureRefs, shaderRefs ) {

	if ( ! material ) return null;

	const mats = Array.isArray( material ) ? material : [ material ];
	return mats.map( ( mat ) => {

		const out = {
			uuid: mat.uuid,
			name: mat.name || '',
			type: mat.type,
			transparent: !! mat.transparent,
			opacity: mat.opacity,
			side: mat.side,
			depthWrite: mat.depthWrite,
			depthTest: mat.depthTest,
			color: colorToHex( mat.color ),
			emissive: colorToHex( mat.emissive ),
			metalness: mat.metalness,
			roughness: mat.roughness,
			textures: {},
			uniforms: {}
		};

		for ( const key of TEXTURE_MAP_KEYS ) {

			if ( mat[ key ] && mat[ key ].isTexture ) {

				const ref = textureRefs.get( mat[ key ].uuid );
				if ( ref ) out.textures[ key ] = ref.path;

			}

		}

		if ( mat.isShaderMaterial || mat.isRawShaderMaterial ) {

			const shaderEntry = shaderRefs && shaderRefs.get( mat.uuid );
			out.shader = shaderEntry ? {
				vertex: shaderEntry.vertexPath,
				fragment: shaderEntry.fragmentPath,
				raw: !! mat.isRawShaderMaterial
			} : {
				vertexShader: '(missing)',
				fragmentShader: '(missing)'
			};

			if ( mat.uniforms ) {

				for ( const [ ukey, u ] of Object.entries( mat.uniforms ) ) {

					if ( ! u || u.value === undefined ) continue;
					// Below-input is NLE-bound at runtime; Editor preview must not become a packed map
					if ( isBelowInputUniformName( ukey ) ) {

						out.uniforms[ ukey ] = { type: 't', value: null, binding: 'accumBelow' };
						continue;

					}

					if ( u.value && u.value.isTexture ) {

						if ( u.value.userData && u.value.userData.editorBelowPreview ) continue;
						const ref = textureRefs.get( u.value.uuid );
						if ( ref ) {

							out.textures[ ukey ] = ref.path;
							out.uniforms[ ukey ] = { type: 't', path: ref.path };

						}

					} else {

						const sv = serializeUniformValue( u.value );
						if ( sv !== null ) out.uniforms[ ukey ] = sv;

					}

				}

			}

			if ( mat.defines && Object.keys( mat.defines ).length ) {

				out.defines = { ...mat.defines };

			}

		}

		if ( mat.userData && mat.userData.exposedUniforms && typeof mat.userData.exposedUniforms === 'object' ) {

			out.exposedUniforms = { ...mat.userData.exposedUniforms };

		}

		return out;

	} );

}

function typedArrayToJSON( array ) {

	return {
		type: array.constructor.name,
		array: Array.from( array )
	};

}

function serializeBufferAttribute( attr ) {

	if ( ! attr || ! attr.array ) return null;
	return {
		itemSize: attr.itemSize,
		normalized: !! attr.normalized,
		type: attr.array.constructor.name,
		array: Array.from( attr.array )
	};

}

/**
 * Parametric geometries keep parameters only.
 * Imported BufferGeometry (GLB/FBX) also writes geometries/<uuid>.json so OpenCut
 * can rebuild the real mesh instead of falling back to a 1x1x1 box.
 */
function serializeGeometry( geometry, geometriesFolder, geometryRefs ) {

	if ( ! geometry ) return null;

	const out = {
		uuid: geometry.uuid,
		name: geometry.name || '',
		type: geometry.type,
		parameters: geometry.parameters ? { ...geometry.parameters } : undefined,
		attributes: geometry.attributes ? Object.keys( geometry.attributes ) : [],
		indexCount: geometry.index ? geometry.index.count : null
	};

	const needsBuffers = ! geometry.parameters && geometry.attributes && geometry.attributes.position;

	if ( needsBuffers && geometriesFolder ) {

		if ( geometryRefs && geometryRefs.has( geometry.uuid ) ) {

			out.data = geometryRefs.get( geometry.uuid );
			return out;

		}

		const fileName = `geom_${ geometry.uuid.slice( 0, 8 ) }.json`;
		const relPath = `geometries/${ fileName }`;
		const payload = {
			uuid: geometry.uuid,
			type: geometry.type,
			attributes: {}
		};

		for ( const name of Object.keys( geometry.attributes ) ) {

			const serialized = serializeBufferAttribute( geometry.attributes[ name ] );
			if ( serialized ) payload.attributes[ name ] = serialized;

		}

		if ( geometry.index ) {

			payload.index = typedArrayToJSON( geometry.index.array );

		}

		geometriesFolder.file( fileName, JSON.stringify( payload ) );
		out.data = relPath;
		if ( geometryRefs ) geometryRefs.set( geometry.uuid, relPath );

	}

	return out;

}

function detectNodeKind( object ) {


	// FreeFilmCut UGUI (Canvas / Image) — before Mesh/Group so UI planes are not 3D meshes.
	if ( object.userData && object.userData.fccUI && object.userData.fccUI.type ) return 'ui';
	if ( object.userData && object.userData.fccRenderTexture ) return 'renderTexture';
	if ( object.userData && object.userData.fccVideoPlayer ) return 'videoPlayer';
	if ( object.userData && object.userData.fccTimeline ) return 'timeline';
	if ( object.isPerspectiveCamera || object.isOrthographicCamera || object.isCamera ) return 'camera';
	if ( object.isLight ) return 'light';
	if ( object.isMesh || object.isSkinnedMesh ) return 'mesh';
	if ( object.isSprite ) return 'sprite';
	if ( object.isPoints ) return 'points';
	if ( object.isLine || object.isLineSegments ) return 'line';
	if ( object.isBone ) return 'bone';
	if ( object.isGroup ) return 'group';
	if ( object.isScene ) return 'scene';
	// Heuristic UI stub: userData.ui or name prefix
	if ( object.userData && ( object.userData.ui || object.userData.kind === 'ui' ) ) return 'ui';
	return 'object';

}

function serializeLightExtras( object ) {

	const out = { lightType: object.type };
	if ( object.color ) out.color = colorToHex( object.color );
	if ( object.intensity !== undefined ) out.intensity = object.intensity;
	if ( object.distance !== undefined ) out.distance = object.distance;
	if ( object.decay !== undefined ) out.decay = object.decay;
	if ( object.angle !== undefined ) out.angle = object.angle;
	if ( object.penumbra !== undefined ) out.penumbra = object.penumbra;
	if ( object.castShadow !== undefined ) out.castShadow = object.castShadow;
	if ( object.isHemisphereLight ) {

		out.groundColor = colorToHex( object.groundColor );

	}

	if ( object.isDirectionalLight || object.isSpotLight ) {

		out.target = object.target ? vec3ToArray( object.target.position ) : null;

	}

	return out;

}

function serializeCameraExtras( object, customDefsById = null ) {

	const out = { cameraType: object.type };
	if ( object.isPerspectiveCamera ) {

		out.fov = object.fov;
		out.aspect = object.aspect;
		out.near = object.near;
		out.far = object.far;
		out.focus = object.focus;
		out.zoom = object.zoom;

	} else if ( object.isOrthographicCamera ) {

		out.left = object.left;
		out.right = object.right;
		out.top = object.top;
		out.bottom = object.bottom;
		out.near = object.near;
		out.far = object.far;
		out.zoom = object.zoom;

	}

	// FreeFilmCut: Unity-like post-process stack (also in userData.postProcessStack)
	const stack = object.userData && object.userData.postProcessStack;
	if ( stack && typeof stack === 'object' ) {

		out.postProcess = serializePostProcessStack( stack, customDefsById );

	}

	return out;

}

/**
 * Snapshot a postProcessStack for pack scene/manifest.
 * Keeps custom effect `definition` (shader inline) + `textureBindings`
 * (rtUuid → pack scene RT node; NLE resolves live __fccRT each frame).
 * @param {object} stack
 * @param {Map<string, object>|null} [customDefsById] packed defs with rewritten texture paths
 */
function serializePostProcessStack( stack, customDefsById = null ) {

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
			const srcDef = e.definition && typeof e.definition === 'object' ? e.definition : null;
			const defId = srcDef && srcDef.id;
			if ( defId && customDefsById && customDefsById.has( defId ) ) {

				row.definition = customDefsById.get( defId );

			} else if ( srcDef ) {

				row.definition = JSON.parse( JSON.stringify( srcDef ) );

			}

			// RT slot bindings (scene-local uuids that also exist as pack nodes).
			if ( e.textureBindings && typeof e.textureBindings === 'object' ) {

				const tb = {};
				for ( const [ name, b ] of Object.entries( e.textureBindings ) ) {

					if ( ! b || typeof b !== 'object' ) continue;
					const rtUuid = typeof b.rtUuid === 'string' ? b.rtUuid : '';
					if ( ! rtUuid ) continue;
					tb[ name ] = { rtUuid };

				}
				if ( Object.keys( tb ).length > 0 ) row.textureBindings = tb;

			}

			return row;

		} ).filter( Boolean )
		: [];
	return {
		enabled: stack.enabled !== false,
		effects,
	};

}

/** Collect unique custom effect definitions from camera PP (+ textFx) stacks. */
function collectCustomEffectDefsFromScene( scene ) {

	const byId = new Map();
	if ( ! scene || typeof scene.traverse !== 'function' ) return byId;
	scene.traverse( ( object ) => {

		const stacks = [];
		if ( object.isCamera && object.userData && object.userData.postProcessStack ) {

			stacks.push( object.userData.postProcessStack );

		}

		const ui = object.userData && object.userData.fccUI;
		if ( ui && ui.textFxStack ) stacks.push( ui.textFxStack );
		for ( const stack of stacks ) {

			for ( const e of stack.effects || [] ) {

				if ( ! e || ! e.definition || typeof e.definition !== 'object' ) continue;
				const id = e.definition.id;
				if ( ! id || byId.has( id ) ) continue;
				byId.set( id, JSON.parse( JSON.stringify( e.definition ) ) );

			}

		}

	} );
	return byId;

}

function dataUrlToArrayBuffer( dataUrl ) {

	if ( typeof dataUrl !== 'string' || dataUrl.indexOf( 'base64,' ) === - 1 ) return null;
	try {

		const b64 = dataUrl.slice( dataUrl.indexOf( 'base64,' ) + 7 );
		const bin = atob( b64 );
		const arr = new Uint8Array( bin.length );
		for ( let i = 0; i < bin.length; i ++ ) arr[ i ] = bin.charCodeAt( i );
		return arr.buffer;

	} catch ( e ) {

		return null;

	}

}

function guessTextureExt( fileName, dataUrl ) {

	const fromName = String( fileName || '' ).match( /\.(png|jpe?g|webp|gif)$/i );
	if ( fromName ) return fromName[ 0 ].toLowerCase().replace( 'jpeg', 'jpg' );
	if ( typeof dataUrl === 'string' ) {

		if ( /image\/jpe?g/i.test( dataUrl ) ) return '.jpg';
		if ( /image\/webp/i.test( dataUrl ) ) return '.webp';
		if ( /image\/gif/i.test( dataUrl ) ) return '.gif';

	}

	return '.png';

}

/**
 * Copy custom-effect image textures into pack/effects/custom/<id>/…
 * Mutates each definition's texture.path to the pack-relative path; strips dataUrl.
 * @returns {string[]} pack-relative asset paths
 */
async function packCustomEffectAssets( editor, customDefsById, pack ) {

	const assetPaths = [];
	if ( ! customDefsById || customDefsById.size === 0 ) return assetPaths;
	const pf = editor && editor.projectFolder;
	const used = new Set();

	for ( const [ id, def ] of customDefsById ) {

		const folderRel = 'effects/custom/' + id;
		const folder = pack.folder( folderRel );
		for ( const tex of def.textures || [] ) {

			if ( ! tex || tex.source === 'rt' ) continue;
			let bytes = null;
			let hintName = '';

			if ( tex.path && pf && typeof pf.readBinaryFile === 'function' ) {

				try {

					const bin = await pf.readBinaryFile( tex.path );
					if ( bin && bin.buffer ) {

						bytes = bin.buffer;
						hintName = String( tex.path ).split( /[/\\]/ ).pop() || '';

					}

				} catch ( e ) { /* try dataUrl */ }

			}

			if ( ! bytes && tex.dataUrl ) {

				bytes = dataUrlToArrayBuffer( tex.dataUrl );
				hintName = ( tex.name || 'tex' ) + guessTextureExt( '', tex.dataUrl );

			}

			if ( ! bytes ) {

				if ( tex.path || tex.dataUrl ) {

					console.warn( '[FreeFilmCut] custom effect texture not packed:', id, tex.name, tex.path || '(dataUrl)' );

				}

				continue;

			}

			const base = slugify( String( hintName || tex.name || 'tex' ).replace( /\.[^.]+$/, '' ) ) || 'tex';
			const ext = guessTextureExt( hintName, tex.dataUrl );
			let fileName = base + ext;
			let n = 2;
			while ( used.has( id + '/' + fileName ) ) {

				fileName = base + '_' + n + ext;
				n ++;

			}

			used.add( id + '/' + fileName );
			folder.file( fileName, new Uint8Array( bytes ) );
			const rel = folderRel + '/' + fileName;
			tex.path = rel;
			delete tex.dataUrl;
			assetPaths.push( rel );

		}

	}

	return assetPaths;

}

/**
 * Collect FreeFilmCut .anim clips to pack.
 * Sources: active panel clip, editor.freecapcutAnims[], project assets/animations/*.anim
 * Keeps targets whose objectUuid is in the exported scene, OR that only use
 * material.*. / postProcess.* paths (resolved by uuid/effectId at playback).
 */
function clipHasKeys( raw ) {

	return Array.isArray( raw && raw.targets ) && raw.targets.some( ( t ) =>
		t && Array.isArray( t.tracks ) && t.tracks.some( ( tr ) => tr && tr.keys && tr.keys.length )
	);

}

function trackIsNonTransform( path ) {

	const p = String( path || '' );
	return p.startsWith( 'material.' ) || p.startsWith( 'postProcess.' );

}

function filterAnimTargets( targets, sceneUuids ) {

	const out = [];
	for ( const t of targets || [] ) {

		if ( ! t || ! t.objectUuid ) continue;
		const tracks = Array.isArray( t.tracks ) ? t.tracks : [];
		const inScene = ! sceneUuids || sceneUuids.has( t.objectUuid );
		const hasSpecial = tracks.some( ( tr ) => trackIsNonTransform( tr && tr.path ) );
		if ( ! inScene && ! hasSpecial ) continue;
		out.push( {
			objectUuid: t.objectUuid,
			tracks: tracks.map( ( tr ) => ( {
				path: tr.path,
				interp: tr.interp === 'step' ? 'step' : 'linear',
				keys: ( tr.keys || [] ).map( ( k ) => ( { t: Number( k.t ), v: Number( k.v ) } ) ),
			} ) ),
		} );

	}
	return out;

}

function normalizeClipCandidate( raw ) {

	if ( ! raw || typeof raw !== 'object' ) return null;
	return {
		format: raw.format || 'freecapcut.anim/1',
		name: String( raw.name || 'Animation' ),
		fps: Number( raw.fps ) || 30,
		duration: Math.max( 0.01, Number( raw.duration ) || 1 ),
		loop: raw.loop === 'loop' ? 'loop' : 'clamp',
		targets: Array.isArray( raw.targets ) ? raw.targets : [],
		_projectPath: raw._projectPath || null,
		_export: raw._export === true,
	};

}

async function loadProjectAnimFiles( editor ) {

	const out = [];
	const pf = editor.projectFolder;
	if ( ! pf || ! pf.hasFolder || ! pf.hasFolder() ) return out;
	if ( typeof pf.listAssetFiles !== 'function' || typeof pf.readTextFile !== 'function' ) return out;
	try {

		const names = await pf.listAssetFiles( 'assets/animations' );
		for ( const name of names || [] ) {

			if ( ! /\.anim$/i.test( name ) ) continue;
			const text = await pf.readTextFile( 'assets/animations/' + name );
			if ( ! text ) continue;
			try {

				const raw = JSON.parse( text );
				const clip = normalizeClipCandidate( raw );
				if ( clip ) {

					clip._projectPath = 'assets/animations/' + name;
					clip._export = true;
					out.push( clip );

				}

			} catch ( e ) {

				console.warn( '[FreeFilmCut] skip bad .anim', name, e );

			}

		}

	} catch ( e ) {

		console.warn( '[FreeFilmCut] list assets/animations failed', e );

	}
	return out;

}

async function collectFreecapcutAnims( editor, sceneUuids ) {

	const list = [];
	const seen = new Set();
	const candidates = [];

	if ( editor.activeFreecapcutAnim ) candidates.push( editor.activeFreecapcutAnim );
	if ( Array.isArray( editor.freecapcutAnims ) ) {

		for ( const a of editor.freecapcutAnims ) candidates.push( a );

	}
	const fromDisk = await loadProjectAnimFiles( editor );
	for ( const a of fromDisk ) candidates.push( a );

	const skippedEmpty = [];
	const skippedFiltered = [];

	for ( const raw of candidates ) {

		const clip = normalizeClipCandidate( raw );
		if ( ! clip ) continue;
		const name = clip.name;
		if ( seen.has( name ) ) continue;
		const hasKeys = clipHasKeys( clip );
		if ( ! hasKeys ) {

			if ( clip._export ) skippedEmpty.push( name );
			continue;

		}
		seen.add( name );

		const targets = filterAnimTargets( clip.targets, sceneUuids );
		if ( targets.length === 0 ) {

			// Skip clips that don't target any object in the exported scene.
			// (Old behavior packed them anyway and re-introduced deleted/orphan anims.)
			skippedFiltered.push( name );
			continue;

		}
		list.push( {
			format: clip.format,
			name,
			fps: clip.fps,
			duration: clip.duration,
			loop: clip.loop,
			targets,
			_projectPath: clip._projectPath,
		} );

	}

	return { clips: list, skippedEmpty, skippedFiltered };

}

/**
 * @param {object} editor Three.js Editor instance
 * @param {object} [opts]
 * @param {string} [opts.id]
 * @param {string} [opts.displayName]
 * @param {string} [opts.type] scene | post-effect | effect | overlay
 * @param {string} [opts.scope] below | clip | stack
 * @param {string} [opts.version]
 * @returns {Promise<{ filename: string, blob: Blob, manifest: object, scene: object }>}
 */

async function collectUIFonts( editor, nodes, pack ) {

	const fontsFolder = pack.folder( 'fonts' );
	const fontMap = new Map();
	let idx = 0;

	async function embedFont( url, preferredName ) {

		if ( ! url ) return '';
		if ( fontMap.has( url ) ) return fontMap.get( url );
		if ( typeof url === 'string' && url.startsWith( 'fonts/' ) ) {

			fontMap.set( url, url );
			return url;

		}

		let buffer = null;
		let fileName = preferredName || ( 'font_' + idx + '.ttf' );

		try {

			if ( url.startsWith( 'blob:' ) || url.startsWith( 'http://' ) || url.startsWith( 'https://' ) || url.startsWith( 'data:' ) ) {

				const res = await fetch( url );
				buffer = await res.arrayBuffer();
				const guess = ( preferredName || '' ).toLowerCase();
				if ( guess.endsWith( '.otf' ) || guess.endsWith( '.ttf' ) || guess.endsWith( '.woff' ) ) fileName = preferredName;
				else if ( url.includes( '.woff' ) ) fileName = 'font_' + idx + '.woff';
				else if ( url.includes( '.otf' ) ) fileName = 'font_' + idx + '.otf';
				else fileName = 'font_' + idx + '.ttf';

			}

		} catch ( e ) {

			console.warn( '[FreeFilmCut] font fetch failed', url, e );
			fontMap.set( url, url );
			return url;

		}

		if ( ! buffer ) {

			fontMap.set( url, url );
			return url;

		}

		const safe = String( fileName ).replace( /[^\w.\-]+/g, '_' );
		const rel = 'fonts/' + safe;
		fontsFolder.file( safe, buffer );
		fontMap.set( url, rel );
		idx += 1;
		return rel;

	}

	for ( const node of nodes ) {

		if ( ! node || ! node.ui || node.ui.type !== 'text' ) continue;

		let embedded = null;
		if ( editor && editor._fccFontBytes && node.uuid && editor._fccFontBytes.has( node.uuid ) ) {

			const entry = editor._fccFontBytes.get( node.uuid );
			const safe = ( entry.name || ( 'font_' + idx + '.ttf' ) ).replace( /[^\w.\-]+/g, '_' );
			const rel = 'fonts/' + safe;
			fontsFolder.file( safe, entry.buffer );
			embedded = rel;
			idx += 1;
			if ( node.ui.font ) fontMap.set( node.ui.font, rel );

		}

		if ( embedded ) {

			node.ui.font = embedded;
			if ( node.userData && node.userData.fccUI ) node.userData.fccUI.font = embedded;

		} else if ( node.ui.font ) {

			const rel = await embedFont( node.ui.font, node.ui.fontFileName || '' );
			node.ui.font = rel;
			if ( node.userData && node.userData.fccUI ) node.userData.fccUI.font = rel;

		}

		if ( node.ui.fontBold ) {

			const relB = await embedFont( node.ui.fontBold, '' );
			node.ui.fontBold = relB;
			if ( node.userData && node.userData.fccUI ) node.userData.fccUI.fontBold = relB;

		}

	}

}


async function collectFlowerTextures( editor, nodes, pack ) {

	const texturesFolder = pack.folder( 'textures' );
	const map = new Map(); // source path/url -> pack rel path
	let idx = 0;

	function flowerTexLeaf( s ) {

		return String( s || '' ).replace( /\\/g, '/' ).split( '/' ).pop() || '';

	}

	/** CapCut hashes often have no extension on disk while fileName carries .png */
	function flowerTexStem( s ) {

		const leaf = flowerTexLeaf( s );
		return leaf.replace( /\.(png|jpe?g|webp|gif|bmp)$/i, '' );

	}

	function flowerTexNamesMatch( a, b ) {

		if ( ! a || ! b ) return false;
		if ( a === b ) return true;
		const sa = flowerTexStem( a );
		const sb = flowerTexStem( b );
		return !! ( sa && sb && sa === sb );

	}

	function findFlowerTexBytes( path, preferredName ) {

		if ( ! editor || ! editor._fccFlowerTexBytes ) return null;
		if ( editor._fccFlowerTexBytes.has( path ) ) {
			return editor._fccFlowerTexBytes.get( path );
		}
		const want = flowerTexLeaf( preferredName ) || flowerTexLeaf( path );
		if ( ! want ) return null;
		for ( const [ key, entry ] of editor._fccFlowerTexBytes ) {
			const leaf = flowerTexLeaf( key );
			const name = entry && entry.name ? String( entry.name ) : '';
			if (
				flowerTexNamesMatch( leaf, want ) ||
				flowerTexNamesMatch( name, want )
			) {
				return entry;
			}
		}
		return null;

	}

	async function readFlowerTexFromProject( path, preferredName ) {

		const pf = editor && editor.projectFolder;
		if ( ! pf || typeof pf.readBinaryFile !== 'function' ) return null;
		const candidates = [];
		if ( path && ! path.startsWith( 'blob:' ) && ! path.startsWith( 'http' ) && ! path.startsWith( 'data:' ) ) {
			candidates.push( path );
			const stem = flowerTexStem( path );
			const leaf = flowerTexLeaf( path );
			if ( stem && stem !== leaf ) candidates.push( path.replace( /\/[^/]+$/, '/' + stem ) );
			if ( leaf && ! /\.(png|jpe?g|webp|gif|bmp)$/i.test( leaf ) ) {
				candidates.push( path + '.png' );
			}
		}
		const want = flowerTexLeaf( preferredName ) || flowerTexLeaf( path );
		const stem = flowerTexStem( want );
		if ( stem ) {
			// Bound art-text projects keep textures under assets/flower/<packId>/
			candidates.push( 'assets/flower/' + stem );
			candidates.push( 'assets/flower/' + stem + '.png' );
			candidates.push( 'assets/flower/' + want );
			// Also try any flower subdir via path still containing flower/
			const m = String( path || '' ).replace( /\\/g, '/' ).match( /(assets\/flower\/[^/]+\/)([^/]+)$/i );
			if ( m ) {
				candidates.push( m[ 1 ] + stem );
				candidates.push( m[ 1 ] + stem + '.png' );
				candidates.push( m[ 1 ] + want );
			}
		}
		const seen = new Set();
		for ( const rel of candidates ) {
			const n = String( rel || '' ).replace( /\\/g, '/' );
			if ( ! n || seen.has( n ) ) continue;
			seen.add( n );
			try {
				const bin = await pf.readBinaryFile( n );
				if ( bin && bin.buffer ) {
					return {
						buffer: bin.buffer,
						name: flowerTexLeaf( n ) || want || ( 'flower_tex_' + idx + '.png' ),
					};
				}
			} catch ( e ) { /* try next */ }
		}
		return null;

	}

	async function embedOne( path, preferredName ) {

		if ( ! path || typeof path !== 'string' ) return '';
		if ( map.has( path ) ) return map.get( path );
		if ( path.startsWith( 'textures/' ) ) {
			map.set( path, path );
			return path;
		}
		if ( path.startsWith( 'rt:' ) ) {
			map.set( path, path );
			return path;
		}

		let buffer = null;
		let fileName = preferredName || ( 'flower_tex_' + idx + '.png' );

		const cached = findFlowerTexBytes( path, preferredName );
		if ( cached && cached.buffer ) {
			buffer = cached.buffer;
			if ( cached.name ) fileName = cached.name;
		}

		if ( ! buffer ) {
			try {
				if ( path.startsWith( 'blob:' ) || path.startsWith( 'http://' ) || path.startsWith( 'https://' ) || path.startsWith( 'data:' ) ) {
					const res = await fetch( path );
					buffer = await res.arrayBuffer();
				}
			} catch ( e ) {
				console.warn( '[FreeFilmCut] flower texture fetch failed', path, e );
			}
		}

		// Revoked blob: / missing cache — read from bound project folder by fileName.
		if ( ! buffer ) {
			const fromProj = await readFlowerTexFromProject( path, preferredName );
			if ( fromProj && fromProj.buffer ) {
				buffer = fromProj.buffer;
				if ( fromProj.name ) fileName = fromProj.name;
			}
		}

		if ( ! buffer ) {
			console.warn( '[FreeFilmCut] flower texture not embedded (missing bytes)', path, preferredName );
			map.set( path, path );
			return path;
		}

		const safe = String( fileName ).replace( /[^\w.\-]+/g, '_' );
		const unique = 'flower_' + idx + '_' + safe;
		const rel = 'textures/' + unique;
		texturesFolder.file( unique, buffer );
		map.set( path, rel );
		idx += 1;
		return rel;

	}

	async function rewriteContent( content ) {
		if ( ! content || typeof content !== 'object' ) return content;
		const c = JSON.parse( JSON.stringify( content ) );
		const rt = c.renderType || c.render_type;
		if ( rt === 'texture' && c.texture && c.texture.path ) {
			if ( String( c.texture.path ).startsWith( 'rt:' ) ) {
				/* keep live RT ref */
			} else {
				const rel = await embedOne( c.texture.path, c.texture.fileName || c.texture.name || '' );
				c.texture.path = rel;
				if ( rel.startsWith( 'textures/' ) ) {
					c.texture.fileName = rel.split( '/' ).pop() || c.texture.fileName;
				}
			}
		}
		return c;
	}

	async function rewriteLayer( layer ) {
		if ( ! layer || typeof layer !== 'object' ) return layer;
		if ( layer.content ) layer.content = await rewriteContent( layer.content );
		if ( Array.isArray( layer.strokes ) ) {
			for ( let j = 0; j < layer.strokes.length; j ++ ) {
				if ( layer.strokes[ j ] && layer.strokes[ j ].content ) {
					layer.strokes[ j ].content = await rewriteContent( layer.strokes[ j ].content );
				}
			}
		}
		return layer;
	}

	async function rewriteStyle( style ) {
		if ( ! style || typeof style !== 'object' ) return style;
		const s = JSON.parse( JSON.stringify( style ) );
		if ( s.fill && s.fill.content ) s.fill.content = await rewriteContent( s.fill.content );
		if ( Array.isArray( s.strokes ) ) {
			for ( let i = 0; i < s.strokes.length; i ++ ) {
				if ( s.strokes[ i ] && s.strokes[ i ].content ) {
					s.strokes[ i ].content = await rewriteContent( s.strokes[ i ].content );
				}
			}
		}
		// Canonical stack + bucket shadows (incl. nested projection strokes).
		for ( const key of [ 'shadows', 'innerShadows', 'inner_shadows', 'stack' ] ) {
			if ( ! Array.isArray( s[ key ] ) ) continue;
			for ( let i = 0; i < s[ key ].length; i ++ ) {
				const e = s[ key ][ i ];
				if ( ! e || typeof e !== 'object' ) continue;
				if ( e.kind === 'face' ) continue;
				s[ key ][ i ] = await rewriteLayer( e );
			}
		}
		return s;
	}

	for ( const node of nodes ) {
		if ( ! node || ! node.ui || node.ui.type !== 'text' ) continue;
		if ( node.ui.flowerStyle ) {
			node.ui.flowerStyle = await rewriteStyle( node.ui.flowerStyle );
			if ( node.userData && node.userData.fccUI ) {
				node.userData.fccUI.flowerStyle = node.ui.flowerStyle;
			}
		}
	}

}


function dataUrlToBytes( dataUrl ) {

	const comma = dataUrl.indexOf( ',' );
	if ( comma < 0 ) return null;
	const bin = atob( dataUrl.slice( comma + 1 ) );
	const bytes = new Uint8Array( bin.length );
	for ( let i = 0; i < bin.length; i ++ ) bytes[ i ] = bin.charCodeAt( i );
	return bytes;

}

function loadImageElement( src ) {

	return new Promise( ( resolve, reject ) => {

		const image = new Image();
		image.onload = () => resolve( image );
		image.onerror = () => reject( new Error( 'preview image failed to load' ) );
		image.src = src;

	} );

}

async function posterToPngBytes( dataUrl ) {

	if ( dataUrl.startsWith( 'data:image/png' ) ) return dataUrlToBytes( dataUrl );
	const image = await loadImageElement( dataUrl );
	const canvas = document.createElement( 'canvas' );
	canvas.width = Math.max( 1, image.naturalWidth || image.width || 1 );
	canvas.height = Math.max( 1, image.naturalHeight || image.height || 1 );
	const ctx = canvas.getContext( '2d' );
	ctx.drawImage( image, 0, 0, canvas.width, canvas.height );
	const blob = await canvasToBlob( canvas );
	if ( ! blob ) return null;
	return new Uint8Array( await blob.arrayBuffer() );

}

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

			console.warn( '[VfxPack] poster export failed', error );

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

async function buildStickerAnimPack( editor, opts ) {

	const displayName = opts.displayName || 'Sticker animation';
	const id = opts.id || ( 'freecapcut.sticker-anim.' + slugify( displayName ) );
	const version = opts.version || '1.0.0';
	const motion = normalizeStickerMotion( editor.stickerMotion );
	const zip = new JSZip();
	const pack = zip.folder( 'pack' );
	pack.folder( 'preview' );
	const libraryPreview = await addLibraryPreview( editor, pack );
	const manifest = {
		schema: 'freecapcut.vfxpack/1',
		id,
		version,
		displayName,
		type: 'sticker-anim',
		phase: motion.phase,
		duration: motion.duration,
		motion: {
			format: 'freecapcut.sticker-motion/1',
			duration: motion.duration,
			loop: motion.loop,
			tracks: motion.tracks,
		},
		i18n: { 'zh-CN': { displayName } },
	};
	if ( libraryPreview ) manifest.preview = libraryPreview;
	pack.file( 'manifest.json', JSON.stringify( manifest, null, 2 ) );
	const blob = await zip.generateAsync( { type: 'blob', compression: 'DEFLATE' } );
	return {
		filename: slugify( id ) + '.vfxpack',
		blob,
		manifest,
		scene: null,
		animationCount: motion.tracks.length,
		animationSkippedEmpty: [],
		animationSkippedFiltered: [],
	};

}

async function buildVfxPack( editor, opts = {} ) {

	const scene = editor.scene;
	const displayName = opts.displayName || scene.name || 'Untitled Pack';
	const packType = normalizePackType( opts.type || ( editor.config && editor.config.getKey( 'project/vfxpack/type' ) ) || 'effect' );
	const id = opts.id || (
		packType === 'sticker-anim'
			? ( 'freecapcut.sticker-anim.' + slugify( displayName ) )
			: packType === 'text-anim'
				? ( 'freecapcut.text-anim.' + slugify( displayName ) )
				: packType === 'clip-anim'
					? ( 'freecapcut.clip-anim.' + slugify( displayName ) )
					: ( 'freecapcut.' + slugify( displayName ) )
	);
	if ( packType === 'sticker-anim' ) {

		return buildStickerAnimPack( editor, { ...opts, id, displayName, version: opts.version } );

	}
	// clip-anim intentionally uses the full scene build path below (not sticker/text thin packs).
	if ( packType === 'text-template' ) {

		throw new Error(
			'text-template packs must use TextTemplatePackExporter. ' +
			'Use the VfxPack toolbar / File→Export VfxPack (auto-routes by pack type), or File→Export Text Template. ' +
			'Generic VfxPackExporter omits manifest.textTemplate (clip cannot apply flower/stickers/media/PP).'
		);

	}
	if ( packType === 'text-anim' ) {

		const phaseRaw = ( editor.config && editor.config.getKey( 'project/vfxpack/stickerAnimPhase' ) ) || 'in';
		const category = phaseRaw === 'out' || phaseRaw === 'loop' ? phaseRaw : 'in';
		const textResult = await buildTextAnimPack( editor, {
			...opts,
			id: id || ( 'freecapcut.text-anim.' + slugify( displayName ) ),
			displayName,
			category,
			version: opts.version,
		} );
		const man = textResult && textResult.manifest;
		if ( ! man || man.type !== 'text-anim' || ! man.textAnim ) {

			throw new Error(
				'text-anim export failed: expected manifest.type=text-anim + textAnim payload, got type='
				+ ( man && man.type ),
			);

		}
		return {
			...textResult,
			animationCount: textResult.trackCount || textResult.componentCount || 0,
			animationSkippedEmpty: [],
			animationSkippedFiltered: [],
		};

	}
	const scope = opts.scope || 'below';
	const version = opts.version || '0.1.0';

	const zip = new JSZip();
	const pack = zip.folder( 'pack' );
	const texturesFolder = pack.folder( 'textures' );
	const videosFolder = pack.folder( 'videos' );
	const shadersFolder = pack.folder( 'shaders' );
	const geometriesFolder = pack.folder( 'geometries' );
	const previewFolder = pack.folder( 'preview' );
	const geometryRefs = new Map(); // geometry.uuid -> geometries/... path

	const textureMap = new Map(); // texture.uuid -> entry

	// First pass: gather textures from materials, background, environment
	if ( scene.background && scene.background.isTexture ) {

		textureMap.set( scene.background.uuid, scene.background );

	}

	if ( scene.environment && scene.environment.isTexture ) {

		textureMap.set( scene.environment.uuid, scene.environment );

	}

	scene.traverse( ( object ) => {

		const mat = object.material;
		if ( ! mat ) return;
		const mats = Array.isArray( mat ) ? mat : [ mat ];
		for ( const m of mats ) {

			for ( const key of TEXTURE_MAP_KEYS ) {

				if ( m[ key ] && m[ key ].isTexture ) {

					textureMap.set( m[ key ].uuid, m[ key ] );

				}

			}

			if ( ( m.isShaderMaterial || m.isRawShaderMaterial ) && m.uniforms ) {

				for ( const [ ukey, u ] of Object.entries( m.uniforms ) ) {

					// Editor-only preview samplers — NLE binds the real frames.
					if ( isBelowInputUniformName( ukey ) || isTransitionInputUniformName( ukey ) ) continue;
					if ( u && u.value && u.value.isTexture ) {

						if ( u.value.userData && u.value.userData.editorBelowPreview ) continue;
						textureMap.set( u.value.uuid, u.value );

					}

				}

			}

		}

	} );


	// Live RT textures must keep fccRenderTextureUuid so they pack as rt:<objectUuid>,
	// not as empty PNG placeholders.
	scene.traverse( ( object ) => {

		if ( ! object.userData || ! object.userData.fccRenderTexture ) return;
		const rt = object.__fccRT;
		if ( rt && rt.texture ) {

			rt.texture.userData = rt.texture.userData || {};
			rt.texture.userData.fccRenderTextureUuid = object.uuid;
			rt.texture.name = object.name || 'RenderTexture';
			textureMap.set( rt.texture.uuid, rt.texture );

		}

	} );

	const textureRefs = new Map();
	for ( const tex of textureMap.values() ) {

		const entry = await collectTexture( tex, textureRefs, texturesFolder );
		if ( entry ) textureRefs.set( tex.uuid, entry );

	}

	// Extract custom ShaderMaterial / RawShaderMaterial GLSL into shaders/
	const shaderRefs = new Map(); // material.uuid -> { vertexPath, fragmentPath, name }
	const shaderAssetPaths = [];

	scene.traverse( ( object ) => {

		const mat = object.material;
		if ( ! mat ) return;
		const mats = Array.isArray( mat ) ? mat : [ mat ];

		for ( const m of mats ) {

			if ( ! ( m.isShaderMaterial || m.isRawShaderMaterial ) ) continue;
			if ( shaderRefs.has( m.uuid ) ) continue;

			const base = `mat_${ shaderRefs.size }_${ slugify( m.name || m.uuid.slice( 0, 8 ) ) }`;
			const vertexPath = `shaders/${ base }.vert.glsl`;
			const fragmentPath = `shaders/${ base }.frag.glsl`;
			const vertSrc = m.vertexShader || '';
			const fragSrc = m.fragmentShader || '';

			shadersFolder.file( `${ base }.vert.glsl`, vertSrc );
			shadersFolder.file( `${ base }.frag.glsl`, fragSrc );
			shaderAssetPaths.push( vertexPath, fragmentPath );
			shaderRefs.set( m.uuid, {
				name: m.name || base,
				vertexPath,
				fragmentPath,
				raw: !! m.isRawShaderMaterial
			} );

		}

	} );

	const videoPathByUuid = new Map();
	const videoAssetPaths = [];
	const videoPlayers = [];
	scene.traverse( ( object ) => {

		if ( object.userData && object.userData.fccVideoPlayer ) videoPlayers.push( object );

	} );
	for ( const object of videoPlayers ) {

		const vp = object.userData.fccVideoPlayer;
		if ( vp && ( vp.kind === 'gif' || vp.kind === 'imageSequence' ) ) continue;
		let bytes = object.__fccVideoBytes;
		const pf = editor.projectFolder;
		const tryPaths = [];
		if ( vp.projectPath ) tryPaths.push( vp.projectPath );
		if ( vp.fileName ) {

			tryPaths.push( 'assets/videos/' + String( vp.fileName ).split( /[/\\]/ ).pop() );

		}
		if ( ! bytes && pf && typeof pf.readBinaryFile === 'function' ) {

			for ( const rel of tryPaths ) {

				try {

					const bin = await pf.readBinaryFile( rel );
					if ( bin && bin.buffer ) {

						bytes = bin.buffer;
						if ( bin.name ) vp.fileName = bin.name;
						vp.projectPath = rel;
						object.__fccVideoBytes = bytes;
						break;

					}

				} catch ( e ) { /* try next */ }

			}

		}
		if ( ! bytes ) {

			console.warn( '[FreeFilmCut] video player has no media to pack', object.name || object.uuid, tryPaths );
			continue;

		}
		const rawName = String( vp.fileName || 'video.mp4' ).split( /[/\\]/ ).pop() || 'video.mp4';
		const extMatch = rawName.match( /\.(mp4|webm|mov|ogv|ogg)$/i );
		const ext = extMatch ? extMatch[ 0 ].toLowerCase() : '.mp4';
		const base = slugify( rawName.replace( /\.[^.]+$/, '' ) ) || 'video';
		const fileName = `${ object.uuid.slice( 0, 8 ) }_${ base }${ ext }`;
		const rel = `videos/${ fileName }`;
		videosFolder.file( fileName, new Uint8Array( bytes ) );
		videoPathByUuid.set( object.uuid, rel );
		videoAssetPaths.push( rel );

	}


	// GIF players → media/ (same map as videoPathByUuid)
	for ( const object of videoPlayers ) {

		const vp = object.userData.fccVideoPlayer || {};
		if ( vp.kind !== 'gif' ) continue;
		if ( videoPathByUuid.has( object.uuid ) ) continue;
		let bytes = object.__fccGifBytes;
		const pf = editor.projectFolder;
		const tryPaths = [];
		if ( vp.projectPath ) tryPaths.push( vp.projectPath );
		if ( vp.fileName ) tryPaths.push( 'assets/textures/' + String( vp.fileName ).split( /[/\\]/ ).pop() );
		if ( ! bytes && pf && typeof pf.readBinaryFile === 'function' ) {

			for ( const rel of tryPaths ) {

				try {

					const bin = await pf.readBinaryFile( rel );
					if ( bin && bin.buffer ) {

						bytes = bin.buffer;
						vp.fileName = bin.name || vp.fileName;
						vp.projectPath = rel;
						object.__fccGifBytes = bytes;
						break;

					}

				} catch ( e ) { /* next */ }

			}

		}
		if ( ! bytes ) {

			console.warn( '[FreeFilmCut] gif player has no media to pack', object.name || object.uuid );
			continue;

		}
		const rawName = String( vp.fileName || 'anim.gif' ).split( /[/\\]/ ).pop() || 'anim.gif';
		const base = slugify( rawName.replace( /\.[^.]+$/, '' ) ) || 'gif';
		const fileName = `${ object.uuid.slice( 0, 8 ) }_${ base }.gif`;
		const rel = `media/${ fileName }`;
		const mediaFolder = pack.folder( 'media' );
		mediaFolder.file( fileName, new Uint8Array( bytes ) );
		videoPathByUuid.set( object.uuid, rel );
		videoAssetPaths.push( rel );

	}

	// Image sequences → sequences/{uuid}/
	for ( const object of videoPlayers ) {

		const vp = object.userData.fccVideoPlayer || {};
		if ( vp.kind !== 'imageSequence' ) continue;
		if ( videoPathByUuid.has( object.uuid ) ) continue;
		const seq = object.__fccSeq;
		const names = seq && seq.names ? seq.names.slice() : [];
		const pf = editor.projectFolder;
		const dir = vp.sequenceDir || vp.projectPath || '';
		if ( ! names.length && pf && dir && typeof pf.listAssetFiles === 'function' ) {

			const listed = await pf.listAssetFiles( dir );
			for ( const n of listed || [] ) {

				if ( /\.(png|jpe?g|webp|bmp|gif)$/i.test( n ) ) names.push( n );

			}
			names.sort( ( a, b ) => a.localeCompare( b, undefined, { numeric: true, sensitivity: 'base' } ) );

		}
		if ( ! names.length ) {

			console.warn( '[FreeFilmCut] sequence player has no frames to pack', object.name || object.uuid );
			continue;

		}
		const seqFolderName = object.uuid.slice( 0, 8 ) + '_seq';
		const seqFolder = pack.folder( 'sequences/' + seqFolderName );
		let packed = 0;
		for ( const name of names ) {

			let bytes = null;
			if ( seq && seq.fileMap && seq.fileMap.has( name ) ) {

				const f = seq.fileMap.get( name );
				if ( f && typeof f.arrayBuffer === 'function' ) bytes = await f.arrayBuffer();
				else if ( f instanceof ArrayBuffer ) bytes = f;

			}
			if ( ! bytes && pf && dir && typeof pf.readBinaryFile === 'function' ) {

				try {

					const bin = await pf.readBinaryFile( dir.replace( /\\/g, '/' ).replace( /\/$/, '' ) + '/' + name );
					if ( bin && bin.buffer ) bytes = bin.buffer;

				} catch ( e ) { /* skip */ }

			}
			if ( ! bytes ) continue;
			seqFolder.file( name, new Uint8Array( bytes ) );
			packed ++;

		}
		if ( ! packed ) {

			console.warn( '[FreeFilmCut] sequence pack wrote 0 frames', object.name || object.uuid );
			continue;

		}
		const rel = 'sequences/' + seqFolderName;
		videoPathByUuid.set( object.uuid, rel );
		videoAssetPaths.push( rel + '/' );

	}

	// Custom post-effects: pack image textures + keep definition (shaders inline)
	const customDefsById = collectCustomEffectDefsFromScene( scene );
	const customEffectAssetPaths = await packCustomEffectAssets( editor, customDefsById, pack );
	const customEffectsList = Array.from( customDefsById.values() );

	// Build scene graph
	const nodes = [];
	const nodeByUuid = new Map();

	scene.traverse( ( object ) => {

		// Skip editor helpers if tagged
		if ( object.userData && object.userData.editorHelper ) return;
		// Image child mesh is serialized on the UI Image group — skip as its own node.
		if ( object.name === '__fccImageMesh' && object.parent && object.parent.userData && object.parent.userData.fccUI ) return;

		const kind = detectNodeKind( object );
		const node = {
			uuid: object.uuid,
			name: object.name || '',
			kind,
			type: object.type,
			visible: object.visible,
			layers: object.layers ? object.layers.mask : undefined,
			parent: object.parent && object.parent !== scene ? object.parent.uuid : null,
			transform: {
				position: vec3ToArray( object.position ),
				rotation: vec3ToArray( object.rotation ), // euler xyz
				quaternion: quatToArray( object.quaternion ),
				scale: vec3ToArray( object.scale ),
				matrix: mat4ToArray( object.matrix )
			},
			userData: object.userData ? { ...object.userData } : {}
		};

		if ( kind === 'videoPlayer' ) {

			const vp = object.userData.fccVideoPlayer || {};
			const mediaKind = vp.kind === 'gif' || vp.kind === 'imageSequence' ? vp.kind : 'video';
			node.video = {
				path: videoPathByUuid.get( object.uuid ) || '',
				loop: vp.loop !== false,
				muted: vp.muted === true,
				volume: Number.isFinite( Number( vp.volume ) ) ? Number( vp.volume ) : 1,
				playbackRate: ( Number.isFinite( Number( vp.playbackRate ) ) && Number( vp.playbackRate ) > 0 ) ? Number( vp.playbackRate ) : 1,
				autoplay: vp.autoplay === true,
				targetUuid: vp.targetUuid || '',
				kind: mediaKind,
				sequenceFps: Number( vp.sequenceFps ) || 30,
				sequenceDir: vp.sequenceDir || '',
				sequenceStart: Number( vp.sequenceStart ) || 0,
				sequenceEnd: Number.isFinite( Number( vp.sequenceEnd ) ) ? Number( vp.sequenceEnd ) : -1,
			};

		}

		if ( kind === 'camera' ) {

			Object.assign( node, serializeCameraExtras( object, customDefsById ) );
			// Prefer node.postProcess (with packed defs); keep userData stack in sync.
			if ( node.postProcess && node.userData ) {

				node.userData = { ...node.userData, postProcessStack: node.postProcess };

			}

		}

		if ( kind === 'light' ) Object.assign( node, serializeLightExtras( object ) );

		if ( kind === 'mesh' || kind === 'sprite' || kind === 'points' || kind === 'line' ) {

			node.geometry = serializeGeometry( object.geometry, geometriesFolder, geometryRefs );
			node.materials = serializeMaterial( object.material, textureRefs, shaderRefs );
			node.castShadow = !! object.castShadow;
			node.receiveShadow = !! object.receiveShadow;

		}

				if ( kind === 'ui' ) {

			const fcc = ( object.userData && object.userData.fccUI ) ? object.userData.fccUI : {};
			node.ui = {
				type: fcc.type || 'image',
				anchorMin: Array.isArray( fcc.anchorMin ) ? [ ...fcc.anchorMin ] : [ 0.5, 0.5 ],
				anchorMax: Array.isArray( fcc.anchorMax ) ? [ ...fcc.anchorMax ] : [ 0.5, 0.5 ],
				pivot: Array.isArray( fcc.pivot ) ? [ ...fcc.pivot ] : [ 0.5, 0.5 ],
				anchoredPosition: Array.isArray( fcc.anchoredPosition ) ? [ ...fcc.anchoredPosition ] : [ 0, 0 ],
				sizeDelta: Array.isArray( fcc.sizeDelta ) ? [ ...fcc.sizeDelta ] : [ 200, 200 ],
				localEulerAngles: Array.isArray( fcc.localEulerAngles ) && fcc.localEulerAngles.length >= 3
					? [ Number( fcc.localEulerAngles[ 0 ] ) || 0, Number( fcc.localEulerAngles[ 1 ] ) || 0, Number( fcc.localEulerAngles[ 2 ] ) || 0 ]
					: [ 0, 0, 0 ],
				localScale: Array.isArray( fcc.localScale ) && fcc.localScale.length >= 3
					? [ Number( fcc.localScale[ 0 ] ) || 1, Number( fcc.localScale[ 1 ] ) || 1, Number( fcc.localScale[ 2 ] ) || 1 ]
					: [ 1, 1, 1 ],
				renderMode: ( fcc.renderMode === 'camera' ) ? 'camera' : 'overlay',
				cameraUuid: fcc.cameraUuid || null,
				planeDistance: ( fcc.planeDistance !== undefined && fcc.planeDistance !== null )
					? Number( fcc.planeDistance ) : 100
			};
			if ( fcc.type === 'text' ) {

				node.ui.text = fcc.text != null ? String( fcc.text ) : '';
				node.ui.font = fcc.font || '';
				node.ui.fontBold = fcc.fontBold || '';
				node.ui.fontFileName = fcc.fontFileName || '';
				node.ui.fontSize = Number( fcc.fontSize ) || 48;
				node.ui.bold = !! fcc.bold;
				node.ui.color = fcc.color || '#ffffff';
				node.ui.letterSpacing = Number( fcc.letterSpacing ) || 0;
				node.ui.lineHeight = Number( fcc.lineHeight ) > 0 ? Number( fcc.lineHeight ) : 1.2;
				node.ui.align = fcc.align || 'center';
				node.ui.verticalAlign = fcc.verticalAlign || 'middle';
				node.ui.outline = fcc.outline ? { ...fcc.outline } : { enabled: false, width: 2, color: '#000000', opacity: 1 };
				node.ui.shadow = fcc.shadow ? { ...fcc.shadow } : { enabled: false, offsetX: 2, offsetY: -2, blur: 4, color: '#000000', opacity: 0.75 };
				if ( fcc.flowerStyle && typeof fcc.flowerStyle === 'object' ) {

					try {

						node.ui.flowerStyle = JSON.parse( JSON.stringify( fcc.flowerStyle ) );

					} catch ( e ) {

						node.ui.flowerStyle = fcc.flowerStyle;

					}

				}
				if ( fcc.flowerBaseFontSize != null && Number( fcc.flowerBaseFontSize ) > 0 ) {

					node.ui.flowerBaseFontSize = Number( fcc.flowerBaseFontSize );

				}

			}

			// Mirror mode fields onto node.userData.fccUI for OpenCut rebuild (do not mutate live scene).
			node.userData = {
				...( object.userData || {} ),
				fccUI: { ...( ( object.userData && object.userData.fccUI ) || {} ), ...node.ui }
			};
			// Keep fccUI on userData for OpenCut rebuild; also serialize materials for Image.
			// Image may be a Mesh (legacy) or Group + __fccImageMesh (size on child).
			if ( fcc.type === 'image' ) {

				const imgMesh = object.isMesh
					? object
					: ( object.getObjectByName && object.getObjectByName( '__fccImageMesh' ) );
				if ( imgMesh && imgMesh.isMesh ) {

					node.geometry = { uuid: imgMesh.geometry ? imgMesh.geometry.uuid : '', type: 'PlaneGeometry', parameters: { width: 1, height: 1 } };
					node.materials = serializeMaterial( imgMesh.material, textureRefs, shaderRefs );
					node.castShadow = false;
					node.receiveShadow = false;

				}

			}

		}

		if ( object.animations && object.animations.length > 0 ) {

			node.animations = object.animations.map( ( clip ) => ( {
				name: clip.name,
				duration: clip.duration,
				tracks: clip.tracks.length
			} ) );

		}

		nodes.push( node );
		nodeByUuid.set( object.uuid, node );

	} );

	// Active camera from editor
	let activeCameraUuid = null;
	if ( editor.viewportCamera ) {

		activeCameraUuid = editor.viewportCamera.uuid;

	} else if ( editor.camera ) {

		activeCameraUuid = editor.camera.uuid;

	}

	const renderSettings = serializeRenderSettings( editor );
	const backgroundJson = await serializeBackground( scene, textureRefs, texturesFolder );
	const environmentJson = await serializeEnvironment( editor, scene, textureRefs, texturesFolder );
	const fogJson = serializeFog( scene.fog );

	const textureAssetList = Array.from( textureRefs.values() ).map( ( t ) => ( {
		uuid: t.uuid,
		name: t.name,
		path: t.path,
		exported: t.exported,
		wrapS: t.wrapS,
		wrapT: t.wrapT,
		magFilter: t.magFilter,
		minFilter: t.minFilter,
		flipY: t.flipY,
		colorSpace: t.colorSpace
	} ) );

	const sceneJson = {
		schema: 'vfxpack-scene/1.1',
		name: scene.name || displayName,
		background: backgroundJson,
		environment: environmentJson,
		fog: fogJson,
		render: renderSettings,
		activeCamera: activeCameraUuid,
		nodes,
		assets: {
			textures: textureAssetList,
			shaders: Array.from( shaderRefs.values() ).map( ( s ) => ( {
				name: s.name,
				vertex: s.vertexPath,
				fragment: s.fragmentPath,
				raw: s.raw
			} ) ),
			geometries: Array.from( geometryRefs.entries() ).map( ( [ uuid, path ] ) => ( {
				uuid,
				path
			} ) )
		},
		resolution: {
			width: Math.max( 1, parseInt( editor.config.getKey( 'project/resolution/width' ), 10 ) || 1920 ),
			height: Math.max( 1, parseInt( editor.config.getKey( 'project/resolution/height' ), 10 ) || 1080 )
		},
		meta: {
			generator: 'FreeFilmCut Three.js Editor VfxPackExporter',
			threeSceneUuid: scene.uuid,
			exportedAt: new Date().toISOString(),
			nodeCount: nodes.length,
			textureCount: textureRefs.size,
			shaderCount: shaderRefs.size
		}
	};


	// Keep a documented placeholder only when the pack has no custom ShaderMaterials
	if ( shaderRefs.size === 0 ) {

		const placeholderFrag = `// FreeFilmCut vfxpack shader placeholder (MVP)
// No ShaderMaterial in this pack. Add one in the Editor (Material type →ShaderMaterial)
// then Export VfxPack to embed real GLSL under shaders/.
precision mediump float;
uniform sampler2D uInput;
uniform vec2 uResolution;
varying vec2 vUv;
void main() {
  vec4 c = texture2D( uInput, vUv );
  gl_FragColor = c;
}
`;

		const placeholderVert = `varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

		shadersFolder.file( 'placeholder.frag.glsl', placeholderFrag );
		shadersFolder.file( 'placeholder.vert.glsl', placeholderVert );
		shaderAssetPaths.push( 'shaders/placeholder.vert.glsl', 'shaders/placeholder.frag.glsl' );

	}

	shadersFolder.file( 'README.txt',
		'Custom GLSL from Editor ShaderMaterial / RawShaderMaterial is written as mat_*.vert.glsl / mat_*.frag.glsl.\n' +
		'Edit shaders in Material →Program (Vert / Frag / Info). NLE loads Three.js-compatible GLSL.\n'
	);

		previewFolder.file( 'README.txt',
		'Optional: thumb.webp / demo.mp4 for pack gallery in FreeFilmCut.\n'
	);


	// FreeFilmCut .anim →pack/animations/*.anim + manifest.animations
	const sceneUuidSet = new Set( nodes.map( ( n ) => n.uuid ) );
	const animCollect = await collectFreecapcutAnims( editor, sceneUuidSet );
	const animClips = animCollect.clips || [];
	const animationsFolder = pack.folder( 'animations' );
	const animManifestEntries = [];
	const animAssetPaths = [];
	for ( let i = 0; i < animClips.length; i ++ ) {

		const clip = animClips[ i ];
		const safe = slugify( clip.name || ( 'anim_' + i ) ) || ( 'anim_' + i );
		const rel = 'animations/' + safe + '.anim';
		const body = {
			format: clip.format,
			name: clip.name,
			fps: clip.fps,
			duration: clip.duration,
			loop: clip.loop,
			targets: clip.targets,
		};
		animationsFolder.file( safe + '.anim', JSON.stringify( body, null, 2 ) );
		animAssetPaths.push( rel );
		animManifestEntries.push( {
			name: clip.name,
			path: rel,
			fps: clip.fps,
			duration: clip.duration,
			loop: clip.loop,
			objectUuids: clip.targets.map( ( t ) => t.objectUuid ),
		} );

	}
	sceneJson.assets.animations = animAssetPaths.slice();
	sceneJson.meta.animationCount = animClips.length;
	sceneJson.meta.animationSkippedEmpty = animCollect.skippedEmpty || [];
	sceneJson.meta.animationSkippedFiltered = animCollect.skippedFiltered || [];

	const timelinesFolder = pack.folder( 'timelines' );
	const timelineAssetPaths = [];
	const timelineManifestEntries = [];
	let timelineMaxDuration = 0;
	const timelineObjects = [];
	scene.traverse( ( o ) => {

		if ( o.userData && o.userData.fccTimeline ) timelineObjects.push( o );

	} );
	for ( const object of timelineObjects ) {

		const ud = object.userData.fccTimeline;
		let asset = object.__fccTimelineAsset || null;
		if ( ! asset && ud.projectPath && editor.projectFolder && typeof editor.projectFolder.readTextFile === 'function' ) {

			try {

				const text = await editor.projectFolder.readTextFile( ud.projectPath );
				if ( text ) asset = JSON.parse( text );

			} catch ( e ) {

				console.warn( '[FreeFilmCut] timeline pack read', e );

			}

		}
		if ( ! asset || typeof asset !== 'object' ) {

			asset = {
				format: 'freecapcut-timeline/1',
				name: object.name || 'Timeline',
				fps: ud.fps || 30,
				duration: Number( ud.duration ) || 1,
				loop: ud.loop === 'loop' ? 'loop' : 'clamp',
				tracks: [],
			};

		}
		const safe = slugify( asset.name || object.name || 'timeline' ) || 'timeline';
		const fileName = safe + '.timeline.json';
		const rel = 'timelines/' + fileName;
		timelinesFolder.file( fileName, JSON.stringify( asset, null, 2 ) );
		timelineAssetPaths.push( rel );
		timelineManifestEntries.push( {
			name: asset.name,
			path: rel,
			fps: asset.fps,
			duration: asset.duration,
			loop: asset.loop,
			objectUuid: object.uuid,
		} );
		timelineMaxDuration = Math.max( timelineMaxDuration, Number( asset.duration ) || 0 );
		const node = nodeByUuid.get( object.uuid );
		if ( node ) {

			node.kind = 'timeline';
			node.timeline = { path: rel };

		}

	}
	if ( ! sceneJson.assets ) sceneJson.assets = {};
	sceneJson.assets.timelines = timelineAssetPaths.slice();
	sceneJson.meta.timelineCount = timelineManifestEntries.length;

	const libraryPreview = await addLibraryPreview( editor, pack );

	const exposedParams = collectExposedParamsFromScene( {
		scene,
		getEffectDescriptor,
	} );
	const manifestParams = exposedParams.length > 0
		? exposedParamsToManifestParams( exposedParams )
		: [ { key: 'intensity', label: 'Intensity', type: 'float', default: 1, min: 0, max: 1 } ];

	const manifest = {
		schema: 'vfxpack/1.2',
		id,
		version,
		displayName,
		engine: {
			api: 'webgl2',
			renderer: 'three'
		},
		type: packType,
		scope,
		resolution: {
			width: Math.max( 1, parseInt( editor.config.getKey( 'project/resolution/width' ), 10 ) || 1920 ),
			height: Math.max( 1, parseInt( editor.config.getKey( 'project/resolution/height' ), 10 ) || 1080 )
		},
		render: renderSettings,
		entry: {
			scene: 'scene.json'
		},
		params: manifestParams,
		exposedParams,
		passes: ( () => {

			const first = shaderRefs.size > 0 ? shaderRefs.values().next().value : null;
			const vertex = first ? first.vertexPath : 'shaders/placeholder.vert.glsl';
			const fragment = first ? first.fragmentPath : 'shaders/placeholder.frag.glsl';
			return [ {
				id: 'main',
				shader: { vertex, fragment },
				inputs: { uInput: 'accumBelow' }
			} ];

		} )(),
		assets: {
			scene: 'scene.json',
			textures: sceneJson.assets.textures.map( ( t ) => t.path ),
			shaders: shaderAssetPaths.slice(),
			animations: animAssetPaths.slice(),
			timelines: timelineAssetPaths.slice(),
			videos: videoAssetPaths.slice(),
			customEffectTextures: customEffectAssetPaths.slice(),
			background: backgroundJson && backgroundJson.path ? backgroundJson.path : null,
			environment: environmentJson && environmentJson.path ? environmentJson.path : null
		},
		animations: animManifestEntries,
		timelines: timelineManifestEntries,
		i18n: {
			'zh-CN': { displayName }
		},
		meta: {
			generator: 'FreeFilmCut Three.js Editor VfxPackExporter',
			exportedAt: sceneJson.meta.exportedAt,
			hasCustomShaders: shaderRefs.size > 0,
			shaderCount: shaderRefs.size,
			animationCount: animClips.length,
			timelineCount: timelineManifestEntries.length,
			customEffectCount: customEffectsList.length
		}
	};
	if ( packType === 'clip-anim' ) {

		manifest.phase = clipAnimPhaseFromConfig( editor );

	}
	if ( customEffectsList.length > 0 ) {

		// Pack-level registry payload for NLE loadCustomDefinitions (P3).
		manifest.customEffects = customEffectsList;

	}

	if ( timelineManifestEntries.length > 0 ) manifest.duration = Math.max( 0.01, timelineMaxDuration );
	if ( libraryPreview ) manifest.preview = libraryPreview;


	sceneJson.exposedParams = exposedParams;
	sceneJson.schema = 'vfxpack-scene/1.2';
	manifest.schema = 'vfxpack/1.3';
	pack.file( 'manifest.json', JSON.stringify( manifest, null, 2 ) );
	await collectUIFonts( editor, nodes, pack );
	await collectFlowerTextures( editor, nodes, pack );

	pack.file( 'scene.json', JSON.stringify( sceneJson, null, 2 ) );

	const blob = await zip.generateAsync( { type: 'blob', compression: 'DEFLATE' } );
	const filename = `${ slugify( id ) }.vfxpack`;

	return {
		filename,
		blob,
		manifest,
		scene: sceneJson,
		animationCount: animClips.length,
		animationSkippedEmpty: animCollect.skippedEmpty || [],
		animationSkippedFiltered: animCollect.skippedFiltered || [],
	};

}


/**
 * Build Chinese/EN summary line(s) about packed animations for the export alert.
 */
function formatVfxPackExportMessage( result, strings ) {

	const get = ( k, fb ) => ( strings && strings.getKey && strings.getKey( k ) ) || fb;
	const lines = [];
	const manType = result && result.manifest && result.manifest.type;
	if ( manType ) lines.push( 'type: ' + manType );
	if ( manType === 'text-anim' ) {

		lines.push( 'textanim-pack/1 — put under vfxpacks/text-anims/{入场|出场|循环}/' );

	}
	if ( manType === 'clip-anim' ) {

		const phase = ( result && result.manifest && result.manifest.phase ) || 'in';
		lines.push( 'clip-anim — put under vfxpacks/clip-anims/' + phase + '/' );

	}
	const n = ( result && result.animationCount != null )
		? result.animationCount
		: ( result && result.manifest && Array.isArray( result.manifest.animations )
			? result.manifest.animations.length
			: 0 );
	lines.push( get( 'prompt/file/export/animCount', 'Animations packed' ) + ': ' + n );
	if ( n === 0 ) {

		lines.push( get(
			'prompt/file/export/animNoneHint',
			'No .anim packed. Add keys in View \u2192 Animation, or save .anim under assets/animations/.',
		) );

	}
	const skipped = ( result && result.animationSkippedFiltered ) || [];
	if ( skipped.length ) {

		lines.push( get( 'prompt/file/export/animSkipped', 'Skipped (no usable targets)' ) + ': ' + skipped.join( ', ' ) );

	}
	return lines.join( '\n' );

}

async function exportVfxPack( editor, saveFn, opts = {} ) {

	const requested = normalizePackType(
		opts.type || ( editor.config && editor.config.getKey( 'project/vfxpack/type' ) ) || 'effect',
	);
	const result = await buildVfxPack( editor, { ...opts, type: requested } );
	const got = result && result.manifest && result.manifest.type;
	if ( requested === 'text-anim' && got !== 'text-anim' ) {

		throw new Error( 'Export type mismatch: requested text-anim, got ' + got );

	}

	// Prefer project exports/ folder when a local project is bound
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

			console.warn( '[FreeFilmCut] exports/ write failed, falling back to download:', e );

		}

	}

	saveFn( result.blob, result.filename );
	result.savedToProject = false;
	return result;

}

function promptExportOptions( editor ) {

	// Single dialog: pack name only (e.g. glow, 3D cube).
	// type comes from Project -> VFX PACK settings (localStorage).
	const strings = editor.strings;
	const untitled = ( strings && strings.getKey( 'prompt/file/untitledProject' ) ) || 'Untitled Project';
	const fromProject = ( editor.getProjectTitle && editor.getProjectTitle() )
		|| editor.config.getKey( 'project/title' )
		|| '';
	const defaultName = ( fromProject && String( fromProject ).trim() )
		|| editor.scene.name
		|| untitled
		|| 'MyPack';
	const type = normalizePackType( editor.config.getKey( 'project/vfxpack/type' ) );
	const typeLabel = ( strings && strings.getKey( 'sidebar/project/vfxpack/type/' + type ) ) || type;
	const baseLabel = ( strings && strings.getKey( 'prompt/file/export/vfxpackName' ) ) || 'VfxPack name';
	const promptLabel = baseLabel + '  [' + typeLabel + ' / ' + type + ']';
	if ( type === 'text-anim' ) {

		const ok = window.confirm(
			'当前包类型是「文字动画」(text-anim)。\n'
			+ '将导出 clip 文字动画库包（textanim-pack/1），不是整场景 effect。\n'
			+ '相位/分类取自 Project → Phase（入场/出场/循环）。\n\n'
			+ '若要导出整场景特效，请先把包类型改成「特效」。\n\n继续？',
		);
		if ( ! ok ) return null;

	}
	if ( type === 'clip-anim' ) {

		const phase = clipAnimPhaseFromConfig( editor );
		const ok = window.confirm(
			'当前包类型是「片段动画」(clip-anim)。\n'
			+ '将导出整场景 clip-anim 包（scope=below，采样 uInput）。\n'
			+ '相位 = ' + phase + ' → 放到 vfxpacks/clip-anims/' + phase + '/\n'
			+ '并写入该目录 index.json。\n\n'
			+ '继续？',
		);
		if ( ! ok ) return null;

	}
	const entered = window.prompt( promptLabel, defaultName );
	if ( entered === null ) return null;

	const displayName = entered.trim() || defaultName;
	let id;
	if ( type === 'sticker-anim' ) {
		id = 'freecapcut.sticker-anim.' + slugify( displayName );
	} else if ( type === 'text-anim' ) {
		id = 'freecapcut.text-anim.' + slugify( displayName );
	} else if ( type === 'clip-anim' ) {
		id = 'freecapcut.clip-anim.' + slugify( displayName );
	} else {
		id = 'freecapcut.' + slugify( displayName );
	}

	return {
		displayName,
		id,
		type,
		scope: defaultScopeForType( type )
	};

}

export { buildVfxPack, exportVfxPack, promptExportOptions, formatVfxPackExportMessage, normalizePackType, PACK_TYPES };
