/**
 * 文字动画 (textanim v3) — AE-style component stack.
 *
 * Each card is one component instance:
 *   char scope — per-glyph pose channels (offset / scale / rotate / opacity)
 *   text scope — bend / wipe (刃光) inside the Troika materials (TextGeomFx)
 *   every control is generated from the descriptor's param schema
 *
 * Timing lives in the Text's `.anim` clip: `textAnim.<id>.progress` plus any
 * keyed param. A keyed field is read-only here (◆) — edit it in the animation
 * panel. Static values below are what un-keyed fields use.
 */

import { UIPanel, UIRow, UIText, UIButton, UISelect, UICheckbox, UINumber, UIDiv } from './libs/ui.js';

import { getFccUI, isUIText } from './ui/UIConstants.js?v=fcc-ui-136';
import {
	ensureTextAnimOnUI,
	TEXTANIM_EASES,
	TEXTANIM_ORDERS,
} from './ui/TextAnim.js?v=fcc-ui-146';
import {
	createDefaultComponent,
	TEXTANIM_MAX_COMPONENTS,
	orderTextAnimComponents,
} from './textanim/TextAnimTypes.js?v=fcc-tanim-24';
import {
	getTextAnimDescriptor,
	listTextAnims,
} from './textanim/TextAnimRegistry.js';
// Builtins register via TextAnimTypes side-effect — do not import Builtins again
// (mismatched ?v= URLs would double-register into the same Map).
import { clearTextAnimPreview } from './ui/TextAnimRuntime.js?v=fcc-ui-212';
import {
	addDefaultProgressKeys,
	removeTextAnimComponentTracks,
	findTextAnimTrack,
	migrateTextAnimTimesOn,
	textAnimPath,
} from './ui/TextAnimKeys.js?v=fcc-ui-146';

const CH_LABELS = {
	opacity: [ 'Opacity', '透明度' ],
	offsetX: [ 'Offset X', '偏移X' ],
	offsetY: [ 'Offset Y', '偏移Y' ],
	scale: [ 'Scale', '缩放' ],
	rotateX: [ 'Rotate X', '旋转X' ],
	rotateY: [ 'Rotate Y', '旋转Y' ],
	rotateZ: [ 'Rotate Z', '旋转Z' ],
	charProgress: [ 'Progress', '进度' ],
};

const ORDER_LABELS = {
	ltr: [ 'LTR', '从左到右' ],
	rtl: [ 'RTL', '从右到左' ],
	center: [ 'Center out', '由中间向外' ],
	edges: [ 'Edges in', '由两端向内' ],
	random: [ 'Random', '随机' ],
};

const CATEGORY_LABELS = {
	in: [ 'In', '入场' ],
	out: [ 'Out', '出场' ],
	loop: [ 'Loop', '循环' ],
};

function deepClone( v ) {

	try {

		return JSON.parse( JSON.stringify( v ) );

	} catch ( e ) {

		return v;

	}

}

