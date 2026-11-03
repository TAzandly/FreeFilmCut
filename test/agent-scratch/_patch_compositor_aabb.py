from pathlib import Path

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing: {label}\n---snippet---\n{old[:200]}")
    return text.replace(old, new, 1)

path = Path(r"freefilmcut/apps/web/src/services/renderer/compositor/three-compositor.ts")
text = path.read_text(encoding="utf-8")

text = replace_once(
    text,
    """import {
	ensureTextLayerRenderTarget,
	renderTextLayerToTarget,
	textLayerCompositeSource,
} from "@/vfxpack/text-layer-rt";
""",
    """import {
	ensureTextLayerRenderTarget,
	renderTextLayerToTarget,
	textLayerCompositeSource,
} from "@/vfxpack/text-layer-rt";
import {
	aabbToCenteredOrthoView,
	mapAabbToDestRect,
	resolveTextLayerRtRect,
	type TextLayerAabb,
} from "@/vfxpack/text-layer-aabb";
""",
    "text-layer-rt import",
)

text = replace_once(
    text,
    """	private ensureTextLayerTarget(width: number, height: number): THREE.WebGLRenderTarget {
		this.textLayerRT = ensureTextLayerRenderTarget(this.textLayerRT, width, height, {
			stencilBuffer: true,
			depthBuffer: true,
		});
		return this.textLayerRT;
	}
""",
    """	private ensureTextLayerTarget(
		width: number,
		height: number,
		opts?: { fit?: boolean },
	): THREE.WebGLRenderTarget {
		this.textLayerRT = ensureTextLayerRenderTarget(this.textLayerRT, width, height, {
			stencilBuffer: true,
			depthBuffer: true,
			fit: opts?.fit === true,
		});
		return this.textLayerRT;
	}
""",
    "ensureTextLayerTarget",
)

# Extend blitTextureToTarget signature + destRect handling
text = replace_once(
    text,
    """	private blitTextureToTarget({
		source,
		target,
		flipY = false,
		clear = true,
		clearColor = 0x000000,
		clearAlpha = 1,
		blend = "replace",
		contain,
		placement,
		opacity = 1,
		straightAlphaFromPremul = false,
	}: {
		source: THREE.Texture;
		target: THREE.WebGLRenderTarget | null;
		flipY?: boolean;
		clear?: boolean;
		clearColor?: number;
		clearAlpha?: number;
		blend?: "replace" | "alpha";
		/** Fit source pixels inside the destination without stretching. */
		contain?: {
			sourceWidth: number;
			sourceHeight: number;
			destWidth: number;
			destHeight: number;
		};
		/** Extra placement on top of contain. Scale is a multiplier, position is pixels, rotation is degrees. */
		placement?: {
			scaleX: number;
			scaleY: number;
			positionX: number;
			positionY: number;
			rotate: number;
		};
		/** Multiplies rgb and alpha of the finished picture. */
		opacity?: number;
		/**
		 * Editor Viewport presentComposerToLetterbox: additive bloom leaves
		 * premultiplied-looking rgb with low a; convert to straight alpha for
		 * premultipliedAlpha:false compositing.
		 */
		straightAlphaFromPremul?: boolean;
	}) {
""",
    """	private blitTextureToTarget({
		source,
		target,
		flipY = false,
		clear = true,
		clearColor = 0x000000,
		clearAlpha = 1,
		blend = "replace",
		contain,
		placement,
		destRect,
		opacity = 1,
		straightAlphaFromPremul = false,
	}: {
		source: THREE.Texture;
		target: THREE.WebGLRenderTarget | null;
		flipY?: boolean;
		clear?: boolean;
		clearColor?: number;
		clearAlpha?: number;
		blend?: "replace" | "alpha";
		/** Fit source pixels inside the destination without stretching. */
		contain?: {
			sourceWidth: number;
			sourceHeight: number;
			destWidth: number;
			destHeight: number;
		};
		/** Extra placement on top of contain. Scale is a multiplier, position is pixels, rotation is degrees. */
		placement?: {
			scaleX: number;
			scaleY: number;
			positionX: number;
			positionY: number;
			rotate: number;
		};
		/**
		 * Place source as a axis-aligned quad covering destRect in destination
		 * pixels (bottom-left origin). Used by tight text-layer RT blit.
		 */
		destRect?: { x: number; y: number; w: number; h: number } | null;
		/** Multiplies rgb and alpha of the finished picture. */
		opacity?: number;
		/**
		 * Editor Viewport presentComposerToLetterbox: additive bloom leaves
		 * premultiplied-looking rgb with low a; convert to straight alpha for
		 * premultipliedAlpha:false compositing.
		 */
		straightAlphaFromPremul?: boolean;
	}) {
""",
    "blitTextureToTarget signature",
)

