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

async function serializeEnvironment( scene, textureRefs, texturesFolder ) {

	const env = scene.environment;
	if ( env == null ) {

		return { type: 'None', value: null };

	}

	if ( env.isTexture ) {

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

