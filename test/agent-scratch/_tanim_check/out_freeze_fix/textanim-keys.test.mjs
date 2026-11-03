// node --test three.js/editor/test/
import test from 'node:test';
import assert from 'node:assert/strict';

import { applyAnimEase, ANIM_EASES } from '../js/anim/AnimEase.js';
import {
	sampleKeys, normalizeAnim, serializeAnimClip, applyAnimToRoot, upsertKey, ANIM_FORMAT,
} from '../js/anim/FreeCapCutAnimCore.js?v=fcc-anim-18';
import { getTextAnimSampleOpts } from '../js/ui/TextAnimOverrides.js';
import {
	createDefaultTextAnim, createDefaultComponent, normalizeComponentInPlace, timeToProgressKeys,
	ensureTextAnimOnUI,
} from '../js/textanim/TextAnimTypes.js?v=fcc-tanim-22';
import { sampleTextAnim, sampleTextPassOps, charWeight } from '../js/textanim/TextAnimEngine.js?v=fcc-tanim-22';
import { getTextAnimDescriptor } from '../js/textanim/TextAnimRegistry.js';

const near = ( a, b, eps = 1e-6 ) => assert.ok( Math.abs( a - b ) <= eps, a + ' !~ ' + b );

test( 'eases hit both endpoints and bend the right way', () => {

	for ( const e of ANIM_EASES ) {

		near( applyAnimEase( e, 0 ), 0 );
		near( applyAnimEase( e, 1 ), 1 );

	}
	assert.ok( applyAnimEase( 'easeIn', 0.5 ) < 0.5 );
	assert.ok( applyAnimEase( 'easeOut', 0.5 ) > 0.5 );
	assert.equal( applyAnimEase( 'step', 0.99 ), 0 );
	assert.ok( applyAnimEase( 'back', 0.8 ) > 1 );

} );

test( 'sampleKeys applies the left key ease per segment', () => {

	const keys = [ { t: 0, v: 0, ease: 'easeIn' }, { t: 1, v: 10 }, { t: 2, v: 20, ease: 'step' }, { t: 3, v: 0 } ];
	near( sampleKeys( keys, 0.5 ), 10 * 0.125 );
	near( sampleKeys( keys, 1.5 ), 15 );
	near( sampleKeys( keys, 2.9 ), 20 );
	near( sampleKeys( keys, 5 ), 0 );
	near( sampleKeys( keys, 0.5, 'step' ), 0 );

} );

test( 'ease survives normalize + serialize; linear is omitted', () => {

	const clip = normalizeAnim( { format: 'freecapcut.anim/1', duration: 1, targets: [ { objectUuid: 'u', tracks: [
		{ path: 'position.x', keys: [ { t: 0, v: 0, ease: 'bounce' }, { t: 1, v: 1, ease: 'linear' }, { t: 2, v: 2, ease: 'nope' } ] },
	] } ] } );
	const keys = clip.targets[ 0 ].tracks[ 0 ].keys;
	assert.equal( keys[ 0 ].ease, 'bounce' );
	assert.equal( keys[ 1 ].ease, undefined );
	assert.equal( keys[ 2 ].ease, undefined );
	const ser = serializeAnimClip( clip );
	assert.equal( ser.format, ANIM_FORMAT );
	assert.equal( ser.targets[ 0 ].tracks[ 0 ].keys[ 0 ].ease, 'bounce' );

} );

test( 'upsertKey keeps ease unless given', () => {

	const tr = { path: 'x', interp: 'linear', keys: [] };
	upsertKey( tr, 0, 1, 1e-4, 'easeOut' );
	upsertKey( tr, 0, 2 );
	assert.deepEqual( tr.keys, [ { t: 0, v: 2, ease: 'easeOut' } ] );
	upsertKey( tr, 0, 3, 1e-4, 'linear' );
	assert.deepEqual( tr.keys, [ { t: 0, v: 3 } ] );

} );

function fakeRoot( obj ) {

	return { getObjectByProperty: ( k, v ) => ( v === obj.uuid ? obj : null ) };

}

test( 'applyAnimToRoot routes textAnim.* into per-object overrides', () => {

	const obj = { uuid: 'txt', userData: {} };
	const root = fakeRoot( obj );
	const clip = normalizeAnim( { duration: 2, targets: [ { objectUuid: 'txt', tracks: [
		{ path: 'textAnim.c1.progress', keys: [ { t: 0, v: 0 }, { t: 2, v: 1 } ] },
		{ path: 'textAnim.c1.amp', keys: [ { t: 0, v: 30 } ] },
	] } ] } );
	applyAnimToRoot( root, clip, 1 );
	let o = getTextAnimSampleOpts( obj );
	near( o.time, 1 );
	near( o.values.get( 'c1.progress' ), 0.5 );
	near( o.values.get( 'c1.amp' ), 30 );

	clip.targets[ 0 ].tracks.pop();
	applyAnimToRoot( root, clip, 2 );
	o = getTextAnimSampleOpts( obj );
	assert.equal( o.values.has( 'c1.amp' ), false );

	clip.targets[ 0 ].tracks.length = 0;
	applyAnimToRoot( root, clip, 2 );
	// Empty textAnim tracks skip beginTextAnimTarget; stale values remain until
	// applyAllEditorAnims / clearTextAnimOverrides. Last written progress stays.
	assert.equal( getTextAnimSampleOpts( obj ).values.get( 'c1.progress' ), 1 );

} );

