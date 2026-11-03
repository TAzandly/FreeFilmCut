# -*- coding: utf-8 -*-
"""Revert tight AABB text RT to full project-size RT."""
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut")

# ---------- three-compositor.ts ----------
comp = ROOT / "freefilmcut/apps/web/src/services/renderer/compositor/three-compositor.ts"
text = comp.read_text(encoding="utf-8")

# Remove aabb imports
text = re.sub(
    r'\nimport \{\n\taabbToCenteredOrthoView,\n\tmapAabbToDestRect,\n\tresolveTextLayerRtRect,\n\tbloomPadPxFromPackTracks,\n\tmeasureOverlayTextInkAabb,\n\ttype TextLayerAabb,\n\} from "@/vfxpack/text-layer-aabb";\n',
    "\n",
    text,
    count=1,
)

# Remove rtCache from flowerTextScenes type
text = text.replace(
    """\t\t{\n\t\t\tbuilt: BuiltPackScene;\n\t\t\thash: string;\n\t\t\tpack: LoadedVfxPack;\n\t\t\t/** Stable tight-RT cache: expand-only ink + pack-max bloom pad (no per-frame realloc). */\n\t\t\trtCache?: {\n\t\t\t\tkey: string;\n\t\t\t\tink: import("@/vfxpack/text-layer-aabb").TextLayerAabb;\n\t\t\t\trect: import("@/vfxpack/text-layer-aabb").TextLayerAabb;\n\t\t\t\tpadPx: number;\n\t\t\t};\n\t\t}""",
    """\t\t{\n\t\t\tbuilt: BuiltPackScene;\n\t\t\thash: string;\n\t\t\tpack: LoadedVfxPack;\n\t\t}""",
)

# Soften comments that say "tight text RT"
text = text.replace(
    "\t/** Save/restore around tight text RT / pack PP so video layers keep full viewport. */",
    "\t/** Save/restore around text RT / pack PP so video layers keep full viewport. */",
)
text = text.replace(
    "\t\t\t// Tight text RT must not leave a small viewport; video/image need full accum.",
    "\t\t\t// Text / pack PP must not leave a non-full viewport; video/image need full accum.",
)
text = text.replace(
    "\t\t// EffectComposer sets viewport to its FBO size (tight text RT); restore so\n\t\t// following video/image layers and present use the full compose buffer.",
    "\t\t// EffectComposer sets viewport to its FBO size; restore so\n\t\t// following video/image layers and present use the full compose buffer.",
)

# ensureTextLayerTarget: drop fit
text = text.replace(
    """\tprivate ensureTextLayerTarget(
\t\twidth: number,
\t\theight: number,
\t\topts?: { fit?: boolean },
\t): THREE.WebGLRenderTarget {
\t\tthis.textLayerRT = ensureTextLayerRenderTarget(this.textLayerRT, width, height, {
\t\t\tstencilBuffer: true,
\t\t\tdepthBuffer: true,
\t\t\tfit: opts?.fit === true,
\t\t});
\t\treturn this.textLayerRT;
\t}""",
    """\tprivate ensureTextLayerTarget(
\t\twidth: number,
\t\theight: number,
\t): THREE.WebGLRenderTarget {
\t\tthis.textLayerRT = ensureTextLayerRenderTarget(this.textLayerRT, width, height, {
\t\t\tstencilBuffer: true,
\t\t\tdepthBuffer: true,
\t\t});
\t\treturn this.textLayerRT;
\t}""",
)

