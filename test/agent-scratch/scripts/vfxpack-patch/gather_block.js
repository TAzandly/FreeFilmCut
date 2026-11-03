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

				for ( const u of Object.values( m.uniforms ) ) {

					if ( u && u.value && u.value.isTexture ) {

						textureMap.set( u.value.uuid, u.value );

					}

				}

			}

		}

	} );
