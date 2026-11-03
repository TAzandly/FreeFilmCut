	const renderSettings = serializeRenderSettings( editor );
	const backgroundJson = await serializeBackground( scene, textureRefs, texturesFolder );
	const environmentJson = await serializeEnvironment( scene, textureRefs, texturesFolder );
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

