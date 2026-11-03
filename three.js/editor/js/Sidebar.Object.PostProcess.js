/**
 * Camera post-process stack UI (Unity-like).
 * Shown when the selected object is a Camera.
 */

import { UIPanel, UIRow, UIText, UIButton, UISelect, UICheckbox, UINumber, UIDiv, UIColor } from './libs/ui.js';

import {
		ensureStackOnCamera,
		listEffectDescriptors,
		createDefaultEffectEntry,
		getEffectDescriptor,
	} from './postprocessing/PostProcessRegistry.js?v=fcc-ui-124';
	import { registerBuiltinEffects } from './postprocessing/BuiltinEffects.js?v=fcc-ui-124';
	import { stackHasEnabledEffects } from './postprocessing/PostProcessStack.js?v=fcc-ui-231';
	import {
		registerCustomEffectsFromStackData,
		createBlankCustomEffectDefinition,
		createCustomEffectEntry,
		registerCustomEffect,
		validateCustomEffectDefinition,
		scanCustomEffectsLibrary,
		migrateEntryTextureBindings,
		ensureCustomEffectMediaBindings,
		markCustomEffectRtSlotsForAutoCreate,
		registerCustomEffectAssetResolver,
		registerCustomEffectTextureUpdateListener,
	} from './postprocessing/CustomEffectRuntime.js?v=fcc-ui-231';
	import { buildCustomEffectEditor } from './Sidebar.Object.PostProcess.CustomEditor.js?v=fcc-ui-231';
import {
	isEffectParamExposed,
	setEffectParamExposed,
} from './ExposedParams.js?v=fcc-ui-229';
import {
	hasPostProcessParamKeyAtPlayhead,
	removePostProcessParamTracks,
	togglePostProcessParamKeyAtPlayhead,
	ensureObjectAnimClip,
} from './anim/FreeCapCutAnimCore.js?v=fcc-anim-22';

function markAnimClipForExport( editor, clip ) {

	if ( ! clip ) return;
	clip._export = true;
	if ( ! editor.freecapcutAnims ) editor.freecapcutAnims = [];
	const idx = editor.freecapcutAnims.findIndex( ( a ) => a === clip || ( a && a.name === clip.name ) );
	if ( idx >= 0 ) editor.freecapcutAnims[ idx ] = clip;
	else editor.freecapcutAnims.push( clip );

}

function isEditorAnimatablePpSchema( schema ) {

	const t = schema && schema.type;
	return t === 'float' || t === 'int' || t === 'boolean'
		|| t === 'color' || t === 'vec2' || t === 'vec3' || t === 'vec4';

}

registerBuiltinEffects();

// Entries whose definition editor is currently open (session-only state).
const editingEntryIds = new Set();

