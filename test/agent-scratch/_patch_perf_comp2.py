# -*- coding: utf-8 -*-
from pathlib import Path
comp = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\services\renderer\compositor\three-compositor.ts")
text = comp.read_text(encoding="utf-8")

old = """		let rtRect: TextLayerAabb;
		const cached = entry.rtCache;
		if (cached && cached.key === rtKey) {
			// Expand-only: char poses may stick out once; never shrink mid-play.
			const liveInk = measureOverlayTextInkAabb(built.root, resW, resH);
			if (liveInk) {
				const ink = unionTextLayerAabb(cached.ink, liveInk);
				if (
					ink.x !== cached.ink.x ||
					ink.y !== cached.ink.y ||
					ink.w !== cached.ink.w ||
					ink.h !== cached.ink.h
				) {
					rtRect = resolveTextLayerRtRect({
						root: built.root,
						resW,
						resH,
						stack: packPpStack,
						padOverridePx: padPx,
						inkOverride: ink,
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
					entry.rtCache = { key: rtKey, ink, rect: rtRect, padPx };
				} else {
					rtRect = cached.rect;
				}
			} else {
				rtRect = cached.rect;
			}
		} else {
			rtRect = resolveTextLayerRtRect({
				root: built.root,
				resW,
				resH,
				stack: packPpStack,
				padOverridePx: padPx,
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
			const ink =
				measureOverlayTextInkAabb(built.root, resW, resH) || {
					x: rtRect.x,
					y: rtRect.y,
					w: rtRect.w,
					h: rtRect.h,
				};
			entry.rtCache = { key: rtKey, ink, rect: rtRect, padPx };
		}"""

new = """		let rtRect: TextLayerAabb;
		const cached = entry.rtCache;
		if (cached && cached.key === rtKey) {
			// Hit: reuse padded rect. Do NOT layout+measure every frame (was a
			// major play-path cost). Char travel is covered by motionPad below.
			rtRect = cached.rect;
		} else {
			const propsFallback = {
				content: props.content,
				positionX: props.positionX,
				positionY: props.positionY,
				scaledFontSize: props.scaledFontSize,
				letterSpacing: props.letterSpacing,
				lineHeight: props.lineHeight,
				scaleX: props.scaleX,
				scaleY: props.scaleY,
				flowerStyle: props.flowerStyle,
			};
			let ink =
				measureOverlayTextInkAabb(built.root, resW, resH) ||
				null;
			// Char-in travel can leave the rest ink; keep a motion skirt so we
			// don't remeasure every tick.
			if (ink && activePack) {
				const travel = Math.max(48, (Number(props.scaledFontSize) || 48) * 2.75);
				ink = {
					x: ink.x - travel,
					y: ink.y - travel,
					w: ink.w + travel * 2,
					h: ink.h + travel * 2,
				};
			}
			rtRect = resolveTextLayerRtRect({
				root: built.root,
				resW,
				resH,
				stack: packPpStack,
				padOverridePx: padPx,
				inkOverride: ink,
				propsFallback,
			});
			entry.rtCache = {
				key: rtKey,
				ink: ink || { x: rtRect.x, y: rtRect.y, w: rtRect.w, h: rtRect.h },
				rect: rtRect,
				padPx,
			};
		}"""

if old not in text:
    raise SystemExit("cached block not found")
text = text.replace(old, new)
# unionTextLayerAabb may now be unused - keep import for now (harmless) or remove
comp.write_text(text, encoding="utf-8")
print("updated cache hit path")
