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
		params: [
			{
				key: 'intensity',
				label: 'Intensity',
				type: 'float',
				default: 1,
				min: 0,
				max: 1
			}
		],
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
			background: backgroundJson && backgroundJson.path ? backgroundJson.path : null,
			environment: environmentJson && environmentJson.path ? environmentJson.path : null
		},
		i18n: {
			'zh-CN': { displayName }
		},
		meta: {
			generator: 'FreeFilmCut Three.js Editor VfxPackExporter',
			exportedAt: sceneJson.meta.exportedAt,
			hasCustomShaders: shaderRefs.size > 0,
			shaderCount: shaderRefs.size
		}
	};

