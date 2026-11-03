/**
 * FreeFilmCut default ShaderMaterial templates + map/color uniform bridge.
 * Used when switching material type to ShaderMaterial / RawShaderMaterial in the Editor.
 *
 * Shader 与编辑器 / 剪辑端约定（摘要，完整说明见 DEFAULT_FRAGMENT 顶部注释）：
 * - 颜色：gl_FragColor 写线性，不要写 linearToOutputTexel
 * - 滤镜/特效下层：uniform sampler2D uInput（别名 belowInput / iChannel0）
 * - 转场：uTransitionFrom / uTransitionTo（别名见下）；进度用 .anim 驱动 uMix，不是自动绑定
 * - 屏幕：uResolution / uScreenParams / uScreenTexelSize / _ScreenParams 按声明每帧填充
 */
import * as THREE from 'three';
import { ensureGlobalScreenUniforms } from './GlobalScreenParams.js?v=fcc-ui-106';

/**
 * NLE auto-binds these sampler2D names to the below-track composite
 * when the pack type is filter/effect and scope is "below".
 * Prefer `uInput` in author shaders; belowInput / iChannel0 are aliases.
 */
const BELOW_INPUT_UNIFORM_NAMES = [ 'uInput', 'belowInput', 'iChannel0' ];

/** NLE binds outgoing clip A. Editor preview uses the same names. */
const TRANSITION_FROM_UNIFORM_NAMES = [ 'uTransitionFrom', 'uFrom', 'transitionFrom' ];

/** NLE binds incoming clip B. Editor preview uses the same names. */
const TRANSITION_TO_UNIFORM_NAMES = [ 'uTransitionTo', 'uTo', 'transitionTo' ];

function isBelowInputUniformName( name ) {

	return BELOW_INPUT_UNIFORM_NAMES.includes( name );

}

function isTransitionFromUniformName( name ) {

	return TRANSITION_FROM_UNIFORM_NAMES.includes( name );

}

function isTransitionToUniformName( name ) {

	return TRANSITION_TO_UNIFORM_NAMES.includes( name );

}

function isTransitionInputUniformName( name ) {

	return isTransitionFromUniformName( name ) || isTransitionToUniformName( name );

}


const DEFAULT_VERTEX = `varying vec2 vUv;

void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

// Default: sample uInput (below composite), optional map multiply, color/color2 tint.
const DEFAULT_FRAGMENT = `// =============================================================================
// FreeFilmCut Shader 约定（编辑器 / 剪辑端自动绑定的名字）
// 只声明你实际用到的 uniform；系统按「GLSL 里写了什么」来绑定，不会猜。
// =============================================================================
//
// 【颜色空间】
// - gl_FragColor 写线性颜色。贴图采样已是 sRGB 解码后的线性值。
// - 不要写 linearToOutputTexel / #include <colorspace_fragment>。
//   色调映射 + sRGB 输出由编辑器 / 剪辑端统一做。
//
// 【滤镜 / 特效 · 下层输入】（pack type = filter | effect，scope = below）
// - 推荐：uniform sampler2D uInput;
// - 别名：belowInput、iChannel0（三选一即可，也可同时声明，内容相同）
// - 剪辑端每帧绑定「本轨道下方合成」画面。
// - 编辑器材质面板可本地选图预览，不会打进 .vfxpack。
//
// 【转场】（pack type = transition，挂在时间线切点上）
// - 推荐：
//     uniform sampler2D uTransitionFrom;  // 切点左侧 / 离开的画面 A
//     uniform sampler2D uTransitionTo;    // 切点右侧 / 进入的画面 B
// - FROM 别名：uFrom、transitionFrom
// - TO   别名：uTo、transitionTo
// - 可选尺寸（每帧写入像素宽高）：
//     uniform vec2 uTransitionFromSize;  // 别名 uFromSize
//     uniform vec2 uTransitionToSize;    // 别名 uToSize
// - 进度：没有自动绑定的「进度」uniform。
//   常见做法是自己声明 uniform float uMix;（0=全 A，1=全 B），
//   用工程里的 .anim / timeline 把 uMix 从 0 关键到 1。
//   参考 dissolve-cut：mix(A, B, clamp(uMix, 0.0, 1.0))
// - 编辑器同样可用本地图预览 From/To，不会打进包。
//
// 【屏幕尺寸】（声明了就会每帧填工程/安全框分辨率，不是 CSS 窗口）
//     uniform vec2 uResolution;      // (width, height)
//     uniform vec2 uScreenTexelSize;  // (1/w, 1/h)
//     uniform vec4 uScreenParams;     // (w, h, 1+1/w, 1+1/h) 类似 Unity
//     uniform vec4 _ScreenParams;     // 可选，与 uScreenParams 相同
//   屏幕 UV 示例：vec2 screenUV = gl_FragCoord.xy / uResolution.xy;
//
// 【花字 / 字贴纸 · 横条 atlas（可选，与 FlowerStyle texture.range 同约定）】
// - 声明后编辑器/贴纸同步会写入：
//     uniform float uFccTexRange;   // 分区数，默认 1=不切
//     uniform float uFccCharIndex;  // 字序号（贴纸已按字拆 mesh；共享材质球请用下面 UV 重映射）
// - 采样前把局部 UV 映到第 (charIndex % range) 条横带：
//     float n = max(uFccTexRange, 1.0);
//     float slot = mod(uFccCharIndex, n);
//     uv.x = (clamp(uv.x, 0.0, 1.0) + slot) / n;
// - 共享材质球：贴纸同步也会按 range 改 mesh UV，无需每字一份材质。
//
// 【本模板自带（侧栏可调 / 可 K 帧）】
// - map + useMap：可选贴图相乘
// - color / color2 / opacity：着色与透明度
// - uTime：占位 float，需自己用动画驱动；剪辑端不会自动写时钟
//
// =============================================================================