function SidebarObjectPostProcess( editor ) {

	const strings = editor.strings;
	const signals = editor.signals;
	const lang = editor.config.getKey( 'language' ) || 'en';

	// Custom-effect asset loading: project-relative path → blob URL via the
	// bound project folder (same restore path as MediaPlay video files).
	registerCustomEffectAssetResolver( async ( path ) => {

		const pf = editor.projectFolder;
		if ( ! pf ) return null;
		const bin = await pf.readBinaryFile( path );
		if ( ! bin || ! bin.buffer ) return null;
		return URL.createObjectURL( new Blob( [ bin.buffer ], { type: bin.mime || 'image/png' } ) );

	} );

	// Async texture resolve finishes after scene refresh — kick a re-render so
	// ConfigurablePass leaves passthrough and the effect becomes visible.
	registerCustomEffectTextureUpdateListener( () => {

		editor.signals.sceneGraphChanged.dispatch();

	} );

	const container = new UIPanel();
	container.setBorderTop( '1px solid #444' );
	container.setMarginTop( '12px' );
	container.setPaddingTop( '10px' );
	container.setDisplay( 'none' );

	const title = new UIText( strings.getKey( 'sidebar/object/postprocess' ) ).setFontWeight( 'bold' );
	container.add( title );

	const enabledRow = new UIRow().setMarginTop( '8px' );
	const enabledCb = new UICheckbox( true ).onChange( () => {
		const cam = currentCamera();
		if ( ! cam ) return;
		const stack = ensureStackOnCamera( cam );
		stack.enabled = enabledCb.getValue();
		dirty( cam );
	} );
	enabledRow.add( new UIText( strings.getKey( 'sidebar/object/postprocess/enabled' ) ).setClass( 'Label' ) );
	enabledRow.add( enabledCb );
	container.add( enabledRow );

	const hint = new UIText( strings.getKey( 'sidebar/object/postprocess/hint' ) )
		.setFontSize( '11px' )
		.setColor( '#aaa' )
		.setMarginTop( '4px' );
	container.add( hint );

	// Live preview only runs on editor.viewportCamera — warn when looking elsewhere.
	const previewStatus = new UIText( '' )
		.setFontSize( '11px' )
		.setMarginTop( '4px' );
	previewStatus.setDisplay( 'none' );
	container.add( previewStatus );

	const listPanel = new UIDiv().setMarginTop( '8px' );
	container.add( listPanel );

	function updatePreviewStatus( cam ) {

		if ( ! cam ) {

			previewStatus.setDisplay( 'none' );
			return;

		}

		const stack = ensureStackOnCamera( cam );
		const hasOn = stack.enabled !== false && ( stack.effects || [] ).some( ( e ) => e && e.enabled !== false );
		if ( ! hasOn ) {

			previewStatus.setDisplay( 'none' );
			return;

		}

		previewStatus.setDisplay( '' );
		if ( editor.viewportCamera === cam ) {

			previewStatus.setColor( '#7de08a' );
			previewStatus.setValue( lang === 'zh'
				? '✓ 正在通过此相机预览后处理'
				: '✓ Previewing post-process through this camera' );

		} else {

			previewStatus.setColor( '#e8c96a' );
			previewStatus.setValue( lang === 'zh'
				? '⚠ 当前视口不是此相机 — 勾选不会作用到画面。已尝试切换视口。'
				: '⚠ Viewport is not this camera — enabling has no on-screen effect. Switching…' );

		}

	}

	const addRow = new UIRow().setMarginTop( '8px' );
	const typeSelect = new UISelect().setWidth( '120px' );
	function fillTypeOptions() {

		// Rebuilt on refresh(): custom effects register lazily (demos on module
		// load, project definitions on stack scan) so the list grows over time.
		const options = {};
		for ( const d of listEffectDescriptors() ) {
			options[ d.type ] = ( lang === 'zh' && d.labelZh ) ? d.labelZh : d.label;
		}
		typeSelect.setOptions( options );
		const types = Object.keys( options );
		if ( types.length > 0 && types.indexOf( typeSelect.getValue() ) === - 1 ) {
			typeSelect.setValue( types[ 0 ] );
		}

	}
	fillTypeOptions();
	const addBtn = new UIButton( strings.getKey( 'sidebar/object/postprocess/add' ) ).onClick( async () => {
		const cam = currentCamera();
		if ( ! cam ) return;
		const stack = ensureStackOnCamera( cam );
		const type = typeSelect.getValue();
		let entry = createDefaultEffectEntry( type );
		if ( ! entry ) return;
		// Custom types: attach a cloned definition so RT autoCreate / export work.
		if ( typeof type === 'string' && type.indexOf( 'custom:' ) === 0 ) {
			const desc = getEffectDescriptor( type );
			const srcDef = desc && desc.__customDefinition;
			if ( srcDef ) {
				entry.definition = JSON.parse( JSON.stringify( srcDef ) );
				markCustomEffectRtSlotsForAutoCreate( entry.definition );
				migrateEntryTextureBindings( entry );
			}
		}
		stack.effects.push( entry );
		dirty( cam );
		rebuildList();
		if ( entry.definition ) {
			try {
				const changed = await ensureCustomEffectMediaBindings( editor, entry );
				if ( changed ) { dirty( cam ); rebuildList(); }
			} catch ( e ) { console.warn( '[FreeFilmCut] add custom-effect media bindings failed', e ); }
		}
	} );
	addRow.add( typeSelect );
	addRow.add( addBtn );
	container.add( addRow );

	const customRow = new UIRow().setMarginTop( '4px' );

	const newCustomBtn = new UIButton( lang === 'zh' ? '新建自定义效果' : 'New custom effect' ).onClick( () => {

		const cam = currentCamera();
		if ( ! cam ) return;
		const stack = ensureStackOnCamera( cam );
		const def = createBlankCustomEffectDefinition();
		const reg = registerCustomEffect( def );
		if ( ! reg.ok ) return;
		const entry = createCustomEffectEntry( def );
		if ( ! entry ) return;
		stack.effects.push( entry );
		editingEntryIds.add( entry.id );
		dirty( cam );
		rebuildList();

	} );
	customRow.add( newCustomBtn );

	const importBtn = new UIButton( lang === 'zh' ? '导入JSON' : 'Import JSON' ).setMarginLeft( '4px' ).onClick( () => {

		const fileInput = document.createElement( 'input' );
		fileInput.type = 'file';
		fileInput.accept = '.json,application/json';
		fileInput.onchange = async () => {

			const file = fileInput.files && fileInput.files[ 0 ];
			if ( ! file ) return;
			let def = null;
			try {

				def = JSON.parse( await file.text() );

			} catch ( e ) {

				alert( lang === 'zh' ? 'JSON 解析失败：' + e.message : 'Invalid JSON: ' + e.message );
				return;

			}

			const v = validateCustomEffectDefinition( def );
			if ( ! v.ok ) {

				alert( lang === 'zh' ? '定义校验失败：\n' + v.errors.join( '\n' ) : 'Invalid definition:\n' + v.errors.join( '\n' ) );
				return;

			}

			const reg = registerCustomEffect( def );
			if ( ! reg.ok ) {

				alert( ( lang === 'zh' ? '注册失败：\n' : 'Register failed:\n' ) + reg.errors.join( '\n' ) );
				return;

			}

			const cam = currentCamera();
			if ( ! cam ) return;
			const stack = ensureStackOnCamera( cam );
			// RT 贴图槽：导入即自动建 MediaPlay + RT（按槽位 / 媒体键去重，不重复创建）
			markCustomEffectRtSlotsForAutoCreate( def );
			const entry = createCustomEffectEntry( def );
			if ( ! entry ) return;
			migrateEntryTextureBindings( entry );
			stack.effects.push( entry );
			dirty( cam );
			rebuildList();
			try {

				const changed = await ensureCustomEffectMediaBindings( editor, entry );
				if ( changed ) {

					dirty( cam );
					rebuildList();

				}

			} catch ( e ) {

				console.warn( '[FreeFilmCut] import custom-effect media bindings failed', e );

			}

		};
		fileInput.click();

	} );
	customRow.add( importBtn );
	container.add( customRow );

	function currentCamera() {
		const obj = editor.selected;
		return ( obj && obj.isCamera ) ? obj : null;
	}

	function dirty( cam ) {
		editor.signals.objectChanged.dispatch( cam );
		editor.signals.sceneGraphChanged.dispatch();
		// Composer only reads editor.viewportCamera. Editor nav cam strips PP;
		// switch the viewport to this scene camera so Bloom/DeepGlow is visible.
		if ( cam && cam.isCamera && cam !== editor.camera && editor.viewportCamera !== cam ) {
			editor.setViewportCamera( cam.uuid );
		}
	}

	/** Outer param row ↔ definition.params[].default (same live value). */
	function setEntryParam( entry, key, value ) {

		if ( ! entry.params || typeof entry.params !== 'object' ) entry.params = {};
		entry.params[ key ] = value;
		const def = entry.definition;
		if ( ! def || ! Array.isArray( def.params ) ) return;
		for ( const p of def.params ) {

			if ( p && p.key === key ) {

				p.default = value;
				break;

			}

		}

	}

	function effectLabel( type ) {
		const d = getEffectDescriptor( type );
		if ( ! d ) return type;
		return ( lang === 'zh' && d.labelZh ) ? d.labelZh : d.label;
	}

	function rebuildList() {
		listPanel.clear();
		const cam = currentCamera();
		if ( ! cam ) return;
		const stack = ensureStackOnCamera( cam );
		enabledCb.setValue( stack.enabled !== false );

		stack.effects.forEach( ( entry, index ) => {
			const box = new UIPanel();
			box.setPadding( '6px' );
			box.setMarginTop( '6px' );
			box.setBackgroundColor( '#2a2a2a' );
			
			const head = new UIRow();
			const onCb = new UICheckbox( entry.enabled !== false ).onChange( () => {
				entry.enabled = onCb.getValue();
				dirty( cam );
			} );
			head.add( onCb );
			head.add( new UIText( effectLabel( entry.type ) ).setMarginLeft( '6px' ).setFontWeight( 'bold' ) );

			const upBtn = new UIButton( '↑' ).setMarginLeft( '6px' ).onClick( () => {
				if ( index <= 0 ) return;
				const tmp = stack.effects[ index - 1 ];
				stack.effects[ index - 1 ] = stack.effects[ index ];
				stack.effects[ index ] = tmp;
				dirty( cam );
				rebuildList();
			} );
			const downBtn = new UIButton( '↓' ).onClick( () => {
				if ( index >= stack.effects.length - 1 ) return;
				const tmp = stack.effects[ index + 1 ];
				stack.effects[ index + 1 ] = stack.effects[ index ];
				stack.effects[ index ] = tmp;
				dirty( cam );
				rebuildList();
			} );
			const rmBtn = new UIButton( strings.getKey( 'sidebar/object/postprocess/remove' ) ).onClick( () => {
				stack.effects.splice( index, 1 );
				dirty( cam );
				rebuildList();
			} );
			head.add( upBtn );
			head.add( downBtn );
			head.add( rmBtn );

			// ---- custom effect: edit entry + definition editor panel ----
			const isCustom = typeof entry.type === 'string' && entry.type.indexOf( 'custom:' ) === 0;
			if ( isCustom ) {

				const editBtn = new UIButton(
					editingEntryIds.has( entry.id )
						? ( lang === 'zh' ? '收起编辑' : 'Collapse' )
						: ( lang === 'zh' ? '编辑定义' : 'Edit' ),
				).setMarginLeft( '4px' ).onClick( () => {

					if ( editingEntryIds.has( entry.id ) ) editingEntryIds.delete( entry.id );
					else editingEntryIds.add( entry.id );
					rebuildList();

				} );
				head.add( editBtn );

			}
			box.add( head );

			if ( isCustom && editingEntryIds.has( entry.id ) ) {

				box.add( buildCustomEffectEditor( editor, cam, entry, {
					onDirty() {

						// Live preview (debounced) — same viewport switch as Apply.
						dirty( cam );

					},
					onApplied() {

						dirty( cam );
						// Refresh param rows under the entry — the definition may have
						// added/changed params. The editor panel reopens from the just
						// applied entry.definition (editingEntryIds still set).
						rebuildList();

					},
					onClose() {

						editingEntryIds.delete( entry.id );
						dirty( cam );
						rebuildList();

					},
				} ) );
				listPanel.add( box );
				return;

			}

			// Outer live params === definition.params[].default (setEntryParam ↔ writeParamDefault).
			const desc = getEffectDescriptor( entry.type );
			if ( desc && Array.isArray( desc.paramSchema ) ) {
				entry.params = { ...desc.createDefaultParams(), ...( entry.params || {} ) };
				// One-shot legacy default only (0.85) — never fight live slider edits
				const stack = ensureStackOnCamera( cam );
				if ( entry.type === 'bloom' && ! stack._bloomThresholdMigrated ) {
					stack._bloomThresholdMigrated = true;
					if ( entry.params.threshold === undefined || Number( entry.params.threshold ) === 0.85 ) {
						entry.params.threshold = 0.0;
					}
				}
				for ( const schema of desc.paramSchema ) {
					const row = new UIRow().setMarginTop( '4px' );
					const lab = ( lang === 'zh' && schema.labelZh ) ? schema.labelZh : schema.label;
					row.add( new UIText( lab ).setClass( 'Label' ).setWidth( '70px' ) );
					if ( schema.type === 'boolean' ) {
						const cb = new UICheckbox( !! entry.params[ schema.key ] ).onChange( () => {
							setEntryParam( entry, schema.key, cb.getValue() );
							dirty( cam );
						} );
						row.add( cb );
					} else if ( schema.type === 'color' ) {
						const col = new UIColor().setValue( entry.params[ schema.key ] || '#ffffff' ).onInput( () => {
							setEntryParam( entry, schema.key, col.getValue() );
							dirty( cam );
						} );
						row.add( col );
					} else if ( schema.type === 'vec2' || schema.type === 'vec3' || schema.type === 'vec4' ) {

						const size = Number( schema.type.slice( 3 ) );
						const arr = Array.isArray( entry.params[ schema.key ] ) ? entry.params[ schema.key ] : [];
						const comps = [];
						for ( let i = 0; i < size; i ++ ) {

							const num = new UINumber( Number( arr[ i ] ) || 0 )
								.setStep( 0.01 )
								.setWidth( '34px' );
							comps.push( num );
							num.onChange( () => {

								setEntryParam( entry, schema.key, comps.map( ( c ) => c.getValue() ) );
								dirty( cam );

							} );
							row.add( num );

						}

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
								setEntryParam( entry, schema.key, v );
								dirty( cam );
							} );
						row.add( num );
					}
					// Editor key (◆) vs NLE expose — mutually exclusive.
					const exposedNow = isEffectParamExposed( entry, schema.key );
					const canEditorKey = isEditorAnimatablePpSchema( schema ) && ! exposedNow;
					if ( isEditorAnimatablePpSchema( schema ) ) {

						const keyed = canEditorKey && hasPostProcessParamKeyAtPlayhead(
							editor, cam, entry.id, schema.key, schema.type,
						);
						const keyBtn = new UIButton( keyed ? '◆' : '◇' )
							.setWidth( '18px' )
							.setMarginLeft( '4px' );
						keyBtn.dom.title = exposedNow
							? ( lang === 'zh' ? '已勾选剪辑端，请在剪辑端打帧' : 'Exposed to NLE — keyframe there' )
							: ( lang === 'zh' ? '在播放头切换后处理关键帧' : 'Toggle PP key at playhead' );
						keyBtn.dom.classList.add( 'fcc-pp-key' );
						keyBtn.dom.style.cssText += [
							'background:transparent',
							'background-color:transparent',
							'border:none',
							'box-shadow:none',
							'padding:0 2px',
							'min-width:18px',
							'height:18px',
							'line-height:18px',
							'text-transform:none',
							'font-size:12px',
							'opacity:' + ( canEditorKey ? '1' : '0.35' ),
							'cursor:' + ( canEditorKey ? 'pointer' : 'not-allowed' ),
							'color:' + ( keyed ? '#fc6' : '#9a9a9a' ),
						].join( ';' ) + ';';
						keyBtn.dom.addEventListener( 'mouseenter', () => {

							if ( ! canEditorKey ) return;
							keyBtn.dom.style.background = 'transparent';
							keyBtn.dom.style.backgroundColor = 'transparent';
							keyBtn.dom.style.color = keyed ? '#ffe08a' : '#ddd';

						} );
						keyBtn.dom.addEventListener( 'mouseleave', () => {

							keyBtn.dom.style.background = 'transparent';
							keyBtn.dom.style.backgroundColor = 'transparent';
							keyBtn.dom.style.color = keyed ? '#fc6' : '#9a9a9a';

						} );
						keyBtn.onClick( () => {

							if ( ! canEditorKey ) return;
							const interp = schema.type === 'boolean' ? 'step' : 'linear';
							const result = togglePostProcessParamKeyAtPlayhead(
								editor,
								cam,
								entry.id,
								schema.key,
								schema.type,
								entry.params ? entry.params[ schema.key ] : undefined,
								interp,
							);
							if ( ! result ) return;
							const clip = ensureObjectAnimClip( editor, cam );
							markAnimClipForExport( editor, clip );
							if ( typeof editor.refreshAnimPanel === 'function' ) editor.refreshAnimPanel();
							else dirty( cam );
							rebuildList();

						} );
						row.add( keyBtn );

					}
					const exposeLab = new UIText( lang === 'zh' ? '剪辑端' : 'NLE' )
						.setFontSize( '10px' )
						.setColor( '#8af' )
						.setMarginLeft( '6px' );
					const exposeCb = new UICheckbox( exposedNow ).onChange( () => {

						const on = exposeCb.getValue();
						setEffectParamExposed( entry, schema.key, on );
						if ( on && isEditorAnimatablePpSchema( schema ) ) {

							removePostProcessParamTracks( editor, cam, entry.id, schema.key );
							if ( typeof editor.refreshAnimPanel === 'function' ) editor.refreshAnimPanel();

						}
						dirty( cam );
						rebuildList();

					} );
					row.add( exposeLab );
					row.add( exposeCb );
					box.add( row );
				}
			}

			listPanel.add( box );
		} );
	}

	function refresh() {
		const cam = currentCamera();
		if ( cam ) {
			container.setDisplay( '' );
			// Register custom definitions carried by this camera's stack so the
			// add-dropdown lists them (and saved projects restore on select).
			const stack = ensureStackOnCamera( cam );
			registerCustomEffectsFromStackData( stack );
			// Migrate legacy inline rtUuid → entry.textureBindings, then make
			// sure autoCreate RT slots have live bindings (idempotent, async —
			// may add MediaPlay/RT nodes; scene signals refresh the composer).
			for ( const entry of ( stack.effects || [] ) ) {

				if ( ! entry || typeof entry.type !== 'string' || ! entry.type.startsWith( 'custom:' ) ) continue;
				migrateEntryTextureBindings( entry );
				ensureCustomEffectMediaBindings( editor, entry ).then( ( changed ) => {

					if ( changed ) dirty( cam );

				} ).catch( () => {} );

			}
			fillTypeOptions();
			// Effects library scan (custom-effects/*.json in the project folder)
			// — async, list refreshes when restorations complete.
			scanCustomEffectsLibrary( editor.projectFolder ).then( ( count ) => {

				if ( count > 0 ) rebuildList();

			} ).catch( () => {} );
			rebuildList();
			// SS-Camera / scene PP only runs on editor.viewportCamera. Selecting a
			// scene camera that already has a stack jumps the viewport so Bloom hits
			// both scene meshes and Camera-mode UI in the same RenderPass.
			const hasEnabledEntry = stack.enabled !== false
				&& ( stack.effects || [] ).some( ( e ) => e && e.enabled !== false );
			if ( cam !== editor.camera && hasEnabledEntry && editor.viewportCamera !== cam ) {

				editor.setViewportCamera( cam.uuid );

			}
			updatePreviewStatus( cam );
		} else {
			container.setDisplay( 'none' );
		}
	}

	signals.objectSelected.add( refresh );
	signals.viewportCameraChanged.add( () => {

		const cam = currentCamera();
		if ( cam ) updatePreviewStatus( cam );

	} );
	signals.objectChanged.add( function ( object ) {
		if ( object === editor.selected && object && object.isCamera ) {
			// avoid full rebuild loops from our own dirty(); only sync enabled checkbox
			const stack = ensureStackOnCamera( object );
			enabledCb.setValue( stack.enabled !== false );
			updatePreviewStatus( object );
		}
	} );
	signals.editorCleared.add( () => container.setDisplay( 'none' ) );

	return container;

}

export { SidebarObjectPostProcess };
