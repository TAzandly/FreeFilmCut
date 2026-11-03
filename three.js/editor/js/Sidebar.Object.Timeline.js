import { UIPanel, UIRow, UIText, UINumber, UISelect, UICheckbox, UIButton } from './libs/ui.js';
import { TL_KEY, isFccTimeline } from './timeline/FccTimelineCore.js?v=fcc-ui-107';

function SidebarObjectTimeline( editor ) {
	const signals = editor.signals;
	const lang = ( editor.config && editor.config.getKey( 'language' ) ) || 'en';
	const isZh = lang === 'zh';
	const container = new UIPanel();
	container.setDisplay( 'none' );

	container.add( new UIText( isZh ? '时间轴' : 'Timeline' ).setTextTransform( 'uppercase' ) );

	const durRow = new UIRow();
	durRow.add( new UIText( isZh ? '时长(秒)' : 'Duration' ).setClass( 'Label' ) );
	const durNum = new UINumber( 1 ).setPrecision( 3 ).setRange( 0.01, 9999 ).setWidth( '60px' );
	durRow.add( durNum );
	container.add( durRow );

	const fpsRow = new UIRow();
	fpsRow.add( new UIText( 'FPS' ).setClass( 'Label' ) );
	const fpsSelect = new UISelect().setOptions( { '24': '24', '25': '25', '30': '30' } ).setWidth( '60px' );
	fpsRow.add( fpsSelect );
	container.add( fpsRow );

	const loopRow = new UIRow();
	loopRow.add( new UIText( isZh ? '循环' : 'Loop' ).setClass( 'Label' ) );
	const loopSelect = new UISelect().setOptions( {
		clamp: isZh ? '一次' : 'Clamp',
		loop: isZh ? '循环' : 'Loop',
	} ).setWidth( '80px' );
	loopRow.add( loopSelect );
	container.add( loopRow );

	const activeRow = new UIRow();
	activeRow.add( new UIText( isZh ? '预览激活' : 'Active preview' ).setClass( 'Label' ) );
	const activeBox = new UICheckbox( false );
	activeRow.add( activeBox );
	container.add( activeRow );

	const openBtn = new UIButton( isZh ? '打开 Timeline 编辑器' : 'Open Timeline Editor' );
	container.add( new UIRow().add( openBtn ) );

	let object = null;

	function writeUD() {
		if ( ! isFccTimeline( object ) ) return;
		const ud = object.userData[ TL_KEY ];
		ud.duration = durNum.getValue();
		ud.fps = parseInt( fpsSelect.getValue(), 10 ) || 30;
		ud.loop = loopSelect.getValue() === 'loop' ? 'loop' : 'clamp';
		ud.active = activeBox.getValue() === true;
		if ( ud.active ) {
			editor.scene.traverse( ( o ) => {
				if ( o !== object && isFccTimeline( o ) ) o.userData[ TL_KEY ].active = false;
			} );
			editor.activeFccTimeline = object;
		} else if ( editor.activeFccTimeline === object ) {
			editor.activeFccTimeline = null;
		}
		const live = object.__fccTimelineAsset;
		if ( live ) {
			live.duration = ud.duration;
			live.fps = ud.fps;
			live.loop = ud.loop;
		}
		const ed = editor.fccTimelineEditor;
		if ( ed && typeof ed.syncSettingsFromObject === 'function' ) {
			ed.syncSettingsFromObject( object );
		}
		signals.objectChanged.dispatch( object );
	}

	durNum.onChange( writeUD );
	fpsSelect.onChange( writeUD );
	loopSelect.onChange( writeUD );
	activeBox.onChange( writeUD );

	openBtn.onClick( function () {
		if ( ! isFccTimeline( object ) ) return;
		if ( editor.fccTimelineEditor && editor.fccTimelineEditor.openFor ) {
			editor.fccTimelineEditor.openFor( object );
		} else {
			console.warn( '[FreeFilmCut] Timeline editor not mounted yet' );
		}
	} );

	function refresh( current ) {
		object = current;
		const show = isFccTimeline( object );
		container.setDisplay( show ? '' : 'none' );
		if ( ! show ) return;
		const ud = object.userData[ TL_KEY ];
		durNum.setValue( Number( ud.duration ) || 1 );
		fpsSelect.setValue( String( ud.fps || 30 ) );
		loopSelect.setValue( ud.loop === 'loop' ? 'loop' : 'clamp' );
		activeBox.setValue( ud.active === true );
	}

	signals.objectSelected.add( refresh );
	signals.objectChanged.add( function ( changed ) {

		if ( changed && object && changed === object ) refresh( object );

	} );
	return container;
}

export { SidebarObjectTimeline };
