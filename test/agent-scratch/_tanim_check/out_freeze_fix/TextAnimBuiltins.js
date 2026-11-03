/**
 * FreeFilmCut textanim/3 —first-party components.
 *
 * Imported for side effects by TextAnimTypes.js, so the registry is always
 * populated before any document is normalized or sampled.
 *
 * Channel / param conventions (docs/textanim-v2-plan.md §2):
 *   offsets add, rotations add, scale multiplies, opacity multiplies.
 *   Every number below is read from ctx.params —NEVER hard-coded in sample() —
 *   because .anim keys override params right before sampling (TextAnimEngine.resolveComponent).
 */

import { registerTextAnim } from './TextAnimRegistry.js';

const WIPE_DIRS = [ 'ltr', 'rtl', 'ttb', 'btt' ];
const WIPE_BLENDS = [ 'normal', 'add', 'screen', 'multiply' ];
const EASES = [ 'linear', 'cubicOut', 'cubicInOut', 'bounceOut', 'spring' ];

function clamp01( x ) {

	return x < 0 ? 0 : ( x > 1 ? 1 : x );

}

function numParam( label, labelZh, def, min, max, step, unit ) {

	return {
		type: 'number',
		default: def,
		min,
		max,
		step: step != null ? step : 0.01,
		unit: unit || '',
		label,
		labelZh,
	};

}

const NUM_OFFSET = { type: 'number', min: - 500, max: 500, step: 1, unit: 'px' };
const NUM_ROT = { type: 'number', min: - 6.2832, max: 6.2832, step: 0.01, unit: 'rad' };
const NUM_SCALE = { type: 'number', min: 0, max: 4, step: 0.01 };

// ---------------------------------------------------------------- charIn / charOut

/**
 * charIn / charOut: single keyable channel values (no From->To).
 * Defaults are the resting pose; the anim editor keys the entrance/exit.
 *
 * Two sampling modes (see TextAnimEngine):
 *   paramsMapped — params were re-sampled at this char's local progress on the
 *     same keyed curve (CapCut stagger). Apply as absolute pose * amount.
 *   static — no param keys; treat sidebar values as the start (in) or end
 *     (out) pose and lerp to/from rest by selector weight u.
 */
function charStepDescriptor( type, label, labelZh ) {

	const isIn = type !== 'charOut';

	return {
		scope: 'char',
		category: isIn ? 'in' : 'out',
		group: 'transform',
		label,
		labelZh,
		channels: [ 'opacity', 'offsetX', 'offsetY', 'scale', 'rotateX', 'rotateY', 'rotateZ' ],
		// Only the channels v1 actually used start enabled — the rest are opt-in.
		defaultChannels: { opacity: true, offsetX: false, offsetY: true, scale: true, rotateX: false, rotateY: false, rotateZ: true },
		selector: true,
		progressMappedParams: true,
		defaultDuration: 0.8,
		hintZh: '在动画编辑器里对通道与进度打 K；错开=按字延迟同一条「起点→静息」曲线（不是整段共用当前插值）。',
		params: {
			opacity: numParam( 'Opacity', '透明度', 1, 0, 1, 0.01 ),
			offsetX: numParam( 'Offset X', '偏移X', 0, - 500, 500, 1, 'px' ),
			offsetY: numParam( 'Offset Y', '偏移Y', 0, - 500, 500, 1, 'px' ),
			scale: numParam( 'Scale', '缩放', 1, 0, 4, 0.01 ),
			rotateX: numParam( 'Rotate X', '旋转X', 0, - 6.2832, 6.2832, 0.01, 'rad' ),
			rotateY: numParam( 'Rotate Y', '旋转Y', 0, - 6.2832, 6.2832, 0.01, 'rad' ),
			rotateZ: numParam( 'Rotate Z', '旋转Z', 0, - 6.2832, 6.2832, 0.01, 'rad' ),
		},
		sample( ctx, pose ) {

			const P = ctx.params;
			const on = ctx.on;
			const u = ctx.p;
			const mapped = !! ctx.paramsMapped;

			const amp = ( ctx.amount != null && Number.isFinite( Number( ctx.amount ) ) )
				? Number( ctx.amount ) : 1;

			function mixOffset( v ) {

				const x = Number( v ) || 0;
				// mapped: absolute curve sample * intensity (legacy path)
				if ( mapped ) return x * amp;
				return isIn ? x * ( 1 - u ) : x * u;

			}

			function mixOpacity( v ) {

				const o = Number.isFinite( Number( v ) ) ? clamp01( Number( v ) ) : 1;
				if ( mapped ) return 1 + ( o - 1 ) * amp;
				// in: lerp(start, 1, u); out: lerp(1, end, u)
				return isIn ? ( o + ( 1 - o ) * u ) : ( 1 + ( o - 1 ) * u );

			}

			function mixScale( v ) {

				const s0 = Number.isFinite( Number( v ) ) ? Number( v ) : 1;
				if ( mapped ) return 1 + ( s0 - 1 ) * amp;
				return isIn ? ( s0 + ( 1 - s0 ) * u ) : ( 1 + ( s0 - 1 ) * u );

			}

			function mixRot( v ) {

				const x = Number( v ) || 0;
				if ( mapped ) return x * amp;
				return isIn ? x * ( 1 - u ) : x * u;

			}

			if ( on.opacity ) pose.opacity *= mixOpacity( P.opacity );
			if ( on.offsetX ) pose.offsetX += mixOffset( P.offsetX );
			if ( on.offsetY ) pose.offsetY += mixOffset( P.offsetY );
			if ( on.rotateX ) pose.rotateX += mixRot( P.rotateX );
			if ( on.rotateY ) pose.rotateY += mixRot( P.rotateY );
			if ( on.rotateZ ) pose.rotateZ += mixRot( P.rotateZ );
			if ( on.scale ) {

				const s = mixScale( P.scale );
				pose.scaleX *= s;
				pose.scaleY *= s;

			}

		},
	};

}

