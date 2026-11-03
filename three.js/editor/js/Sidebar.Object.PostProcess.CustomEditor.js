/**
 * FreeFilmCut —Custom post-effect definition editor (P2).
 *
 * Edits a CustomEffectDefinition attached to a camera stack entry
 * (entry.definition). Structure edits rebuild the panel; shader/name edits
 * write straight into the working copy. Edits commit live (no Apply button);
 * composer rebuilds via definition fingerprint in structureSignature.
 *
 * Texture files are picked and copied into the effect asset dir
 * (custom-effects/<效果名>/assets/...); the definition stores the project-relative
 * path only (dataUrl kept solely as a legacy fallback). Self-contained as an
 * effect package folder across project save/load and vfxpack export.
 */

import {
	UIPanel, UIRow, UIText, UIButton, UISelect, UICheckbox, UINumber, UIDiv,
	UIColor, UIInput, UITextArea,
} from './libs/ui.js';

import {
	validateCustomEffectDefinition,
	registerCustomEffect,
	saveCustomEffectToLibrary,
	customEffectJsonFileName,
	customEffectAssetDir,
	resolveCustomEffectAssetUrl,
	ensureCustomEffectMediaBindings,
	DEFAULT_VERTEX_SHADER_SRC,
} from './postprocessing/CustomEffectRuntime.js?v=fcc-ui-231';
import { getEffectDescriptor } from './postprocessing/PostProcessRegistry.js?v=fcc-ui-124';
import { listRenderTextureOptions } from './media/FccVideo.js?v=fcc-ui-207';

const COPY_FRAGMENT_SHADER = `
	uniform sampler2D uInput;
	varying vec2 vUv;
	void main() {
		gl_FragColor = texture2D( uInput, vUv );
	}
`;

const PARAM_TYPES = [ 'float', 'int', 'boolean', 'color', 'vec2', 'vec3', 'vec4' ];

function monospace( ta, height ) {

	ta.dom.style.width = '100%';
	ta.dom.style.height = height;
	ta.dom.style.fontFamily = 'Consolas, Monaco, monospace';
	ta.dom.style.fontSize = '11px';
	ta.dom.style.whiteSpace = 'pre';
	ta.dom.style.resize = 'vertical';
	return ta;

}

function listenInput( ui, handler ) {

	// UITextArea only fires 'change' on blur —bind 'input' directly for live edits.
	ui.dom.addEventListener( 'input', handler );
	return ui;

}

function defaultSourceOptions() {

	return {
		'uInput': 'uInput（主链输入＝上 effect 输出/相机画面）',
		'$camera': '$camera（相机原始画面）',
		'uTransitionFrom': 'uTransitionFrom（转场出画）',
		'uTransitionTo': 'uTransitionTo（转场入画）',
	};

}

function sourceOptionsFor( def, passIndex, currentValue ) {

	const opts = defaultSourceOptions();
	for ( let j = 0; j < passIndex; j ++ ) {

		const p = def.passes[ j ];
		const rt = p && p.output && p.output.rt;
		if ( rt ) opts[ '$rt:' + rt ] = '$rt:' + rt + ( p.name ? '（' + p.name + '）' : '' );

	}

	for ( const t of def.textures || [] ) {

		opts[ '$tex:' + t.name ] = '$tex:' + t.name;

	}

	if ( currentValue && ! opts[ currentValue ] ) opts[ currentValue ] = currentValue;
	return opts;

}

function ensurePassDefaults( pass ) {

	if ( ! pass.inputs ) pass.inputs = {};
	if ( pass.vertexShader === undefined ) pass.vertexShader = 'default';
	if ( pass.downsample === undefined ) pass.downsample = 1;
	if ( pass.colorSpace === undefined ) pass.colorSpace = 'linear';

}

/** RT name must match CustomEffectRuntime validation: /^[a-zA-Z_][a-zA-Z0-9_]*$/. */
function sanitizeRtBase( name, index ) {

	let base = String( name || '' ).replace( /[^a-zA-Z0-9_]+/g, '_' ).replace( /^[^a-zA-Z_]+/, '' );
	if ( ! base ) base = 'pass' + ( index + 1 );
	return base;

}

function allocateRtName( preferredBase, used ) {

	let name = /_rt\d*$/.test( preferredBase ) ? preferredBase : preferredBase + '_rt';
	if ( ! /^[a-zA-Z_][a-zA-Z0-9_]*$/.test( name ) ) name = 'pass_rt';
	const root = name;
	let n = 2;
	while ( used.has( name ) ) {

		name = root + n;
		n ++;

	}

	used.add( name );
	return name;

}

/**
 * ≠ passes: every non-last pass gets a named output RT; last pass writes the
 * chain and must not declare output.rt. Also rewrites legacy $prev / $prevN
 * inputs to the corresponding $rt: name.
 */
function ensurePassChainRtNames( def ) {

	const passes = def.passes || [];
	if ( passes.length === 0 ) return;

	const used = new Set();
	for ( let i = 0; i < passes.length - 1; i ++ ) {

		const pass = passes[ i ];
		ensurePassDefaults( pass );
		const raw = pass.output && typeof pass.output.rt === 'string' ? pass.output.rt.trim() : '';
		if ( raw && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test( raw ) && ! used.has( raw ) ) {

			used.add( raw );
			pass.output = { rt: raw };

		} else {

			pass.output = { rt: allocateRtName( sanitizeRtBase( pass.name, i ), used ) };

		}

	}

	const last = passes[ passes.length - 1 ];
	if ( last && last.output ) delete last.output;

	for ( let i = 0; i < passes.length; i ++ ) {

		const inputs = passes[ i ].inputs;
		if ( ! inputs ) continue;
		for ( const key of Object.keys( inputs ) ) {

			const src = inputs[ key ];
			let n = 0;
			if ( src === '$prev' ) n = 1;
			else if ( typeof src === 'string' && /^\$prev\d+$/.test( src ) ) n = parseInt( src.slice( 5 ), 10 );
			if ( n < 1 ) continue;
			const upstream = passes[ i - n ];
			if ( upstream && upstream.output && upstream.output.rt ) {

				inputs[ key ] = '$rt:' + upstream.output.rt;

			}

		}

	}

}