uniform sampler2D uInput;
uniform sampler2D map;
uniform vec3 color;
uniform vec3 color2;
uniform float opacity;
uniform float uTime;
uniform bool useMap;
uniform vec2 uResolution;
uniform vec4 uScreenParams;
uniform vec2 uScreenTexelSize;
// uniform vec4 _ScreenParams;

varying vec2 vUv;

void main() {
	vec4 texel = texture2D( uInput, vUv );
	if ( useMap ) {
		texel *= texture2D( map, vUv );
	}
	vec3 finalcol = mix( color, color2, vUv.x );
	gl_FragColor = vec4( texel.rgb * finalcol, texel.a * opacity );
}
`;

const RAW_VERTEX = `precision mediump float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;

void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const RAW_FRAGMENT = `precision mediump float;
// FreeFilmCut Raw 模板：约定与 ShaderMaterial 相同（见默认片段顶部注释）。
// 滤镜下层 uInput；转场 uTransitionFrom/uTransitionTo；进度自管 uMix；勿写 linearToOutputTexel。
uniform sampler2D uInput;
uniform sampler2D map;
uniform vec3 color;
uniform vec3 color2;
uniform float opacity;
uniform float uTime;
uniform bool useMap;
uniform vec2 uResolution;
uniform vec4 uScreenParams;
uniform vec2 uScreenTexelSize;
varying vec2 vUv;

void main() {
	vec4 texel = texture2D( uInput, vUv );
	if ( useMap ) {
		texel *= texture2D( map, vUv );
	}
	vec3 finalcol = mix( color, color2, vUv.x );
	gl_FragColor = vec4( texel.rgb * finalcol, texel.a * opacity );
}
`;

/**
 * Heuristic: treat hex ints / [r,g,b] / {r,g,b} as colors for *color* uniforms.
 */
function looksLikeColorUniformName( name ) {

	if ( typeof name !== 'string' ) return false;
	const n = name.toLowerCase();
	return n === 'color' || n.endsWith( 'color' ) || n.startsWith( 'color' ) ||
		n.includes( 'tint' ) || n.includes( 'albedo' );

}


/**
 * Heuristic: sampler2D / texture uniform names (map, map2, diffuseMap, tex, …).
 */