registerTextAnim( 'charIn', charStepDescriptor( 'charIn', 'Char In', '逐字入场' ) );

registerTextAnim( 'charOut', charStepDescriptor( 'charOut', 'Char Out', '逐字出场' ) );

// ---------------------------------------------------------------- wave

registerTextAnim( 'wave', {
	scope: 'char',
	group: 'motion',
	label: 'Wave',
	labelZh: '波浪',
	category: 'loop',
	channels: [ 'offsetY', 'offsetX' ],
	defaultChannels: { offsetY: true, offsetX: false },
	selector: true,
	defaultDuration: 1,
	hintZh: '按片段时间持续运动；进度控制振幅从「起振幅」到满量。',
	params: {
		amp: Object.assign( {}, NUM_OFFSET, { default: 12, min: 0, max: 400, label: 'Amp Y', labelZh: '振幅Y' } ),
		ampX: Object.assign( {}, NUM_OFFSET, { default: 0, min: 0, max: 400, label: 'Amp X', labelZh: '振幅X' } ),
		freq: { type: 'number', default: 1.25, min: 0, max: 8, step: 0.05, label: 'Frequency', labelZh: '频率' },
		speed: { type: 'number', default: 1, min: - 4, max: 4, step: 0.05, label: 'Speed', labelZh: '速度' },
		phase: { type: 'number', default: 0, min: - 12.566, max: 12.566, step: 0.1, label: 'Phase', labelZh: '初相位' },
		ramp: { type: 'number', default: 0.35, min: 0, max: 1, step: 0.05, label: 'Ramp in', labelZh: '起振幅' },
	},
	sample( ctx, pose ) {

		const P = ctx.params;
		const g = P.ramp + ( 1 - P.ramp ) * ctx.p;
		if ( g === 0 ) return;
		const ph = ctx.charIndex * P.freq + P.phase + ctx.t * Math.PI * 2 * P.speed;
		if ( ctx.on.offsetY ) pose.offsetY += Math.sin( ph ) * P.amp * g;
		if ( ctx.on.offsetX ) pose.offsetX += Math.cos( ph ) * P.ampX * g;

	},
} );

// ---------------------------------------------------------------- bend

