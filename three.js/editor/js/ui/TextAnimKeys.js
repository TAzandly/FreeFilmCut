/**
 * Editor glue between text-anim components and `.anim` tracks:
 *   - keyable field list / track labels for the animation panel
 *   - default progress keys for a new component, track cleanup on delete
 *   - one-shot conversion of textanim/2 `time` windows into keys
 * Paths: `textAnim.<compId>.<field>` on the Text group (see TextAnimOverrides.js).
 */

import {
	ensureObjectAnimClip,
	ensureTarget,
	ensureTrack,
	upsertKey,
	recomputeDuration,
	listEditorAnimClips,
	TEXTANIM_PATH_PREFIX,
} from '../anim/FreeCapCutAnimCore.js?v=fcc-anim-20';
import { getTextAnimDescriptor } from '../textanim/TextAnimRegistry.js';
import { ensureTextAnimOnUI, timeToProgressKeys } from '../textanim/TextAnimTypes.js?v=fcc-tanim-24';
import { getTextAnimSampleOpts } from './TextAnimOverrides.js';
import { getFccUI, isUIText } from './UIConstants.js?v=fcc-ui-108';

const SELECTOR_FIELDS = {
	start: [ 'Range start', '字范围起' ],
	end: [ 'Range end', '字范围止' ],
	amount: [ 'Amount', '强度' ],
	delay: [ 'Stagger', '错开' ],
};

const SELECTOR_RANGES = { start: [ 0, 1 ], end: [ 0, 1 ], amount: [ - 4, 4 ], delay: [ 0, 1 ] };

const DEFAULT_IN_EASE = 'easeOut';
const DEFAULT_OUT_EASE = 'easeIn';

export function textAnimPath( compId, field ) {

	return TEXTANIM_PATH_PREFIX + compId + '.' + field;

}

/** @returns {{ compId: string, field: string }|null} */
export function parseTextAnimPath( path ) {

	const p = String( path || '' );
	if ( p.indexOf( TEXTANIM_PATH_PREFIX ) !== 0 ) return null;
	const rest = p.slice( TEXTANIM_PATH_PREFIX.length );
	const dot = rest.indexOf( '.' );
	if ( dot <= 0 ) return null;
	return { compId: rest.slice( 0, dot ), field: rest.slice( dot + 1 ) };

}

function textAnimOf( object ) {

	if ( ! object || ! isUIText( object ) ) return null;
	const ui = getFccUI( object );
	return ui ? ensureTextAnimOnUI( ui ) : null;

}

function findComp( anim, compId ) {

	return anim && Array.isArray( anim.components )
		? anim.components.find( ( c ) => c && c.id === compId ) || null
		: null;

}

/**
 * Field descriptor for one path tail, or null when it is not keyable.
 * @returns {{ label: [string,string], value: number, interp?: 'step', range?: [number,number] }|null}
 */
function describeField( comp, desc, field ) {

	if ( field === 'progress' ) return { label: [ 'Progress', '进度' ], value: 1, range: [ 0, 1 ] };
	if ( field === 'enabled' ) return { label: [ 'Enabled', '启用' ], value: comp.enabled ? 1 : 0, interp: 'step', range: [ 0, 1 ] };

	if ( field.indexOf( 'selector.' ) === 0 ) {

		const f = field.slice( 9 );
		if ( ! comp.selector || ! SELECTOR_FIELDS[ f ] ) return null;
		return { label: SELECTOR_FIELDS[ f ], value: Number( comp.selector[ f ] ) || 0, range: SELECTOR_RANGES[ f ] };

	}

	const parts = field.split( '.' );
	const def = desc.params[ parts[ 0 ] ];
	if ( ! def ) return null;
	const name = [ def.label || parts[ 0 ], def.labelZh || def.label || parts[ 0 ] ];
	const range = [ def.min != null ? def.min : - 1e6, def.max != null ? def.max : 1e6 ];
	if ( parts.length !== 1 ) return null;
	if ( def.type === 'bool' ) return { label: name, value: comp.params[ parts[ 0 ] ] ? 1 : 0, interp: 'step', range: [ 0, 1 ] };
	if ( def.type === 'number' || def.type == null ) return { label: name, value: Number( comp.params[ parts[ 0 ] ] ) || 0, range };
	return null;

}

