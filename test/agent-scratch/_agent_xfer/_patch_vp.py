# -*- coding: utf-8 -*-
from pathlib import Path
import re

vp_path = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Viewport.js")
s = vp_path.read_text(encoding="utf-8")

# Update imports from TextLayerRT
old_imp = """import {
	ensureTextLayerRenderTarget,
	renderOverlayTextLayerToRT,
	textLayerCompositeSource,
	blitTextLayerToLetterbox,
	stackDataHasEnabledEffects,
} from './ui/TextLayerRT.js?v=fcc-ui-11';
import { isFccUI, getFccUI, isUIText } from './ui/UIConstants.js?v=fcc-ui-88';
import { applyTextAnimsInScene } from './ui/TextAnimRuntime.js?v=fcc-ui-6';"""

new_imp = """import {
	ensureTextLayerRenderTarget,
	renderOverlayTextLayerToRT,
	textLayerCompositeSource,
	blitTextLayerToLetterbox,
	stackDataHasEnabledEffects,
	applyWipeReveal,
	computeWipeUvBounds,
	applyTextLayerFx,
} from './ui/TextLayerRT.js?v=fcc-ui-12';
import { isFccUI, getFccUI, isUIText } from './ui/UIConstants.js?v=fcc-ui-88';
import { applyTextAnimsInScene } from './ui/TextAnimRuntime.js?v=fcc-ui-7';
import {
	ensureTextAnimOnUI,
	sampleWipeRevealProgress,
} from './ui/TextAnim.js?v=fcc-ui-7';"""

if old_imp not in s:
    raise SystemExit('Viewport imports not found')
s = s.replace(old_imp, new_imp)

# Replace the text RT block
old_block = """			// Text→RT→Fx→blit when preview toggle on OR selected text has TextFxStack.
			// wipeReveal is per-glyph in TextAnimRuntime (not RT AABB UV).
			let textFxStack = null;
			const sel = editor.selected;
			if ( sel && isUIText( sel ) ) {
				const ui = getFccUI( sel );
				textFxStack = ( ui && ui.textFxStack ) ? ui.textFxStack : null;
			}
			const wantTextRT = editor.textLayerRTPreview === true
				|| stackDataHasEnabledEffects( textFxStack );

			if ( wantTextRT ) {

				const textRT = ensureTextLayerRenderTarget( projectRes.width, projectRes.height );
				renderOverlayTextLayerToRT( {
					renderer,
					uiOverlay,
					resW: projectRes.width,
					resH: projectRes.height,
					target: textRT,
				} );
				// Shared Registry Fx (same types as camera PP) after full text composite.
				const outTex = textLayerCompositeSource( textRT, {
					renderer,
					stack: textFxStack,
				} );
				blitTextLayerToLetterbox( {
					renderer,
					texture: outTex,
					rect: uiLayout,
					opacity: 1,
				} );

			} else {

				uiOverlay.render( renderer, uiLayout, projectRes.width, projectRes.height );

			}"""

new_block = """			// Text→RT→wipe(+edge)→Fx→blit when preview toggle / TextFx / wipeReveal on.
			let textFxStack = null;
			const sel = editor.selected;
			if ( sel && isUIText( sel ) ) {
				const ui = getFccUI( sel );
				textFxStack = ( ui && ui.textFxStack ) ? ui.textFxStack : null;
			}

			// Active wipeReveal (prefer selected text with wipe; else any enabled).
			let wipeInfo = null;
			const animT = editor.textAnimTime || 0;
			const considerWipe = ( obj ) => {
				if ( ! obj || ! isUIText( obj ) ) return;
				if ( obj.userData && obj.userData.__fccTextAnimChar ) return;
				const ui = getFccUI( obj );
				if ( ! ui || ! ui.textAnim ) return;
				ensureTextAnimOnUI( ui );
				if ( ! ui.textAnim.enabled ) return;
				const wipe = sampleWipeRevealProgress( animT, ui.textAnim );
				if ( ! wipe.enabled ) return;
				if ( ! wipeInfo || obj === sel ) wipeInfo = { object: obj, wipe };
			};
			considerWipe( sel );
			if ( ! wipeInfo ) {
				scene.traverse( ( o ) => {
					if ( wipeInfo ) return;
					considerWipe( o );
				} );
			}

			const wantTextRT = editor.textLayerRTPreview === true
				|| stackDataHasEnabledEffects( textFxStack )
				|| wipeInfo != null;

			if ( wantTextRT ) {

				const textRT = ensureTextLayerRenderTarget( projectRes.width, projectRes.height );
				renderOverlayTextLayerToRT( {
					renderer,
					uiOverlay,
					resW: projectRes.width,
					resH: projectRes.height,
					target: textRT,
				} );
				// Wipe + 刃光 before TextFx so Bloom/Deep Glow on text stack see overbright edge.
				let outTex = textRT.texture;
				if ( wipeInfo ) {
					const bounds = computeWipeUvBounds(
						wipeInfo.object,
						projectRes.width,
						projectRes.height,
					);
					outTex = applyWipeReveal( {
						renderer,
						inputTexture: outTex,
						width: textRT.width,
						height: textRT.height,
						progress: wipeInfo.wipe.progress,
						direction: wipeInfo.wipe.direction,
						soft: wipeInfo.wipe.soft,
						edgeIntensity: wipeInfo.wipe.edgeIntensity,
						edgeWidth: wipeInfo.wipe.edgeWidth,
						bounds,
					} ) || outTex;
				}
				outTex = applyTextLayerFx( {
					renderer,
					target: textRT,
					stack: textFxStack,
					inputTexture: outTex,
				} ) || outTex;
				blitTextLayerToLetterbox( {
					renderer,
					texture: outTex,
					rect: uiLayout,
					opacity: 1,
				} );

			} else {

				uiOverlay.render( renderer, uiLayout, projectRes.width, projectRes.height );

			}"""

if old_block not in s:
    # try with different arrow character
    print("exact block missing; searching markers...")
    i0 = s.find("wipeReveal is per-glyph")
    i1 = s.find("wantTextRT")
    print("markers", i0, i1)
    # Show surrounding
    if i0 > 0:
        print(repr(s[i0-80:i0+200]))
    raise SystemExit('Viewport text RT block not found')

s = s.replace(old_block, new_block)
vp_path.write_text(s, encoding="utf-8")
print("Viewport OK")