registerTextAnim( 'bend', {
	scope: 'text',
	group: 'look',
	label: 'Bend',
	labelZh: '弯曲',
	category: 'loop',
	defaultDuration: 1,
	hintZh: '整体文字顶点式弯曲：绕中心 rotY/rotX 进深度再透视投影；中心与位置同属世界像素；弯后 AABB 重算。',
	params: {
		bendX: { type: 'number', default: 0, min: - 4, max: 4, step: 0.01, label: 'Bend X', labelZh: 'X轴弯曲' },
		bendY: { type: 'number', default: 0.35, min: - 4, max: 4, step: 0.01, label: 'Bend Y', labelZh: 'Y轴弯曲' },
		rotateZ: { type: 'number', default: 0, min: - 6.28, max: 6.28, step: 0.01, unit: 'rad', label: 'Rotate Z', labelZh: '平面旋转Z' },
		centerX: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, label: 'Center X', labelZh: '中心X' },
		centerY: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, label: 'Center Y', labelZh: '中心Y' },
	},
	resolvePass( ctx ) {

		const P = ctx.params || {};
		// Legacy char-bend used `amount` (rad) — map to bendY if new fields absent.
		const legacy = Number( P.amount );
		const bx = Number.isFinite( Number( P.bendX ) ) ? Number( P.bendX ) : 0;
		let by = Number( P.bendY );
		if ( ! Number.isFinite( by ) ) by = Number.isFinite( legacy ) ? legacy : 0.35;
		return {
			kind: 'bend',
			componentId: ctx.comp ? ctx.comp.id : '',
			progress: clamp01( ctx.raw ),
			bendX: Math.max( - 4, Math.min( 4, bx ) ),
			bendY: Math.max( - 4, Math.min( 4, by ) ),
			rotateZ: Math.max( - 6.2832, Math.min( 6.2832, Number.isFinite( Number( P.rotateZ ) ) ? Number( P.rotateZ ) : 0 ) ),
			centerX: Math.max( 0, Math.min( 1, Number.isFinite( Number( P.centerX ) ) ? Number( P.centerX ) : 0.5 ) ),
			centerY: Math.max( 0, Math.min( 1, Number.isFinite( Number( P.centerY ) ) ? Number( P.centerY ) : 0.5 ) ),
		};

	},
} );

// ---------------------------------------------------------------- jitter

function hash01( x ) {

	const s = Math.sin( x * 12.9898 ) * 43758.5453;
	return s - Math.floor( s );

}

registerTextAnim( 'jitter', {
	scope: 'char',
	group: 'motion',
	label: 'Jitter',
	labelZh: '抖动',
	category: 'loop',
	channels: [ 'offsetX', 'offsetY', 'rotateZ' ],
	defaultChannels: { offsetX: true, offsetY: true, rotateZ: false },
	selector: true,
	defaultDuration: 1,
	hintZh: '按字噪波抖动；seed 决定图案，speed 决定复用频率。',
	params: {
		ampX: { type: 'number', default: 4, min: 0, max: 200, step: 0.5, unit: 'px', label: 'Amp X', labelZh: '抖动X' },
		ampY: { type: 'number', default: 4, min: 0, max: 200, step: 0.5, unit: 'px', label: 'Amp Y', labelZh: '抖动Y' },
		rotate: { type: 'number', default: 0.05, min: 0, max: 1.5, step: 0.01, unit: 'rad', label: 'Rotate', labelZh: '旋转抖动' },
		speed: { type: 'number', default: 12, min: 0, max: 60, step: 0.5, label: 'Speed', labelZh: '速度' },
		seed: { type: 'number', default: 1, min: 0, max: 9999, step: 1, label: 'Seed', labelZh: '种子' },
	},
	sample( ctx, pose ) {

		const P = ctx.params;
		const g = ctx.p;
		if ( g === 0 ) return;
		const base = ctx.t * P.speed + ctx.charIndex * 1.7 + P.seed * 13.13;
		if ( ctx.on.offsetX ) pose.offsetX += ( hash01( base ) * 2 - 1 ) * P.ampX * g;
		if ( ctx.on.offsetY ) pose.offsetY += ( hash01( base + 37.7 ) * 2 - 1 ) * P.ampY * g;
		if ( ctx.on.rotateZ ) pose.rotateZ += ( hash01( base + 91.3 ) * 2 - 1 ) * P.rotate * g;

	},
} );

// ---------------------------------------------------------------- typewriter