function fieldsOf( comp, desc ) {

	const out = [ 'progress', 'enabled' ];
	for ( const key of Object.keys( desc.params ) ) {

		const def = desc.params[ key ];
		if ( def.channel && comp.channels && comp.channels[ def.channel ] === false ) continue;
		if ( desc.channels.includes( key ) && comp.channels && comp.channels[ key ] === false ) continue;
		if ( def.type === 'number' || def.type === 'bool' || def.type == null ) out.push( key );

	}
	if ( comp.selector ) for ( const f of Object.keys( SELECTOR_FIELDS ) ) out.push( 'selector.' + f );
	return out;

}

/**
 * Keyable text-anim fields of a Text, current values first from the live
 * overrides, else the static component value.
 * @returns {{ path: string, label: string, compLabel: string, fieldLabel: string, value: number, interp?: string, range?: number[] }[]}
 */
export function listTextAnimKeyPaths( object, zh = true ) {

	const anim = textAnimOf( object );
	if ( ! anim ) return [];
	const values = getTextAnimSampleOpts( object ).values;
	const out = [];
	for ( const comp of anim.components ) {

		const desc = comp ? getTextAnimDescriptor( comp.type ) : null;
		if ( ! desc ) continue;
		const compLabel = zh ? desc.labelZh : desc.label;
		for ( const field of fieldsOf( comp, desc ) ) {

			const f = describeField( comp, desc, field );
			if ( ! f ) continue;
			const sub = comp.id + '.' + field;
			const live = values ? values.get( sub ) : undefined;
			const fieldLabel = zh ? f.label[ 1 ] : f.label[ 0 ];
			out.push( {
				path: TEXTANIM_PATH_PREFIX + sub,
				label: compLabel + ' · ' + fieldLabel,
				compLabel,
				fieldLabel,
				value: live !== undefined ? live : f.value,
				interp: f.interp,
				range: f.range,
			} );

		}

	}
	return out;

}

/** @returns {{ label: string, missing: boolean, range?: number[], interp?: string }} */
export function textAnimTrackInfo( object, path, zh = true ) {

	const parsed = parseTextAnimPath( path );
	if ( ! parsed ) return { label: String( path ), missing: true };
	const anim = textAnimOf( object );
	const comp = findComp( anim, parsed.compId );
	const desc = comp ? getTextAnimDescriptor( comp.type ) : null;
	if ( ! comp || ! desc ) return { label: parsed.compId + ' · ' + parsed.field, missing: true };
	const f = describeField( comp, desc, parsed.field );
	const compLabel = zh ? desc.labelZh : desc.label;
	if ( ! f ) return { label: compLabel + ' · ' + parsed.field, missing: true };
	return { label: compLabel + ' · ' + ( zh ? f.label[ 1 ] : f.label[ 0 ] ), missing: false, range: f.range, interp: f.interp };

}

export function findTextAnimTrack( editor, objectUuid, path ) {

	for ( const clip of listEditorAnimClips( editor ) ) {

		for ( const t of ( clip && clip.targets ) || [] ) {

			if ( ! t || t.objectUuid !== objectUuid ) continue;
			const tr = ( t.tracks || [] ).find( ( x ) => x && x.path === path && x.keys && x.keys.length );
			if ( tr ) return tr;

		}

	}
	return null;

}

/**
 * Write textAnim keys into the *active* animation clip (create/bind one if
 * needed). Previously ensureObjectAnimClip could park keys on a hidden clip
 * while the panel kept showing another — progress tracks never appeared for K,
 * and play sampled the wrong clip / cleared overrides.
 */
function withObjectClip( editor, object, fn ) {

	if ( ! editor || ! object ) return null;
	let clip = editor.activeFreecapcutAnim;
	if ( ! clip ) {

		clip = ensureObjectAnimClip( editor, object );
		if ( ! clip ) return null;

	} else {

		ensureTarget( clip, object.uuid );
		if ( ! object.userData ) object.userData = {};
		object.userData.freecapcutAnimController = {
			enabled: true,
			clipId: String( clip.name || '' ),
		};
		if ( ! Array.isArray( editor.freecapcutAnims ) ) editor.freecapcutAnims = [];
		if ( editor.freecapcutAnims.indexOf( clip ) < 0 ) editor.freecapcutAnims.push( clip );

	}
	const target = ensureTarget( clip, object.uuid );
	fn( clip, target );
	recomputeDuration( clip );
	editor.activeFreecapcutAnim = clip;
	return clip;

}

