# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src")
comp = ROOT / "services" / "renderer" / "compositor" / "three-compositor.ts"
text = comp.read_text(encoding="utf-8")

# Update imports
old_imp = """	resolveTextLayerRtRect,
	mapAabbToDestRect,
	aabbToCenteredOrthoView,
	type TextLayerAabb,
} from \"@/vfxpack/text-layer-aabb\";"""

# Find actual import block
import re
m = re.search(r'from \"@/vfxpack/text-layer-aabb\";', text)
if not m:
    raise SystemExit("text-layer-aabb import not found")
# find start of that import
start = text.rfind("import", 0, m.start())
block = text[start:m.end()]
print("IMPORT BLOCK:\n", block[:500])

needed = ["bloomPadPxFromPackTracks", "unionTextLayerAabb", "measureOverlayTextInkAabb"]
if "bloomPadPxFromPackTracks" not in block:
    # replace closing of import to add names
    new_block = block.replace(
        "resolveTextLayerRtRect,",
        "resolveTextLayerRtRect,\n\tbloomPadPxFromPackTracks,\n\tunionTextLayerAabb,\n\tmeasureOverlayTextInkAabb,",
    )
    if new_block == block:
        # try another pattern
        new_block = block.replace(
            "} from \"@/vfxpack/text-layer-aabb\";",
            "\tbloomPadPxFromPackTracks,\n\tunionTextLayerAabb,\n\tmeasureOverlayTextInkAabb,\n} from \"@/vfxpack/text-layer-aabb\";",
        )
    text = text[:start] + new_block + text[m.end():]
    print("updated imports")
else:
    print("imports already have helpers")

# Update flowerTextScenes type to include rtCache
old_type = """	private flowerTextScenes = new Map<
		string,
		{ built: BuiltPackScene; hash: string; pack: LoadedVfxPack }
	>();"""
new_type = """	private flowerTextScenes = new Map<
		string,
		{
			built: BuiltPackScene;
			hash: string;
			pack: LoadedVfxPack;
			/** Stable tight-RT cache: expand-only ink + pack-max bloom pad (no per-frame realloc). */
			rtCache?: {
				key: string;
				ink: import(\"@/vfxpack/text-layer-aabb\").TextLayerAabb;
				rect: import(\"@/vfxpack/text-layer-aabb\").TextLayerAabb;
				padPx: number;
			};
		}
	>();"""
if old_type not in text:
    raise SystemExit("flowerTextScenes type missing")
text = text.replace(old_type, new_type)

# Replace rtRect computation block in renderOneFlowerText
old_rt = """		// Tight AABB + bloom pad in authored project pixels (shared helper).
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
		});"""

new_rt = """		// Tight AABB + bloom pad in authored project pixels (shared helper).
		// Layout uses full canvas; RT / PP FBO / blit destRect use the padded rect.
		// Pad from pack-max track peaks (not live K-frame strength) so RT/composer
		// signature stays stable while Bloom intensity animates.
		const padPx = bloomPadPxFromPackTracks({
			stack: packPpStack,
			tracks: activePack?.payload?.tracks ?? null,
			canvasW: resW,
			canvasH: resH,
			inkMaxSide: Math.max(
				1,
				(Number(props.scaledFontSize) || 48) *
					Math.max(4, String(props.content || \"\").length),
			),
		});
		const rtKey = [
			item.contentHash,
			resW,
			resH,
			padPx,
			String(props.scaledFontSize),
			String(props.letterSpacing ?? \"\"),
			String(props.lineHeight ?? \"\"),
			String(props.scaleX ?? 1),
			String(props.scaleY ?? 1),
		].join(\"|\");
		let rtRect: TextLayerAabb;
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

if old_rt not in text:
    raise SystemExit("rtRect block missing - dump nearby")
text = text.replace(old_rt, new_rt)

comp.write_text(text, encoding="utf-8")
print("patched three-compositor.ts")