text = replace_once(
    text,
    """		resolution.set(Math.max(1, destWidth), Math.max(1, destHeight));
		if (
			contain &&
			contain.sourceWidth > 0 &&
			contain.sourceHeight > 0 &&
			contain.destWidth > 0 &&
			contain.destHeight > 0
		) {
			const pixel = Math.min(
				contain.destWidth / contain.sourceWidth,
				contain.destHeight / contain.sourceHeight,
			);
			const userScaleX = placement?.scaleX ?? 1;
			const userScaleY = placement?.scaleY ?? 1;
			scale.set(
				((contain.sourceWidth * pixel) / contain.destWidth) * userScaleX,
				((contain.sourceHeight * pixel) / contain.destHeight) * userScaleY,
			);
			const posX = placement?.positionX ?? 0;
			const posY = placement?.positionY ?? 0;
			offset.set((posX * 2) / contain.destWidth, (-posY * 2) / contain.destHeight);
			blitMaterial.uniforms.uRotate.value =
				-((placement?.rotate ?? 0) * Math.PI) / 180;
		} else {
			scale.set(1, 1);
			offset.set(0, 0);
			blitMaterial.uniforms.uRotate.value = 0;
		}
""",
    """		resolution.set(Math.max(1, destWidth), Math.max(1, destHeight));
		if (
			destRect &&
			destRect.w > 0 &&
			destRect.h > 0 &&
			destWidth > 0 &&
			destHeight > 0
		) {
			const dw = Math.max(1, destWidth);
			const dh = Math.max(1, destHeight);
			scale.set(destRect.w / dw, destRect.h / dh);
			const cx = destRect.x + destRect.w * 0.5;
			const cy = destRect.y + destRect.h * 0.5;
			offset.set((cx / dw) * 2 - 1, (cy / dh) * 2 - 1);
			blitMaterial.uniforms.uRotate.value = 0;
		} else if (
			contain &&
			contain.sourceWidth > 0 &&
			contain.sourceHeight > 0 &&
			contain.destWidth > 0 &&
			contain.destHeight > 0
		) {
			const pixel = Math.min(
				contain.destWidth / contain.sourceWidth,
				contain.destHeight / contain.sourceHeight,
			);
			const userScaleX = placement?.scaleX ?? 1;
			const userScaleY = placement?.scaleY ?? 1;
			scale.set(
				((contain.sourceWidth * pixel) / contain.destWidth) * userScaleX,
				((contain.sourceHeight * pixel) / contain.destHeight) * userScaleY,
			);
			const posX = placement?.positionX ?? 0;
			const posY = placement?.positionY ?? 0;
			offset.set((posX * 2) / contain.destWidth, (-posY * 2) / contain.destHeight);
			blitMaterial.uniforms.uRotate.value =
				-((placement?.rotate ?? 0) * Math.PI) / 180;
		} else {
			scale.set(1, 1);
			offset.set(0, 0);
			blitMaterial.uniforms.uRotate.value = 0;
		}
""",
    "blit scale/offset body",
)

