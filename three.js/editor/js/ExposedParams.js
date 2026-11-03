/**
 * FreeFilmCut: exposed (keyframable) params for OpenCut.
 * Checked in Editor → written to manifest.exposedParams on VfxPack export.
 */

import { isBelowInputUniformName, looksLikeColorUniformName } from './FreeCapCutShaders.js?v=fcc-ui-198';

/** @typedef {'postProcess'|'material'|'text'} ExposedScope */
/**
 * @typedef {object} ExposedParam
 * @property {string} id
 * @property {ExposedScope} scope
 * @property {string} label
 * @property {'float'|'int'|'boolean'|'color'} type
 * @property {number|boolean|string} default
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 * @property {string} [effectId]
 * @property {string} [effectType]
 * @property {string} [key]
 * @property {string} [materialUuid]
 * @property {string} [uniform]
 * @property {string} [objectUuid]
 */

export function buildPostProcessExposedId( effectId, key ) {

	return `pp.${ effectId }.${ key }`;

}

export function buildMaterialExposedId( materialUuid, uniform ) {

	return `mat.${ materialUuid }.${ uniform }`;

}

export function buildTextExposedId( objectUuid, key ) {

	return `ui.${ objectUuid }.${ key }`;

}

/** Keys the asset editor can expose on a Text fccUI object. */
export const TEXT_EXPOSE_SCHEMA = {
	text: { label: '文本', type: 'text' },
	fontSize: { label: '字号', type: 'float', min: 1, max: 1024, step: 1 },
	bold: { label: '加粗', type: 'boolean' },
	color: { label: '颜色', type: 'color' },
	letterSpacing: { label: '字间距', type: 'float', step: 0.1 },
	lineHeight: { label: '行距', type: 'float', min: 0.2, max: 8, step: 0.05 },
	'outline.enabled': { label: '描边', type: 'boolean' },
	'outline.width': { label: '描边宽', type: 'float', min: 0, max: 512, step: 1 },
	'outline.color': { label: '描边颜色', type: 'color' },
	'outline.opacity': { label: '描边不透明', type: 'float', min: 0, max: 1, step: 0.01 },
	'shadow.enabled': { label: '阴影', type: 'boolean' },
	'shadow.offsetX': { label: '阴影偏移 X', type: 'float', step: 1 },
	'shadow.offsetY': { label: '阴影偏移 Y', type: 'float', step: 1 },
	'shadow.blur': { label: '阴影模糊', type: 'float', min: 0, max: 64, step: 1 },
	'shadow.color': { label: '阴影颜色', type: 'color' },
};

export function getTextExposedMap( ui ) {

	if ( ! ui || typeof ui !== 'object' ) return {};
	if ( ! ui.exposed || typeof ui.exposed !== 'object' ) ui.exposed = {};
	return ui.exposed;

}

export function isTextParamExposed( ui, key ) {

	return !! getTextExposedMap( ui )[ key ];

}

export function setTextParamExposed( ui, key, on ) {

	const map = getTextExposedMap( ui );
	if ( on ) map[ key ] = true;
	else delete map[ key ];

}

function readTextParam( ui, key ) {

	if ( ! ui ) return undefined;
	const dot = key.indexOf( '.' );
	if ( dot === - 1 ) return ui[ key ];
	const group = ui[ key.slice( 0, dot ) ];
	if ( ! group || typeof group !== 'object' ) return undefined;
	return group[ key.slice( dot + 1 ) ];

}

export function getEffectExposedMap( entry ) {

	if ( ! entry || typeof entry !== 'object' ) return {};
	if ( ! entry.exposed || typeof entry.exposed !== 'object' ) entry.exposed = {};
	return entry.exposed;

}

export function isEffectParamExposed( entry, key ) {

	return !! getEffectExposedMap( entry )[ key ];

}

export function setEffectParamExposed( entry, key, on ) {

	const map = getEffectExposedMap( entry );
	if ( on ) map[ key ] = true;
	else delete map[ key ];

}

export function getMaterialExposedMap( material ) {

	if ( ! material ) return {};
	if ( ! material.userData ) material.userData = {};
	if ( ! material.userData.exposedUniforms || typeof material.userData.exposedUniforms !== 'object' ) {

		material.userData.exposedUniforms = {};

	}

	return material.userData.exposedUniforms;

}

export function isUniformExposed( material, name ) {

	return !! getMaterialExposedMap( material )[ name ];

}

export function setUniformExposed( material, name, on ) {

	const map = getMaterialExposedMap( material );
	if ( on ) map[ name ] = true;
	else delete map[ name ];

}

function schemaTypeOf( schema ) {

	if ( ! schema ) return 'float';
	if ( schema.type === 'boolean' ) return 'boolean';
	if ( schema.type === 'int' ) return 'int';
	if ( schema.type === 'color' ) return 'color';
	if ( schema.type === 'text' ) return 'text';
	if ( schema.type === 'vec2' || schema.type === 'vec3' || schema.type === 'vec4' ) return schema.type;
	return 'float';

}

function uniformValueType( name, value ) {

	if ( typeof value === 'boolean' ) return 'boolean';
	if ( value && value.isColor ) return 'color';
	if ( value && value.isVector3 && looksLikeColorUniformName( name ) ) return 'color';
	if ( typeof value === 'number' ) return 'float';
	return null;

}