function looksLikeMapUniformName( name ) {

	if ( typeof name !== 'string' ) return false;
	const n = name.toLowerCase();
	if ( n === 'map' || n.startsWith( 'map' ) || n.endsWith( 'map' ) ) return true;
	return n.includes( 'tex' ) || n.includes( 'texture' ) || n.includes( 'sampler' ) ||
		n.includes( 'diffuse' ) || n.includes( 'albedo' ) || n.includes( 'normal' ) ||
		n.includes( 'emissive' ) || n.includes( 'specular' ) || n.includes( 'bump' ) ||
		n.includes( 'roughness' ) || n.includes( 'metalness' ) || n.includes( 'ao' );

}


/**
 * Convert a JSON-friendly uniform value into a Three.js runtime value.
 * - hex int (e.g. 16711680) → THREE.Color
 * - [r,g,b] or [r,g,b,a] (0–1 floats, or 0–255 if any channel > 1) → Color / Vector3 / Vector4
 * - {r,g,b} → THREE.Color
 * - {x,y,z} → THREE.Vector3
 * Leaves textures / null / bool / number (non-color) alone.
 */
function coerceUniformValue( name, value ) {

	if ( value === null || value === undefined ) return value;
	if ( value.isTexture || value.isColor || value.isVector2 || value.isVector3 || value.isVector4 ) {

		return value;

	}

	// THREE.Color.toJSON() → hex number; common when re-applying Info JSON
	if ( typeof value === 'number' && Number.isFinite( value ) && looksLikeColorUniformName( name ) ) {

		return new THREE.Color( value );

	}

	if ( Array.isArray( value ) ) {

		const asColor = looksLikeColorUniformName( name );
		let nums = value.map( Number );
		if ( nums.some( ( n ) => n > 1 ) ) {

			// 0–255 style
			nums = nums.map( ( n ) => n / 255 );

		}

		if ( asColor && nums.length >= 3 ) {

			return new THREE.Color( nums[ 0 ], nums[ 1 ], nums[ 2 ] );

		}

		if ( nums.length === 2 ) return new THREE.Vector2( nums[ 0 ], nums[ 1 ] );
		if ( nums.length === 3 ) return new THREE.Vector3( nums[ 0 ], nums[ 1 ], nums[ 2 ] );
		if ( nums.length >= 4 ) return new THREE.Vector4( nums[ 0 ], nums[ 1 ], nums[ 2 ], nums[ 3 ] );
		return value;

	}

	if ( typeof value === 'object' ) {

		if ( 'r' in value && 'g' in value && 'b' in value ) {

			return new THREE.Color( value.r, value.g, value.b );

		}

		if ( 'x' in value && 'y' in value && 'z' in value && 'w' in value ) {

			return new THREE.Vector4( value.x, value.y, value.z, value.w );

		}

		if ( 'x' in value && 'y' in value && 'z' in value ) {

			return new THREE.Vector3( value.x, value.y, value.z );

		}

		if ( 'x' in value && 'y' in value ) {

			return new THREE.Vector2( value.x, value.y );

		}

	}

	return value;

}

/**
 * Normalize a uniforms dict coming from Info JSON (or broken scene state)
 * so vec3 colors are real THREE.Color / Vector3 instances.
 * Mutates and returns the same object.
 */
function normalizeShaderUniforms( uniforms ) {

	if ( ! uniforms || typeof uniforms !== 'object' ) return uniforms;

	for ( const [ name, entry ] of Object.entries( uniforms ) ) {

		if ( ! entry || typeof entry !== 'object' || ! ( 'value' in entry ) ) continue;
		entry.value = coerceUniformValue( name, entry.value );

	}

	return uniforms;

}

/**
 * JSON.stringify replacer so Info editor shows colors as [r,g,b] arrays
 * instead of opaque hex ints from Color.toJSON().
 */
function uniformsInfoReplacer( key, value ) {

	if ( value && value.isColor ) {

		return [ value.r, value.g, value.b ];

	}

	if ( value && ( value.isVector2 || value.isVector3 || value.isVector4 ) ) {

		return value.toArray();

	}

	// Hex int left from a previous broken save — expand color* keys for readability
	if ( key === 'value' && typeof value === 'number' && Number.isFinite( value ) ) {

		// Parent key is not available here; leave as-is. coerceUniformValue handles on apply.
		return value;

	}

	return value;

}

/**
 * Serialize material defines/uniforms/attributes for the Info panel.
 */
