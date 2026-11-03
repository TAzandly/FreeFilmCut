import { UIPanel, UIRow, UIText, UISelect, UIInteger, UICheckbox } from './libs/ui.js';

const PRESETS = {
	'16:9-1080': { w: 1920, h: 1080, label: '16:9 — 1920×1080' },
	'16:9-720': { w: 1280, h: 720, label: '16:9 — 1280×720' },
	'9:16-1080': { w: 1080, h: 1920, label: '9:16 — 1080×1920' },
	'9:16-720': { w: 720, h: 1280, label: '9:16 — 720×1280' },
	'1:1-1080': { w: 1080, h: 1080, label: '1:1 — 1080×1080' },
	'4:3-1080': { w: 1440, h: 1080, label: '4:3 — 1440×1080' },
	'custom': { w: null, h: null, label: 'Custom' }
};

function matchPreset( w, h ) {

	for ( const key of Object.keys( PRESETS ) ) {

		if ( key === 'custom' ) continue;
		const p = PRESETS[ key ];
		if ( p.w === w && p.h === h ) return key;

	}

	return 'custom';

}

function SidebarProjectResolution( editor ) {

	const config = editor.config;
	const signals = editor.signals;
	const strings = editor.strings;

	const container = new UIPanel();
	container.setId( 'project-resolution' );

	const headerRow = new UIRow();
	headerRow.add( new UIText( ( strings.getKey( 'sidebar/project/safeFrame' ) || 'SAFE FRAME' ).toUpperCase() ) );
	container.add( headerRow );

	// Show frame toggle
	const showRow = new UIRow();
	const showFrame = new UICheckbox( config.getKey( 'project/resolution/showFrame' ) !== false )
		.setLeft( '100px' )
		.onChange( function () {

			config.setKey( 'project/resolution/showFrame', this.getValue() );
			signals.resolutionChanged.dispatch();

		} );
	showRow.add( new UIText( strings.getKey( 'sidebar/project/safeFrame/show' ) || 'Show frame' ).setClass( 'Label' ) );
	showRow.add( showFrame );
	container.add( showRow );

	// Preset
	const presetRow = new UIRow();
	const presetOptions = {};
	for ( const key of Object.keys( PRESETS ) ) {

		presetOptions[ key ] = PRESETS[ key ].label;

	}

	const curW = parseInt( config.getKey( 'project/resolution/width' ), 10 ) || 1920;
	const curH = parseInt( config.getKey( 'project/resolution/height' ), 10 ) || 1080;

	const presetSelect = new UISelect()
		.setOptions( presetOptions )
		.setWidth( '170px' )
		.setValue( matchPreset( curW, curH ) )
		.onChange( applyPreset );

	presetRow.add( new UIText( strings.getKey( 'sidebar/project/safeFrame/preset' ) || 'Preset' ).setClass( 'Label' ) );
	presetRow.add( presetSelect );
	container.add( presetRow );

	// Width × Height
	const resolutionRow = new UIRow();
	resolutionRow.add( new UIText( strings.getKey( 'sidebar/project/resolution' ) || 'Resolution' ).setClass( 'Label' ) );

	const widthInput = new UIInteger( curW ).setRange( 1, 8192 ).setWidth( '56px' ).setTextAlign( 'center' );
	const heightInput = new UIInteger( curH ).setRange( 1, 8192 ).setWidth( '56px' ).setTextAlign( 'center' );

	widthInput.onChange( onCustomSize );
	heightInput.onChange( onCustomSize );

	resolutionRow.add( widthInput );
	resolutionRow.add( new UIText( '×' ).setTextAlign( 'center' ).setFontSize( '12px' ).setWidth( '14px' ) );
	resolutionRow.add( heightInput );
	container.add( resolutionRow );

	const hintRow = new UIRow();
	hintRow.add( new UIText( strings.getKey( 'sidebar/project/safeFrame/hint' ) || 'Frame matches NLE / export resolution.' )
		.setFontSize( '11px' )
		.setColor( '#888' ) );
	container.add( hintRow );

	function applyPreset() {

		const key = presetSelect.getValue();
		const p = PRESETS[ key ];
		if ( ! p || key === 'custom' ) return;

		widthInput.setValue( p.w );
		heightInput.setValue( p.h );
		commit( p.w, p.h );

	}

	function onCustomSize() {

		const w = Math.max( 1, widthInput.getValue() | 0 );
		const h = Math.max( 1, heightInput.getValue() | 0 );
		presetSelect.setValue( matchPreset( w, h ) );
		commit( w, h );

	}

	function commit( w, h ) {

		config.setKey(
			'project/resolution/width', w,
			'project/resolution/height', h
		);
		signals.resolutionChanged.dispatch();

	}

	function syncFromConfig() {

		const w = parseInt( config.getKey( 'project/resolution/width' ), 10 ) || 1920;
		const h = parseInt( config.getKey( 'project/resolution/height' ), 10 ) || 1080;
		const show = config.getKey( 'project/resolution/showFrame' ) !== false;

		if ( widthInput.getValue() !== w ) widthInput.setValue( w );
		if ( heightInput.getValue() !== h ) heightInput.setValue( h );
		presetSelect.setValue( matchPreset( w, h ) );
		showFrame.setValue( show );

	}

	// Keep UI in sync if something else changes resolution / project open
	signals.resolutionChanged.add( syncFromConfig );
	if ( signals.projectSettingsChanged ) signals.projectSettingsChanged.add( syncFromConfig );
	signals.editorCleared.add( syncFromConfig );

	return container;

}

export { SidebarProjectResolution };
