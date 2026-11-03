// v1 migration + legacy repair + suppress semantics.
// node _tanim_check/t_wipe.mjs
import {
	normalizeTextAnim,
	repairFromLegacy,
	TEXTANIM_FORMAT,
} from '../three.js/editor/js/textanim/TextAnimTypes.js?v=fcc-tanim-4';
import {
	sampleTextAnim,
	sampleTextPassOps,
	charPoseSuppressed,
	textAnimNeedsCharSplit,
} from '../three.js/editor/js/textanim/TextAnimEngine.js?v=fcc-tanim-4';

let fail = 0;
function ok( name, cond, extra ) {

	if ( ! cond ) fail ++;
	console.log( ( cond ? 'PASS  ' : 'FAIL  ' ) + name + ( ! cond && extra ? '  → ' + JSON.stringify( extra ) : '' ) );

}

const v1Base = ( mods, wipe ) => ( {
	format: 'freecapcut.textanim/1',
	enabled: true,
	in: {
		duration: 1,
		ease: 'cubicOut',
		stagger: { overlap: 0.65, order: 'ltr', seed: 1 },
		channels: {
			opacity: { from: 0, to: 1 },
			offsetY: { from: - 36, to: 0 },
			scale: { from: 0.55, to: 1 },
			rotateZ: { from: - 0.35, to: 0 },
		},
		modulators: mods || {},
		...( wipe ? { wipeReveal: wipe } : {} ),
	},
	out: null,
} );

// 1) wipe under modulators
{
	const a = normalizeTextAnim( v1Base( { wipeReveal: { enabled: true, direction: 'rtl', soft: 0.2, edgeIntensity: 4 } } ) );
	const w = a.components.find( ( c ) => c.type === 'wipeReveal' );
	ok( '1a wipe in modulators migrated', !! w );
	ok( '1b direction kept', w && w.params.direction === 'rtl', w && w.params );
	ok( '1c suppressCharPose set', w && w.suppressCharPose === true );
	ok( '1d format is v2', a.format === TEXTANIM_FORMAT );
	ok( '1e legacyRepaired flagged', a.legacyRepaired === true );
}

// 2) wipe as phase sibling (older layout)
{
	const a = normalizeTextAnim( v1Base( null, { enabled: true, direction: 'ttb' } ) );
	const w = a.components.find( ( c ) => c.type === 'wipeReveal' );
	ok( '2a sibling wipe found', !! w, a.components.map( ( c ) => c.type ) );
	ok( '2b direction kept', w && w.params.direction === 'ttb' );
}

// 3) wipe only on out phase → inverted, starts after in
{
	const doc = v1Base( null );
	doc.out = {
		duration: 1.5,
		ease: 'cubicOut',
		stagger: { overlap: 0.65, order: 'ltr', seed: 1 },
		channels: { opacity: { from: 1, to: 0 }, scale: { from: 1, to: 0.55 }, offsetY: { from: 36, to: 0 } },
		modulators: { wipeReveal: { enabled: true, direction: 'ltr' } },
	};
	const a = normalizeTextAnim( doc );
	const w = a.components.filter( ( c ) => c.type === 'wipeReveal' );
	ok( '3a out-phase wipe migrated', w.length === 1, a.components.map( ( c ) => c.type ) );
	ok( '3b inverted', w[ 0 ] && w[ 0 ].params.invert === true );
	ok( '3c starts at in duration', w[ 0 ] && Math.abs( w[ 0 ].time.start - 1 ) < 1e-6, w[ 0 ] && w[ 0 ].time );
	ok( '3d owns visibility', w[ 0 ] && w[ 0 ].suppressCharPose === true );
}

// 4) document produced by the earlier buggy migration (wipe lost, legacy kept)
{
	const legacy = v1Base( { wipeReveal: { enabled: true, direction: 'ltr', edgeIntensity: 3 } } );
	const broken = {
		format: TEXTANIM_FORMAT,
		enabled: true,
		components: [
			{
				id: 'c_charIn_1', type: 'charIn', scope: 'char', enabled: true,
				time: { start: 0, duration: 1, loop: 'clamp', timeScale: 1 },
				channels: { opacity: true, offsetY: true, scale: true, rotateZ: true, offsetX: true },
				params: { opacity: [ 0, 1 ], offsetY: [ - 36, 0 ], scale: [ 0.55, 1 ] },
				selector: { order: 'ltr', delay: 0.35, ease: 'cubicOut', seed: 1, start: 0, end: 1, amount: 1 },
			},
		],
		legacy,
	};
	const a = normalizeTextAnim( broken );
	const w = a.components.find( ( c ) => c.type === 'wipeReveal' );
	ok( '4a repair put the wipe back', !! w, a.components.map( ( c ) => c.type ) );
	ok( '4b repair kept edgeIntensity', w && Math.abs( w.params.edgeIntensity - 3 ) < 1e-6 );
	ok( '4c repair marks legacyRepaired', a.legacyRepaired === true );

	// idempotent
	const before = a.components.length;
	repairFromLegacy( a );
	repairFromLegacy( a );
	ok( '4d repair is idempotent', a.components.length === before, { before, after: a.components.length } );
}

