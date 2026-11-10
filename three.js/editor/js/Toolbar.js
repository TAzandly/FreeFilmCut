import { UIPanel, UIButton } from './libs/ui.js';
import { exportVfxPack, formatVfxPackExportMessage, promptExportOptions, normalizePackType } from './VfxPackExporter.js?v=fcc-ui-237';
import {
	exportTextTemplatePack,
	formatTextTemplatePackExportMessage,
	promptTextTemplatePackOptions,
} from './TextTemplatePackExporter.js?v=fcc-ui-217';
import {
	exportTextAnimPack,
	formatTextAnimPackExportMessage,
	promptTextAnimPackOptions,
} from './TextAnimPackExporter.js?v=fcc-ui-164';

function Toolbar( editor ) {

	const signals = editor.signals;
	const strings = editor.strings;

	const container = new UIPanel();
	container.setId( 'toolbar' );

	// translate / rotate / scale

	const translateIcon = document.createElement( 'img' );
	translateIcon.title = strings.getKey( 'toolbar/translate' );
	translateIcon.src = 'images/translate.svg';

	const translate = new UIButton();
	translate.dom.className = 'Button selected';
	translate.dom.appendChild( translateIcon );
	translate.onClick( function () {

		signals.transformModeChanged.dispatch( 'translate' );

	} );
	container.add( translate );

	const rotateIcon = document.createElement( 'img' );
	rotateIcon.title = strings.getKey( 'toolbar/rotate' );
	rotateIcon.src = 'images/rotate.svg';

	const rotate = new UIButton();
	rotate.dom.appendChild( rotateIcon );
	rotate.onClick( function () {

		signals.transformModeChanged.dispatch( 'rotate' );

	} );
	container.add( rotate );

	const scaleIcon = document.createElement( 'img' );
	scaleIcon.title = strings.getKey( 'toolbar/scale' );
	scaleIcon.src = 'images/scale.svg';

	const scale = new UIButton();
	scale.dom.appendChild( scaleIcon );
	scale.onClick( function () {

		signals.transformModeChanged.dispatch( 'scale' );

	} );
	container.add( scale );

	// FreeFilmCut: Export VfxPack

	const vfxpack = new UIButton();
	vfxpack.setTextContent( 'VfxPack' );
	vfxpack.dom.title = strings.getKey( 'menubar/file/export/vfxpack' );
	vfxpack.dom.style.marginLeft = '8px';
	vfxpack.onClick( async function () {

		// Match Sidebar / File menu: route specialized pack types to their exporters
		// (toolbar used to always call exportVfxPack → hard-fail on text-template).
		const packType = normalizePackType(
			( editor.config && editor.config.getKey( 'project/vfxpack/type' ) ) || 'effect',
		);

		try {

			if ( packType === 'text-template' ) {

				const opts = promptTextTemplatePackOptions( editor );
				if ( opts === null ) return;
				const result = await exportTextTemplatePack( editor, editor.utils.save, opts );
				console.log( '[FreeFilmCut] Text Template pack exported (via VfxPack toolbar)', result );
				alert( 'Text template pack exported\n' + formatTextTemplatePackExportMessage( result ) );
				return;

			}

			if ( packType === 'text-anim' ) {

				const opts = promptTextAnimPackOptions( editor );
				if ( opts === null ) return;
				const phaseRaw = ( editor.config && editor.config.getKey( 'project/vfxpack/stickerAnimPhase' ) ) || 'in';
				const category = phaseRaw === 'out' || phaseRaw === 'loop' ? phaseRaw : 'in';
				const result = await exportTextAnimPack( editor, editor.utils.save, { ...opts, category } );
				console.log( '[FreeFilmCut] Text Anim pack exported (via VfxPack toolbar)', result );
				alert( '文本动画包已导出\n' + formatTextAnimPackExportMessage( result ) );
				return;

			}

			const opts = promptExportOptions( editor );
			if ( opts === null ) return;
			const result = await exportVfxPack( editor, editor.utils.save, { ...opts, type: packType } );
			console.log( '[FreeFilmCut] Exported', result.filename, result.manifest, 'anims=', result.animationCount );
			const where = result.savedToProject
				? ( result.projectPath || ( 'exports/' + result.filename ) )
				: result.filename;
			alert(
				strings.getKey( 'prompt/file/export/vfxpackSuccess' ) + '\n' + where
				+ '\n' + formatVfxPackExportMessage( result, strings )
			);

		} catch ( e ) {

			console.error( e );
			alert( strings.getKey( 'prompt/file/export/vfxpackFailed' ) + '\n' + ( e && e.message ? e.message : e ) );

		}

	} );
	container.add( vfxpack );

	//

	signals.transformModeChanged.add( function ( mode ) {

		translate.dom.classList.remove( 'selected' );
		rotate.dom.classList.remove( 'selected' );
		scale.dom.classList.remove( 'selected' );

		switch ( mode ) {

			case 'translate': translate.dom.classList.add( 'selected' ); break;
			case 'rotate': rotate.dom.classList.add( 'selected' ); break;
			case 'scale': scale.dom.classList.add( 'selected' ); break;

		}

	} );

	return container;

}

export { Toolbar };
