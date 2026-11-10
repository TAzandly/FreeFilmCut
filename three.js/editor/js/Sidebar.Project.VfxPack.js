import { UIPanel, UIRow, UIText, UISelect, UIButton } from './libs/ui.js';
import { showPreviewExportDialog } from './preview/PreviewExportDialog.js?v=fcc-ui-232';
import {
	exportVfxPack,
	formatVfxPackExportMessage,
	promptExportOptions,
} from './VfxPackExporter.js?v=fcc-ui-237';
import {
	exportTextAnimPack,
	formatTextAnimPackExportMessage,
	promptTextAnimPackOptions,
} from './TextAnimPackExporter.js?v=fcc-ui-164';
import {
	exportTextTemplatePack,
	formatTextTemplatePackExportMessage,
	promptTextTemplatePackOptions,
} from './TextTemplatePackExporter.js?v=fcc-ui-217';

const PACK_TYPES = {
	'sticker': 'Sticker',
	'transition': 'Transition',
	'effect': 'Effect',
	'filter': 'Filter',
	'art-text': 'Art text',
	'sticker-anim': 'Sticker animation',
	'text-anim': '文字动画',
	'text-template': 'Text template',
	'clip-anim': 'Clip animation'
};

const VALID_TYPES = Object.keys( PACK_TYPES );

function normalizePackType( value ) {

	return VALID_TYPES.includes( value ) ? value : 'effect';

}

function normalizeFitMode( value ) {

	return value === 'stretch' ? 'stretch' : 'crop';

}

