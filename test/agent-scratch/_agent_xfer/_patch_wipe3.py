# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")

# ========== TextAnimRuntime: bypass per-glyph wipe ==========
rt = (ROOT / "ui/TextAnimRuntime.js").read_text(encoding="utf-8")

# Remove unused wipe imports that only served per-glyph (keep sampleWipeRevealProgress? not needed in runtime if wiped in Viewport)
# Still might not need wipe at all in runtime
rt2 = rt.replace(
    """	sampleWipeRevealProgress,
	sampleWipeAxisMask,
	wipeAxisForChar,
""",
    "",
)

# Replace the wipe AABB + opacity multiply block with a short comment
old_block = """	const phase = getActivePhase( anim );
	const count = root.userData.__fccCharCount || 0;
	const order = buildCharOrder( count, phase.stagger.order, phase.stagger.seed );
	const wipe = sampleWipeRevealProgress( t, anim );

	// Glyph AABB from caret bases (layout space) — wipe axis is text-local, not RT UV.
	let minX = Infinity;
	let maxX = - Infinity;
	let minY = Infinity;
	let maxY = - Infinity;
	if ( wipe.enabled && count > 0 ) {

		for ( let i = 0; i < count; i ++ ) {

			const cg = root.getObjectByName( FCC_TEXTANIM_CHAR_PREFIX + i );
			const b = cg && cg.userData && cg.userData.__fccCharBase;
			if ( ! b ) continue;
			if ( b.x < minX ) minX = b.x;
			if ( b.x > maxX ) maxX = b.x;
			if ( b.y < minY ) minY = b.y;
			if ( b.y > maxY ) maxY = b.y;

		}

		if ( ! Number.isFinite( minX ) ) {

			minX = 0;
			maxX = 1;
			minY = 0;
			maxY = 1;

		}

	}

	for ( let i = 0; i < count; i ++ ) {

		const charGroup = root.getObjectByName( FCC_TEXTANIM_CHAR_PREFIX + i );
		if ( ! charGroup ) continue;
		const orderIndex = order.indexOf( i );
		const pose = sampleCharPose( t, phase, count, i, orderIndex < 0 ? i : orderIndex );
		const base = charGroup.userData.__fccCharBase || { x: 0, y: 0, z: 0.01 };
		charGroup.position.set( base.x + pose.offsetX, base.y + pose.offsetY, base.z );
		charGroup.rotation.set( pose.rotateX, pose.rotateY, pose.rotateZ );
		charGroup.scale.set( pose.scaleX, pose.scaleY, 1 );

		let op = pose.opacity;
		if ( wipe.enabled ) {

			const axis = wipeAxisForChar( wipe.direction, base, minX, maxX, minY, maxY );
			op *= sampleWipeAxisMask( wipe.progress, wipe.soft, axis );

		}

		applyOpacityToCharGroup( charGroup, op );

	}"""

# The dash might be a special unicode character. Let's find by unique markers.
idx = rt2.find("const wipe = sampleWipeRevealProgress")
if idx < 0:
    # maybe already removed import broke - check original
    print("wipe sample line missing; checking original rt...")
    idx = rt.find("const wipe = sampleWipeRevealProgress")
    print("in original:", idx)
    rt2 = rt  # reset if replace of imports failed oddly
    rt2 = rt.replace(
        """	sampleWipeRevealProgress,
	sampleWipeAxisMask,
	wipeAxisForChar,
""",
        "",
    )
    idx = rt2.find("const wipe = sampleWipeRevealProgress")

print("wipe idx", idx)

# Use line-based surgery
lines = rt2.splitlines(keepends=True)
out = []
i = 0
while i < len(lines):
    line = lines[i]
    if "const wipe = sampleWipeRevealProgress" in line:
        # Remove wipe const and following AABB block until "for ( let i = 0; i < count; i ++ )"
        # Keep the for loop but strip wipe inside
        # First skip wipe line
        i += 1
        # skip blank and AABB block
        while i < len(lines) and "for ( let i = 0; i < count; i ++ )" not in lines[i]:
            i += 1
        continue
    if "if ( wipe.enabled )" in line and i + 1 < len(lines) and "wipeAxisForChar" in lines[i+1]:
        # skip the if wipe block: if { ... }
        # expect structure:
        # if ( wipe.enabled ) {
        #   const axis = ...
        #   op *= ...
        # }
        # Also change "let op = pose.opacity;" before - keep that
        depth = 0
        while i < len(lines):
            if "{" in lines[i]:
                depth += lines[i].count("{")
            if "}" in lines[i]:
                depth -= lines[i].count("}")
            i += 1
            if depth <= 0:
                break
        continue
    if "let op = pose.opacity;" in line:
        out.append("\t\tconst op = pose.opacity;\n")
        i += 1
        continue
    out.append(line)
    i += 1

rt2 = "".join(out)
# Also remove unused imports if still present
for name in ["sampleWipeRevealProgress", "sampleWipeAxisMask", "wipeAxisForChar"]:
    rt2 = re.sub(rf"\t{name},\n", "", rt2)

# bump TextAnim import
rt2 = rt2.replace("from './TextAnim.js?v=fcc-ui-6';", "from './TextAnim.js?v=fcc-ui-7';")

# Add comment near pose loop
rt2 = rt2.replace(
    "\tconst phase = getActivePhase( anim );\n\tconst count = root.userData.__fccCharCount || 0;\n\tconst order = buildCharOrder( count, phase.stagger.order, phase.stagger.seed );\n",
    "\tconst phase = getActivePhase( anim );\n\tconst count = root.userData.__fccCharCount || 0;\n\tconst order = buildCharOrder( count, phase.stagger.order, phase.stagger.seed );\n\t// wipeReveal runs as TextLayerRT fragment wipe + edge glint (not per-glyph opacity).\n",
)

(ROOT / "ui/TextAnimRuntime.js").write_text(rt2, encoding="utf-8")
print("TextAnimRuntime OK", "wipeAxisForChar" not in rt2, "sampleWipeAxisMask" not in rt2)
print("still has sampleWipeReveal?", "sampleWipeRevealProgress" in rt2)