# Replace the big tight-RT block in renderOneFlowerText
old_block = r'''		// Tight AABB \+ bloom pad in authored project pixels \(shared helper\)\.
		// Layout uses full canvas; RT / PP FBO / blit destRect use the padded rect\.
		// Pad from pack-max track peaks \(not live K-frame strength\) so RT/composer
		// signature stays stable while Bloom intensity animates\.
		const padPx = bloomPadPxFromPackTracks\(\{
			stack: packPpStack,
			tracks: activePack\?\.payload\?\.tracks \?\? null,
			canvasW: resW,
			canvasH: resH,
			inkMaxSide: Math\.max\(
				1,
				\(Number\(props\.scaledFontSize\) \|\| 48\) \*
					Math\.max\(4, String\(props\.content \|\| ""\)\.length\),
			\),
		\}\);
		const rtKey = \[
			item\.contentHash,
			resW,
			resH,
			padPx,
			String\(props\.scaledFontSize\),
			String\(props\.letterSpacing \?\? ""\),
			String\(props\.lineHeight \?\? ""\),
			String\(props\.scaleX \?\? 1\),
			String\(props\.scaleY \?\? 1\),
		\]\.join\("\|"\);
		let rtRect: TextLayerAabb;
		const cached = entry\.rtCache;
		if \(cached && cached\.key === rtKey\) \{
			// Hit: reuse padded rect\. Do NOT layout\+measure every frame \(was a
			// major play-path cost\)\. Char travel is covered by motionPad below\.
			rtRect = cached\.rect;
		\} else \{
			const propsFallback = \{
				content: props\.content,
				positionX: props\.positionX,
				positionY: props\.positionY,
				scaledFontSize: props\.scaledFontSize,
				letterSpacing: props\.letterSpacing,
				lineHeight: props\.lineHeight,
				scaleX: props\.scaleX,
				scaleY: props\.scaleY,
				flowerStyle: props\.flowerStyle,
			\};
			let ink =
				measureOverlayTextInkAabb\(built\.root, resW, resH\) \|\|
				null;
			// Char-in travel can leave the rest ink; keep a motion skirt so we
			// don't remeasure every tick\.
			if \(ink && activePack\) \{
				const travel = Math\.max\(48, \(Number\(props\.scaledFontSize\) \|\| 48\) \* 2\.75\);
				ink = \{
					x: ink\.x - travel,
					y: ink\.y - travel,
					w: ink\.w \+ travel \* 2,
					h: ink\.h \+ travel \* 2,
				\};
			\}
			rtRect = resolveTextLayerRtRect\(\{
				root: built\.root,
				resW,
				resH,
				stack: packPpStack,
				padOverridePx: padPx,
				inkOverride: ink,
				propsFallback,
			\}\);
			entry\.rtCache = \{
				key: rtKey,
				ink: ink \|\| \{ x: rtRect\.x, y: rtRect\.y, w: rtRect\.w, h: rtRect\.h \},
				rect: rtRect,
				padPx,
			\};
		\}
		const destRect = mapAabbToDestRect\(
			rtRect,
			resW,
			resH,
			target\.width \|\| width,
			target\.height \|\| height,
		\);
		const opacityMul = item\.opacity \* \(props\.opacity > 0 \? props\.opacity : 1\);

		if \(useCameraPp && built\.camera\) \{
			type CanvasUi = \{ type\?: string; renderMode\?: string \};
			const canvases: Array<\{ obj: THREE\.Object3D; ui: CanvasUi \}> = \[\];
			built\.root\.traverse\(\(obj\) => \{
				const ui = getFccUI\(obj\) as CanvasUi \| null;
				if \(ui\?\.type === "canvas"\) canvases\.push\(\{ obj, ui \}\);
			\}\);
			const prevModes = canvases\.map\(\(\{ ui \}\) => ui\.renderMode\);
			for \(const \{ ui \} of canvases\) ui\.renderMode = "camera";

			const packId = TIMELINE_FLOWER_TEXT_PACK_PREFIX \+ item\.elementId;
			// Bloom kernels are texel-sized\. Keep 1:1 authored density on the tight
			// FBO \(not preview undersample\) so radius matches full-canvas authoring;
			// pad grows with radius so large blooms naturally approach full canvas\.
			const ppRT = this\.ensureTextLayerTarget\(
				Math\.max\(1, Math\.round\(rtRect\.w\)\),
				Math\.max\(1, Math\.round\(rtRect\.h\)\),
				\{ fit: true \},
			\);
			// Composer signature uses actual RT size \(hysteresis\), not breathing AABB\.
			const ppW = ppRT\.width;
			const ppH = ppRT\.height;
			const packBg = \(activePack\?\.payload as \{ background\?: \{ type\?: string; color\?: string \} \} \| null\)
				\?\.background;
			const bgType = String\(packBg\?\.type \|\| "Default"\);
			const isTransparentBg =
				bgType === "Default" \|\| bgType === "default" \|\| !packBg\?\.type;
			const beautyClearColor = isTransparentBg
				\? null
				: new THREE\.Color\(packBg\?\.color \|\| "#000000"\);
			const ortho = this\.ensureFlowerPpOrtho\(resW, resH\);
			const view = aabbToCenteredOrthoView\(rtRect, resW, resH\);
			try \{
				// Full frustum for placeCanvas; viewOffset crops to padded AABB\.
				ortho\.setViewOffset\(
					view\.fullW,
					view\.fullH,
					view\.offsetX,
					view\.offsetY,
					view\.width,
					view\.height,
				\);
				ortho\.updateProjectionMatrix\(\);
				this\.renderPackWithPostProcess\(\{
					packId: packId \+ ":textanim-pp",
					built: \{
						\.\.\.built,
						postProcess: packPpStack,
						// placeCanvas still authored full res; composer FBO = tight RT\.
						resolution: \{ width: resW, height: resH \},
						camera: ortho,
					\},
					width: Math\.max\(1, ppW\),
					height: Math\.max\(1, ppH\),
					target: ppRT,
					clearFirst: true,
					keepDepthClear: false,
					allowMsaa: true,
					cameraOverride: ortho,
					transparentClear: isTransparentBg,
					beautyClearColor,
					outputToneMapping: resolvePackOutputToneMapping\(activePack\?\.payload\),
					outputExposure: resolvePackOutputExposure\(activePack\?\.payload\),
				\}\);
			\} finally \{
				ortho\.clearViewOffset\(\);
				ortho\.updateProjectionMatrix\(\);
				canvases\.forEach\(\(\{ ui \}, i\) => \{
					const prev = prevModes\[i\];
					ui\.renderMode = prev === "camera" \|\| prev === "overlay" \? prev : "overlay";
				\}\);
			\}
			if \(clearFirst\) \{
				renderer\.setRenderTarget\(target\);
				renderer\.setClearColor\(0x000000, 0\);
				renderer\.clear\(true, true, true\);
			\}
			ppRT\.texture\.colorSpace = THREE\.SRGBColorSpace;
			this\.blitTextureToTarget\(\{
				source: ppRT\.texture,
				target,
				flipY: false,
				clear: false,
				blend: "alpha",
				destRect,
				opacity: opacityMul,
				straightAlphaFromPremul: false,
			\}\);
			return true;
		\}

		// Overlay UI camera .* tight text RT .* offset blit \(no pack PP\)\.
		const ovW = Math\.max\(1, Math\.round\(rtRect\.w \* previewScale\)\);
		const ovH = Math\.max\(1, Math\.round\(rtRect\.h \* previewScale\)\);
		const textRT = this\.ensureTextLayerTarget\(ovW, ovH, \{ fit: true \}\);
		const drew = renderTextLayerToTarget\(\{
			renderer,
			root: built\.root,
			uiCamera: this\.ensureUIOverlayCamera\(\),
			resW,
			resH,
			target: textRT,
			viewRect: rtRect,
		\}\);
		if \(!drew\) return false;

		if \(clearFirst\) \{
			renderer\.setRenderTarget\(target\);
			renderer\.setClearColor\(0x000000, 0\);
			renderer\.clear\(true, true, true\);
		\}

		this\.blitTextureToTarget\(\{
			source: textRT\.texture,
			target,
			flipY: false,
			clear: false,
			blend: "alpha",
			destRect,
			opacity: opacityMul,
		\}\);
		return true;
	\}'''