function serializeProgramInfo( material ) {

	const uniforms = {};
	if ( material.uniforms ) {

		for ( const [ name, entry ] of Object.entries( material.uniforms ) ) {

			if ( ! entry || typeof entry !== 'object' ) continue;
			const v = entry.value;
			if ( v && v.isTexture ) {

				uniforms[ name ] = { value: null }; // texture kept via Map UI / map bridge
				continue;

			}

			if ( v && v.isColor ) {

				uniforms[ name ] = { value: [ v.r, v.g, v.b ] };
				continue;

			}

			if ( v && ( v.isVector2 || v.isVector3 || v.isVector4 ) ) {

				uniforms[ name ] = { value: v.toArray() };
				continue;

			}

			uniforms[ name ] = { value: v };

		}

	}

	return {
		defines: material.defines || {},
		uniforms,
		attributes: material.attributes || {}
	};

}

/**
 * Sync convenience properties (map / color / opacity) onto ShaderMaterial uniforms
 * so the existing Material sidebar Map / Color / Opacity controls keep working.
 */
function syncShaderMaterialBridge( material ) {

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

}

/**
 * Create a FreeFilmCut-friendly ShaderMaterial (or RawShaderMaterial).
 * Defaults: color = red [1,0,0], color2 = blue [0,0,1], fragment mixes by vUv.x.
 * @param {'ShaderMaterial'|'RawShaderMaterial'} type
 * @param {object} [from] previous material to copy map/color/opacity from
 */
function createFreeFilmCutShaderMaterial( type, from = null ) {

	const isRaw = type === 'RawShaderMaterial';
	const color = ( from && from.color && from.color.isColor )
		? from.color.clone()
		: new THREE.Color( 0xff0000 );
	const color2 = new THREE.Color( 0x0000ff );
	const opacity = ( from && typeof from.opacity === 'number' ) ? from.opacity : 1;
	const map = ( from && from.map && from.map.isTexture ) ? from.map : null;
	const transparent = from ? !! from.transparent : false;

	const uniforms = {
		uInput: { value: null }, // NLE / Editor below-preview binds this
		map: { value: map },
		color: { value: color.clone() },
		color2: { value: color2.clone() },
		opacity: { value: opacity },
		uTime: { value: 0 },
		useMap: { value: map !== null },
		// Global screen — filled each frame from project/safe-frame resolution
		uResolution: { value: new THREE.Vector2( 1, 1 ) },
		uScreenTexelSize: { value: new THREE.Vector2( 1, 1 ) },
		uScreenParams: { value: new THREE.Vector4( 1, 1, 2, 2 ) },
		_ScreenParams: { value: new THREE.Vector4( 1, 1, 2, 2 ) },
	};

	const MaterialClass = isRaw ? THREE.RawShaderMaterial : THREE.ShaderMaterial;
	const material = new MaterialClass( {
		uniforms,
		vertexShader: isRaw ? RAW_VERTEX : DEFAULT_VERTEX,
		fragmentShader: isRaw ? RAW_FRAGMENT : DEFAULT_FRAGMENT,
		transparent,
		opacity
	} );

	// Own properties so existing sidebar Map / Color / Opacity rows show up
	material.map = map;
	material.color = color;
	material.name = ( from && from.name ) ? from.name : ( isRaw ? 'RawShader' : 'CustomShader' );

	if ( ! material.userData ) material.userData = {};
	material.userData.freecapcutGlobalScreen = true;
	ensureGlobalScreenUniforms( material, { forceAll: true } );
	if ( ! material.uniforms.uFccTexRange ) {
		material.uniforms.uFccTexRange = { value: 1 };
	}
	if ( ! material.uniforms.uFccCharIndex ) {
		material.uniforms.uFccCharIndex = { value: 0 };
	}
	syncShaderMaterialBridge( material );
	return material;

}

/**
 * Editor-only below-input preview (uInput / belowInput / iChannel0).
 * Not used by OpenCut — NLE overwrites these uniforms with the real below composite.
 * Persisted on material.userData.editorPreviewInputs for Editor autosave restore.
 */
const EDITOR_PREVIEW_INPUT_KEY = 'uInput'; // canonical key in userData.editorPreviewInputs
const EDITOR_PREVIEW_FROM_KEY = 'uTransitionFrom';
const EDITOR_PREVIEW_TO_KEY = 'uTransitionTo';