// 5) engine: suppression kills char split but keeps the pass op
{
	const a = normalizeTextAnim( {
		format: 'freecapcut.textanim/2',
		enabled: true,
		components: [
			{
				id: 'c_charIn_1', type: 'charIn', scope: 'char', enabled: true,
				time: { start: 0, duration: 1, loop: 'clamp', timeScale: 1 },
				channels: { opacity: true, offsetY: true },
				params: { opacity: [ 0, 1 ], offsetY: [ - 36, 0 ] },
				selector: { order: 'ltr', delay: 0.35, ease: 'cubicOut', seed: 1, start: 0, end: 1, amount: 1 },
			},
			{
				id: 'c_wipe_1', type: 'wipeReveal', scope: 'text', enabled: true,
				time: { start: 0, duration: 1, loop: 'clamp', timeScale: 1 },
				params: { direction: 'ltr', soft: 0.08, edgeIntensity: 2.5, edgeWidth: 0.03, invert: false },
				suppressCharPose: true,
			},
		],
		legacy: null,
	} );

	ok( '5a charPoseSuppressed true', charPoseSuppressed( a ) === true );
	ok( '5b no char split needed', textAnimNeedsCharSplit( a ) === false );
	const s = sampleTextAnim( a, 0.5, 4 );
	ok( '5c charPoses is null', s.charPoses === null, s.charPoses );
	ok( '5d pass op still emitted', s.passOps.length === 1 && s.passOps[ 0 ].kind === 'wipe', s.passOps );
	ok( '5e progress mid', Math.abs( s.passOps[ 0 ].progress - 0.5 ) < 1e-6, s.passOps[ 0 ] );

	// disabling suppression brings the char poses back
	a.components[ 1 ].suppressCharPose = false;
	const s2 = sampleTextAnim( a, 0.5, 4 );
	ok( '5f char poses return when Solo off', s2.needsCharSplit === true && Array.isArray( s2.charPoses ) );
	ok( '5g wipe still present', s2.passOps.length === 1 );
}

// 6) suppressCharPose is ignored on char components
{
	const a = normalizeTextAnim( {
		format: 'freecapcut.textanim/2',
		enabled: true,
		components: [ {
			id: 'c_wave_1', type: 'wave', scope: 'char', enabled: true,
			time: { start: 0, duration: 1, loop: 'infinite', timeScale: 1 },
			params: { amp: 12, freq: 1.25, speed: 1, phase: 0, ramp: 0.35 },
			selector: { order: 'ltr', delay: 0, ease: 'linear', seed: 1, start: 0, end: 1, amount: 1 },
			suppressCharPose: true,
		} ],
		legacy: null,
	} );
	ok( '6a flag dropped on char comp', a.components[ 0 ].suppressCharPose === undefined );
	ok( '6b suppression inert', charPoseSuppressed( a ) === false );
	ok( '6c split still happens', textAnimNeedsCharSplit( a ) === true );
}

// 7) pure JSON (must survive IndexedDB structuredClone)
{
	const a = normalizeTextAnim( v1Base( { wave: { enabled: true, amp: 20 }, wipeReveal: { enabled: true } } ) );
	const json = JSON.stringify( a );
	ok( '7a serialises', json.length > 100 );
	const back = JSON.parse( json );
	ok( '7b round-trip keeps components', back.components.length === a.components.length );
	ok( '7c no functions anywhere', ! /function|=>/.test( JSON.stringify( a, ( k, v ) => typeof v === 'function' ? 'FN' : v ) ) );
}

console.log( fail === 0 ? '\nALL PASS' : '\n' + fail + ' FAILED' );
process.exit( fail === 0 ? 0 : 1 );