test( 'components carry no time; a legacy time is kept for migration', () => {

	const anim = createDefaultTextAnim();
	const c = createDefaultComponent( anim, 'wave' );
	assert.equal( c.time, undefined );
	normalizeComponentInPlace( c );
	assert.equal( c.time, undefined );

	const legacy = { id: 'c_charIn_1', type: 'charIn', time: { start: 0.5, duration: 2, loop: 'clamp' } };
	normalizeComponentInPlace( legacy );
	assert.equal( legacy.time.start, 0.5 );

	const ui = { textAnim: { format: 'freecapcut.textanim/2', enabled: true, components: [ legacy ] } };
	const doc = ensureTextAnimOnUI( ui );
	assert.equal( doc.format, 'freecapcut.textanim/3' );
	assert.equal( doc.components[ 0 ].time.duration, 2 );

	assert.equal( getTextAnimDescriptor( 'charOut' ).category, 'out' );
	assert.equal( getTextAnimDescriptor( 'wave' ).category, 'loop' );
	assert.equal( getTextAnimDescriptor( 'wipeReveal' ).category, 'in' );

} );

test( 'timeToProgressKeys reproduces the v2 loop modes', () => {

	assert.deepEqual( timeToProgressKeys( { start: 1, duration: 2, loop: 'clamp' }, 0 ), [ { t: 1, v: 0 }, { t: 3, v: 1 } ] );
	assert.deepEqual( timeToProgressKeys( { start: 0, duration: 1, loop: 'infinite' }, 9 ), [ { t: 0, v: 0 }, { t: 1, v: 1 } ] );
	assert.deepEqual( timeToProgressKeys( { start: 0, duration: 2, loop: 'clamp', timeScale: 2 }, 0 ), [ { t: 0, v: 0 }, { t: 1, v: 1 } ] );

	const pp = timeToProgressKeys( { start: 0, duration: 1, loop: 'pingpong' }, 3 );
	assert.deepEqual( pp.map( ( k ) => k.v ), [ 0, 1, 0, 1 ] );

	const saw = timeToProgressKeys( { start: 0, duration: 1, loop: 'loop' }, 2 );
	near( sampleKeys( saw, 0.5 ), 0.5 );
	near( sampleKeys( saw, 1.0005 ), 1 );
	near( sampleKeys( saw, 1.5 ), 0.5, 1e-3 );
	near( sampleKeys( saw, 2 ), 1 );

} );

test( 'progress-domain stagger matches the v2 time-domain formula', () => {

	const n = 5;
	const delay = 0.4;
	const dur = 2;
	const sel = { delay, ease: 'linear', amount: 1, start: 0, end: 1 };
	for ( const lt of [ 0, 0.3, 0.9, 1.4, 2 ] ) {

		for ( let rank = 0; rank < n; rank ++ ) {

			const step = delay * dur / ( n - 1 );
			const win = dur - step * ( n - 1 );
			const l = lt - rank * step;
			const old = l <= 0 ? 0 : ( l >= win ? 1 : l / win );
			near( charWeight( lt / dur, rank, n, sel ).raw, old, 1e-9 );

		}

	}

} );

function charInAnim() {

	const anim = createDefaultTextAnim();
	anim.enabled = true;
	const c = createDefaultComponent( anim, 'charIn' );
	anim.components.push( c );
	return { anim, c };

}

test( 'no progress key = end state; static amplitude + keyed progress', () => {

	const { anim, c } = charInAnim();
	// Rest defaults: no keys → progress held at 1 → rest pose.
	let s = sampleTextAnim( anim, 3, {} );
	near( s.charPoses[ 0 ].opacity, 1 );
	near( s.charPoses[ 0 ].offsetY, 0 );

	// Static sidebar amplitude (start pose) + progress 0 → all chars at start.
	c.params.offsetY = - 36;
	c.params.opacity = 0;
	const values = new Map( [ [ c.id + '.progress', 0 ] ] );
	s = sampleTextAnim( anim, 3, { values } );
	near( s.charPoses[ 0 ].opacity, 0 );
	near( s.charPoses[ 0 ].offsetY, - 36 );

	values.set( c.id + '.progress', 1 );
	s = sampleTextAnim( anim, 3, { values } );
	near( s.charPoses[ 0 ].opacity, 1 );
	near( s.charPoses[ 0 ].offsetY, 0 );

	values.set( c.id + '.progress', 0.5 );
	values.set( c.id + '.selector.delay', 0 );
	c.selector.ease = 'linear';
	s = sampleTextAnim( anim, 3, { values } );
	near( s.charPoses[ 0 ].opacity, s.charPoses[ 2 ].opacity );
	near( s.charPoses[ 0 ].offsetY, - 18 );

	values.set( c.id + '.enabled', 0 );
	s = sampleTextAnim( anim, 3, { values } );
	near( s.charPoses[ 0 ].opacity, 1 );
	near( s.charPoses[ 0 ].offsetY, 0 );

} );

