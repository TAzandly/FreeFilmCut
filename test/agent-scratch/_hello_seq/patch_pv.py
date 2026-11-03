import pathlib, re, sys
path = pathlib.Path(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/pack-video.ts")
s = path.read_text(encoding="utf-8")
orig = s

def sub(pattern, repl, label):
    global s
    news, n = re.subn(pattern, repl, s, count=1, flags=re.M)
    if n != 1:
        print("FAIL %s: replacements=%d" % (label, n))
        sys.exit(1)
    s = news
    print("OK", label)

sub(
    r'function packMediaKind\(vp: \{ kind\?: string \} \| undefined\): MediaKind \{\n\tif \(vp\?\.kind === "gif" \|\| vp\?\.kind === "imageSequence"\) return vp\.kind;\n\treturn "video";\n\}',
    'function packMediaKind(\n\tvp: { kind?: string } | undefined,\n\tcache?: FrameCache | null,\n): MediaKind {\n\tif (vp?.kind === "gif" || vp?.kind === "imageSequence") return vp.kind;\n\t// Infer from attached cache when fccVideoPlayer.kind was dropped on rewrite.\n\tif (cache?.names && cache.names.length) return "imageSequence";\n\tif (cache && (cache.mode === "full" || (cache.delays && cache.delays.length)))\n\t\treturn "gif";\n\treturn "video";\n}',
    "packMediaKind",
)

sub(
    r'cache\.lru\.set\(index, bitmap\);\n\t\t\treturn bitmap;\n\t\t\} catch \{\n\t\t\treturn null;\n\t\t\} finally \{\n\t\t\tcache\.inflight\.delete\(index\);\n\t\t\}',
    'cache.lru.set(index, bitmap);\n\t\t\tmarkPackVideoFrameReady();\n\t\t\treturn bitmap;\n\t\t} catch (e) {\n\t\t\tconsole.warn("[vfxpack] sequence frame", index, name, e);\n\t\t\treturn null;\n\t\t} finally {\n\t\t\tcache.inflight.delete(index);\n\t\t}',
    "ensurePackSeqFrame mark+warn",
)

sub(
    r'const kind = packMediaKind\(ud\.fccVideoPlayer\);\n\tconst sampleT = t \* packPlaybackRate\(ud\.fccVideoPlayer\);\n\tconst index = kind === "gif" \? gifIndexAt\(cache, sampleT, loop\) : seqIndexAt\(cache, sampleT, loop\);',
    'const kind = packMediaKind(ud.fccVideoPlayer, cache);\n\tconst sampleT = t * packPlaybackRate(ud.fccVideoPlayer);\n\tconst index = kind === "gif" ? gifIndexAt(cache, sampleT, loop) : seqIndexAt(cache, sampleT, loop);',
    "samplePackMediaTexture kind",
)

sub(
    r'void ensurePackGifFrame\(cache, index\)\.then\(\(b\) => \{\n\t\t\tif \(b && ud\.__fccMediaCache === cache\) uploadPackBitmap\(cache, b, index\);\n\t\t\}\);',
    'void ensurePackGifFrame(cache, index).then((b) => {\n\t\t\tif (b && ud.__fccMediaCache === cache) {\n\t\t\t\tuploadPackBitmap(cache, b, index);\n\t\t\t\tmarkPackVideoFrameReady();\n\t\t\t}\n\t\t});',
    "gif async mark",
)

sub(
    r'void ensurePackSeqFrame\(cache, index\)\.then\(\(b\) => \{\n\t\tif \(b && ud\.__fccMediaCache === cache\) uploadPackBitmap\(cache, b, index\);\n\t\}\);',
    'void ensurePackSeqFrame(cache, index).then((b) => {\n\t\tif (b && ud.__fccMediaCache === cache) {\n\t\t\tuploadPackBitmap(cache, b, index);\n\t\t\tmarkPackVideoFrameReady();\n\t\t}\n\t});',
    "seq async mark",
)

sub(
    r'\(object\.userData as \{ fccVideoPlayer\?: Record<string, unknown> \}\)\.fccVideoPlayer = \{\n\t\t\t\.\.\.\(\(object\.userData as \{ fccVideoPlayer\?: Record<string, unknown> \}\)\.fccVideoPlayer \|\| \{\}\),\n\t\t\tkind: mediaKind,\n\t\t\ttargetUuid: merged\.targetUuid \|\| "",\n\t\t\tloop: merged\.loop !== false,\n\t\t\tmuted: merged\.muted === true,\n\t\t\tvolume: Number\.isFinite\(Number\(merged\.volume\)\) \? Number\(merged\.volume\) : 1,\n\t\t\tsequenceFps: Number\(merged\.sequenceFps\) \|\| 30,\n\t\t\tplaybackRate: packPlaybackRate\(\{ playbackRate: Number\(merged\.playbackRate\) \}\),\n\t\t\};',
    '(object.userData as { fccVideoPlayer?: Record<string, unknown> }).fccVideoPlayer = {\n\t\t\t...((object.userData as { fccVideoPlayer?: Record<string, unknown> }).fccVideoPlayer || {}),\n\t\t\tkind: mediaKind,\n\t\t\tpath: merged.path || merged.sequenceDir || "",\n\t\t\tprojectPath: merged.projectPath || merged.path || "",\n\t\t\ttargetUuid: merged.targetUuid || "",\n\t\t\tloop: merged.loop !== false,\n\t\t\tmuted: merged.muted === true,\n\t\t\tvolume: Number.isFinite(Number(merged.volume)) ? Number(merged.volume) : 1,\n\t\t\tsequenceFps: Number(merged.sequenceFps) || 30,\n\t\t\tplaybackRate: packPlaybackRate({ playbackRate: Number(merged.playbackRate) }),\n\t\t};',
    "prepare fccVideoPlayer path",
)

sub(
    r'\(object\.userData as \{ __fccMediaTime\?: number \}\)\.__fccMediaTime = 0;\n\t\t\tvoid ensurePackSeqFrame\(cache, 0\);\n\t\t\tcontinue;',
    '(object.userData as { __fccMediaTime?: number }).__fccMediaTime = 0;\n\t\t\t// Decode + upload frame 0 so first blit has a real CanvasTexture (fcc-tl-flower-18).\n\t\t\tconst bit0 = await ensurePackSeqFrame(cache, 0);\n\t\t\tif (bit0) {\n\t\t\t\tuploadPackBitmap(cache, bit0, 0);\n\t\t\t\tmarkPackVideoFrameReady();\n\t\t\t}\n\t\t\tfor (let d = 1; d <= Math.min(8, names.length - 1); d++) {\n\t\t\t\tvoid ensurePackSeqFrame(cache, d);\n\t\t\t}\n\t\t\tcontinue;',
    "await frame0",
)

sub(
    r'const kind = packMediaKind\(ud\.fccVideoPlayer\);\n\tif \(kind === "gif" \|\| kind === "imageSequence"\) \{',
    'const kind = packMediaKind(ud.fccVideoPlayer, ud.__fccMediaCache);\n\tif (kind === "gif" || kind === "imageSequence") {',
    "seekPackTimelineVideo kind",
)

sub(
    r'const mediaKind = packMediaKind\(vp\);\n\t\t\tif \(mediaKind === "gif" \|\| mediaKind === "imageSequence"\) \{\n\t\t\t\tconst tex = samplePackMediaTexture\(ud, \{ loop: vp\.loop !== false \}\);\n\t\t\t\tif \(!tex\) continue;',
    'const mediaKind = packMediaKind(vp, ud.__fccMediaCache);\n\t\t\tif (mediaKind === "gif" || mediaKind === "imageSequence") {\n\t\t\t\tconst tex = samplePackMediaTexture(ud, { loop: vp.loop !== false });\n\t\t\t\tif (!tex) continue;\n\t\t\t\ttex.needsUpdate = true;',
    "syncPackVideos kind+needsUpdate",
)

path.write_text(s, encoding="utf-8")
print("DONE delta", len(s) - len(orig))