function serializeUniformDefault( name, value ) {

	if ( typeof value === 'boolean' ) return value;
	if ( typeof value === 'number' ) return value;
	if ( value && value.isColor ) return '#' + value.getHexString();
	if ( value && value.isVector3 && looksLikeColorUniformName( name ) ) {

		const r = Math.round( Math.min( 1, Math.max( 0, value.x ) ) * 255 );
		const g = Math.round( Math.min( 1, Math.max( 0, value.y ) ) * 255 );
		const b = Math.round( Math.min( 1, Math.max( 0, value.z ) ) * 255 );
		return '#' + r.toString( 16 ).padStart( 2, '0' ) + g.toString( 16 ).padStart( 2, '0' ) + b.toString( 16 ).padStart( 2, '0' );

	}

	return 0;

}

/**
 * Collect exposedParams from editor scene (cameras + materials).
 * @param {{ scene: import('three').Scene, getEffectDescriptor?: Function }} opts
 * @returns {ExposedParam[]}
 */
export function collectExposedParamsFromScene( { scene, getEffectDescriptor } ) {

	/** @type {ExposedParam[]} */
	const out = [];
	const seen = new Set();

	scene.traverse( ( object ) => {

		if ( object.isCamera ) {

			const stack = object.userData && object.userData.postProcessStack;
			if ( ! stack || ! Array.isArray( stack.effects ) ) return;

			for ( const entry of stack.effects ) {

				if ( ! entry || ! entry.id ) continue;
				const exposed = getEffectExposedMap( entry );
				const keys = Object.keys( exposed ).filter( ( k ) => exposed[ k ] );
				if ( keys.length === 0 ) continue;

				const desc = typeof getEffectDescriptor === 'function'
					? getEffectDescriptor( entry.type )
					: null;
				const schemaByKey = new Map(
					( desc && Array.isArray( desc.paramSchema ) ? desc.paramSchema : [] )
						.map( ( s ) => [ s.key, s ] )
				);
				const defaults = desc && typeof desc.createDefaultParams === 'function'
					? desc.createDefaultParams()
					: {};

				for ( const key of keys ) {

					const id = buildPostProcessExposedId( entry.id, key );
					if ( seen.has( id ) ) continue;
					seen.add( id );
					const schema = schemaByKey.get( key ) || {};
					const rawDefault = ( entry.params && entry.params[ key ] !== undefined )
						? entry.params[ key ]
						: defaults[ key ];
					out.push( {
						id,
						scope: 'postProcess',
						effectId: entry.id,
						effectType: entry.type,
						key,
						label: schema.labelZh || schema.label || key,
						type: schemaTypeOf( schema ),
						default: rawDefault !== undefined ? rawDefault : 0,
						min: schema.min,
						max: schema.max,
						step: schema.step,
					} );

				}

			}

		}

		const fcc = object.userData && object.userData.fccUI;
		if ( fcc && fcc.type === 'text' && fcc.exposed && typeof fcc.exposed === 'object' ) {

			const name = object.name || 'Text';
			for ( const key of Object.keys( TEXT_EXPOSE_SCHEMA ) ) {

				if ( ! fcc.exposed[ key ] ) continue;
				const schema = TEXT_EXPOSE_SCHEMA[ key ];
				const id = buildTextExposedId( object.uuid, key );
				if ( seen.has( id ) ) continue;
				seen.add( id );
				const raw = readTextParam( fcc, key );
				out.push( {
					id,
					scope: 'text',
					objectUuid: object.uuid,
					key,
					label: name + ' · ' + schema.label,
					type: schemaTypeOf( schema ),
					default: raw !== undefined && raw !== null ? raw : ( schema.type === 'boolean' ? false : ( schema.type === 'text' ? '' : 0 ) ),
					min: schema.min,
					max: schema.max,
					step: schema.step,
				} );

			}

		}

		const mat = object.material;
		if ( ! mat ) return;
		const mats = Array.isArray( mat ) ? mat : [ mat ];

		for ( const m of mats ) {

			if ( ! ( m.isShaderMaterial || m.isRawShaderMaterial ) ) continue;
			if ( ! m.uniforms ) continue;
			const exposed = getMaterialExposedMap( m );
			for ( const name of Object.keys( exposed ) ) {

				if ( ! exposed[ name ] ) continue;
				if ( isBelowInputUniformName( name ) ) continue;
				const entry = m.uniforms[ name ];
				if ( ! entry ) continue;
				const utype = uniformValueType( name, entry.value );
				if ( ! utype ) continue;
				const id = buildMaterialExposedId( m.uuid, name );
				if ( seen.has( id ) ) continue;
				seen.add( id );
				out.push( {
					id,
					scope: 'material',
					materialUuid: m.uuid,
					uniform: name,
					label: name,
					type: utype,
					default: serializeUniformDefault( name, entry.value ),
				} );

			}

		}

	} );

	return out;

}

/**
 * Map exposedParams → legacy manifest.params[] (OpenCut property list).
 * @param {ExposedParam[]} exposed
 */
export function exposedParamsToManifestParams( exposed ) {

	return ( exposed || [] ).map( ( p ) => ( {
		key: p.id,
		label: p.label,
		type: p.type === 'int' ? 'int' : ( p.type === 'boolean' ? 'boolean' : ( p.type === 'color' ? 'color' : 'float' ) ),
		default: p.default,
		min: p.min,
		max: p.max,
		step: p.step,
		scope: p.scope,
		effectId: p.effectId,
		effectType: p.effectType,
		paramKey: p.key,
			materialUuid: p.materialUuid,
			uniform: p.uniform,
			objectUuid: p.objectUuid,
		} ) );

}

export { looksLikeColorUniformName };
