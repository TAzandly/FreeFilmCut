# -*- coding: utf-8 -*-
from pathlib import Path

NEW_TS = r'''/** Collect bloom/deepGlow pad in project pixels from a PP stack. */
export function bloomPadPxFromStack(input: TextLayerBloomPadInput): number {
	const base = Math.max(0, Math.round(input.basePadPx ?? BASE_AA_PAD));
	const stack = input.stack;
	const canvasMax = Math.max(1, input.canvasW, input.canvasH);
	const inkMax = Math.max(1, input.inkMaxSide);
	let bloomPad = 0;
	if (!stack || stack.enabled === false) return base;
	for (const entry of stack.effects || []) {
		if (!entry || entry.enabled === false) continue;
		const params = entry.params || {};
		if (entry.type === "bloom") {
			const strength = Math.max(0, Number(params.strength) || 0);
			const radius = Math.max(0, Number(params.radius) || 0);
			if (strength < 1e-4) continue;
			bloomPad = Math.max(
				bloomPad,
				unrealBloomHaloPadPx(strength, radius, canvasMax, inkMax),
			);
		} else if (entry.type === "deepGlow") {
			const intensity = Math.max(0, Number(params.intensity) || 0);
			const radius = Math.max(0, Number(params.radius) || 0);
			if (intensity < 1e-4) continue;
			// deepGlow radius is authored in a softer unit; keep generous floor.
			bloomPad = Math.max(
				bloomPad,
				radius * 64 + 32,
				48 * Math.min(2, intensity + 0.35),
				0.06 * canvasMax,
			);
		}
	}
	return Math.max(base, Math.ceil(bloomPad));
}

/**
 * UnrealBloomPass pad in **project pixels** (1:1 PP density).
 *
 * Important: `radius` is a 0..1 **mip-weight lerp** (mix factor↔mirrorFactor),
 * NOT a pixel/kernel radius. Separable kernels [6,10,14,18,22] on the half-res
 * mip chain give approx full-res texel reaches ~[12, 40, 112, 288, 704] when the
 * bloom FBO is 1:1 with authored pixels. Old formula `radius * k * ink` under-
 * padded badly at author values like radius=0.01 (sweep), causing hard RT seams.
 *
 * Pad ≈ strength-weighted mix of those mip reaches; radius shifts weight toward
 * larger mips; clamp so we expand toward full-canvas only when needed.
 */
function unrealBloomHaloPadPx(
	strength: number,
	radius: number,
	canvasMax: number,
	inkMax: number,
): number {
	const s = Math.max(0, strength);
	const t = Math.min(1, Math.max(0, radius));
	// Soft-visible reaches (not the hard kernel tip). Outer mips are faint but
	// wipe/HDR edges + additive composite still show a wide soft skirt.
	const r0 = 12;
	const r1 = 40;
	const r2 = 112;
	const r3 = 288;
	const r4 = Math.min(704, canvasMax * 0.45);
	const reachCore = 0.5 * r0 + 0.35 * r1 + 0.15 * r2; // ~37px
	const reachOuter = 0.25 * r1 + 0.35 * r2 + 0.25 * r3 + 0.15 * r4;
	const reach = (1 - t) * reachCore + t * reachOuter;
	// strength: low values still need core blur room; high pulls outer mips in.
	const sMul = Math.min(2.75, 0.75 + s * 1.25);
	let pad = reach * sMul;
	// Floor: never thinner than a readable halo band; also ~8% canvas / fraction of ink
	// so small-radius authored packs (0.01) still clear wipe bloom skirts.
	pad = Math.max(pad, 64, 0.08 * canvasMax, Math.min(0.22 * canvasMax, 0.45 * inkMax * Math.min(1.4, s + 0.55)));
	pad = Math.min(pad, 0.48 * canvasMax);
	return pad;
}
'''