registerTextAnim( 'typewriter', {
	scope: 'char',
	group: 'look',
	label: 'Typewriter',
	labelZh: '打字机',
	category: 'in',
	channels: [ 'opacity' ],
	defaultChannels: { opacity: true },
	selector: true,
	defaultDuration: 1,
	hintZh: '按selector 顺序硬切显示；fade>0 时每个字有一小段淡入。',
	params: {
		fade: { type: 'number', default: 0, min: 0, max: 1, step: 0.01, label: 'Fade', labelZh: '单字淡入' },
	},
	sample( ctx, pose ) {

		if ( ctx.amount <= 0 ) return;
		const fade = Math.max( 0, ctx.params.fade );
		const a = fade <= 0 ? ( ctx.raw > 0 ? 1 : 0 ) : clamp01( ctx.raw / fade );
		pose.opacity *= a;

	},
} );

// ---------------------------------------------------------------- wipeReveal (text pass)

registerTextAnim( 'wipeReveal', {
	scope: 'text',
	group: 'reveal',
	label: 'Wipe reveal',
	labelZh: '扫光',
	category: 'in',
	defaultDuration: 1,
	// v1 semantics: the sweep owns visibility, otherwise a per-char fade sits on
	// top of it and the blade reads as a muddy fade-in.
	defaultSuppressCharPose: true,
	hintZh: '整文片元扫光 + 刃光（走 TextLayerRT，不是逐字透明度）。',
	params: {
		direction: {
			type: 'select',
			options: WIPE_DIRS,
			default: 'ltr',
			label: 'Direction',
			labelZh: '方向',
			optionLabelsZh: { ltr: '左→右', rtl: '右→左', ttb: '上→下', btt: '下→上' },
		},
		soft: { type: 'number', default: 0.08, min: 0, max: 0.5, step: 0.01, label: 'Soft', labelZh: '软边' },
		edgeIntensity: { type: 'number', default: 2.5, min: 0, max: 8, step: 0.1, label: 'Edge', labelZh: '刃光强度' },
		edgeWidth: { type: 'number', default: 0.03, min: 0.005, max: 0.25, step: 0.005, label: 'Edge width', labelZh: '刃光宽度' },
		fillDim: { type: 'number', default: 1, min: 0, max: 1, step: 0.05, label: 'Fill dim', labelZh: '露出压暗(1=不压)' },
		fillRange: { type: 'number', default: 0.12, min: 0.02, max: 1, step: 0.01, label: 'Fill range', labelZh: '压暗范围' },
		fillPower: { type: 'number', default: 2.5, min: 0.5, max: 8, step: 0.1, label: 'Fill power', labelZh: '压暗曲线' },
		blendMode: {
			type: 'select',
			options: WIPE_BLENDS,
			default: 'normal',
			label: 'Blend',
			labelZh: '混合模式',
			optionLabelsZh: { normal: '正常', add: '叠加', screen: '滤色', multiply: '正片叠底' },
		},
		invert: { type: 'bool', default: false, label: 'Invert', labelZh: '反向（出场）' },
	},
	resolvePass( ctx ) {

		const P = ctx.params;
		let progress = clamp01( ctx.raw );
		if ( P.invert ) progress = 1 - progress;
		return {
			kind: 'wipe',
			componentId: ctx.comp ? ctx.comp.id : '',
			progress,
			direction: WIPE_DIRS.includes( P.direction ) ? P.direction : 'ltr',
			soft: Math.max( 0.02, Math.min( 0.45, P.soft ) ),
			edgeIntensity: Math.max( 0, P.edgeIntensity ),
			edgeWidth: Math.max( 0.005, Math.min( 0.25, P.edgeWidth ) ),
			fillDim: Math.max( 0, Math.min( 1, Number.isFinite( Number( P.fillDim ) ) ? Number( P.fillDim ) : 1 ) ),
			fillRange: Math.max( 0.02, Math.min( 1, Number.isFinite( Number( P.fillRange ) ) ? Number( P.fillRange ) : 0.12 ) ),
			fillPower: Math.max( 0.5, Math.min( 8, Number.isFinite( Number( P.fillPower ) ) ? Number( P.fillPower ) : 2.5 ) ),
			blendMode: WIPE_BLENDS.includes( P.blendMode ) ? P.blendMode : 'normal',
		};

	},
} );

export { EASES };