test( 'keyed offsetY+progress with delay: far-amp x weight stagger, not global*u', () => {

	const { anim, c } = charInAnim();
	c.selector.delay = 0.6;
	c.selector.amount = 1;
	c.selector.ease = 'linear';
	const n = 5;
	const progKeys = [ { t: 0, v: 0 }, { t: 1, v: 1 } ];
	const yKeys = [ { t: 0, v: - 36 }, { t: 1, v: 0 } ];
	const values = new Map( [ [ c.id + '.progress', 0.5 ] ] );
	const keys = new Map( [
		[ c.id + '.progress', progKeys ],
		[ c.id + '.offsetY', yKeys ],
	] );
	const s = sampleTextAnim( anim, n, { values, keys } );
	const ys = s.charPoses.map( ( p ) => p.offsetY );
	// Far amp is -36 (key at progress 0); each char gets -36*(1-u_i).
	assert.ok( ys[ 0 ] > ys[ n - 1 ] - 1e-6, 'earlier chars closer to rest (0) than later: ' + ys );
	assert.ok( Math.abs( ys[ 0 ] - ys[ n - 1 ] ) > 5, 'visible stagger, not rigid: ' + ys );
	near( ys[ 0 ], 0, 0.5 );
	assert.ok( ys[ n - 1 ] < - 10, 'late char still below: ' + ys[ n - 1 ] );

	// Live global Y must NOT be used as amplitude (would compress to ~-18 span).
	values.set( c.id + '.offsetY', - 18 );
	const s2 = sampleTextAnim( anim, n, { values, keys } );
	near( s2.charPoses[ n - 1 ].offsetY, ys[ n - 1 ], 0.5 );

	// Without keys map, still staggers from first-key fallback via values? 
	// No keys → far falls back to static params (rest 0) unless sidebar set.
	c.params.offsetY = - 36;
	const s3 = sampleTextAnim( anim, n, { values: new Map( [ [ c.id + '.progress', 0.5 ] ] ) } );
	assert.ok( Math.abs( s3.charPoses[ 0 ].offsetY - s3.charPoses[ n - 1 ].offsetY ) > 5, 'sidebar far amp staggers' );

} );

test( 'regression: paramsMapped absolute path must not zero motion if engaged', () => {

	const { anim, c } = charInAnim();
	c.selector.delay = 0;
	const values = new Map( [ [ c.id + '.progress', 0 ], [ c.id + '.offsetY', - 36 ] ] );
	const keys = new Map( [
		[ c.id + '.progress', [ { t: 0, v: 0 }, { t: 1, v: 1 } ] ],
		[ c.id + '.offsetY', [ { t: 0, v: - 36 }, { t: 1, v: 0 } ] ],
	] );
	const s0 = sampleTextAnim( anim, 3, { values, keys } );
	near( s0.charPoses[ 0 ].offsetY, - 36, 0.5 );
	values.set( c.id + '.progress', 1 );
	values.set( c.id + '.offsetY', 0 );
	const s1 = sampleTextAnim( anim, 3, { values, keys } );
	near( s1.charPoses[ 0 ].offsetY, 0, 0.5 );

} );

test( 'wave uses the clip clock; wipe progress comes from keys', () => {

	const anim = createDefaultTextAnim();
	anim.enabled = true;
	const w = createDefaultComponent( anim, 'wave' );
	anim.components.push( w );
	const a = sampleTextAnim( anim, 4, { time: 0 } ).charPoses[ 1 ].offsetY;
	const b = sampleTextAnim( anim, 4, { time: 0.2 } ).charPoses[ 1 ].offsetY;
	assert.notEqual( a, b );

	const wipe = createDefaultComponent( anim, 'wipeReveal' );
	anim.components.push( wipe );
	const ops = sampleTextPassOps( anim, { values: new Map( [ [ wipe.id + '.progress', 0.25 ] ] ) } );
	near( ops.find( ( o ) => o.kind === 'wipe' ).progress, 0.25 );
	near( sampleTextPassOps( anim, {} ).find( ( o ) => o.kind === 'wipe' ).progress, 1 );

} );
