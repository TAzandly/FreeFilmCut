const fs = require('fs');
const path = 'three.js/editor/js/FreeCapCutShaders.js';
let src = fs.readFileSync(path, 'utf8');

const oldBridge = `function syncShaderMaterialBridge( material ) {

	if ( ! material || ( ! material.isShaderMaterial && ! material.isRawShaderMaterial ) ) {

		return;

	}

	if ( ! material.uniforms ) {

		material.uniforms = {};

	}

	normalizeShaderUniforms( material.uniforms );

	const u = material.uniforms;

	if ( ! u.map ) u.map = { value: null };
	if ( ! u.color ) u.color = { value: new THREE.Color( 0xff0000 ) };
	if ( ! u.color2 ) u.color2 = { value: new THREE.Color( 0x0000ff ) };
	if ( ! u.opacity ) u.opacity = { value: 1 };
	if ( ! u.uTime ) u.uTime = { value: 0 };
	if ( ! u.useMap ) u.useMap = { value: false };

	// Ensure color / color2 are Color instances even after a bad Info apply
	if ( !( u.color.value && u.color.value.isColor ) ) {

		u.color.value = coerceUniformValue( 'color', u.color.value );

	}

	if ( !( u.color2.value && u.color2.value.isColor ) ) {

		u.color2.value = coerceUniformValue( 'color2', u.color2.value );

	}

	if ( material.map !== undefined ) {

		u.map.value = material.map;
		u.useMap.value = material.map !== null;

	}

	if ( material.color && material.color.isColor ) {

		if ( u.color.value && u.color.value.isColor ) {

			u.color.value.copy( material.color );

		} else {

			u.color.value = material.color.clone();

		}

	}

	if ( typeof material.opacity === 'number' ) {

		u.opacity.value = material.opacity;

	}

	material.needsUpdate = true;

}`;

const newBridge = `function syncShaderMaterialBridge( material ) {

	if ( ! material || ( ! material.isShaderMaterial && ! material.isRawShaderMaterial ) ) {

		return;

	}

	if ( ! material.uniforms ) {

		material.uniforms = {};

	}

	normalizeShaderUniforms( material.uniforms );

	const u = material.uniforms;

	if ( ! u.map ) u.map = { value: null };
	if ( ! u.color ) u.color = { value: new THREE.Color( 0xff0000 ) };
	if ( ! u.color2 ) u.color2 = { value: new THREE.Color( 0x0000ff ) };
	if ( ! u.opacity ) u.opacity = { value: 1 };
	if ( ! u.uTime ) u.uTime = { value: 0 };
	if ( ! u.useMap ) u.useMap = { value: false };

	// Ensure color / color2 are Color instances even after a bad Info apply
	if ( !( u.color.value && u.color.value.isColor ) ) {

		u.color.value = coerceUniformValue( 'color', u.color.value );

	}

	if ( !( u.color2.value && u.color2.value.isColor ) ) {

		u.color2.value = coerceUniformValue( 'color2', u.color2.value );

	}

	// After ObjectLoader restore, .color/.map may be missing (stripped on save).
	// Recreate sidebar bridge props FROM uniforms so Map/Color rows still work.
	if ( ! ( material.color && material.color.isColor ) ) {

		material.color = ( u.color.value && u.color.value.isColor )
			? u.color.value.clone()
			: new THREE.Color( 0xff0000 );

	} else if ( u.color.value && u.color.value.isColor ) {

		u.color.value.copy( material.color );

	}

	if ( material.map === undefined ) {

		material.map = u.map.value && u.map.value.isTexture ? u.map.value : null;

	} else {

		u.map.value = material.map;
		u.useMap.value = material.map !== null;

	}

	if ( typeof material.opacity === 'number' ) {

		u.opacity.value = material.opacity;

	} else if ( typeof u.opacity.value === 'number' ) {

		material.opacity = u.opacity.value;

	}

	material.needsUpdate = true;

}`;

if (!src.includes(oldBridge)) {
  console.error('bridge not found exactly, checking markers');
  console.log('has sync=', src.includes('function syncShaderMaterialBridge'));
  process.exit(1);
}
src = src.replace(oldBridge, newBridge);
fs.writeFileSync(path, src);
console.log('FreeCapCutShaders bridge updated');