function SidebarProjectVfxPack( editor ) {

	const config = editor.config;
	const strings = editor.strings;

	const container = new UIPanel();
	container.setId( 'project-vfxpack' );

	const headerRow = new UIRow();
	headerRow.add( new UIText( ( strings.getKey( 'sidebar/project/vfxpack' ) || 'VFX PACK' ).toUpperCase() ) );
	container.add( headerRow );

	const typeRow = new UIRow();
	const typeOptions = {};
	for ( const key of VALID_TYPES ) {

		typeOptions[ key ] = strings.getKey( 'sidebar/project/vfxpack/type/' + key ) || PACK_TYPES[ key ];

	}

	const currentType = normalizePackType( config.getKey( 'project/vfxpack/type' ) );

	const typeSelect = new UISelect()
		.setOptions( typeOptions )
		.setWidth( '170px' )
		.setValue( currentType )
		.onChange( function () {

			const value = normalizePackType( this.getValue() );
			config.setKey( 'project/vfxpack/type', value );
			typeSelect.setValue( value );

		} );

	typeRow.add( new UIText( strings.getKey( 'sidebar/project/vfxpack/type' ) || 'Pack type' ).setClass( 'Label' ) );
	typeRow.add( typeSelect );
	container.add( typeRow );

	const phaseRow = new UIRow();
	const phaseSelect = new UISelect()
		.setOptions( {
			in: strings.getKey( 'sidebar/project/vfxpack/phase/in' ) || 'In',
			out: strings.getKey( 'sidebar/project/vfxpack/phase/out' ) || 'Out',
			loop: strings.getKey( 'sidebar/project/vfxpack/phase/loop' ) || 'Loop',
			combo: strings.getKey( 'sidebar/project/vfxpack/phase/combo' ) || 'Combo',
		} )
		.setWidth( '170px' )
		.setValue( ( editor.stickerMotion && editor.stickerMotion.phase ) || config.getKey( 'project/vfxpack/stickerAnimPhase' ) || 'in' )
		.onChange( function () {

			const raw = this.getValue();
			const packType = normalizePackType( typeSelect.getValue() );
			let phase = 'in';
			if ( packType === 'clip-anim' ) {

				phase = raw === 'out' || raw === 'combo' ? raw : 'in';

			} else {

				phase = raw === 'out' || raw === 'loop' ? raw : 'in';

			}
			config.setKey( 'project/vfxpack/stickerAnimPhase', phase );
			const current = editor.stickerMotion || { duration: 0.5, tracks: [], playStickerTimeline: true };
			editor.stickerMotion = {
				...current,
				phase,
				loop: phase === 'loop' ? 'loop' : 'clamp',
			};
			if ( editor.signals.stickerMotionChanged ) editor.signals.stickerMotionChanged.dispatch();

		} );
	phaseRow.add( new UIText( strings.getKey( 'sidebar/project/vfxpack/phase' ) || 'Phase' ).setClass( 'Label' ) );
	phaseRow.add( phaseSelect );
	container.add( phaseRow );

	function syncPhaseRow() {

		const packType = typeSelect.getValue();
		const show = packType === 'sticker-anim' || packType === 'text-anim' || packType === 'clip-anim';
		phaseRow.setDisplay( show ? '' : 'none' );
		// Clip-anim uses In/Out/Combo (no Loop); sticker/text keep Loop.
		const opts = packType === 'clip-anim'
			? {
				in: strings.getKey( 'sidebar/project/vfxpack/phase/in' ) || 'In',
				out: strings.getKey( 'sidebar/project/vfxpack/phase/out' ) || 'Out',
				combo: strings.getKey( 'sidebar/project/vfxpack/phase/combo' ) || 'Combo',
			}
			: {
				in: strings.getKey( 'sidebar/project/vfxpack/phase/in' ) || 'In',
				out: strings.getKey( 'sidebar/project/vfxpack/phase/out' ) || 'Out',
				loop: strings.getKey( 'sidebar/project/vfxpack/phase/loop' ) || 'Loop',
			};
		phaseSelect.setOptions( opts );
		const current = phaseSelect.getValue();
		if ( packType === 'clip-anim' && current === 'loop' ) {

			phaseSelect.setValue( 'in' );
			config.setKey( 'project/vfxpack/stickerAnimPhase', 'in' );

		} else if ( packType !== 'clip-anim' && current === 'combo' ) {

			phaseSelect.setValue( 'in' );
			config.setKey( 'project/vfxpack/stickerAnimPhase', 'in' );

		}

	}

	const fitModeRow = new UIRow();
	const fitModeSelect = new UISelect()
		.setOptions( {
			crop: strings.getKey( 'sidebar/project/vfxpack/fitMode/crop' ) || 'Crop',
			stretch: strings.getKey( 'sidebar/project/vfxpack/fitMode/stretch' ) || 'Stretch',
		} )
		.setWidth( '170px' )
		.setValue( normalizeFitMode( config.getKey( 'project/vfxpack/fitMode' ) ) )
		.onChange( function () {

			const value = normalizeFitMode( this.getValue() );
			config.setKey( 'project/vfxpack/fitMode', value );
			fitModeSelect.setValue( value );

		} );
	fitModeRow.add( new UIText( strings.getKey( 'sidebar/project/vfxpack/fitMode' ) || 'Fit mode' ).setClass( 'Label' ) );
	fitModeRow.add( fitModeSelect );
	container.add( fitModeRow );

	const fitModeHintRow = new UIRow();
	fitModeHintRow.add( new UIText( strings.getKey( 'sidebar/project/vfxpack/fitMode/hint' ) || 'Transition only. Stretch fills the NLE canvas (may distort).' )
		.setFontSize( '11px' )
		.setColor( '#888' ) );
	container.add( fitModeHintRow );

	function syncFitModeRow() {

		const show = typeSelect.getValue() === 'transition';
		fitModeRow.setDisplay( show ? '' : 'none' );
		fitModeHintRow.setDisplay( show ? '' : 'none' );

	}

	typeSelect.onChange( function () {

		const value = normalizePackType( this.getValue() );
		config.setKey( 'project/vfxpack/type', value );
		typeSelect.setValue( value );
		syncPhaseRow();
		syncFitModeRow();
		if ( editor.signals.sceneGraphChanged ) editor.signals.sceneGraphChanged.dispatch();

	} );
	syncPhaseRow();
	syncFitModeRow();

	const hintRow = new UIRow();
	hintRow.add( new UIText( strings.getKey( 'sidebar/project/vfxpack/hint' ) || 'Used when exporting .vfxpack (manifest.type).' )
		.setFontSize( '11px' )
		.setColor( '#888' ) );
	container.add( hintRow );

	const posterRefresh = addLibraryPreviewRow( {
		editor,
		container,
		label: strings.getKey( 'sidebar/project/vfxpack/poster' ) || 'Poster',
		accept: 'image/png,image/jpeg,image/webp,image/gif',
		configKey: 'project/vfxpack/previewPoster',
		nameKey: 'project/vfxpack/previewPosterName',
		hoverGif: false
	} );
	const hoverRefresh = addLibraryPreviewRow( {
		editor,
		container,
		label: strings.getKey( 'sidebar/project/vfxpack/hover' ) || 'Hover GIF',
		accept: 'image/gif,.gif',
		configKey: 'project/vfxpack/previewHover',
		nameKey: 'project/vfxpack/previewHoverName',
		hoverGif: true
	} );

	function refreshPreviews() {

		const type = normalizePackType( config.getKey( 'project/vfxpack/type' ) );
		typeSelect.setValue( type );
		syncPhaseRow();
		const packType = normalizePackType( config.getKey( 'project/vfxpack/type' ) );
		const phase = ( editor.stickerMotion && editor.stickerMotion.phase )
			|| config.getKey( 'project/vfxpack/stickerAnimPhase' )
			|| 'in';
		if ( packType === 'clip-anim' ) {

			phaseSelect.setValue( phase === 'out' || phase === 'combo' ? phase : 'in' );

		} else {

			phaseSelect.setValue( phase === 'out' || phase === 'loop' ? phase : 'in' );

		}
		posterRefresh();
		hoverRefresh();

	}

	editor.signals.editorCleared.add( refreshPreviews );
	if ( editor.signals.vfxpackChanged ) editor.signals.vfxpackChanged.add( refreshPreviews );
	if ( editor.signals.projectSettingsChanged ) editor.signals.projectSettingsChanged.add( refreshPreviews );

	const exportRow = new UIRow();
	const exportButton = new UIButton( strings.getKey( 'preview/export/open' ) || 'Export preview' );
	exportButton.onClick( function () {

		showPreviewExportDialog( editor );

	} );
	exportRow.add( exportButton );
	container.add( exportRow );

	const packExportRow = new UIRow();
	const packExportButton = new UIButton(
		strings.getKey( 'menubar/file/export/vfxpack' ) || 'Export VfxPack',
	);
	packExportButton.onClick( async function () {

		const packType = normalizePackType( config.getKey( 'project/vfxpack/type' ) );
		try {

			if ( packType === 'text-template' ) {

				const opts = promptTextTemplatePackOptions( editor );
				if ( opts === null ) return;
				const result = await exportTextTemplatePack( editor, editor.utils.save, opts );
				alert( 'Text template pack exported\n' + formatTextTemplatePackExportMessage( result ) );
				return;

			}

			if ( packType === 'text-anim' ) {

				const opts = promptTextAnimPackOptions( editor );
				if ( opts === null ) return;
				const phaseRaw = config.getKey( 'project/vfxpack/stickerAnimPhase' ) || 'in';
				const category = phaseRaw === 'out' || phaseRaw === 'loop' ? phaseRaw : 'in';
				const result = await exportTextAnimPack( editor, editor.utils.save, { ...opts, category } );
				alert( '文字动画包已导出\n' + formatTextAnimPackExportMessage( result ) );
				return;

			}

			const opts = promptExportOptions( editor );
			if ( opts === null ) return;
			const result = await exportVfxPack( editor, editor.utils.save, { ...opts, type: packType } );
			const where = result.savedToProject
				? ( result.projectPath || ( 'exports/' + result.filename ) )
				: result.filename;
			alert(
				( strings.getKey( 'prompt/file/export/vfxpackSuccess' ) || 'VfxPack exported.' )
				+ '\n' + where + '\n' + formatVfxPackExportMessage( result, strings ),
			);

		} catch ( e ) {

			console.error( e );
			alert( ( strings.getKey( 'prompt/file/export/vfxpackFailed' ) || 'Export failed' )
				+ '\n' + ( e && e.message ? e.message : e ) );

		}

	} );
	packExportRow.add( packExportButton );
	container.add( packExportRow );

	return container;

}

