import * as THREE from 'three';

import { UIPanel, UIText, UIInput } from './libs/ui.js';
import { UIBoolean } from './libs/ui.three.js';

function MenubarStatus( editor ) {

	const strings = editor.strings;
	const config = editor.config;

	const container = new UIPanel();
	container.setClass( 'menu right' );

	const autosave = new UIBoolean( editor.config.getKey( 'autosave' ), strings.getKey( 'menubar/status/autosave' ) );
	autosave.text.setColor( '#888' );
	autosave.onChange( function () {

		const value = this.getValue();

		editor.config.setKey( 'autosave', value );

		if ( value === true ) {

			editor.signals.sceneGraphChanged.dispatch();

		}

	} );
	container.add( autosave );

	editor.signals.savingStarted.add( function () {

		autosave.text.setTextDecoration( 'underline' );

	} );

	editor.signals.savingFinished.add( function () {

		autosave.text.setTextDecoration( 'none' );

	} );

	// FreeFilmCut: editable project name
	const nameLabel = new UIText( strings.getKey( 'menubar/status/projectName' ) + ':' );
	nameLabel.setClass( 'title' );
	nameLabel.setOpacity( 0.65 );
	nameLabel.setMarginRight( '4px' );
	nameLabel.setColor( '#ccc' );
	container.add( nameLabel );

	const nameInput = new UIInput( config.getKey( 'project/title' ) || '' );
	nameInput.setWidth( '140px' );
	nameInput.setMarginRight( '10px' );
	nameInput.setPadding( '2px 4px' );
	nameInput.dom.placeholder = strings.getKey( 'menubar/status/projectNamePlaceholder' );
	nameInput.dom.title = strings.getKey( 'menubar/status/projectNameHint' );
	nameInput.dom.style.fontSize = '12px';
	nameInput.dom.style.background = 'transparent';
	nameInput.dom.style.border = '1px solid #6af';
	nameInput.dom.style.borderRadius = '3px';
	nameInput.dom.style.color = '#eee';
	nameInput.onChange( function () {

		const untitled = strings.getKey( 'prompt/file/untitledProject' );
		let v = this.getValue().trim();
		if ( ! v ) v = untitled;
		if ( editor.setProjectTitle ) {

			editor.setProjectTitle( v );
			this.setValue( v );

		} else {

			config.setKey( 'project/title', v );
			if ( editor.signals.projectTitleChanged ) editor.signals.projectTitleChanged.dispatch( v );

		}

	} );
	container.add( nameInput );

	function refreshName( title ) {

		const t = ( title !== undefined && title !== null )
			? title
			: ( config.getKey( 'project/title' ) || '' );
		if ( nameInput.getValue() !== t ) nameInput.setValue( t );

	}

	refreshName();
	if ( editor.signals.projectTitleChanged ) {

		editor.signals.projectTitleChanged.add( refreshName );

	}

	// FreeFilmCut: current local project folder name
	const folderLabel = new UIText( '' );
	folderLabel.setClass( 'title' );
	folderLabel.setOpacity( 0.65 );
	folderLabel.setMarginRight( '8px' );
	folderLabel.setColor( '#8af' );
	container.add( folderLabel );

	function refreshFolderLabel( name ) {

		const n = ( name !== undefined && name !== null )
			? name
			: ( editor.projectFolder ? editor.projectFolder.getName() : '' );
		if ( n ) {

			folderLabel.setValue( strings.getKey( 'menubar/status/projectFolder' ) + ': ' + n );
			folderLabel.setDisplay( '' );

		} else {

			folderLabel.setValue( '' );
			folderLabel.setDisplay( 'none' );

		}

	}

	refreshFolderLabel();
	if ( editor.signals.projectFolderChanged ) {

		editor.signals.projectFolderChanged.add( refreshFolderLabel );

	}

	const version = new UIText( 'r' + THREE.REVISION );
	version.setClass( 'title' );
	version.setOpacity( 0.5 );
	container.add( version );

	return container;

}

export { MenubarStatus };