# Replace the PP + overlay tail of renderOneFlowerText from useCameraPp through return
old_tail = '''		if (useCameraPp && built.camera) {
			type CanvasUi = { type?: string; renderMode?: string };
			const canvases: Array<{ obj: THREE.Object3D; ui: CanvasUi }> = [];
			built.root.traverse((obj) => {
				const ui = getFccUI(obj) as CanvasUi | null;
				if (ui?.type === "canvas") canvases.push({ obj, ui });
			});
			const prevModes = canvases.map(({ ui }) => ui.renderMode);
			for (const { ui } of canvases) ui.renderMode = "camera";

			const packId = TIMELINE_FLOWER_TEXT_PACK_PREFIX + item.elementId;
			// Bloom kernels are texel-sized (UnrealBloomPass). Match editor Viewport:
			// composer FBO = authored project/safe-frame pixels, not preview undersample.
			// (previewScale still applies to the final compose blit via target size.)
			const ppRT = this.ensureTextLayerTarget(resW, resH);
			// BeautyClear parity: pack.background Default → transparent; Color → opaque plate.
			const packBg = (activePack?.payload as { background?: { type?: string; color?: string } } | null)
				?.background;
			const bgType = String(packBg?.type || "Default");
			const isTransparentBg =
				bgType === "Default" || bgType === "default" || !packBg?.type;
			const beautyClearColor = isTransparentBg
				? null
				: new THREE.Color(packBg?.color || "#000000");
			try {
				// Per-frame SS-camera path: pack postProcess on beauty cam (editor parity).
				// Intermediate RT so we can alpha-blit with clip opacity (no textFx).
				const ortho = this.ensureFlowerPpOrtho(resW, resH);
				this.renderPackWithPostProcess({
					packId: packId + ":textanim-pp",
					built: {
						...built,
						postProcess: packPpStack,
						// Layout / placeCanvasInFrontOfCamera + bloom setSize: authored pixels.
						resolution: { width: resW, height: resH },
						camera: ortho,
					},
					width: Math.max(1, resW),
					height: Math.max(1, resH),
					target: ppRT,
					clearFirst: true,
					keepDepthClear: false,
					allowMsaa: true,
					cameraOverride: ortho,
					transparentClear: isTransparentBg,
					beautyClearColor,
					// Pack output.toneMapping is truth (none stays NoToneMapping).
					// LDR pre-bloom clamp in composer handles none+Bloom without Neutral remap.
					outputToneMapping: resolvePackOutputToneMapping(activePack?.payload),
					outputExposure: resolvePackOutputExposure(activePack?.payload),
				});
			} finally {
				canvases.forEach(({ ui }, i) => {
					const prev = prevModes[i];
					ui.renderMode = prev === "camera" || prev === "overlay" ? prev : "overlay";
				});
			}
			if (clearFirst) {
				renderer.setRenderTarget(target);
				renderer.setClearColor(0x000000, 0);
				renderer.clear(true, true, true);
			}
			// Pack OutputPass: none => working-space bytes (no sRGB transfer); Neutral/ACES
			// => display-encoded. Tag sRGB for MeshBasic present round-trip either way
			// (identity for working bytes, correct round-trip for display bytes).
			ppRT.texture.colorSpace = THREE.SRGBColorSpace;
			// renderPackWithPostProcess already straight-alpha+clamps when
			// transparentClear (composer→ppRT). Do NOT convert again —
			// would raise alpha / darken bloom (divide by a twice).
			this.blitTextureToTarget({
				source: ppRT.texture,
				target,
				flipY: false,
				clear: false,
				blend: "alpha",
				opacity: item.opacity * (props.opacity > 0 ? props.opacity : 1),
				straightAlphaFromPremul: false,
			});
			return true;
		}

		// Default: overlay UI camera → text layer RT → blit (no textFx).
		const textRT = this.ensureTextLayerTarget(rtW, rtH);
		const drew = renderTextLayerToTarget({
			renderer,
			root: built.root,
			uiCamera: this.ensureUIOverlayCamera(),
			resW,
			resH,
			target: textRT,
		});
		if (!drew) return false;

		if (clearFirst) {
			renderer.setRenderTarget(target);
			renderer.setClearColor(0x000000, 0);
			renderer.clear(true, true, true);
		}

		this.blitTextureToTarget({
			source: textRT.texture,
			target,
			flipY: false,
			clear: false,
			blend: "alpha",
			opacity: item.opacity * (props.opacity > 0 ? props.opacity : 1),
		});
		return true;
	}
'''

# The file may use special dashes - read the actual section from file
start = text.find('\t\tif (useCameraPp && built.camera) {')
if start < 0:
    raise SystemExit('useCameraPp block start not found')
end = text.find('\n\tprivate ensurePackBuilt(', start)
if end < 0:
    raise SystemExit('ensurePackBuilt after flower text not found')
# include back to end of renderOneFlowerText - the block ends with `}\n\n\n\tprivate ensurePackBuilt`
# find the closing of renderOneFlowerText: last `return true;\n\t}` before ensurePackBuilt
chunk = text[start:end]
# verify
if 'Default: overlay UI camera' not in chunk and 'text layer RT' not in chunk:
    # encoding may have mangled arrow
    if 'ensureTextLayerTarget(rtW, rtH)' not in chunk:
        raise SystemExit('unexpected chunk content:\n' + chunk[:300])

