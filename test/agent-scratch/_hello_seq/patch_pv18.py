from pathlib import Path

# ---- pack-video.ts patches ----
pv = Path(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/pack-video.ts")
s = pv.read_text(encoding="utf-8")

# 1) ensurePackSeqFrame: mark ready when frame lands in LRU
old_seq_set = "\t\t\tcache.lru.set(index, bitmap);\n\t\t\treturn bitmap;"
new_seq_set = "\t\t\tcache.lru.set(index, bitmap);\n\t\t\tmarkPackVideoFrameReady();\n\t\t\treturn bitmap;"
if old_seq_set not in s:
    raise SystemExit("ensurePackSeqFrame lru.set block not found")
# Only replace the one inside ensurePackSeqFrame (seq), not gif - check context
idx = s.find("async function ensurePackSeqFrame")
if idx < 0:
    raise SystemExit("ensurePackSeqFrame not found")
sub = s[idx:]
# find first occurrence of lru.set in ensurePackSeqFrame function
rel = sub.find(old_seq_set)
if rel < 0:
    # maybe already patched
    if "markPackVideoFrameReady();\n\t\t\treturn bitmap;" in sub[:2000]:
        print("ensurePackSeqFrame already marks ready")
    else:
        raise SystemExit("lru.set in ensurePackSeqFrame not found")
else:
    s = s[:idx+rel] + new_seq_set + s[idx+rel+len(old_seq_set):]
    print("patched ensurePackSeqFrame markReady")

# 2) prepare: keep frameNames on fccVideoPlayer
old_vp = """\t\t(object.userData as { fccVideoPlayer?: Record<string, unknown> }).fccVideoPlayer = {
\t\t\t...((object.userData as { fccVideoPlayer?: Record<string, unknown> }).fccVideoPlayer || {}),
\t\t\tkind: mediaKind,
\t\t\tpath: merged.path || merged.sequenceDir || "",
\t\t\tprojectPath: merged.projectPath || merged.path || "",
\t\t\ttargetUuid: merged.targetUuid || "",
\t\t\tloop: merged.loop !== false,
\t\t\tmuted: merged.muted === true,
\t\t\tvolume: Number.isFinite(Number(merged.volume)) ? Number(merged.volume) : 1,
\t\t\tsequenceFps: Number(merged.sequenceFps) || 30,
\t\t\tplaybackRate: packPlaybackRate({ playbackRate: Number(merged.playbackRate) }),
\t\t};"""

new_vp = """\t\tconst explicitFrameNames = Array.isArray(merged.frameNames)
\t\t\t? merged.frameNames.filter((n) => typeof n === "string" && n.length > 0)
\t\t\t: [];
\t\t(object.userData as { fccVideoPlayer?: Record<string, unknown> }).fccVideoPlayer = {
\t\t\t...((object.userData as { fccVideoPlayer?: Record<string, unknown> }).fccVideoPlayer || {}),
\t\t\tkind: mediaKind,
\t\t\tpath: merged.path || merged.sequenceDir || "",
\t\t\tprojectPath: merged.projectPath || merged.path || "",
\t\t\ttargetUuid: merged.targetUuid || "",
\t\t\tloop: merged.loop !== false,
\t\t\tmuted: merged.muted === true,
\t\t\tvolume: Number.isFinite(Number(merged.volume)) ? Number(merged.volume) : 1,
\t\t\tsequenceFps: Number(merged.sequenceFps) || 30,
\t\t\tsequenceDir: merged.sequenceDir || merged.path || "",
\t\t\tplaybackRate: packPlaybackRate({ playbackRate: Number(merged.playbackRate) }),
\t\t\t...(explicitFrameNames.length ? { frameNames: explicitFrameNames } : {}),
\t\t};"""

if old_vp not in s:
    raise SystemExit("prepare fccVideoPlayer block not found")
s = s.replace(old_vp, new_vp, 1)
print("patched prepare frameNames on fccVideoPlayer")

# 3) syncPackVideos: force timeline time onto gif/seq before sample
old_sync = """\t\t\tconst mediaKind = packMediaKind(vp, ud.__fccMediaCache);
\t\t\tif (mediaKind === "gif" || mediaKind === "imageSequence") {
\t\t\t\tconst tex = samplePackMediaTexture(ud, { loop: vp.loop !== false });
\t\t\t\tif (!tex) continue;
\t\t\t\ttex.needsUpdate = true;"""

new_sync = """\t\t\tconst mediaKind = packMediaKind(vp, ud.__fccMediaCache);
\t\t\tif (mediaKind === "gif" || mediaKind === "imageSequence") {
\t\t\t\t// Always drive sample time from the compositor clock (fcc-tl-flower-18).
\t\t\t\t// Seek usually sets this first; keep a belt-and-suspenders write so a
\t\t\t\t// missed seek cannot leave __fccMediaTime stuck at 0 (frozen frame 0).
\t\t\t\tud.__fccMediaActive = true;
\t\t\t\tud.__fccMediaTime = Number(timeSeconds) || 0;
\t\t\t\tconst prevUploaded = ud.__fccMediaCache?.uploadedIndex;
\t\t\t\tconst tex = samplePackMediaTexture(ud, { loop: vp.loop !== false });
\t\t\t\tif (!tex) continue;
\t\t\t\ttex.needsUpdate = true;
\t\t\t\tif (
\t\t\t\t\tud.__fccMediaCache &&
\t\t\t\t\tud.__fccMediaCache.uploadedIndex !== prevUploaded
\t\t\t\t) {
\t\t\t\t\tmarkPackVideoFrameReady();
\t\t\t\t}"""

if old_sync not in s:
    raise SystemExit("sync gif/seq block not found")
s = s.replace(old_sync, new_sync, 1)
print("patched syncPackVideos force time")

# 4) samplePackMediaTexture: mark when sync upload changes index for seq
old_seq_sample = """\tif (cache.lru.has(index)) {
\t\tif (cache.uploadedIndex !== index) uploadPackBitmap(cache, cache.lru.get(index)!, index);
\t\treturn cache.texture || null;
\t}
\tvoid ensurePackSeqFrame(cache, index).then((b) => {
\t\tif (b && ud.__fccMediaCache === cache) {
\t\t\tuploadPackBitmap(cache, b, index);
\t\t\tmarkPackVideoFrameReady();
\t\t}
\t});
\treturn cache.texture || null;
}"""

new_seq_sample = """\tif (cache.lru.has(index)) {
\t\tif (cache.uploadedIndex !== index) {
\t\t\tuploadPackBitmap(cache, cache.lru.get(index)!, index);
\t\t\tmarkPackVideoFrameReady();
\t\t}
\t\treturn cache.texture || null;
\t}
\tvoid ensurePackSeqFrame(cache, index).then((b) => {
\t\tif (b && ud.__fccMediaCache === cache) {
\t\t\tuploadPackBitmap(cache, b, index);
\t\t\tmarkPackVideoFrameReady();
\t\t}
\t});
\treturn cache.texture || null;
}"""

if old_seq_sample not in s:
    raise SystemExit("seq sample block not found")
s = s.replace(old_seq_sample, new_seq_sample, 1)
print("patched sample seq mark on upload")

pv.write_text(s, encoding="utf-8")
print("pack-video.ts written", len(s))