NEW_JS = r'''export function bloomPadPxFromStack( input ) {

	const base = Math.max( 0, Math.round( input.basePadPx != null ? input.basePadPx : BASE_AA_PAD ) );
	const stack = input.stack;
	const canvasMax = Math.max( 1, input.canvasW, input.canvasH );
	const inkMax = Math.max( 1, input.inkMaxSide );
	let bloomPad = 0;
	if ( ! stack || stack.enabled === false ) return base;
	const effects = stack.effects || [];
	for ( let i = 0; i < effects.length; i ++ ) {

		const entry = effects[ i ];
		if ( ! entry || entry.enabled === false ) continue;
		const params = entry.params || {};
		if ( entry.type === 'bloom' ) {

			const strength = Math.max( 0, Number( params.strength ) || 0 );
			const radius = Math.max( 0, Number( params.radius ) || 0 );
			if ( strength < 1e-4 ) continue;
			bloomPad = Math.max(
				bloomPad,
				unrealBloomHaloPadPx( strength, radius, canvasMax, inkMax )
			);

		} else if ( entry.type === 'deepGlow' ) {

			const intensity = Math.max( 0, Number( params.intensity ) || 0 );
			const radius = Math.max( 0, Number( params.radius ) || 0 );
			if ( intensity < 1e-4 ) continue;
			bloomPad = Math.max(
				bloomPad,
				radius * 64 + 32,
				48 * Math.min( 2, intensity + 0.35 ),
				0.06 * canvasMax
			);

		}

	}
	return Math.max( base, Math.ceil( bloomPad ) );

}

/**
 * UnrealBloomPass pad in project pixels (1:1 PP density).
 * `radius` is a 0..1 mip-weight lerp, NOT pixels — see OpenCut text-layer-aabb.ts.
 */
function unrealBloomHaloPadPx( strength, radius, canvasMax, inkMax ) {

	const s = Math.max( 0, strength );
	const t = Math.min( 1, Math.max( 0, radius ) );
	const r0 = 12;
	const r1 = 40;
	const r2 = 112;
	const r3 = 288;
	const r4 = Math.min( 704, canvasMax * 0.45 );
	const reachCore = 0.5 * r0 + 0.35 * r1 + 0.15 * r2;
	const reachOuter = 0.25 * r1 + 0.35 * r2 + 0.25 * r3 + 0.15 * r4;
	const reach = ( 1 - t ) * reachCore + t * reachOuter;
	const sMul = Math.min( 2.75, 0.75 + s * 1.25 );
	let pad = reach * sMul;
	pad = Math.max( pad, 64, 0.08 * canvasMax, Math.min( 0.22 * canvasMax, 0.45 * inkMax * Math.min( 1.4, s + 0.55 ) ) );
	pad = Math.min( pad, 0.48 * canvasMax );
	return pad;

}
'''

HEADER_EXTRA = """ * - UnrealBloom `radius` is a 0..1 mip-weight lerp (NOT pixels). Pad uses the
 *   mip-kernel reach (~12/40/112/288/704 project-px at 1:1 density), weighted by
 *   strength and radius, with a generous floor so small authored radius (e.g. 0.01)
 *   still clears wipe/HDR soft skirts. Result clamps to canvas (→ near full-canvas
 *   when halo would exceed it).
"""

def replace_fn(src: str, start_marker: str, next_markers: list[str], new_body: str) -> str:
    start = src.find(start_marker)
    if start < 0:
        raise SystemExit(f'marker not found: {start_marker[:60]}')
    # Find end: earliest next top-level export/function after start
    end = len(src)
    for m in next_markers:
        i = src.find(m, start + len(start_marker))
        if i >= 0:
            end = min(end, i)
    return src[:start] + new_body + src[end:]

ts_path = Path(r'D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\text-layer-aabb.ts')
js_path = Path(r'D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\TextLayerAabb.js')
doc_path = Path(r'D:\GrokbotWork\FreeFilmCut\docs\textanim-progress-2026-10.md')

ts = ts_path.read_text(encoding='utf-8')
# Update file header comment about pad
old_bullet = """ * - Pad outward so UnrealBloom / DeepGlow halos are not clipped at the RT edge.
"""
new_bullet = """ * - Pad outward so UnrealBloom / DeepGlow halos are not clipped at the RT edge.
 * - UnrealBloom `radius` is a 0..1 mip-weight lerp (NOT pixels). Pad uses the
 *   mip-kernel reach (~12/40/112/288/704 project-px at 1:1 density), weighted by
 *   strength and radius, with a generous floor so small authored radius (e.g. 0.01)
 *   still clears wipe/HDR soft skirts. Result clamps to canvas (→ near full-canvas
 *   when halo would exceed it).
"""
if old_bullet in ts and 'mip-kernel reach' not in ts:
    ts = ts.replace(old_bullet, new_bullet, 1)

ts = replace_fn(
    ts,
    '/** Collect bloom/deepGlow pad in project pixels from a PP stack. */\nexport function bloomPadPxFromStack',
    ['\n/** Expand AABB by uniform pad and clamp to the canvas. */'],
    NEW_TS,
)
ts_path.write_text(ts, encoding='utf-8')
print('updated', ts_path)

