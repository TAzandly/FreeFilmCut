/**
 * Text Fx stack UI — same effect Registry as camera post-process.
 * Data: fccUI.textFxStack. Runs after Text→RT (not on camera.postProcessStack).
 */

import { UIPanel, UIRow, UIText, UIButton, UISelect, UICheckbox, UINumber, UIDiv, UIColor } from './libs/ui.js';

import {
	ensureTextFxStack,
	listEffectDescriptors,
	createDefaultEffectEntry,
	getEffectDescriptor,
	stackDataHasEnabledEffects,
} from './postprocessing/PostProcessRegistry.js?v=fcc-ui-124';
import { registerBuiltinEffects } from './postprocessing/BuiltinEffects.js?v=fcc-ui-124';
import { getFccUI, isUIText } from './ui/UIConstants.js?v=fcc-ui-106';

registerBuiltinEffects();

function SidebarObjectTextFx( editor ) {

	const strings = editor.strings;
	const signals = editor.signals;
	const lang = editor.config.getKey( 'language' ) || 'en';

	const container = new UIPanel();
	container.setBorderTop( '2px solid #4a8' );
	container.setMarginTop( '12px' );
	container.setPaddingTop( '10px' );
	container.setDisplay( 'none' );
	container.dom.style.background = '#1e2420';
	container.dom.style.padding = '8px';
	container.dom.style.borderRadius = '4px';

	const FOLD_KEY = 'sidebar/text/fxCollapsed';
	function isFxCollapsed() {

		return editor.config.getKey( FOLD_KEY ) !== false;

	}

	const headerRow = new UIRow();
	headerRow.setCursor( 'pointer' );
	headerRow.dom.style.userSelect = 'none';
	const caret = new UIText( isFxCollapsed() ? '▶' : '▼' ).setWidth( '16px' ).setColor( '#8cf' );
	const titleText = lang === 'zh'
		? '文字后处理 Fx（Text→RT）'
		: ( strings.getKey( 'sidebar/object/textfx' ) || 'Text Fx (Text→RT)' );
	const title = new UIText( titleText ).setFontWeight( 'bold' ).setColor( '#8cf' );
	headerRow.add( caret );
	headerRow.add( title );
	container.add( headerRow );

	const body = new UIDiv();
	body.setDisplay( isFxCollapsed() ? 'none' : '' );
	container.add( body );

	headerRow.onClick( function () {

		const next = ! isFxCollapsed();
		editor.config.setKey( FOLD_KEY, next );
		caret.setTextContent( next ? '▶' : '▼' );
		body.setDisplay( next ? 'none' : '' );

	} );

	const hint = new UIText(
		strings.getKey( 'sidebar/object/textfx/hint' )
		|| ( lang === 'zh'
			? '与相机后处理共用效果库。作用于 Text→RT 之后；开预览或添加效果后视口走 RT 路径。'
			: 'Same Registry as camera PP. Runs after Text→RT; viewport uses RT path when effects are on.' )
	).setFontSize( '11px' ).setColor( '#aaa' ).setMarginTop( '4px' );
	body.add( hint );

	const enabledRow = new UIRow().setMarginTop( '8px' );
	const enabledCb = new UICheckbox( true ).onChange( () => {

		const ui = currentUI();
		if ( ! ui ) return;
		const stack = ensureTextFxStack( ui );
		stack.enabled = enabledCb.getValue();
		dirty();

	} );
	enabledRow.add( new UIText(
		strings.getKey( 'sidebar/object/textfx/enabled' ) || ( lang === 'zh' ? '启用' : 'Enabled' )
	).setClass( 'Label' ) );
	enabledRow.add( enabledCb );
	body.add( enabledRow );

	const listPanel = new UIDiv().setMarginTop( '8px' );
	body.add( listPanel );

	const addRow = new UIRow().setMarginTop( '8px' );
	const typeSelect = new UISelect().setWidth( '120px' );
	const options = {};
	for ( const d of listEffectDescriptors( { input: 'texture' } ) ) {

		options[ d.type ] = ( lang === 'zh' && d.labelZh ) ? d.labelZh : d.label;

	}

	typeSelect.setOptions( options );
	const texTypes = listEffectDescriptors( { input: 'texture' } );
	if ( texTypes.length > 0 ) {

		// Prefer invert for quick verify
		const prefer = texTypes.find( ( d ) => d.type === 'invert' ) || texTypes[ 0 ];
		typeSelect.setValue( prefer.type );

	}

	const addBtn = new UIButton(
		strings.getKey( 'sidebar/object/textfx/add' ) || ( lang === 'zh' ? '添加' : 'Add' )
	).onClick( () => {

		const ui = currentUI();
		if ( ! ui ) return;
		const stack = ensureTextFxStack( ui );
		const entry = createDefaultEffectEntry( typeSelect.getValue() );
		if ( ! entry ) return;
		stack.effects.push( entry );
		dirty();
		rebuildList();

	} );
	addRow.add( typeSelect );
	addRow.add( addBtn );
	body.add( addRow );

	/** Walk up from selection (Troika child → fccUI text group). */
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

	function dirty() {

		const obj = currentText();
		if ( ! obj ) return;
		editor.signals.objectChanged.dispatch( obj );
		editor.signals.sceneGraphChanged.dispatch();

	}

	function effectLabel( type ) {

		const d = getEffectDescriptor( type );
		if ( ! d ) return type;
		return ( lang === 'zh' && d.labelZh ) ? d.labelZh : d.label;

	}

	function rebuildList() {

		listPanel.clear();
		const ui = currentUI();
		if ( ! ui ) return;
		const stack = ensureTextFxStack( ui );
		enabledCb.setValue( stack.enabled !== false );

		stack.effects.forEach( ( entry, index ) => {

			const box = new UIPanel();
			box.setPadding( '6px' );
			box.setMarginTop( '6px' );
			box.setBackgroundColor( '#2a2a2a' );

			const head = new UIRow();
			const onCb = new UICheckbox( entry.enabled !== false ).onChange( () => {

				entry.enabled = onCb.getValue();
				dirty();

			} );
			head.add( onCb );
			head.add( new UIText( effectLabel( entry.type ) ).setMarginLeft( '6px' ).setFontWeight( 'bold' ) );

			const upBtn = new UIButton( '↑' ).setMarginLeft( '6px' ).onClick( () => {

				if ( index <= 0 ) return;
				const tmp = stack.effects[ index - 1 ];
				stack.effects[ index - 1 ] = stack.effects[ index ];
				stack.effects[ index ] = tmp;
				dirty();
				rebuildList();

			} );
			const downBtn = new UIButton( '↓' ).onClick( () => {

				if ( index >= stack.effects.length - 1 ) return;
				const tmp = stack.effects[ index + 1 ];
				stack.effects[ index + 1 ] = stack.effects[ index ];
				stack.effects[ index ] = tmp;
				dirty();
				rebuildList();

			} );
			const rmBtn = new UIButton(
				strings.getKey( 'sidebar/object/textfx/remove' ) || ( lang === 'zh' ? '删除' : 'Remove' )
			).onClick( () => {

				stack.effects.splice( index, 1 );
				dirty();
				rebuildList();

			} );
			head.add( upBtn );
			head.add( downBtn );
			head.add( rmBtn );
			box.add( head );

			const desc = getEffectDescriptor( entry.type );
			if ( desc && Array.isArray( desc.paramSchema ) ) {

				entry.params = { ...desc.createDefaultParams(), ...( entry.params || {} ) };
				for ( const schema of desc.paramSchema ) {

					const row = new UIRow().setMarginTop( '4px' );
					const lab = ( lang === 'zh' && schema.labelZh ) ? schema.labelZh : schema.label;
					row.add( new UIText( lab ).setClass( 'Label' ).setWidth( '70px' ) );
					if ( schema.type === 'boolean' ) {

						const cb = new UICheckbox( !! entry.params[ schema.key ] ).onChange( () => {

							entry.params[ schema.key ] = cb.getValue();
							dirty();

						} );
						row.add( cb );

					} else if ( schema.type === 'color' ) {

						const col = new UIColor().setValue( entry.params[ schema.key ] || '#ffffff' ).onInput( () => {

							entry.params[ schema.key ] = col.getValue();
							dirty();

						} );
						row.add( col );

					} else {

						const isInt = schema.type === 'int';
						const num = new UINumber( entry.params[ schema.key ] ?? 0 )
							.setRange( schema.min ?? 0, schema.max ?? 1 )
							.setPrecision( isInt ? 0 : 2 )
							.setStep( schema.step ?? ( isInt ? 1 : 0.01 ) )
							.setWidth( '50px' )
							.onChange( () => {

								let v = num.getValue();
								if ( isInt ) v = Math.round( v );
								entry.params[ schema.key ] = v;
								dirty();

							} );
						row.add( num );

					}

					box.add( row );

				}

			}

			if ( entry.type === 'bloom' ) {

				const note = new UIText(
					lang === 'zh'
						? '※ 文字 RT 为 sRGB8；Bloom 与相机共用参数，但非 HDR 精度。'
						: '※ Text RT is sRGB8; Bloom shares params with camera but is LDR-limited.'
				).setFontSize( '10px' ).setColor( '#c80' ).setMarginTop( '4px' );
				box.add( note );

			}

			listPanel.add( box );

		} );

	}

	function refresh() {

		const obj = currentText();
		if ( obj ) {

			container.setDisplay( '' );
			rebuildList();

		} else {

			container.setDisplay( 'none' );

		}

	}

	signals.objectSelected.add( refresh );
	signals.objectChanged.add( function ( object ) {

		const textObj = resolveUIText( editor.selected );
		if ( object === editor.selected && textObj ) {

			const ui = getFccUI( textObj );
			if ( ui ) enabledCb.setValue( ensureTextFxStack( ui ).enabled !== false );

		}

	} );
	signals.editorCleared.add( () => container.setDisplay( 'none' ) );

	return container;

}

export { SidebarObjectTextFx };
