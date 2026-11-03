# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")

def read(p):
    return Path(p).read_text(encoding="utf-8")

def write(p, s):
    Path(p).write_text(s, encoding="utf-8")
    print("wrote", p, "len", len(s))

ta = read(ROOT / "ui/TextAnim.js")

# Check current state
print("edgeIntensity already?", "edgeIntensity" in ta)
print("wipe default count", ta.count("wipeReveal: { enabled: false, direction: 'ltr', soft: 0.12 }"))

# default wipeReveal — only the createDefault one without edge yet
if "edgeIntensity: 2.5" not in ta:
    ta = ta.replace(
        "wipeReveal: { enabled: false, direction: 'ltr', soft: 0.12 },",
        "wipeReveal: { enabled: false, direction: 'ltr', soft: 0.12, edgeIntensity: 2.5, edgeWidth: 0.04 },",
        1,  # only first in createDefault
    )
    # also the one in mergePhaseInPlace default clone paths — replace remaining
    ta = ta.replace(
        "wipeReveal: { enabled: false, direction: 'ltr', soft: 0.12 },",
        "wipeReveal: { enabled: false, direction: 'ltr', soft: 0.12, edgeIntensity: 2.5, edgeWidth: 0.04 },",
    )

old_norm = """function normalizeWipeReveal( raw, fallback ) {
	const d = fallback || createDefaultTextAnimPhase().modulators.wipeReveal;
	const w = raw && typeof raw === 'object' ? raw : {};
	return {
		enabled: !! w.enabled,
		direction: TEXTANIM_WIPE_DIRS.includes( w.direction ) ? w.direction : d.direction,
		soft: Math.max( 0, Math.min( 0.5, num( w.soft, d.soft ) ) ),
	};
}"""

new_norm = """function normalizeWipeReveal( raw, fallback ) {
	const d = fallback || createDefaultTextAnimPhase().modulators.wipeReveal;
	const w = raw && typeof raw === 'object' ? raw : {};
	return {
		enabled: !! w.enabled,
		direction: TEXTANIM_WIPE_DIRS.includes( w.direction ) ? w.direction : d.direction,
		soft: Math.max( 0, Math.min( 0.5, num( w.soft, d.soft ) ) ),
		edgeIntensity: Math.max( 0, num( w.edgeIntensity, d.edgeIntensity != null ? d.edgeIntensity : 2.5 ) ),
		edgeWidth: Math.max( 0.005, Math.min( 0.25, num( w.edgeWidth, d.edgeWidth != null ? d.edgeWidth : 0.04 ) ) ),
	};
}"""

if "edgeIntensity: Math.max( 0, num( w.edgeIntensity" not in ta:
    if old_norm not in ta:
        raise SystemExit('normalizeWipeReveal block not found')
    ta = ta.replace(old_norm, new_norm)

old_merge_w = """		} else {
			const w = phase.modulators.wipeReveal;
			w.enabled = !! w.enabled;
			if ( ! TEXTANIM_WIPE_DIRS.includes( w.direction ) ) w.direction = d.modulators.wipeReveal.direction;
			if ( w.soft == null || ! Number.isFinite( Number( w.soft ) ) ) {
				w.soft = d.modulators.wipeReveal.soft;
			}
		}"""

new_merge_w = """		} else {
			const w = phase.modulators.wipeReveal;
			w.enabled = !! w.enabled;
			if ( ! TEXTANIM_WIPE_DIRS.includes( w.direction ) ) w.direction = d.modulators.wipeReveal.direction;
			if ( w.soft == null || ! Number.isFinite( Number( w.soft ) ) ) {
				w.soft = d.modulators.wipeReveal.soft;
			}
			if ( w.edgeIntensity == null || ! Number.isFinite( Number( w.edgeIntensity ) ) ) {
				w.edgeIntensity = d.modulators.wipeReveal.edgeIntensity;
			}
			if ( w.edgeWidth == null || ! Number.isFinite( Number( w.edgeWidth ) ) ) {
				w.edgeWidth = d.modulators.wipeReveal.edgeWidth;
			}
		}"""

if "w.edgeIntensity == null" not in ta:
    if old_merge_w not in ta:
        raise SystemExit('merge wipe block not found')
    ta = ta.replace(old_merge_w, new_merge_w)

m = re.search(r"export function sampleWipeRevealProgress\( t, anim \) \{.*?\n\}", ta, re.S)
if not m:
    raise SystemExit('sampleWipeRevealProgress not found')
if "edgeIntensity: Math.max( 0, num( wipe.edgeIntensity" not in m.group(0):
    new_fn = """export function sampleWipeRevealProgress( t, anim ) {
	const phase = getActivePhase( anim );
	const wipe = phase.modulators && phase.modulators.wipeReveal;
	if ( ! wipe || ! wipe.enabled ) {
		return {
			enabled: false,
			progress: 1,
			direction: 'ltr',
			soft: 0.12,
			edgeIntensity: 0,
			edgeWidth: 0.04,
		};
	}
	const duration = Math.max( 0.01, num( phase.duration, 1 ) );
	let p = clamp01( num( t, 0 ) / duration );
	if ( anim && anim.previewPhase === 'out' ) p = 1 - p;
	return {
		enabled: true,
		progress: p,
		direction: TEXTANIM_WIPE_DIRS.includes( wipe.direction ) ? wipe.direction : 'ltr',
		soft: Math.max( 0.02, Math.min( 0.45, num( wipe.soft, 0.12 ) ) ),
		edgeIntensity: Math.max( 0, num( wipe.edgeIntensity, 2.5 ) ),
		edgeWidth: Math.max( 0.005, Math.min( 0.25, num( wipe.edgeWidth, 0.04 ) ) ),
	};
}"""
    ta = ta[:m.start()] + new_fn + ta[m.end():]

ta = ta.replace(
    " * Char-local channels for Editor preview; wipeReveal on text RT; spring ease.",
    " * Char-local channels for Editor preview; wipeReveal = text-RT fragment wipe + edge glint; spring ease.",
)

# Update outdated comments about per-glyph wipe
ta = re.sub(
    r"/\*\*\n \* Sample wipeReveal progress.*?\n \*/\n/\*\*\n \* Wipe reveal progress.*?\n \*/\n",
    """/**
 * Wipe reveal progress over the phase duration (linear 0..1).
 * In: 0 = fully masked, 1 = fully shown. Out: inverted.
 * Does NOT use stagger ease — spring/bounce would slam the mask open.
 * Mask + edge glint applied in TextLayerRT fragment wipe (not per-glyph opacity).
 */
""",
    ta,
    count=1,
    flags=re.S,
)

write(ROOT / "ui/TextAnim.js", ta)
print("TextAnim.js OK")
