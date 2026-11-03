from pathlib import Path
path = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\services\renderer\compositor\three-compositor.ts")
text = path.read_text(encoding="utf-8")
old = '''			// PP result is display-encoded; keep sRGB tag for MeshBasic present.
			ppRT.texture.colorSpace = THREE.SRGBColorSpace;
			// Match editor presentComposerToLetterbox: clamp rgb + straight-alpha
			// (additive bloom often leaves a < max(rgb)). Needed for none parity;
			// harmless under Neutral (already compressed).
			this.blitTextureToTarget({
				source: ppRT.texture,
				target,
				flipY: false,
				clear: false,
				blend: "alpha",
				opacity: item.opacity * (props.opacity > 0 ? props.opacity : 1),
				straightAlphaFromPremul: true,
			});'''
new = '''			// PP result is display-encoded; keep sRGB tag for MeshBasic present.
			ppRT.texture.colorSpace = THREE.SRGBColorSpace;
			// renderPackWithPostProcess already straight-alpha+clamps when
			// transparentClear (composer->ppRT). Do NOT convert again — that
			// would raise alpha / darken bloom (divide by a twice).
			this.blitTextureToTarget({
				source: ppRT.texture,
				target,
				flipY: false,
				clear: false,
				blend: "alpha",
				opacity: item.opacity * (props.opacity > 0 ? props.opacity : 1),
				straightAlphaFromPremul: false,
			});'''
if old not in text:
    raise SystemExit("blit block not found")
text = text.replace(old, new, 1)
path.write_text(text, encoding="utf-8")
print("reverted second straightAlpha")