new_tail = r'''		// Tight AABB + bloom pad in authored project pixels (shared helper).
		// Layout uses full canvas; RT / PP FBO / blit destRect use the padded rect.
		const rtRect: TextLayerAabb = resolveTextLayerRtRect({
			root: built.root,
			resW,
			resH,
			stack: packPpStack,
			propsFallback: {
				content: props.content,
				positionX: props.positionX,
				positionY: props.positionY,
				scaledFontSize: props.scaledFontSize,
				letterSpacing: props.letterSpacing,
				lineHeight: props.lineHeight,
				scaleX: props.scaleX,
				scaleY: props.scaleY,
				flowerStyle: props.flowerStyle,
			},
		});
		const destRect = mapAabbToDestRect(
			rtRect,
			resW,
			resH,
			target.width || width,
			target.height || height,
		);
		const opacityMul = item.opacity * (props.opacity > 0 ? props.opacity : 1);

		if (useCameraPp && built.camera) {
			type CanvasUi = { type?: string; renderMode?: string };
			const canvases: Array<{ obj: THREE.Object3D; ui: CanvasUi }> = [];
			built.root.traverse((obj) => {
				const ui = getFccUI(obj) as CanvasUi | null;
				if (ui?.type === "canvas") canvases.push({ obj, ui });
			});
			const prevModes = canvases.map(({ ui }) => ui.renderMode);
			for (const { ui } of canvases) ui.renderMode = "camera";

			const packId = TIMELINE_FLOWER_TEXT_PACK_PREFIX + item.elementId;
			// Bloom kernels are texel-sized. Keep 1:1 authored density on the tight
			// FBO (not preview undersample) so radius matches full-canvas authoring;
			// pad grows with radius so large blooms naturally approach full canvas.
			const ppRT = this.ensureTextLayerTarget(
				Math.max(1, Math.round(rtRect.w)),
				Math.max(1, Math.round(rtRect.h)),
				{ fit: true },
			);
			const packBg = (activePack?.payload as { background?: { type?: string; color?: string } } | null)
				?.background;
			const bgType = String(packBg?.type || "Default");
			const isTransparentBg =
				bgType === "Default" || bgType === "default" || !packBg?.type;
			const beautyClearColor = isTransparentBg
				? null
				: new THREE.Color(packBg?.color || "#000000");
			const ortho = this.ensureFlowerPpOrtho(resW, resH);
			const view = aabbToCenteredOrthoView(rtRect, resW, resH);
			try {
				// Full frustum for placeCanvas; viewOffset crops to padded AABB.
				ortho.setViewOffset(
					view.fullW,
					view.fullH,
					view.offsetX,
					view.offsetY,
					view.width,
					view.height,
				);
				ortho.updateProjectionMatrix();
				this.renderPackWithPostProcess({
					packId: packId + ":textanim-pp",
					built: {
						...built,
						postProcess: packPpStack,
						// placeCanvas still authored full res; composer FBO = tight RT.
						resolution: { width: resW, height: resH },
						camera: ortho,
					},
					width: Math.max(1, Math.round(rtRect.w)),
					height: Math.max(1, Math.round(rtRect.h)),
					target: ppRT,
					clearFirst: true,
					keepDepthClear: false,
					allowMsaa: true,
					cameraOverride: ortho,
					transparentClear: isTransparentBg,
					beautyClearColor,
					outputToneMapping: resolvePackOutputToneMapping(activePack?.payload),
					outputExposure: resolvePackOutputExposure(activePack?.payload),
				});
			} finally {
				ortho.clearViewOffset();
				ortho.updateProjectionMatrix();
				canvases.forEach(({ ui }, i) => {
					const prev = prevModes[i];
					ui.renderMode = prev === "camera" || prev === "overlay" ? prev : "overlay";
				});
			}
			if (clearFirst) {
				renderer.setRenderTarget(target);
				renderer.setClearColor(0x000000, 0);
				renderer.clear(true, true, true);
			}
			ppRT.texture.colorSpace = THREE.SRGBColorSpace;
			this.blitTextureToTarget({
				source: ppRT.texture,
				target,
				flipY: false,
				clear: false,
				blend: "alpha",
				destRect,
				opacity: opacityMul,
				straightAlphaFromPremul: false,
			});
			return true;
		}

		// Overlay UI camera → tight text RT → offset blit (no pack PP).
		const ovW = Math.max(1, Math.round(rtRect.w * previewScale));
		const ovH = Math.max(1, Math.round(rtRect.h * previewScale));
		const textRT = this.ensureTextLayerTarget(ovW, ovH, { fit: true });
		const drew = renderTextLayerToTarget({
			renderer,
			root: built.root,
			uiCamera: this.ensureUIOverlayCamera(),
			resW,
			resH,
			target: textRT,
			viewRect: rtRect,
		});
		if (!drew) return false;

		if (clearFirst) {
			renderer.setRenderTarget(target);
			renderer.setClearColor(0x000000, 0);
			renderer.clear(true, true, true);
		}

		this.blitTextureToTarget({
			source: textRT.texture,
			target,
			flipY: false,
			clear: false,
			blend: "alpha",
			destRect,
			opacity: opacityMul,
		});
		return true;
	}

'''

text = text[:start] + new_tail + text[end:]
path.write_text(text, encoding="utf-8")
print("ok three-compositor.ts", "rtW still?", "const rtW" in text[start:start+500])
# sanity: rtW/rtH may now be unused - check
import re
fn_start = text.find('private renderOneFlowerText({')
fn_end = text.find('private ensurePackBuilt(', fn_start)
fn = text[fn_start:fn_end]
print('has rtW decl', 'const rtW =' in fn)
print('has rtRect', 'rtRect' in fn)
print('has destRect blit', 'destRect,' in fn)
