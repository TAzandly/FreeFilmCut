from pathlib import Path
p = Path(r"D:/GrokbotWork/FreeFilmCut/three.js/editor/js/TextTemplatePackExporter.js")
s = p.read_text(encoding="utf-8")

# Fix: remember packed frame names per uuid so mediaPlayers always get frameNames
old = """\t\tif ( ! packed ) continue;
\t\tconst rel = 'sequences/' + seqFolderName;
\t\tpathByUuid.set( object.uuid, rel );
\t\tassetPaths.push( rel + '/' );

\t}

\tfor ( const object of videoPlayers ) {

\t\tconst path = pathByUuid.get( object.uuid );
\t\tif ( ! path ) continue;
\t\tconst vp = object.userData.fccVideoPlayer || {};
\t\tconst mediaKind = vp.kind === 'gif' || vp.kind === 'imageSequence' ? vp.kind : 'video';
\t\tlet playbackRate = Number( vp.playbackRate );
\t\tif ( ! Number.isFinite( playbackRate ) || playbackRate <= 0 ) playbackRate = 1;
\t\tplayers.push( {
\t\t\tuuid: object.uuid,
\t\t\tname: object.name || '',
\t\t\tkind: mediaKind,
\t\t\tpath,
\t\t\tloop: vp.loop !== false,
\t\t\tmuted: vp.muted === true,
\t\t\tvolume: Number.isFinite( Number( vp.volume ) ) ? Number( vp.volume ) : 1,
\t\t\tplaybackRate,
\t\t\ttargetUuid: vp.targetUuid || '',
\t\t\tfileName: vp.fileName || '',
\t\t\tsequenceFps: Number( vp.sequenceFps ) || 30,
\t\t\tsequenceDir: mediaKind === 'imageSequence' ? path : ( vp.sequenceDir || '' ),
\t\t\tsequenceStart: Number( vp.sequenceStart ) || 0,
\t\t\tsequenceEnd: Number.isFinite( Number( vp.sequenceEnd ) ) ? Number( vp.sequenceEnd ) : - 1,
\t\t\tframeNames: mediaKind === 'imageSequence' && object.__fccSeq && object.__fccSeq.names
\t\t\t\t? object.__fccSeq.names.slice()
\t\t\t\t: undefined,
\t\t} );

\t}"""

new = """\t\tif ( ! packed ) continue;
\t\tconst rel = 'sequences/' + seqFolderName + '/';
\t\tpathByUuid.set( object.uuid, rel );
\t\tframeNamesByUuid.set( object.uuid, names.slice() );
\t\tassetPaths.push( rel );

\t}

\tfor ( const object of videoPlayers ) {

\t\tconst path = pathByUuid.get( object.uuid );
\t\tif ( ! path ) continue;
\t\tconst vp = object.userData.fccVideoPlayer || {};
\t\tconst mediaKind = vp.kind === 'gif' || vp.kind === 'imageSequence' ? vp.kind : 'video';
\t\tlet playbackRate = Number( vp.playbackRate );
\t\tif ( ! Number.isFinite( playbackRate ) || playbackRate <= 0 ) playbackRate = 1;
\t\tconst packedNames = frameNamesByUuid.get( object.uuid );
\t\tplayers.push( {
\t\t\tuuid: object.uuid,
\t\t\tname: object.name || '',
\t\t\tkind: mediaKind,
\t\t\tpath,
\t\t\tloop: vp.loop !== false,
\t\t\tmuted: vp.muted === true,
\t\t\tvolume: Number.isFinite( Number( vp.volume ) ) ? Number( vp.volume ) : 1,
\t\t\tplaybackRate,
\t\t\ttargetUuid: vp.targetUuid || '',
\t\t\tfileName: vp.fileName || '',
\t\t\tsequenceFps: Number( vp.sequenceFps ) || 30,
\t\t\tsequenceDir: mediaKind === 'imageSequence' ? path : ( vp.sequenceDir || '' ),
\t\t\tsequenceStart: Number( vp.sequenceStart ) || 0,
\t\t\tsequenceEnd: Number.isFinite( Number( vp.sequenceEnd ) ) ? Number( vp.sequenceEnd ) : - 1,
\t\t\tframeNames: mediaKind === 'imageSequence'
\t\t\t\t? ( packedNames && packedNames.length
\t\t\t\t\t? packedNames.slice()
\t\t\t\t\t: ( object.__fccSeq && object.__fccSeq.names ? object.__fccSeq.names.slice() : undefined ) )
\t\t\t\t: undefined,
\t\t} );

\t}"""

if old not in s:
    raise SystemExit("exporter block not found")
s = s.replace(old, new, 1)

# Add frameNamesByUuid map next to pathByUuid
old_map = "\tconst pathByUuid = new Map();\n\tconst assetPaths = [];"
# find the one near imageSequence packing - there may be multiple pathByUuid
# Look for context with videoPlayers gif skip
marker = "\t\tif ( vp.kind === 'gif' || vp.kind === 'imageSequence' ) continue;"
# Actually pathByUuid is created once at start of function
idx = s.find("async function packTextTemplateMedia")
if idx < 0:
    idx = s.find("pack MediaFramePlayers")
# simpler: replace first pathByUuid in the media pack function
import re
# Find "const pathByUuid = new Map();" that precedes imageSequence packing
count = s.count("const pathByUuid = new Map();")
print("pathByUuid decls", count)

# Add frameNamesByUuid after pathByUuid declaration(s) inside the embed function
# Read around line 660 area
i = s.find("Mirrors VfxPackExporter so clip-side")
j = s.find("const pathByUuid = new Map();", i)
if j < 0:
    raise SystemExit("pathByUuid after mirror comment not found")
# only replace this occurrence
k = s.find("\n", j)
line = s[j:k]
print("found line", repr(line))
if "frameNamesByUuid" not in s[j:j+200]:
    s = s[:k] + "\n\tconst frameNamesByUuid = new Map();" + s[k:]
    print("added frameNamesByUuid map")

p.write_text(s, encoding="utf-8")
print("exporter patched", len(s))