function SidebarObjectTextAnim( editor ) {

	const signals = editor.signals;
	const lang = editor.config.getKey( 'language' ) || 'en';
	const zh = lang === 'zh';
	const t = ( en, cn ) => ( zh ? cn : en );

	if ( editor.textAnimWipeDebug == null ) {

		editor.textAnimWipeDebug = editor.config.getKey( 'sidebar/text/wipeDebug' ) === true;

	}

	const collapsedCards = new Set();

	const container = new UIPanel();
	container.setBorderTop( '2px solid #a84' );
	container.setMarginTop( '12px' );
	container.setPaddingTop( '10px' );
	container.setDisplay( 'none' );
	container.dom.style.background = '#24201e';
	container.dom.style.padding = '8px';
	container.dom.style.borderRadius = '4px';

	const FOLD_KEY = 'sidebar/text/animCollapsed';
	function isAnimCollapsed() {

		return editor.config.getKey( FOLD_KEY ) !== false;

	}

	const headerRow = new UIRow();
	headerRow.setCursor( 'pointer' );
	headerRow.dom.style.userSelect = 'none';
	const caret = new UIText( isAnimCollapsed() ? '▶' : '▼' ).setWidth( '16px' ).setColor( '#fc8' );
	const title = new UIText( t( 'Text animation', '文字动画' ) )
		.setFontWeight( 'bold' ).setColor( '#fc8' );
	headerRow.add( caret );
	headerRow.add( title );
	container.add( headerRow );

	const body = new UIDiv();
	body.setDisplay( isAnimCollapsed() ? 'none' : '' );
	container.add( body );

	headerRow.onClick( function () {

		const next = ! isAnimCollapsed();
		editor.config.setKey( FOLD_KEY, next );
		caret.setTextContent( next ? '▶' : '▼' );
		body.setDisplay( next ? 'none' : '' );

	} );

	const hint = new UIText( t(
		'Components stack in order. Timing = keyframes in the animation panel (progress / params). ◆ = keyed.',
		'组件按顺序叠加；时间由动画编辑器里的关键帧控制（进度 / 参数）。◆ = 已 K 帧，在动画编辑器中修改。',
	) ).setFontSize( '11px' ).setColor( '#aaa' ).setMarginTop( '4px' );
	body.add( hint );

	const openAnimBtn = new UIButton( t( 'Edit in animation panel', '在动画编辑器中编辑' ) ).setMarginTop( '6px' )
		.onClick( () => {

			if ( typeof editor.openAnimationPanel === 'function' ) editor.openAnimationPanel();

		} );
	body.add( openAnimBtn );

	function resolveUIText( object ) {

		let p = object;
		while ( p ) {

			if ( isUIText( p ) ) return p;
			p = p.parent;

		}

		return null;

	}

	function currentText() {

		return resolveUIText( editor.selected );

	}

	function currentUI() {

		const obj = currentText();
		return obj ? getFccUI( obj ) : null;

	}

	function currentAnim() {

		const ui = currentUI();
		return ui ? ensureTextAnimOnUI( ui ) : null;

	}

	/**
	 * Push a viewport redraw. Avoid objectChanged here — that rebuilds this panel
	 * and orphans UINumber bindings mid-edit.
	 */
	function dirty( rebuild = false ) {

		const obj = currentText();
		if ( ! obj ) return;
		if ( rebuild ) obj.userData.__fccTextAnimBuiltSig = null;
		editor.signals.sceneGraphChanged.dispatch();

	}

	/** True when this field has keys in any clip (the sidebar value is then ignored). */
	function isKeyed( comp, field ) {

		const obj = currentText();
		return !! ( obj && findTextAnimTrack( editor, obj.uuid, textAnimPath( comp.id, field ) ) );

	}

	function markKeyed( row, inputs ) {

		const label = row.dom.firstChild;
		if ( label ) label.textContent = '◆ ' + label.textContent;
		row.dom.title = t( 'Keyed — edit in the animation panel', '已 K 帧 —— 请在动画编辑器中修改' );
		for ( const n of inputs ) {

			n.dom.disabled = true;
			n.dom.style.opacity = '0.55';
			n.dom.style.pointerEvents = 'none';

		}

	}

	function refreshAnimPanel() {

		if ( typeof editor.refreshAnimPanel === 'function' ) editor.refreshAnimPanel();

	}

	// ---- enable ----
	const enabledRow = new UIRow().setMarginTop( '8px' );
	const enabledCb = new UICheckbox( false ).onChange( () => {

		const anim = currentAnim();
		if ( ! anim ) return;
		anim.enabled = enabledCb.getValue();
		if ( ! anim.enabled ) {

			const obj = currentText();
			if ( obj ) clearTextAnimPreview( obj );

		}

		dirty( true );

	} );
	enabledRow.add( new UIText( t( 'Enable', '启用' ) ).setClass( 'Label' ) );
	enabledRow.add( enabledCb );
	body.add( enabledRow );

	// ---- add component ----
	const addRow = new UIRow().setMarginTop( '8px' );
	const addSel = new UISelect().setWidth( '150px' );
	const addOpts = { '': t( '+ Add animation', '+ 添加动画' ) };
	const groups = [
		[ 'char', t( 'Per char', '逐字' ) ],
		[ 'text', t( 'Whole text', '整文' ) ],
	];
	for ( const [ scope, prefix ] of groups ) {

		for ( const d of listTextAnims( scope ) ) {

			addOpts[ d.type ] = prefix + ' · ' + ( zh ? d.labelZh : d.label );

		}

	}

	addSel.setOptions( addOpts ).setValue( '' ).onChange( () => {

		const type = addSel.getValue();
		addSel.setValue( '' );
		if ( ! type ) return;
		addComponent( type );

	} );
	addRow.add( addSel );
	body.add( addRow );

	const stack = new UIDiv().setMarginTop( '6px' );
	body.add( stack );

	// ---- helpers for controls ----

	function labelRow( parent, textStr, width ) {

		const row = new UIRow().setMarginTop( '4px' );
		row.add( new UIText( textStr ).setClass( 'Label' ).setWidth( width || '64px' ) );
		parent.add( row );
		return row;

	}

	/** @param {boolean} [keyed] value comes from .anim keys → read-only */
	function addNumber( parent, label, value, onChange, range, step, precision, width, keyed ) {

		const row = labelRow( parent, label );
		const n = new UINumber( value )
			.setRange( range[ 0 ], range[ 1 ] )
			.setPrecision( precision != null ? precision : 2 )
			.setStep( step != null ? step : 0.01 )
			.setWidth( width || '56px' )
			.onChange( () => {

				onChange( n.getValue() );
				dirty( false );

			} );
		row.add( n );
		if ( keyed ) markKeyed( row, [ n ] );
		return n;

	}

	function addSelect( parent, label, options, value, onChange, width ) {

		const row = labelRow( parent, label );
		const sel = new UISelect().setWidth( width || '100px' ).setOptions( options )
			.setValue( value )
			.onChange( () => {

				onChange( sel.getValue() );
				dirty( false );

			} );
		row.add( sel );
		return sel;

	}

	// ---- structural ops ----

	function addComponent( type ) {

		const anim = currentAnim();
		if ( ! anim ) return;
		if ( anim.components.length >= TEXTANIM_MAX_COMPONENTS ) {

			console.warn( '[textanim] component limit reached:', TEXTANIM_MAX_COMPONENTS );
			return;

		}

		const comp = createDefaultComponent( anim, type );
		anim.components.push( comp );
		orderTextAnimComponents( anim );

		// in: 0→1 from the playhead; out: same with easeIn; loop: a single 1.
		const obj = currentText();
		const t0 = typeof editor.getAnimPreviewTime === 'function' ? editor.getAnimPreviewTime() : 0;
		if ( obj ) addDefaultProgressKeys( editor, obj, comp, t0 );

		refresh();
		dirty( true );
		refreshAnimPanel();

	}

	function removeComponent( comp ) {

		const anim = currentAnim();
		if ( ! anim ) return;
		const i = anim.components.indexOf( comp );
		if ( i < 0 ) return;
		anim.components.splice( i, 1 );
		collapsedCards.delete( comp.id );
		const obj = currentText();
		if ( obj ) removeTextAnimComponentTracks( editor, obj.uuid, comp.id );
		refresh();
		dirty( true );
		refreshAnimPanel();

	}

	function moveComponent( from, to ) {

		const anim = currentAnim();
		if ( ! anim ) return;
		if ( from === to || from < 0 || to < 0 ) return;
		if ( from >= anim.components.length || to >= anim.components.length ) return;
		const [ c ] = anim.components.splice( from, 1 );
		anim.components.splice( to, 0, c );
		refresh();
		dirty( false );

	}

	// ---- card ----

	function buildCard( anim, comp, index ) {

		const desc = getTextAnimDescriptor( comp.type );
		const card = new UIDiv();
		card.setMarginTop( '6px' );
		card.dom.style.border = '1px solid #3d3733';
		card.dom.style.borderRadius = '3px';
		card.dom.style.background = comp.enabled ? '#2a2624' : '#221f1d';
		card.dom.style.padding = '4px 6px 6px 6px';

		// drop target for reorder
		card.dom.addEventListener( 'dragover', ( e ) => {

			e.preventDefault();
			card.dom.style.borderColor = '#fc8';

		} );
		card.dom.addEventListener( 'dragleave', () => {

			card.dom.style.borderColor = '#3d3733';

		} );
		card.dom.addEventListener( 'drop', ( e ) => {

			e.preventDefault();
			card.dom.style.borderColor = '#3d3733';
			if ( draggingIndex == null ) return;
			const from = draggingIndex;
			draggingIndex = null;
			moveComponent( from, index );

		} );

		// ---- header ----
		const head = new UIRow();
		head.dom.style.alignItems = 'center';

		const handle = new UIText( '⋮' ).setColor( '#888' ).setWidth( '16px' );
		handle.dom.style.cursor = 'grab';
		handle.dom.draggable = true;
		handle.dom.addEventListener( 'dragstart', ( e ) => {

			draggingIndex = index;
			e.dataTransfer.effectAllowed = 'move';

		} );
		handle.dom.addEventListener( 'dragend', () => {

			draggingIndex = null;

		} );
		head.add( handle );

		const isCollapsed = collapsedCards.has( comp.id );
		const fold = new UIText( isCollapsed ? '▶' : '▼' ).setWidth( '14px' ).setColor( '#aaa' );
		fold.setCursor( 'pointer' );
		head.add( fold );

		const nameText = new UIText( desc ? ( zh ? desc.labelZh : desc.label ) : comp.type )
			.setColor( comp.enabled ? '#eee' : '#777' );
		nameText.setFontWeight( 'bold' );
		head.add( nameText );

		const scopeChip = new UIText( comp.scope === 'text' ? t( 'text', '整文' ) : t( 'char', '逐字' ) )
			.setFontSize( '9px' ).setColor( comp.scope === 'text' ? '#8cf' : '#9c9' );
		scopeChip.setMarginLeft( '6px' );
		head.add( scopeChip );

		const spacer = new UIText( '' );
		spacer.dom.style.flex = '1';
		head.add( spacer );

		const eye = new UIButton( comp.enabled ? '👁' : '–' ).setWidth( '24px' )
			.onClick( () => {

				comp.enabled = ! comp.enabled;
				refresh();
				dirty( true );

			} );
		head.add( eye );

		const del = new UIButton( '×' ).setWidth( '22px' ).setMarginLeft( '4px' )
			.onClick( () => removeComponent( comp ) );
		head.add( del );

		card.add( head );

		const cardBody = new UIDiv().setDisplay( isCollapsed ? 'none' : '' );
		card.add( cardBody );

		fold.onClick( () => {

			if ( collapsedCards.has( comp.id ) ) collapsedCards.delete( comp.id );
			else collapsedCards.add( comp.id );
			refresh();

		} );
		nameText.setCursor( 'pointer' );
		nameText.onClick( () => {

			if ( collapsedCards.has( comp.id ) ) collapsedCards.delete( comp.id );
			else collapsedCards.add( comp.id );
			refresh();

		} );

		if ( ! desc ) {

			cardBody.add( new UIText( t(
				'Unknown component type (kept as-is, disabled): ' + comp.type,
				'未知组件类型（已保留但禁用）：' + comp.type,
			) ).setFontSize( '10px' ).setColor( '#f88' ) );
			return card;

		}

		if ( desc.hintZh ) {

			cardBody.add( new UIText( zh ? desc.hintZh : desc.hint )
				.setFontSize( '10px' ).setColor( '#8a8' ).setMarginTop( '2px' ) );

		}

		// ---- timing = progress keys ----
		const cat = CATEGORY_LABELS[ desc.category ] || CATEGORY_LABELS.in;
		const progressKeyed = isKeyed( comp, 'progress' );
		const timingRow = labelRow( cardBody, t( 'Timing', '时间' ) );
		timingRow.add( new UIText( ( zh ? cat[ 1 ] : cat[ 0 ] ) + ' · ' + ( progressKeyed
			? t( '◆ progress keyed', '◆ 进度已 K 帧' )
			: t( 'no progress keys (held at end)', '无进度关键帧（停在终态）' ) ) )
			.setFontSize( '10px' ).setColor( progressKeyed ? '#e9a' : '#c96' ) );
		if ( ! progressKeyed ) {

			const seed = new UIButton( t( 'Add keys', '生成关键帧' ) ).setMarginLeft( '6px' ).onClick( () => {

				const obj = currentText();
				const t0 = typeof editor.getAnimPreviewTime === 'function' ? editor.getAnimPreviewTime() : 0;
				if ( obj ) addDefaultProgressKeys( editor, obj, comp, t0 );
				refresh();
				refreshAnimPanel();

			} );
			timingRow.add( seed );

		}

		// ---- selector (char only) ----
		if ( comp.selector ) {

			const selLabel = new UIText( t( 'Range selector', '范围 / 错开' ) ).setFontWeight( 'bold' )
				.setColor( '#bbb' ).setMarginTop( '8px' );
			cardBody.add( selLabel );

			const orderOptions = {};
			for ( const key of TEXTANIM_ORDERS ) orderOptions[ key ] = zh ? ORDER_LABELS[ key ][ 1 ] : ORDER_LABELS[ key ][ 0 ];

			addSelect( cardBody, t( 'Order', '顺序' ), orderOptions, comp.selector.order,
				( v ) => {

					comp.selector.order = v;
					refresh();

				}, '110px' );

			addNumber( cardBody, t( 'Stagger', '错开' ), comp.selector.delay,
				( v ) => {

					comp.selector.delay = Math.max( 0, Math.min( 1, v ) );

				}, [ 0, 1 ], 0.02, 2, '48px', isKeyed( comp, 'selector.delay' ) );

			addNumber( cardBody, t( 'Amount', '强度' ), comp.selector.amount,
				( v ) => {

					comp.selector.amount = v;

				}, [ - 4, 4 ], 0.02, 2, '48px', isKeyed( comp, 'selector.amount' ) );

			const easeOptions = {};
			for ( const e of TEXTANIM_EASES ) easeOptions[ e ] = e;

			addSelect( cardBody, t( 'Ease', '缓动' ), easeOptions, comp.selector.ease,
				( v ) => {

					comp.selector.ease = v;

				}, '96px' );

			const rangeRow = labelRow( cardBody, t( 'Chars', '字范围' ) );
			const r0 = new UINumber( comp.selector.start ).setRange( 0, 1 ).setPrecision( 2 )
				.setStep( 0.01 ).setWidth( '44px' )
				.onChange( () => {

					comp.selector.start = Math.max( 0, Math.min( 1, r0.getValue() ) );
					dirty( false );

				} );
			const r1 = new UINumber( comp.selector.end ).setRange( 0, 1 ).setPrecision( 2 )
				.setStep( 0.01 ).setWidth( '44px' )
				.onChange( () => {

					comp.selector.end = Math.max( 0, Math.min( 1, r1.getValue() ) );
					dirty( false );

				} );
			rangeRow.add( r0 );
			rangeRow.add( new UIText( '⋮' ).setMarginLeft( '2px' ).setMarginRight( '2px' ) );
			rangeRow.add( r1 );
			const rangeKeyed = [ isKeyed( comp, 'selector.start' ), isKeyed( comp, 'selector.end' ) ];
			if ( rangeKeyed[ 0 ] || rangeKeyed[ 1 ] ) markKeyed( rangeRow, [ r0, r1 ].filter( ( _, k ) => rangeKeyed[ k ] ) );

			if ( comp.selector.order === 'random' ) {

				addNumber( cardBody, t( 'Seed', '种子' ), comp.selector.seed,
					( v ) => {

						comp.selector.seed = Math.floor( v ) || 1;

					}, [ 1, 99999 ], 1, 0, '48px' );

			}

		}

		// ---- channels ----
		if ( desc.channels.length > 1 ) {

			const chLabel = new UIText( t( 'Channels', '通道' ) ).setFontWeight( 'bold' )
				.setColor( '#bbb' ).setMarginTop( '8px' );
			cardBody.add( chLabel );

			const chRow = new UIRow().setMarginTop( '2px' );
			chRow.dom.style.flexWrap = 'wrap';
			for ( const ch of desc.channels ) {

				const lab = CH_LABELS[ ch ] || [ ch, ch ];
				const cb = new UICheckbox( comp.channels[ ch ] !== false )
					.onChange( () => {

						comp.channels[ ch ] = cb.getValue();
						dirty( true );

					} );
				const wrap = new UIDiv();
				wrap.dom.style.display = 'inline-flex';
				wrap.dom.style.alignItems = 'center';
				wrap.dom.style.marginRight = '6px';
				wrap.add( cb );
				wrap.add( new UIText( zh ? lab[ 1 ] : lab[ 0 ] ).setFontSize( '10px' ).setColor( '#999' ) );
				chRow.add( wrap );

			}

			cardBody.add( chRow );

		}

		// ---- text pass owns visibility (opt-in solo; wipe never solos) ----
		if ( desc.scope === 'text' && comp.type !== 'wipeReveal' ) {

			const ownRow = labelRow( cardBody, t( 'Solo', '独占显隐' ), '72px' );
			const own = new UICheckbox( comp.suppressCharPose === true )
				.onChange( () => {

					comp.suppressCharPose = own.getValue() === true;
					refresh();
					dirty( true );

				} );
			ownRow.add( own );
			ownRow.add( new UIText( t( 'rest pose, opacity 1', '字形静止、不透明' ) )
				.setFontSize( '10px' ).setColor( '#999' ).setMarginLeft( '4px' ) );

		}

		// ---- params from schema ----
		const params = new UIDiv().setMarginTop( '4px' );
		cardBody.add( params );

		for ( const key of Object.keys( desc.params ) ) {

			const def = desc.params[ key ];
			// A channel that is switched off hides its own params.
			if ( def.channel && comp.channels[ def.channel ] === false ) continue;
			if ( desc.channels.includes( key ) && comp.channels[ key ] === false ) continue;

			const label = zh ? ( def.labelZh || key ) : ( def.label || key );
			const unit = def.unit ? ' (' + def.unit + ')' : '';

			if ( def.type === 'select' ) {

				const opts = {};
				const list = Array.isArray( def.options ) ? def.options : Object.keys( def.options || {} );
				for ( const o of list ) {

					opts[ o ] = ( def.optionLabelsZh && zh && def.optionLabelsZh[ o ] ) || o;

				}

				addSelect( params, label, opts, comp.params[ key ], ( v ) => {

					comp.params[ key ] = v;
					dirty( true );

				}, '110px' );

			} else if ( def.type === 'bool' ) {

				const row = labelRow( params, label );
				const cb = new UICheckbox( !! comp.params[ key ] ).onChange( () => {

					comp.params[ key ] = cb.getValue();
					dirty( false );

				} );
				row.add( cb );
				if ( isKeyed( comp, key ) ) markKeyed( row, [ cb ] );

			} else {

				addNumber( params, label + unit, comp.params[ key ],
					( v ) => {

						comp.params[ key ] = v;

					},
					[ def.min != null ? def.min : - 9999, def.max != null ? def.max : 9999 ],
					def.step != null ? def.step : 0.01,
					( def.step != null && def.step < 0.1 ) ? 3 : 2,
					'56px', isKeyed( comp, key ) );

			}

		}

		return card;

	}

	function buildStack() {

		stack.clear();
		const anim = currentAnim();
		if ( ! anim ) return;

		if ( anim.components.length === 0 ) {

			stack.add( new UIText( t(
				'No components yet — add one above.',
				'还没有组件，用上面的下拉添加。',
			) ).setFontSize( '11px' ).setColor( '#777' ).setMarginTop( '4px' ) );
			return;

		}

		for ( let i = 0; i < anim.components.length; i ++ ) {

			stack.add( buildCard( anim, anim.components[ i ], i ) );

		}

	}

	// ---- debug (wipe mask) ----
	const dbgRow = new UIRow().setMarginTop( '8px' );
	const dbgCb = new UICheckbox( !! editor.textAnimWipeDebug ).onChange( () => {

		editor.textAnimWipeDebug = dbgCb.getValue();
		editor.config.setKey( 'sidebar/text/wipeDebug', editor.textAnimWipeDebug );
		dirty( false );

	} );
	dbgRow.add( new UIText( t( 'Debug wipe mask', '调试：显示扫光遮罩' ) ).setClass( 'Label' ).setWidth( '140px' ) );
	dbgRow.add( dbgCb );
	body.add( dbgRow );

	const note = new UIText( t(
		'· Wipe / bend run in the text materials. Key progress & params via “+ Text anim keys” in the animation panel; the timeline drives them through the clip.',
		'· 扫光 / 弯曲在文字材质里完成。进度与参数在动画编辑器「+ 文字动画关键帧」里 K；Timeline 通过动画片段驱动。',
	) ).setFontSize( '10px' ).setColor( '#8a8' ).setMarginTop( '6px' );
	body.add( note );

	// ---- refresh ----
	let draggingIndex = null;

	function refresh() {

		const obj = currentText();
		if ( ! obj ) {

			container.setDisplay( 'none' );
			return;

		}

		container.setDisplay( '' );
		// Re-sync the fold state: it may have been changed from config / another panel.
		const folded = isAnimCollapsed();
		caret.setTextContent( folded ? '▶' : '▼' );
		body.setDisplay( folded ? 'none' : '' );

		const ui = getFccUI( obj );
		const anim = ensureTextAnimOnUI( ui );
		if ( ! editor.isLoadingState && migrateTextAnimTimesOn( editor, obj ) ) refreshAnimPanel();

		enabledCb.setValue( !! anim.enabled );
		buildStack();

	}

	signals.objectSelected.add( refresh );
	signals.objectChanged.add( function ( object ) {

		if ( resolveUIText( object ) === currentText() ) refresh();

	} );
	signals.editorCleared.add( () => {

		container.setDisplay( 'none' );

	} );

	return container;

}

export { SidebarObjectTextAnim };
