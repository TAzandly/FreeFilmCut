import { UIPanel } from './libs/ui.js';

/**
 * FreeFilmCut: letterbox / safe-frame overlay matching project resolution aspect.
 * pointer-events: none — does not block viewport picking.
 */
function ViewportSafeFrame( editor ) {

	const signals = editor.signals;
	const config = editor.config;
	const strings = editor.strings;

	const container = new UIPanel();
	container.setId( 'safe-frame' );
	container.setPosition( 'absolute' );
	container.setTop( '0' );
	container.setLeft( '0' );
	container.setRight( '0' );
	container.setBottom( '0' );
	container.dom.style.pointerEvents = 'none';
	container.dom.style.overflow = 'hidden';
	container.dom.style.zIndex = '2';

	const barTop = document.createElement( 'div' );
	const barBottom = document.createElement( 'div' );
	const barLeft = document.createElement( 'div' );
	const barRight = document.createElement( 'div' );
	const frame = document.createElement( 'div' );
	const label = document.createElement( 'div' );

	for ( const el of [ barTop, barBottom, barLeft, barRight ] ) {

		el.className = 'safe-frame-bar';
		container.dom.appendChild( el );

	}

	frame.className = 'safe-frame-rect';
	label.className = 'safe-frame-label';
	container.dom.appendChild( frame );
	container.dom.appendChild( label );

	function getResolution() {

		const width = Math.max( 1, parseInt( config.getKey( 'project/resolution/width' ), 10 ) || 1920 );
		const height = Math.max( 1, parseInt( config.getKey( 'project/resolution/height' ), 10 ) || 1080 );
		const showFrame = config.getKey( 'project/resolution/showFrame' ) !== false;
		return { width, height, showFrame };

	}

	function gcd( a, b ) {

		a = Math.abs( a | 0 );
		b = Math.abs( b | 0 );
		while ( b ) {

			const t = b;
			b = a % b;
			a = t;

		}

		return a || 1;

	}

	function aspectLabel( w, h ) {

		const g = gcd( w, h );
		return `${ w / g }:${ h / g }`;

	}

	/**
	 * Compute letterboxed frame rect inside parent (CSS pixels, y from top).
	 */
	function computeFrameRect( parentW, parentH, resW, resH ) {

		const targetAspect = resW / resH;
		const parentAspect = parentW / parentH;

		let fw, fh, fx, fy;

		if ( parentAspect > targetAspect ) {

			fh = parentH;
			fw = parentH * targetAspect;
			fx = ( parentW - fw ) / 2;
			fy = 0;

		} else {

			fw = parentW;
			fh = parentW / targetAspect;
			fx = 0;
			fy = ( parentH - fh ) / 2;

		}

		return { x: fx, y: fy, w: fw, h: fh };

	}

	function update() {

		const parent = container.dom.parentElement;
		if ( ! parent ) return;

		const { width, height, showFrame } = getResolution();

		if ( ! showFrame ) {

			container.dom.style.display = 'none';
			return;

		}

		container.dom.style.display = 'block';

		const pw = parent.clientWidth;
		const ph = parent.clientHeight;
		if ( pw < 1 || ph < 1 ) return;

		const rect = computeFrameRect( pw, ph, width, height );

		barTop.style.cssText = `position:absolute;left:0;top:0;right:0;height:${ rect.y }px;`;
		barBottom.style.cssText = `position:absolute;left:0;top:${ rect.y + rect.h }px;right:0;bottom:0;`;
		barLeft.style.cssText = `position:absolute;left:0;top:${ rect.y }px;width:${ rect.x }px;height:${ rect.h }px;`;
		barRight.style.cssText = `position:absolute;left:${ rect.x + rect.w }px;top:${ rect.y }px;right:0;height:${ rect.h }px;`;

		frame.style.cssText = [
			'position:absolute',
			`left:${ rect.x }px`,
			`top:${ rect.y }px`,
			`width:${ rect.w }px`,
			`height:${ rect.h }px`,
			'box-sizing:border-box'
		].join( ';' );

		const title = strings.getKey( 'sidebar/project/safeFrame' ) || 'Safe Frame';
		label.textContent = `${ title }  ${ width } × ${ height }  (${ aspectLabel( width, height ) })`;
		label.style.cssText = [
			'position:absolute',
			`left:${ rect.x + 8 }px`,
			`top:${ Math.max( 4, rect.y + 6 ) }px`
		].join( ';' );

	}

	signals.resolutionChanged.add( update );
	signals.windowResize.add( update );
	signals.animationPanelResized.add( update );

	// Initial layout after attach
	requestAnimationFrame( update );

	// Expose helpers for Viewport render letterbox
	container.computeFrameRect = computeFrameRect;
	container.getResolution = getResolution;
	container.update = update;

	return container;

}

export { ViewportSafeFrame };
