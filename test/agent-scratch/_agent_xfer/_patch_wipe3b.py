# -*- coding: utf-8 -*-
from pathlib import Path
import re

p = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\TextAnimRuntime.js")
s = p.read_text(encoding="utf-8")

# Fix imports — remove wipe helpers if still present
s = re.sub(r"\tampleWipeRevealProgress,\n", "", s)  # typo guard
for name in ["sampleWipeRevealProgress", "sampleWipeAxisMask", "wipeAxisForChar"]:
    s = re.sub(rf"\t{name},\n", "", s)

# Replace broken section from phase/count/order through void ready
pat = re.compile(
    r"\tconst phase = getActivePhase\( anim \);\n"
    r"\tconst count = root\.userData\.__fccCharCount \|\| 0;\n"
    r"\tconst order = buildCharOrder\( count, phase\.stagger\.order, phase\.stagger\.seed \);\n"
    r".*?"
    r"\tvoid ready;\n",
    re.S,
)
m = pat.search(s)
if not m:
    raise SystemExit("pose section not found")

new = """\tconst phase = getActivePhase( anim );
\tconst count = root.userData.__fccCharCount || 0;
\tconst order = buildCharOrder( count, phase.stagger.order, phase.stagger.seed );
\t// wipeReveal runs as TextLayerRT fragment wipe + edge glint (not per-glyph opacity).

\tfor ( let i = 0; i < count; i ++ ) {

\t\tconst charGroup = root.getObjectByName( FCC_TEXTANIM_CHAR_PREFIX + i );
\t\tif ( ! charGroup ) continue;
\t\tconst orderIndex = order.indexOf( i );
\t\tconst pose = sampleCharPose( t, phase, count, i, orderIndex < 0 ? i : orderIndex );
\t\tconst base = charGroup.userData.__fccCharBase || { x: 0, y: 0, z: 0.01 };
\t\tcharGroup.position.set( base.x + pose.offsetX, base.y + pose.offsetY, base.z );
\t\tcharGroup.rotation.set( pose.rotateX, pose.rotateY, pose.rotateZ );
\t\tcharGroup.scale.set( pose.scaleX, pose.scaleY, 1 );
\t\tapplyOpacityToCharGroup( charGroup, pose.opacity );

\t}

\tvoid ready;
"""

s = s[:m.start()] + new + s[m.end():]
s = s.replace("from './TextAnim.js?v=fcc-ui-6';", "from './TextAnim.js?v=fcc-ui-7';")

p.write_text(s, encoding="utf-8")
print("fixed", "wipe.enabled" in s, "wipeAxisForChar" in s)
# show snippet
idx = s.find("const phase = getActivePhase")
print(s[idx:idx+800])