function ensureEditorPreviewInputs( material ) {

	if ( ! material.userData ) material.userData = {};
	if ( ! material.userData.editorPreviewInputs || typeof material.userData.editorPreviewInputs !== 'object' ) {

		material.userData.editorPreviewInputs = {};

	}

	return material.userData.editorPreviewInputs;

}

function listPresentSamplerNames( material, nameList ) {

	const names = [];
	const src = String( ( material && material.fragmentShader ) || '' ) + String( ( material && material.vertexShader ) || '' );
	for ( const n of nameList ) {

		const hasUniform = material && material.uniforms && ( n in material.uniforms );
		const inGlsl = new RegExp( '\\buniform\\s+sampler2D\\s+' + n + '\\b' ).test( src );
		if ( hasUniform || inGlsl ) names.push( n );

	}

	return names;

}

function listPresentBelowInputNames( material ) {

	return listPresentSamplerNames( material, BELOW_INPUT_UNIFORM_NAMES );

}

function listPresentTransitionFromNames( material ) {

	return listPresentSamplerNames( material, TRANSITION_FROM_UNIFORM_NAMES );

}

function listPresentTransitionToNames( material ) {

	return listPresentSamplerNames( material, TRANSITION_TO_UNIFORM_NAMES );

}

/**
 * Assign (or clear) an Editor-only preview texture onto all below-input aliases.
 * @param {THREE.Material} material
 * @param {THREE.Texture|null} texture
 * @param {{ fileName?: string, dataUrl?: string }|null} meta
 */
function applyEditorSamplerPreview( material, nameList, storeKey, texture, meta ) {

	if ( ! material || ( ! material.isShaderMaterial && ! material.isRawShaderMaterial ) ) return;
	if ( ! material.uniforms ) material.uniforms = {};

	const names = listPresentSamplerNames( material, nameList );
	const targets = names.length > 0 ? names : [ storeKey ];

	for ( const n of targets ) {

		if ( ! material.uniforms[ n ] ) material.uniforms[ n ] = { value: null };
		material.uniforms[ n ].value = texture;

	}

	const store = ensureEditorPreviewInputs( material );
	if ( texture && meta ) {

		store[ storeKey ] = {
			fileName: meta.fileName || ( texture.sourceFile || 'preview' ),
			dataUrl: meta.dataUrl || null,
			editorOnly: true,
		};

	} else {

		delete store[ storeKey ];
		if ( Object.keys( store ).length === 0 ) delete material.userData.editorPreviewInputs;

	}

	writeEditorPreviewSize( material, storeKey, texture );
	material.needsUpdate = true;

}

function writeEditorPreviewSize( material, storeKey, texture ) {

	const sizeNames = storeKey === EDITOR_PREVIEW_FROM_KEY
		? [ 'uTransitionFromSize', 'uFromSize' ]
		: storeKey === EDITOR_PREVIEW_TO_KEY
			? [ 'uTransitionToSize', 'uToSize' ]
			: null;
	if ( ! sizeNames ) return;
	const image = texture && texture.image;
	const w = image && image.width ? image.width : 1;
	const h = image && image.height ? image.height : 1;
	for ( const name of sizeNames ) {

		if ( ! material.uniforms[ name ] ) continue;
		const value = material.uniforms[ name ].value;
		if ( value && value.isVector2 ) value.set( w, h );
		else material.uniforms[ name ].value = new THREE.Vector2( w, h );

	}

}

function applyEditorBelowPreview( material, texture, meta ) {

	applyEditorSamplerPreview( material, BELOW_INPUT_UNIFORM_NAMES, EDITOR_PREVIEW_INPUT_KEY, texture, meta );

}

function applyEditorTransitionFromPreview( material, texture, meta ) {

	applyEditorSamplerPreview( material, TRANSITION_FROM_UNIFORM_NAMES, EDITOR_PREVIEW_FROM_KEY, texture, meta );

}

function applyEditorTransitionToPreview( material, texture, meta ) {

	applyEditorSamplerPreview( material, TRANSITION_TO_UNIFORM_NAMES, EDITOR_PREVIEW_TO_KEY, texture, meta );

}