function addLibraryPreviewRow( { editor, container, label, accept, configKey, nameKey, hoverGif } ) {

	const config = editor.config;
	const strings = editor.strings;
	const row = new UIRow();
	row.add( new UIText( label ).setClass( 'Label' ) );

	const thumb = document.createElement( 'img' );
	thumb.alt = '';
	thumb.style.width = '42px';
	thumb.style.height = '42px';
	thumb.style.objectFit = 'cover';
	thumb.style.background = '#222';
	thumb.style.marginRight = '6px';
	thumb.style.display = 'none';
	row.dom.appendChild( thumb );

	const name = new UIText( '' ).setFontSize( '11px' ).setColor( '#888' ).setWidth( '72px' );
	row.add( name );

	const choose = new UIButton( strings.getKey( 'sidebar/project/vfxpack/choose' ) || 'Choose' );
	choose.onClick( function () {

		const input = document.createElement( 'input' );
		input.type = 'file';
		input.accept = accept;
		input.addEventListener( 'change', function () {

			const file = input.files && input.files[ 0 ];
			if ( ! file ) return;
			if ( hoverGif && file.type !== 'image/gif' && ! /\.gif$/i.test( file.name ) ) {

				alert( strings.getKey( 'sidebar/project/vfxpack/hoverGifOnly' ) || 'Hover preview must be a GIF.' );
				return;

			}

			const reader = new FileReader();
			reader.addEventListener( 'load', function () {

				try {

					config.setKey( configKey, reader.result || '', nameKey, file.name );

				} catch ( error ) {

					console.warn( '[FreeFilmCut] preview store failed', error );
					alert( strings.getKey( 'sidebar/project/vfxpack/previewTooLarge' ) || 'Could not store that preview. Use a smaller file.' );
					return;

				}

				refresh();

			} );
			reader.readAsDataURL( file );

		} );
		input.click();

	} );

	const clear = new UIButton( strings.getKey( 'sidebar/project/vfxpack/clear' ) || 'Clear' );
	clear.onClick( function () {

		config.setKey( configKey, '', nameKey, '' );
		refresh();

	} );

	row.add( choose );
	row.add( clear );
	container.add( row );

	function refresh() {

		const url = config.getKey( configKey ) || '';
		const fileName = config.getKey( nameKey ) || '';
		name.setValue( fileName );
		if ( url ) {

			// Force decode even when filename/data-URL prefix stays the same.
			thumb.removeAttribute( 'src' );
			thumb.src = url;
			thumb.style.display = '';

		} else {

			thumb.removeAttribute( 'src' );
			thumb.style.display = 'none';

		}

	}

	refresh();
	return refresh;

}

export { SidebarProjectVfxPack, normalizePackType, PACK_TYPES };