/**
 * Build the editor panel for one custom effect entry.
 * @param {object} editor
 * @param {object} cam    camera owning the stack (for dirty)
 * @param {object} entry  stack entry with .definition (type custom:<id>)
 * @param {{ onDirty?: Function, onApplied?: Function, onClose?: Function }} hooks
 * @returns {UIPanel}
 */
function buildCustomEffectEditor( editor, cam, entry, hooks = {} ) {

	const lang = editor.config.getKey( 'language' ) || 'zh';
	const t = ( zh, en ) => ( lang === 'zh' ? zh : en );

	const def = JSON.parse( JSON.stringify( entry.definition ) );
	if ( ! Array.isArray( def.params ) ) def.params = [];
	if ( ! Array.isArray( def.textures ) ) def.textures = [];
	if ( ! Array.isArray( def.passes ) || def.passes.length === 0 ) def.passes = [];
	let expandedPass = 0;
	let statusMessage = null;
	let statusOk = null;

	const container = new UIPanel();
	container.setBackgroundColor( '#1f1f1f' );
	container.setPadding( '8px' );
	container.setMarginTop( '6px' );

	// ------------------------------------------------------------------
	// live apply —definition edits preview without pressing 应用
	// ------------------------------------------------------------------

	let liveTimer = null;
	let lastParamTypeSig = ( def.params || [] ).map( ( p ) => p.key + ':' + p.type ).join( '|' );

	/**
	 * Inner default âouter entry.params[key] (same live value).
	 * Value-only: push entry.params + dirty →syncComposerParams (no Apply / no rebuild).
	 * Structure edits (type/key/shader) still go through scheduleLiveApply.
	 */
	function writeParamDefault( p, value ) {

		p.default = value;
		if ( ! entry.params || typeof entry.params !== 'object' ) entry.params = {};
		if ( p.key ) entry.params[ p.key ] = value;
		const liveDef = entry.definition;
		if ( liveDef && Array.isArray( liveDef.params ) && p.key ) {

			for ( const ep of liveDef.params ) {

				if ( ep && ep.key === p.key ) {

					ep.default = value;
					break;

				}

			}

		}
		if ( typeof hooks.onDirty === 'function' ) hooks.onDirty();
		else {

			editor.signals.objectChanged.dispatch( cam );
			editor.signals.sceneGraphChanged.dispatch();

		}

	}

	/** Sensible default when switching param types (float→color must not keep 0.5). */
	function defaultForParamType( type, prev ) {

		if ( type === 'color' ) {

			return ( typeof prev === 'string' && prev.startsWith( '#' ) ) ? prev : '#ffffff';

		}

		if ( type === 'boolean' ) return !! prev;
		if ( type === 'vec2' ) return Array.isArray( prev ) && prev.length >= 2 ? prev.slice( 0, 2 ) : [ 0, 0 ];
		if ( type === 'vec3' ) return Array.isArray( prev ) && prev.length >= 3 ? prev.slice( 0, 3 ) : [ 0, 0, 0 ];
		if ( type === 'vec4' ) return Array.isArray( prev ) && prev.length >= 4 ? prev.slice( 0, 4 ) : [ 0, 0, 0, 1 ];
		if ( type === 'int' ) return Math.round( Number( prev ) ) || 0;
		return ( typeof prev === 'number' && Number.isFinite( prev ) ) ? prev : 0.5;

	}

	/** Drop stale values when type no longer matches (e.g. color param still holding 0.5). */
	function coerceParamValue( type, value, fallback ) {

		if ( type === 'color' ) {

			if ( typeof value === 'string' && /^#?[0-9a-fA-F]{3,8}$/.test( value.trim() ) ) {

				return value.startsWith( '#' ) ? value : ( '#' + value );

			}

			return typeof fallback === 'string' ? fallback : '#ffffff';

		}

		if ( type === 'boolean' ) return typeof value === 'boolean' ? value : !! fallback;
		if ( type === 'vec2' || type === 'vec3' || type === 'vec4' ) {

			const size = Number( type.slice( 3 ) );
			if ( Array.isArray( value ) && value.length >= size ) return value.slice( 0, size );
			if ( Array.isArray( fallback ) ) return fallback.slice();
			return new Array( size ).fill( 0 );

		}

		if ( type === 'int' ) {

			if ( typeof value === 'number' && Number.isFinite( value ) ) return Math.round( value );
			return Math.round( Number( fallback ) ) || 0;

		}

		// float —reject leftover color strings
		if ( typeof value === 'number' && Number.isFinite( value ) ) return value;
		if ( typeof fallback === 'number' && Number.isFinite( fallback ) ) return fallback;
		return 0;

	}

	function mergeEntryParams( defaults ) {

		const types = {};
		for ( const p of def.params || [] ) types[ p.key ] = p.type;
		const merged = {};
		for ( const key of Object.keys( defaults ) ) {

			merged[ key ] = coerceParamValue(
				types[ key ] || 'float',
				entry.params ? entry.params[ key ] : undefined,
				defaults[ key ],
			);

		}
		return merged;

	}

	// Open editor: show outer live values as the inner "default" fields.
	for ( const p of def.params || [] ) {

		if ( ! p || ! p.key || ! entry.params || entry.params[ p.key ] === undefined ) continue;
		p.default = coerceParamValue( p.type, entry.params[ p.key ], p.default );

	}

	/** Debounced commit while typing (shader / names). Discrete UI →liveApplyNow(). */
	function scheduleLiveApply() {

		if ( liveTimer !== null ) clearTimeout( liveTimer );
		liveTimer = setTimeout( liveApply, 120 );

	}

	function liveApplyNow() {

		if ( liveTimer !== null ) {

			clearTimeout( liveTimer );
			liveTimer = null;

		}
		liveApply();

	}

	function liveApply() {

		liveTimer = null;
		const v = validateCustomEffectDefinition( def );
		if ( ! v.ok ) {

			showStatus( false, t( '预览暂停（校验未通过）：\n', 'Preview paused (validation):\n' )
				+ v.errors.map( ( e ) => '· ' + e ).join( '\n' ) );
			return;

		}

		const reg = registerCustomEffect( def );
		if ( ! reg.ok ) {

			showStatus( false, t( '注册失败：\n', 'Register failed:\n' )
				+ ( reg.errors || [] ).map( ( e ) => '· ' + e ).join( '\n' ) );
			return;

		}

		entry.definition = JSON.parse( JSON.stringify( def ) );

		const desc = getEffectDescriptor( reg.type );
		const defaults = desc ? desc.createDefaultParams() : {};
		entry.params = mergeEntryParams( defaults );

		const typeSig = ( def.params || [] ).map( ( p ) => p.key + ':' + p.type ).join( '|' );
		const shapeChanged = typeSig !== lastParamTypeSig;
		lastParamTypeSig = typeSig;

		if ( v.warnings && v.warnings.length > 0 ) {

			showStatus( 'warn', t( '提示：\n', 'Notes:\n' )
				+ v.warnings.map( ( w ) => '· ' + w ).join( '\n' ) );

		} else if ( statusOk === false ) {

			showStatus( true, '' );

		}

		if ( typeof hooks.onDirty === 'function' ) {

			hooks.onDirty();

		} else {

			editor.signals.objectChanged.dispatch( cam );
			editor.signals.sceneGraphChanged.dispatch();

		}

		if ( shapeChanged && typeof hooks.onApplied === 'function' ) {

			hooks.onApplied();

		}

	}

	/** listenInput + live commit —typing in the definition. */
	function listenLive( ui, handler ) {

		return listenInput( ui, () => {

			handler();
			scheduleLiveApply(); // debounce while typing

		} );

	}

	let liveReady = false; // skip the initial render
	const rebuild = () => {

		container.clear();
		render();
		if ( liveReady ) liveApplyNow();

	};

	// ------------------------------------------------------------------
	// status
	// ------------------------------------------------------------------

	const statusDiv = new UIDiv().setMarginTop( '6px' );
	statusDiv.dom.style.fontSize = '11px';
	statusDiv.dom.style.whiteSpace = 'pre-wrap';
	statusDiv.dom.style.display = 'none';

function showStatus( ok, text ) {

	statusOk = ok;
	statusMessage = text;
	statusDiv.dom.style.display = text ? '' : 'none';
	// ok: true=green, 'warn'=yellow, false=red
	statusDiv.dom.style.color = ok === 'warn' ? '#e8c96a' : ( ok ? '#7de08a' : '#f08a8a' );
	statusDiv.dom.textContent = text || '';

}

		// ------------------------------------------------------------------
		// save / export (commit first —no separate Apply button)
		// ------------------------------------------------------------------

		/** Force a sync commit; used by 存库 / 导出. Returns false if invalid. */
		function commitForSave() {

			liveApplyNow();
			const v = validateCustomEffectDefinition( def );
			if ( ! v.ok ) {

				showStatus( false, t( '无法保存：\n', 'Cannot save:\n' ) + v.errors.map( ( e ) => '· ' + e ).join( '\n' ) );
				return false;

			}
			if ( ! entry.definition ) return false;
			return true;

		}

		async function saveToLibrary() {

			if ( ! commitForSave() ) return;
			const pf = editor.projectFolder;
			const ok = await saveCustomEffectToLibrary( pf, entry.definition );
			if ( ok ) {

				showStatus( true, t( `已保存到效果库 custom-effects/${ customEffectJsonFileName( def ) }`, `Saved to library custom-effects/${ customEffectJsonFileName( def ) }` ) );

			} else {

				showStatus( false, t( '保存失败：请先在文件菜单绑定工程目录', 'Save failed —bind a project folder first (File menu)' ) );

			}

		}

		function exportJson() {

			if ( ! commitForSave() ) return;
			const json = JSON.stringify( entry.definition, null, '\t' );
			const blob = new Blob( [ json ], { type: 'application/json' } );
			const a = document.createElement( 'a' );
			a.href = URL.createObjectURL( blob );
			a.download = customEffectJsonFileName( def );
			a.click();
			setTimeout( () => URL.revokeObjectURL( a.href ), 1000 );

		}

	// ------------------------------------------------------------------
	// render
	// ------------------------------------------------------------------

	function render() {

		// ---- header ----
		const head = new UIRow();
		head.add( new UIText( t( '编辑：', 'Edit: ' ) ).setFontWeight( 'bold' ) );
		const nameInput = new UIInput( def.name || '' ).setWidth( '110px' );
		listenLive( nameInput, () => {

			def.name = nameInput.getValue();

		} );
		head.add( nameInput );

			// No Apply —enable + edits commit live (liveApply / writeParamDefault).
			const saveBtn = new UIButton( t( '存库', 'Save' ) ).setMarginLeft( '4px' ).onClick( saveToLibrary );
			const exportBtn = new UIButton( t( '导出', 'Export' ) ).setMarginLeft( '2px' ).onClick( exportJson );
			const closeBtn = new UIButton( t( '收起', 'Close' ) ).setMarginLeft( '2px' ).onClick( () => {

				liveApplyNow();
				if ( hooks.onClose ) hooks.onClose();

			} );
			head.add( saveBtn );
			head.add( exportBtn );
			head.add( closeBtn );
		container.add( head );

			const idLabel = new UIText( 'id: ' + def.id ).setFontSize( '10px' ).setColor( '#888' ).setMarginTop( '2px' );
			idLabel.setDisplay( 'block' );
			container.add( idLabel );
			container.add( statusDiv );

			/** Section title + add button on one row; tip goes on the title tooltip. */
			function addSectionHead( title, tip, addLabel, onAdd ) {

				const row = new UIRow().setMarginTop( '8px' );
				row.dom.style.display = 'flex';
				row.dom.style.alignItems = 'center';
				row.dom.style.gap = '6px';
				const titleEl = new UIText( title ).setFontWeight( 'bold' );
				titleEl.dom.style.flex = '1';
				titleEl.dom.style.minWidth = '0';
				if ( tip ) titleEl.dom.setAttribute( 'title', tip );
				row.add( titleEl );
				row.add( new UIButton( addLabel ).onClick( onAdd ) );
				container.add( row );
				return row;

			}

			// ---- passes ----
			ensurePassChainRtNames( def );
			addSectionHead(
				t( 'Pass 链', 'Pass chain' ),
				t( '自上而下执行；非末 Pass 自动命名输出 RT，末 Pass 输出到主链', 'Runs top-down; non-final passes auto-name output RTs; last writes the chain' ),
				t( '+ 添加', '+ Add' ),
				() => {

					let n = 0;
					let name = 'pass' + n;
					while ( def.passes.some( ( p ) => p.name === name ) ) {

						n ++;
						name = 'pass' + n;

					}

					def.passes.push( {
						name,
						inputs: { uInput: 'uInput' },
						fragmentShader: COPY_FRAGMENT_SHADER,
						vertexShader: 'default',
						downsample: 1,
						colorSpace: 'linear',
					} );
					ensurePassChainRtNames( def );
					const prev = def.passes[ def.passes.length - 2 ];
					const neu = def.passes[ def.passes.length - 1 ];
					if ( prev && prev.output && prev.output.rt && neu && neu.inputs ) {

						neu.inputs.uInput = '$rt:' + prev.output.rt;

					}

					expandedPass = def.passes.length - 1;
					rebuild();

				}
			);

			def.passes.forEach( ( pass, index ) => {

			ensurePassDefaults( pass );
			const isLast = index === def.passes.length - 1;
			const box = new UIPanel().setBackgroundColor( '#2a2a2a' ).setPadding( '6px' ).setMarginTop( '4px' );

			const row = new UIRow();
			const expandBtn = new UIButton( expandedPass === index ? '▾' : '▸' ).setMarginRight( '4px' ).onClick( () => {

				expandedPass = expandedPass === index ? - 1 : index;
				rebuild();

			} );
			row.add( expandBtn );
			const nameIn = new UIInput( pass.name ).setWidth( '80px' );
			listenLive( nameIn, () => {

				pass.name = nameIn.getValue();

			} );
			row.add( nameIn );
			row.add( new UIText( isLast ? t( '→主链输出', '→chain output' ) : ( pass.output && pass.output.rt ? '→$rt:' + pass.output.rt : t( '→RT', '→RT' ) ) )
				.setFontSize( '10px' ).setColor( '#8af' ).setMarginLeft( '6px' ) );

			const upBtn = new UIButton( '↑' ).setMarginLeft( '4px' ).onClick( () => {

				if ( index <= 0 ) return;
				const tmp = def.passes[ index - 1 ];
				def.passes[ index - 1 ] = def.passes[ index ];
				def.passes[ index ] = tmp;
				ensurePassChainRtNames( def );
				rebuild();

			} );
			const downBtn = new UIButton( '↓' ).onClick( () => {

				if ( index >= def.passes.length - 1 ) return;
				const tmp = def.passes[ index + 1 ];
				def.passes[ index + 1 ] = def.passes[ index ];
				def.passes[ index ] = tmp;
				ensurePassChainRtNames( def );
				rebuild();

			} );
			const delBtn = new UIButton( '✕' ).onClick( () => {

				def.passes.splice( index, 1 );
				if ( expandedPass >= def.passes.length ) expandedPass = def.passes.length - 1;
				ensurePassChainRtNames( def );
				rebuild();

			} );
			row.add( upBtn );
			row.add( downBtn );
			row.add( delBtn );
			box.add( row );

			if ( expandedPass === index ) {

				// settings row: colorSpace + downsample + output.rt
				const cfg = new UIRow().setMarginTop( '4px' );

				const csSelect = new UISelect().setWidth( '80px' )
					.setOptions( { linear: 'linear 线性', gamma: 'gamma 兼容' } )
					.setValue( pass.colorSpace || 'linear' )
					.onChange( () => {

						pass.colorSpace = csSelect.getValue();
						liveApplyNow();

					} );
				cfg.add( csSelect );

				const dsSelect = new UISelect().setWidth( '54px' )
					.setOptions( { 1: '1×', 2: '2×', 4: '4×', 8: '8×' } )
					.setValue( String( pass.downsample || 1 ) )
					.onChange( () => {

						pass.downsample = parseInt( dsSelect.getValue(), 10 ) || 1;
						liveApplyNow();

					} );
				cfg.add( dsSelect );

				if ( isLast ) {

					cfg.add( new UIText( t( '输出到主链', 'writes chain' ) ).setFontSize( '10px' ).setColor( '#888' ).setMarginLeft( '6px' ) );

				} else {

					const rtIn = new UIInput( pass.output && pass.output.rt ? pass.output.rt : '' ).setWidth( '80px' ).setMarginLeft( '6px' );
					listenLive( rtIn, () => {

						const rt = rtIn.getValue().trim();
						if ( rt ) pass.output = { rt };
						else delete pass.output;

					} );
					cfg.add( rtIn );
					cfg.add( new UIText( 'RT 名' ).setFontSize( '10px' ).setColor( '#888' ) );

				}

				box.add( cfg );

				// inputs
				const inputsTitle = new UIText( t( '输入', 'Inputs' ) ).setFontSize( '10px' ).setColor( '#888' ).setMarginTop( '4px' );
				box.add( inputsTitle );

				for ( const uniformName of Object.keys( pass.inputs ) ) {

					const inRow = new UIRow().setMarginTop( '2px' );
					let currentName = uniformName; // tracks renames while typing
					const uniIn = new UIInput( uniformName ).setWidth( '80px' );
					listenLive( uniIn, () => {

						const newName = uniIn.getValue().trim();
						if ( ! newName || newName === currentName || ( newName in pass.inputs ) ) return;
						const src = pass.inputs[ currentName ];
						delete pass.inputs[ currentName ];
						pass.inputs[ newName ] = src;
						currentName = newName;

					} );
					inRow.add( uniIn );

					const srcSelect = new UISelect().setWidth( '150px' )
						.setOptions( sourceOptionsFor( def, index, pass.inputs[ uniformName ] ) )
						.setValue( pass.inputs[ uniformName ] )
						.onChange( () => {

							pass.inputs[ currentName ] = srcSelect.getValue();
							liveApplyNow();

						} );
					inRow.add( srcSelect );

					const rmIn = new UIButton( '✕' ).onClick( () => {

						delete pass.inputs[ currentName ];
						rebuild();

					} );
					inRow.add( rmIn );
					box.add( inRow );

				}

				const addInputBtn = new UIButton( t( '+ 输入', '+ Input' ) ).setMarginTop( '2px' ).onClick( () => {

					let n = Object.keys( pass.inputs ).length + 1;
					let name = 'uExtra' + n;
					while ( name in pass.inputs ) {

						n ++;
						name = 'uExtra' + n;

					}

					pass.inputs[ name ] = 'uInput';
					rebuild();

				} );
				box.add( addInputBtn );

				// fragment shader
				box.add( new UIText( t( '片段着色器', 'Fragment shader' ) ).setFontSize( '10px' ).setColor( '#888' ).setMarginTop( '4px' ) );
				const fsTa = monospace( new UITextArea(), '150px' );
				fsTa.setValue( pass.fragmentShader || '' );
				listenLive( fsTa, () => {

					pass.fragmentShader = fsTa.getValue();

				} );
				box.add( fsTa );

				// vertex shader
				const vsHead = new UIRow().setMarginTop( '4px' );
				vsHead.add( new UIText( t( '顶点着色器', 'Vertex shader' ) ).setFontSize( '10px' ).setColor( '#888' ) );
				const vsResetBtn = new UIButton( t( '恢复默认', 'Reset' ) ).setMarginLeft( '4px' ).onClick( () => {

					pass.vertexShader = 'default';
					rebuild();

				} );
				vsHead.add( vsResetBtn );
				box.add( vsHead );
				const vsTa = monospace( new UITextArea(), '90px' );
				// 'default' shows the real builtin source so edits start from valid code;
				// the definition keeps the 'default' keyword until the user types.
				vsTa.setValue( pass.vertexShader === 'default' ? DEFAULT_VERTEX_SHADER_SRC : pass.vertexShader );
				listenLive( vsTa, () => {

					const value = vsTa.getValue();
					pass.vertexShader = value.trim().length === 0 ? 'default' : value;

				} );
				box.add( vsTa );

			}

			container.add( box );

		} );

		if ( def.passes.length === 0 ) {

			const empty = new UIText( t( '暂无 Pass', 'No passes yet' ) ).setFontSize( '10px' ).setColor( '#777' ).setMarginTop( '4px' );
			empty.setDisplay( 'block' );
			container.add( empty );

		}

		// ---- params ----
		addSectionHead(
			t( '参数', 'Params' ),
			t(
				'每行：名称 · 类型 · 默认值。须在 FS 里声明并使用同名 uniform（color→vec3）才会影响画面。',
				'Row: name · type · default. Declare & use the same uniform in FS (color→vec3) or it will not affect the image.',
			),
			t( '+ 添加', '+ Add' ),
			() => {

				def.params.push( { key: 'param' + ( def.params.length + 1 ), type: 'float', default: 0.5, min: 0, max: 1, step: 0.01, label: '' } );
				rebuild();

			}
		);
		( def.params || [] ).forEach( ( p, index ) => {

			const row = new UIRow().setMarginTop( '2px' );
			const keyIn = new UIInput( p.key ).setWidth( '70px' );
			listenLive( keyIn, () => {

				p.key = keyIn.getValue().trim();

			} );
			row.add( keyIn );

			const typeSelect = new UISelect().setWidth( '64px' )
				.setOptions( PARAM_TYPES.reduce( ( o, k ) => ( o[ k ] = k, o ), {} ) )
				.setValue( p.type )
				.onChange( () => {

					p.type = typeSelect.getValue();
					const next = defaultForParamType( p.type, p.default );
					if ( entry.params && p.key ) delete entry.params[ p.key ];
					p.default = next;
					if ( p.key ) {

						if ( ! entry.params ) entry.params = {};
						entry.params[ p.key ] = next;

					}
					rebuild();

				} );
			row.add( typeSelect );

			if ( p.type === 'color' ) {

				const col = new UIColor().setValue( typeof p.default === 'string' ? p.default : '#ffffff' ).onInput( () => {

					writeParamDefault( p, col.getValue() );

				} );
				row.add( col );

			} else if ( p.type === 'boolean' ) {

				const cb = new UICheckbox( !! p.default ).onChange( () => {

					writeParamDefault( p, cb.getValue() );

				} );
				row.add( cb );

		} else if ( p.type === 'float' || p.type === 'int' ) {

			const tiny = ( txt, tip ) => {

				const el = new UIText( txt ).setFontSize( '9px' ).setColor( '#7a7a7a' ).setMarginLeft( '3px' );
				el.dom.setAttribute( 'title', tip );
				return el;

			};

			const num = new UINumber( Number( p.default ) || 0 )
				.setStep( p.type === 'int' ? 1 : 0.01 )
				.setWidth( '50px' )
				.onChange( () => {

					writeParamDefault( p, p.type === 'int' ? Math.round( num.getValue() ) : num.getValue() );

				} );
			num.dom.setAttribute( 'title', t( '默认值（uniform 初值）', 'Default value (initial uniform)' ) );
			row.add( tiny( '值', '默认值 / default' ) );
			row.add( num );

			const minIn = new UINumber( p.min !== undefined ? p.min : 0 ).setWidth( '34px' ).setStep( 0.1 ).onChange( () => {

				p.min = minIn.getValue();
				liveApplyNow();

			} );
			const maxIn = new UINumber( p.max !== undefined ? p.max : 1 ).setWidth( '34px' ).setStep( 0.1 ).onChange( () => {

				p.max = maxIn.getValue();
				liveApplyNow();

			} );
			minIn.dom.setAttribute( 'title', t( '滑条最小值', 'Slider minimum' ) );
			maxIn.dom.setAttribute( 'title', t( '滑条最大值', 'Slider maximum' ) );
			row.add( tiny( 'min', '滑条最小值 / slider min' ) );
			row.add( minIn );
			row.add( tiny( 'max', '滑条最大值 / slider max' ) );
			row.add( maxIn );

		} else if ( p.type === 'vec2' || p.type === 'vec3' || p.type === 'vec4' ) {

				const size = Number( p.type.slice( 3 ) );
				const arr = Array.isArray( p.default ) ? p.default : [];
				const comps = [];
				for ( let i = 0; i < size; i ++ ) {

					const num = new UINumber( Number( arr[ i ] ) || 0 )
						.setStep( 0.01 )
						.setWidth( '36px' );
					comps.push( num );
					num.onChange( () => {

						writeParamDefault( p, comps.map( ( c ) => c.getValue() ) );

					} );
					row.add( num );

				}

			}

		const labelIn = new UIInput( p.label || '' ).setWidth( '52px' );
		labelIn.dom.setAttribute( 'title', t( '显示标签（可选，仅用于 UI 展示）', 'Display label (optional, UI only)' ) );
		listenLive( labelIn, () => {

			p.label = labelIn.getValue();

		} );
		row.add( labelIn );

			const rmBtn = new UIButton( '✕' ).onClick( () => {

				def.params.splice( index, 1 );
				rebuild();

			} );
				row.add( rmBtn );
				container.add( row );

			} );

			if ( ( def.params || [] ).length === 0 ) {

				const empty = new UIText( t( '暂无参数 · 悬停标题看格式说明', 'No params · hover title for format' ) ).setFontSize( '10px' ).setColor( '#777' ).setMarginTop( '2px' );
				empty.setDisplay( 'block' );
				container.add( empty );

			}

			// ---- textures ----
			addSectionHead(
				t( '贴图', 'Textures' ),
				t( '图片写入 custom-effects/<效果名>/assets/；RT 绑定场景中的 RenderTexture', 'Images go to custom-effects/<name>/assets/; RT binds a scene RenderTexture' ),
				t( '+ 添加', '+ Add' ),
				() => {

					def.textures.push( { name: 'tex' + ( def.textures.length + 1 ), source: 'image', path: '', colorSpace: 'none', flipY: false } );
					rebuild();

				}
			);
			( def.textures || [] ).forEach( ( tex, index ) => {

			const row = new UIRow().setMarginTop( '2px' );
			const nameIn = new UIInput( tex.name ).setWidth( '70px' );
			listenLive( nameIn, () => {

				tex.name = nameIn.getValue().trim();

			} );
			row.add( nameIn );

			const srcSel = new UISelect().setWidth( '54px' )
				.setOptions( { image: '图片', rt: 'RT' } )
				.setValue( tex.source === 'rt' ? 'rt' : 'image' )
				.onChange( () => {

					const next = srcSel.getValue();
					if ( next === tex.source ) return;
					tex.source = next;
					if ( next === 'rt' ) {

						delete tex.dataUrl;
						delete tex.path;

					} else {

						delete tex.rtUuid;

					}

					rebuild();

				} );
			row.add( srcSel );

			if ( tex.source === 'rt' ) {

				// MediaPlay RT slot —binding (rtUuid) lives in
				// entry.textureBindings (scene-instance data), NOT in the
				// definition. Optional autoCreate: stable-key match or create
				// RT+MediaPlay nodes on project load (cross-scene reuse).
				if ( ! entry.textureBindings || typeof entry.textureBindings !== 'object' ) entry.textureBindings = {};
				const getBoundUuid = () => {

					const b = entry.textureBindings[ tex.name ];
					return ( b && b.rtUuid ) ? b.rtUuid : '';

				};
				const setBoundUuid = ( uuid ) => {

					if ( uuid ) entry.textureBindings[ tex.name ] = { rtUuid: uuid };
					else delete entry.textureBindings[ tex.name ];

				};

				// --- row 2: autoCreate switch + binding state ---
				const autoRow = new UIRow().setMarginTop( '2px' );
				const autoCb = new UICheckbox( !! tex.autoCreate ).onChange( () => {

					tex.autoCreate = autoCb.getValue();
					liveApplyNow();
					rebuild();

				} );
				autoRow.add( autoCb );
				autoRow.add( new UIText( t( '跨场景自动创建', 'auto-create across scenes' ) ).setFontSize( '10px' ).setColor( '#888' ) );

				const boundUuid = getBoundUuid();
				const boundObj = boundUuid ? editor.scene.getObjectByProperty( 'uuid', boundUuid ) : null;
				const stateTxt = boundObj
					? t( '已绑定：', 'bound: ' ) + ( boundObj.name || 'RenderTexture' )
					: ( tex.autoCreate ? t( '待自动创建', 'pending auto-create' ) : t( '未绑定', 'unbound' ) );
				const stateEl = new UIText( stateTxt ).setFontSize( '10px' )
					.setColor( boundObj ? '#7de08a' : '#f0b48a' ).setMarginLeft( '6px' );
				stateEl.dom.setAttribute( 'title', boundUuid || '' );
				autoRow.add( stateEl );
				container.add( autoRow );

				// --- row 3: mode-specific controls ---
				const ctlRow = new UIRow().setMarginTop( '2px' );
				if ( tex.autoCreate ) {

					const m = tex.media || {};
					const kindLabel = m.kind === 'gif' ? 'GIF' : ( m.kind === 'imageSequence' ? '序列' : '视频' );
					const mediaTxt = m.projectPath || m.sequenceDir
						? kindLabel + '·' + String( m.projectPath || m.sequenceDir ).split( /[/\\]/ ).pop()
						: t( '未选择媒体', 'no media' );
					const mediaEl = new UIText( mediaTxt ).setFontSize( '10px' ).setColor( ( m.projectPath || m.sequenceDir ) ? '#7de08a' : '#f0b48a' );
					mediaEl.dom.setAttribute( 'title', m.projectPath || m.sequenceDir || '' );
					ctlRow.add( mediaEl );

					const pickBtn = new UIButton( t( '选媒体文件', 'Pick media' ) ).setMarginLeft( '2px' );
					pickBtn.dom.setAttribute( 'title', t( '视频 mp4/webm/mov 或 GIF；复制进工程 assets/ 后随效果自动创建', 'mp4/webm/mov or GIF; copied into project assets/' ) );
					pickBtn.onClick( () => {

						const pf = editor.projectFolder;
						if ( ! pf || ! pf.saveBlob ) {

							alert( t( '请先打开/绑定工程目录。', 'Open/bind a project folder first.' ) );
							return;

						}

						const fileInput = document.createElement( 'input' );
						fileInput.type = 'file';
						fileInput.accept = 'video/*,image/gif';
						fileInput.onchange = async () => {

							const file = fileInput.files && fileInput.files[ 0 ];
							if ( ! file ) return;
							const lower = file.name.toLowerCase();
							const isGif = lower.endsWith( '.gif' );
							const subdir = isGif ? 'assets/textures' : 'assets/videos';
							const ok = await pf.saveBlob( subdir, file.name, file );
							if ( ! ok ) {

								alert( t( '媒体写入工程目录失败。', 'Failed to write media into the project folder.' ) );
								return;

							}

							tex.media = {
								kind: isGif ? 'gif' : 'video',
								fileName: file.name,
								projectPath: subdir + '/' + file.name,
							};
							liveApplyNow();
							// Create/reuse the RT + player right away.
							ensureCustomEffectMediaBindings( editor, entry ).then( ( changed ) => {

								if ( changed && hooks.onApplied ) hooks.onApplied();
								rebuild();

							} ).catch( () => {} );

						};
						fileInput.click();

					} );
					ctlRow.add( pickBtn );

					const seqBtn = new UIButton( t( '选序列帧目录', 'Pick sequence dir' ) ).setMarginLeft( '2px' );
					seqBtn.dom.setAttribute( 'title', t( '选择一个图片序列文件夹（png/jpg），文件复制进工程 assets/sequences/ 后随效果自动创建', 'Pick an image-sequence folder; copied into project assets/sequences/ then auto-created with the effect' ) );
					seqBtn.onClick( () => {

						const pf = editor.projectFolder;
						if ( ! pf || ! pf.saveBlob ) {

							alert( t( '请先打开/绑定工程目录。', 'Open/bind a project folder first.' ) );
							return;

						}

						const dirInput = document.createElement( 'input' );
						dirInput.type = 'file';
						dirInput.setAttribute( 'webkitdirectory', '' );
						dirInput.onchange = async () => {

							const files = Array.from( dirInput.files || [] ).filter( ( f ) => /\.(png|jpe?g|webp|bmp)$/i.test( f.name ) );
							if ( files.length === 0 ) {

								alert( t( '所选目录中没有图片文件。', 'No image files in the selected directory.' ) );
								return;

							}

							const rootName = ( files[ 0 ].webkitRelativePath || files[ 0 ].name ).split( /[/\\]/ )[ 0 ] || 'sequence';
							const subdir = 'assets/sequences/' + rootName.replace( /[<>:"/\\|?*]/g, '_' );
							for ( const f of files ) {

								const ok = await pf.saveBlob( subdir, f.name, f );
								if ( ! ok ) {

									alert( t( '序列帧写入工程目录失败。', 'Failed to write sequence frames into the project folder.' ) );
									return;

								}

							}

							tex.media = {
								kind: 'imageSequence',
								sequenceDir: subdir,
								sequenceFps: 30,
								sequenceStart: 0,
								sequenceEnd: - 1,
							};
							liveApplyNow();
							ensureCustomEffectMediaBindings( editor, entry ).then( ( changed ) => {

								if ( changed && hooks.onApplied ) hooks.onApplied();
								rebuild();

							} ).catch( () => {} );

						};
						dirInput.click();

					} );
					ctlRow.add( seqBtn );

					const clearBtn = new UIButton( t( '清除', 'Clear' ) ).setMarginLeft( '2px' );
					clearBtn.onClick( () => {

						delete tex.media;
						rebuild();

					} );
					ctlRow.add( clearBtn );

				} else {

					// Manual mode: pick one of the scene's MediaPlay RT objects;
					// binding written to entry.textureBindings (per-frame read).
					const rtOpts = listRenderTextureOptions( editor.scene );
					if ( boundUuid && ! rtOpts[ boundUuid ] ) rtOpts[ boundUuid ] = t( '（RT 已删除）', '(RT deleted)' );
					const rtSel = new UISelect().setWidth( '150px' )
						.setOptions( rtOpts )
						.setValue( boundUuid )
						.onChange( () => {

							setBoundUuid( rtSel.getValue() );
							rebuild(); // refresh binding state text; per-frame read picks it up without rebuild

						} );
					ctlRow.add( rtSel );
					ctlRow.add( new UIText( t( 'MediaPlay RT（实时画面）', 'MediaPlay RT (live)' ) ).setFontSize( '10px' ).setColor( '#888' ) );

				}

				container.add( ctlRow );

			} else {

				const csSelect = new UISelect().setWidth( '90px' )
					.setOptions( { srgb: 'srgb（解码）', none: 'none（原始字节）' } )
					.setValue( tex.colorSpace === 'none' ? 'none' : 'srgb' )
					.onChange( () => {

						tex.colorSpace = csSelect.getValue();
						liveApplyNow();

					} );
				row.add( csSelect );

				const flipCb = new UICheckbox( tex.flipY !== false ).onChange( () => {

					tex.flipY = flipCb.getValue();
					liveApplyNow();

				} );
				row.add( flipCb );
				row.add( new UIText( 'flipY' ).setFontSize( '10px' ).setColor( '#888' ) );

			const assetPath = tex.path || ( tex.dataUrl ? t( '内嵌 dataUrl（旧）', 'inline dataUrl (legacy)' ) : '' );
			const state = assetPath
				? assetPath.split( /[/\\]/ ).pop()
				: t( '未设置', 'missing' );
			const stateEl = new UIText( state ).setFontSize( '10px' )
				.setColor( assetPath ? '#7de08a' : '#f0b48a' ).setMarginLeft( '4px' );
			stateEl.dom.setAttribute( 'title', assetPath || '' );
			row.add( stateEl );

			if ( tex.dataUrl ) {

				// Legacy inline thumbnail —visual proof the upload landed.
				const thumb = new UIDiv().setMarginLeft( '4px' );
				const img = document.createElement( 'img' );
				img.src = tex.dataUrl;
				img.style.maxHeight = '36px';
				img.style.maxWidth = '60px';
				img.style.display = 'block';
				thumb.dom.appendChild( img );
				row.add( thumb );

			} else if ( tex.path ) {

				// Path thumbnail —async load via the projectFolder resolver.
				const thumb = new UIDiv().setMarginLeft( '4px' );
				const img = document.createElement( 'img' );
				img.style.maxHeight = '36px';
				img.style.maxWidth = '60px';
				img.style.display = 'none';
				thumb.dom.appendChild( img );
				row.add( thumb );
				resolveCustomEffectAssetUrl( tex.path ).then( ( url ) => {

					if ( ! url ) return;
					img.onload = () => {

						img.style.display = 'block';

					};
					img.src = url;

				} );

			}

			const uploadBtn = new UIButton( t( '选择文件', 'Pick file' ) ).setMarginLeft( '2px' );
			uploadBtn.dom.setAttribute( 'title', t( '图片复制进效果资产目录（custom-effects/<效果名>/assets/），定义里只存相对路径', 'Copied into the effect asset dir; definition stores a relative path only' ) );
			uploadBtn.onClick( () => {

				const pf = editor.projectFolder;
				if ( ! pf || ! pf.saveBlob ) {

					alert( t( '请先打开/绑定工程目录（文件→打开文件夹），才能保存贴图文件。', 'Open/bind a project folder first to store texture files.' ) );
					return;

				}

				const fileInput = document.createElement( 'input' );
				fileInput.type = 'file';
				fileInput.accept = 'image/*';
				fileInput.onchange = async () => {

					const file = fileInput.files && fileInput.files[ 0 ];
					if ( ! file ) return;
					const subdir = customEffectAssetDir( def );
					const ok = await pf.saveBlob( subdir, file.name, file );
					if ( ! ok ) {

						alert( t( '贴图写入工程目录失败。', 'Failed to write texture into the project folder.' ) );
						return;

					}

					tex.path = subdir + '/' + file.name;
					delete tex.dataUrl;
					liveApplyNow();
					rebuild();

				};
				fileInput.click();

			} );
			row.add( uploadBtn );

			}

			const rmBtn = new UIButton( '✕' ).onClick( () => {

				def.textures.splice( index, 1 );
				rebuild();

			} );
			row.add( rmBtn );
			container.add( row );

		} );

		if ( ( def.textures || [] ).length === 0 ) {

			const empty = new UIText( t( '暂无贴图 · 图片或 RT', 'No textures · image or RT' ) ).setFontSize( '10px' ).setColor( '#777' ).setMarginTop( '2px' );
			empty.setDisplay( 'block' );
			container.add( empty );

		}

	}

	rebuild();
	liveReady = true;
	liveApplyNow(); // enable 开着即可：打开编辑器立刻把当前定义推上预览

	return container;

}

export { buildCustomEffectEditor };