new_block = '''		// Full project / engineering resolution text RT (preview-scaled for overlay).
		// Tight AABB sizing was reverted 2026-10-23 — too many seam/viewport issues.
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
			// Bloom kernels are texel-sized: keep 1:1 authored project density
			// (not preview undersample) so radius matches editor authoring.
			const ppRT = this.ensureTextLayerTarget(
				Math.max(1, Math.round(resW)),
				Math.max(1, Math.round(resH)),
			);
			const ppW = ppRT.width;
			const ppH = ppRT.height;
			const packBg = (activePack?.payload as { background?: { type?: string; color?: string } } | null)
				?.background;
			const bgType = String(packBg?.type || "Default");
			const isTransparentBg =
				bgType === "Default" || bgType === "default" || !packBg?.type;
			const beautyClearColor = isTransparentBg
				? null
				: new THREE.Color(packBg?.color || "#000000");
			const ortho = this.ensureFlowerPpOrtho(resW, resH);
			try {
				this.renderPackWithPostProcess({
					packId: packId + ":textanim-pp",
					built: {
						...built,
						postProcess: packPpStack,
						resolution: { width: resW, height: resH },
						camera: ortho,
					},
					width: Math.max(1, ppW),
					height: Math.max(1, ppH),
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
				opacity: opacityMul,
				straightAlphaFromPremul: false,
			});
			return true;
		}

		// Overlay UI camera → full-frame text RT → full blit (no pack PP).
		const ovW = Math.max(1, Math.round(resW * previewScale));
		const ovH = Math.max(1, Math.round(resH * previewScale));
		const textRT = this.ensureTextLayerTarget(ovW, ovH);
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
			opacity: opacityMul,
		});
		return true;
	}'''

m = re.search(old_block, text, flags=re.DOTALL)
if not m:
    raise SystemExit("FAILED: tight AABB block not found in three-compositor.ts")
text = text[: m.start()] + new_block + text[m.end() :]

# Soften destRect comment (keep optional param for API compatibility)
text = text.replace(
    """\t\t/**
\t\t * Place source as a axis-aligned quad covering destRect in destination
\t\t * pixels (bottom-left origin). Used by tight text-layer RT blit.
\t\t */
\t\tdestRect?: { x: number; y: number; w: number; h: number } | null;""",
    """\t\t/**
\t\t * Place source as an axis-aligned quad covering destRect in destination
\t\t * pixels (bottom-left origin). Optional; text layers use full-frame blit.
\t\t */
\t\tdestRect?: { x: number; y: number; w: number; h: number } | null;""",
)

comp.write_text(text, encoding="utf-8")
print("OK three-compositor.ts")

# Verify no leftover aabb imports / tight calls
left = []
for pat in [
    "text-layer-aabb",
    "resolveTextLayerRtRect",
    "bloomPadPxFromPackTracks",
    "measureOverlayTextInkAabb",
    "aabbToCenteredOrthoView",
    "mapAabbToDestRect",
    "rtCache",
    "setViewOffset",
    "fit: true",
    "viewRect:",
]:
    if pat in text:
        # destRect: may still exist as optional param — only flag viewRect: if used in call
        left.append(pat)
print("leftover markers:", left)