/**
 * Restore Editor preview textures from userData.editorPreviewInputs (after ObjectLoader).
 * Skips if uniforms already hold a Texture (e.g. embedded in scene JSON).
 * @returns {Promise<boolean>} true if a texture was (re)loaded
 */
function restoreEditorSamplerPreview( material, nameList, storeKey, apply ) {

	if ( ! material || ( ! material.isShaderMaterial && ! material.isRawShaderMaterial ) ) {

		return Promise.resolve( false );

	}

	const meta = material.userData && material.userData.editorPreviewInputs &&
		material.userData.editorPreviewInputs[ storeKey ];
	if ( ! meta || ! meta.dataUrl ) return Promise.resolve( false );

	const names = listPresentSamplerNames( material, nameList );
	const targets = names.length > 0 ? names : [ storeKey ];
	const existing = material.uniforms && targets.some( ( n ) => {

		const v = material.uniforms[ n ] && material.uniforms[ n ].value;
		return v && v.isTexture;

	} );
	if ( existing ) return Promise.resolve( false );

	return new Promise( ( resolve ) => {

		const loader = new THREE.TextureLoader();
		loader.load(
			meta.dataUrl,
			( texture ) => {

				texture.colorSpace = THREE.SRGBColorSpace;
				texture.flipY = true;
				texture.needsUpdate = true;
				texture.sourceFile = meta.fileName || 'preview';
				texture.userData = texture.userData || {};
				texture.userData.editorBelowPreview = true;
				apply( material, texture, {
					fileName: meta.fileName,
					dataUrl: meta.dataUrl,
				} );
				resolve( true );

			},
			undefined,
			() => resolve( false ),
		);

	} );

}

function restoreEditorBelowPreviews( material ) {

	return Promise.all( [
		restoreEditorSamplerPreview( material, BELOW_INPUT_UNIFORM_NAMES, EDITOR_PREVIEW_INPUT_KEY, applyEditorBelowPreview ),
		restoreEditorSamplerPreview( material, TRANSITION_FROM_UNIFORM_NAMES, EDITOR_PREVIEW_FROM_KEY, applyEditorTransitionFromPreview ),
		restoreEditorSamplerPreview( material, TRANSITION_TO_UNIFORM_NAMES, EDITOR_PREVIEW_TO_KEY, applyEditorTransitionToPreview ),
	] ).then( ( flags ) => flags.some( Boolean ) );

}

/**
 * Walk scene materials and restore any Editor below-previews.
 */
function restoreEditorBelowPreviewsInScene( scene ) {

	if ( ! scene ) return Promise.resolve();
	const jobs = [];
	scene.traverse( ( obj ) => {

		const mat = obj.material;
		if ( ! mat ) return;
		const mats = Array.isArray( mat ) ? mat : [ mat ];
		for ( const m of mats ) jobs.push( restoreEditorBelowPreviews( m ) );

	} );
	return Promise.all( jobs );

}


export {
	DEFAULT_VERTEX,
	DEFAULT_FRAGMENT,
	RAW_VERTEX,
	RAW_FRAGMENT,
	createFreeFilmCutShaderMaterial,
	syncShaderMaterialBridge,
	normalizeShaderUniforms,
	coerceUniformValue,
	serializeProgramInfo,
	uniformsInfoReplacer,
	looksLikeColorUniformName,
	looksLikeMapUniformName,
	BELOW_INPUT_UNIFORM_NAMES,
	TRANSITION_FROM_UNIFORM_NAMES,
	TRANSITION_TO_UNIFORM_NAMES,
	isBelowInputUniformName,
	isTransitionFromUniformName,
	isTransitionToUniformName,
	isTransitionInputUniformName,
	applyEditorBelowPreview,
	applyEditorTransitionFromPreview,
	applyEditorTransitionToPreview,
	restoreEditorBelowPreviews,
	restoreEditorBelowPreviewsInScene,
	listPresentBelowInputNames,
	listPresentTransitionFromNames,
	listPresentTransitionToNames,
	EDITOR_PREVIEW_INPUT_KEY,
	EDITOR_PREVIEW_FROM_KEY,
	EDITOR_PREVIEW_TO_KEY
};