js = js_path.read_text(encoding='utf-8')
js = replace_fn(
    js,
    'export function bloomPadPxFromStack( input ) {',
    ['\nexport function padAndClampTextLayerAabb'],
    NEW_JS,
)
js_path.write_text(js, encoding='utf-8')
print('updated', js_path)

doc = doc_path.read_text(encoding='utf-8')
old_pad = """**Pad formula (project / authored pixels):**
- Base AA pad ≈ 8px (even when bloom strength≈0).
- Plus Troika/bend fraction pad (~6% of ink max-side) inside measure.
- Plus flower stroke/shadow extra from style.
- Bloom: max(radius * 0.55 * inkMax, radius * 0.22 * canvasMax, ~24px) when strength>ε.
- DeepGlow: max(radius * 48 + 16, 24) when intensity>ε.
- Result clamped to canvas. Large radius naturally expands toward full-canvas (same cost as today).
"""
# File may have encoding-mangled approx signs; match flexibly
import re
pat = re.compile(
    r'\*\*Pad formula \(project / authored pixels\):\*\*.*?'
    r'Result clamped to canvas\.[^\n]*\n',
    re.S,
)
new_pad = """**Pad formula (project / authored pixels):**
- Base AA pad ≈ 8px (even when bloom strength≈0).
- Plus Troika/bend fraction pad (~6% of ink max-side) inside measure.
- Plus flower stroke/shadow extra from style.
- **Bloom (UnrealBloomPass):** `radius` is a **0..1 mip-weight lerp**, not pixels. Pad uses mip-kernel reaches ≈ `[12, 40, 112, 288, 704]` project-px at 1:1 PP density, mixed by radius, scaled by strength (`sMul ≈ 0.75 + 1.25·s`), then `max(…, 64, 0.08·canvasMax, min(0.22·canvasMax, 0.45·inkMax·…))`, clamp ≤ `0.48·canvasMax`. Fixes hard RT seams when authored radius is tiny (e.g. sweep `0.01`) but wipe/HDR still grows a wide soft skirt.
- DeepGlow: `max(radius*64+32, 48·min(2, intensity+0.35), 0.06·canvasMax)`.
- Result clamped to canvas. Large halo naturally expands toward full-canvas (same cost as today).
"""
m = pat.search(doc)
if not m:
    # try ascii-mangled variant from console
    pat2 = re.compile(
        r'\*\*Pad formula \(project / authored pixels\):\*\*.*?'
        r'- Result clamped to canvas\.[^\n]*\n',
        re.S,
    )
    m = pat2.search(doc)
if not m:
    raise SystemExit('doc pad section not found')
doc = doc[:m.start()] + new_pad + doc[m.end():]
# Append a short changelog note under §12 if not present
note = (
    "\n**2026-10-23 pad fix:** previous `radius * 0.55 * inkMax` under-padded because "
    "UnrealBloom `radius` is not a pixel radius; halo hard-clipped at tight RT edges on clip. "
    "Formula now mip-reach based (shared with editor `TextLayerAabb.js`).\n"
)
if '2026-10-23 pad fix' not in doc:
    # insert after the Pad formula block we just wrote — before **Clip
    doc = doc.replace(
        '- Result clamped to canvas. Large halo naturally expands toward full-canvas (same cost as today).\n\n**Clip',
        '- Result clamped to canvas. Large halo naturally expands toward full-canvas (same cost as today).\n'
        + note + '\n**Clip',
        1,
    )
doc_path.write_text(doc, encoding='utf-8')
print('updated', doc_path)

# sanity: evaluate pad for sweep-like params
def unreal(s, r, canvasMax, inkMax):
    t = min(1, max(0, r))
    r0,r1,r2,r3 = 12,40,112,288
    r4 = min(704, canvasMax * 0.45)
    reachCore = 0.5*r0 + 0.35*r1 + 0.15*r2
    reachOuter = 0.25*r1 + 0.35*r2 + 0.25*r3 + 0.15*r4
    reach = (1-t)*reachCore + t*reachOuter
    sMul = min(2.75, 0.75 + s*1.25)
    pad = reach * sMul
    pad = max(pad, 64, 0.08*canvasMax, min(0.22*canvasMax, 0.45*inkMax*min(1.4, s+0.55)))
    pad = min(pad, 0.48*canvasMax)
    return pad

print('sweep-like pad (s=0.1,r=0.01,1920, ink=400):', round(unreal(0.1,0.01,1920,400)))
print('old would be ~', round(max(0.01*0.55*400, 0.01*0.22*1920, 24*min(1,0.1+0.25))))
print('strong (s=1,r=0.5,1920,400):', round(unreal(1,0.5,1920,400)))