/**
 * Seed progress keys for a freshly added component at the panel playhead.
 * in: 0→1 easeOut over defaultDuration; out: 0→1 easeIn; loop: a single 1.
 */
export function addDefaultProgressKeys( editor, object, comp, t0 = 0 ) {

	const desc = comp ? getTextAnimDescriptor( comp.type ) : null;
	if ( ! editor || ! object || ! desc ) return null;
	const start = Math.max( 0, Number( t0 ) || 0 );
	return withObjectClip( editor, object, ( clip, target ) => {

		const tr = ensureTrack( target, textAnimPath( comp.id, 'progress' ) );
		tr.keys.length = 0;
		if ( desc.category === 'loop' ) {

			upsertKey( tr, start, 1 );
			return;

		}
		upsertKey( tr, start, 0, 1e-4, desc.category === 'out' ? DEFAULT_OUT_EASE : DEFAULT_IN_EASE );
		upsertKey( tr, start + desc.defaultDuration, 1 );

	} );

}

/** @returns {number} removed track count */
export function removeTextAnimComponentTracks( editor, objectUuid, compId ) {

	const prefix = TEXTANIM_PATH_PREFIX + compId + '.';
	let removed = 0;
	for ( const clip of listEditorAnimClips( editor ) ) {

		for ( const t of ( clip && clip.targets ) || [] ) {

			if ( ! t || t.objectUuid !== objectUuid || ! Array.isArray( t.tracks ) ) continue;
			const kept = t.tracks.filter( ( tr ) => ! ( tr && String( tr.path || '' ).indexOf( prefix ) === 0 ) );
			removed += t.tracks.length - kept.length;
			t.tracks = kept;

		}

	}
	return removed;

}

/** Shortest horizon a migrated loop / ping-pong gets expanded to (seconds). */
const MIGRATE_MIN_HORIZON = 4;

/**
 * textanim/2 → keys: every component that still has `time` gets its progress
 * keys written into the Text's own clip; the window is kept under
 * `anim.legacyTimes[compId]`. A component whose track already has keys only
 * drops its `time`.
 * @returns {number} migrated component count
 */
export function migrateTextAnimTimesOn( editor, object ) {

	const anim = textAnimOf( object );
	if ( ! anim ) return 0;
	const pending = anim.components.filter( ( c ) => c && c.time && getTextAnimDescriptor( c.type ) );
	if ( ! pending.length ) return 0;
	let migrated = 0;
	try {

		withObjectClip( editor, object, ( clip, target ) => {

			const horizon = Math.max( Number( clip.duration ) || 0, MIGRATE_MIN_HORIZON );
			for ( const comp of pending ) {

				const desc = getTextAnimDescriptor( comp.type );
				const tr = ensureTrack( target, textAnimPath( comp.id, 'progress' ) );
				if ( ! tr.keys.length ) {

					for ( const k of timeToProgressKeys( comp.time, horizon, desc ) ) upsertKey( tr, k.t, k.v, 1e-6, k.ease );

				}
				if ( ! anim.legacyTimes || typeof anim.legacyTimes !== 'object' ) anim.legacyTimes = {};
				anim.legacyTimes[ comp.id ] = comp.time;
				delete comp.time;
				migrated ++;

			}

		} );

	} catch ( e ) {

		console.warn( '[textanim] time → keys migration failed, kept v2 time', object && object.name, e );

	}
	return migrated;

}

export function migratePendingTextAnimTimes( editor, root ) {

	const scene = root || ( editor && editor.scene );
	if ( ! scene || typeof scene.traverse !== 'function' ) return 0;
	const texts = [];
	scene.traverse( ( obj ) => {

		if ( obj.userData && obj.userData.__fccTextAnimChar ) return;
		if ( isUIText( obj ) ) texts.push( obj );

	} );
	let n = 0;
	for ( const obj of texts ) n += migrateTextAnimTimesOn( editor, obj );
	if ( n ) console.log( '[textanim] converted ' + n + ' component time window(s) into .anim keys' );
	return n;

}
