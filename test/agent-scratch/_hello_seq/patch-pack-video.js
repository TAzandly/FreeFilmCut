const fs = require("fs");
const path = "D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/pack-video.ts";
let s = fs.readFileSync(path, "utf8");
const orig = s;

// 1) packMediaKind infer from cache
s = s.replace(
  /function packMediaKind\(vp: \{ kind\?: string \} \| undefined\): MediaKind \{\r?\n\tif \(vp\?\.kind === "gif" \|\| vp\?\.kind === "imageSequence"\) return vp\.kind;\r?\n\treturn "video";\r?\n\}/,
  `function packMediaKind(
\tvp: { kind?: string } | undefined,
\tcache?: FrameCache | null,
): MediaKind {
\tif (vp?.kind === "gif" || vp?.kind === "imageSequence") return vp.kind;
\t// Infer from attached cache when fccVideoPlayer.kind was dropped on rewrite.
\tif (cache?.names && cache.names.length) return "imageSequence";
\tif (cache && (cache.mode === "full" || (cache.delays && cache.delays.length)))
\t\treturn "gif";
\treturn "video";
}`
);

// 2) ensurePackSeqFrame: ArrayBuffer + MIME already there; add markPackVideoFrameReady after LRU set; better catch log
s = s.replace(
  /cache\.lru\.set\(index, bitmap\);\r?\n\t\t\treturn bitmap;\r?\n\t\t\} catch \{\r?\n\t\t\treturn null;\r?\n\t\t\} finally \{\r?\n\t\t\tcache\.inflight\.delete\(index\);\r?\n\t\t\}/,
  `cache.lru.set(index, bitmap);
\t\t\tmarkPackVideoFrameReady();
\t\t\treturn bitmap;
\t\t} catch (e) {
\t\t\tconsole.warn("[vfxpack] sequence frame", index, name, e);
\t\t\treturn null;
\t\t} finally {
\t\t\tcache.inflight.delete(index);
\t\t}`
);

// 3) samplePackMediaTexture: use cache for kind; mark ready on async upload; force path
s = s.replace(
  /const kind = packMediaKind\(ud\.fccVideoPlayer\);\r?\n\tconst sampleT = t \* packPlaybackRate\(ud\.fccVideoPlayer\);\r?\n\tconst index = kind === "gif" \? gifIndexAt\(cache, sampleT, loop\) : seqIndexAt\(cache, sampleT, loop\);/,
  `const kind = packMediaKind(ud.fccVideoPlayer, cache);
\tconst sampleT = t * packPlaybackRate(ud.fccVideoPlayer);
\tconst index = kind === "gif" ? gifIndexAt(cache, sampleT, loop) : seqIndexAt(cache, sampleT, loop);`
);

// async upload callbacks — add markPackVideoFrameReady after uploadPackBitmap
s = s.replace(
  /void ensurePackGifFrame\(cache, index\)\.then\(\(b\) => \{\r?\n\t\t\tif \(b && ud\.__fccMediaCache === cache\) uploadPackBitmap\(cache, b, index\);\r?\n\t\t\}\);/,
  `void ensurePackGifFrame(cache, index).then((b) => {
\t\t\tif (b && ud.__fccMediaCache === cache) {
\t\t\t\tuploadPackBitmap(cache, b, index);
\t\t\t\tmarkPackVideoFrameReady();
\t\t\t}
\t\t});`
);

s = s.replace(
  /void ensurePackSeqFrame\(cache, index\)\.then\(\(b\) => \{\r?\n\t\tif \(b && ud\.__fccMediaCache === cache\) uploadPackBitmap\(cache, b, index\);\r?\n\t\}\);/,
  `void ensurePackSeqFrame(cache, index).then((b) => {
\t\tif (b && ud.__fccMediaCache === cache) {
\t\t\tuploadPackBitmap(cache, b, index);
\t\t\tmarkPackVideoFrameReady();
\t\t}
\t});`
);

// 4) preparePackVideos: write path into fccVideoPlayer; await frame 0 + upload
s = s.replace(
  /\(object\.userData as \{ fccVideoPlayer\?: Record<string, unknown> \}\)\.fccVideoPlayer = \{\r?\n\t\t\t\.\.\.\(\(object\.userData as \{ fccVideoPlayer\?: Record<string, unknown> \}\)\.fccVideoPlayer \|\| \{\}\),\r?\n\t\t\tkind: mediaKind,\r?\n\t\t\ttargetUuid: merged\.targetUuid \|\| "",\r?\n\t\t\tloop: merged\.loop !== false,\r?\n\t\t\tmuted: merged\.muted === true,\r?\n\t\t\tvolume: Number\.isFinite\(Number\(merged\.volume\)\) \? Number\(merged\.volume\) : 1,\r?\n\t\t\tsequenceFps: Number\(merged\.sequenceFps\) \|\| 30,\r?\n\t\t\tplaybackRate: packPlaybackRate\(\{ playbackRate: Number\(merged\.playbackRate\) \}\),\r?\n\t\t\};/,
  `(object.userData as { fccVideoPlayer?: Record<string, unknown> }).fccVideoPlayer = {
\t\t\t...((object.userData as { fccVideoPlayer?: Record<string, unknown> }).fccVideoPlayer || {}),
\t\t\tkind: mediaKind,
\t\t\tpath: merged.path || merged.sequenceDir || (object.userData as { fccVideoPlayer?: { path?: string } }).fccVideoPlayer?.path || "",
\t\t\tprojectPath: merged.projectPath || merged.path || "",
\t\t\ttargetUuid: merged.targetUuid || "",
\t\t\tloop: merged.loop !== false,
\t\t\tmuted: merged.muted === true,
\t\t\tvolume: Number.isFinite(Number(merged.volume)) ? Number(merged.volume) : 1,
\t\t\tsequenceFps: Number(merged.sequenceFps) || 30,
\t\t\tplaybackRate: packPlaybackRate({ playbackRate: Number(merged.playbackRate) }),
\t\t};`
);

// Await first frame instead of fire-and-forget
s = s.replace(
  /\(object\.userData as \{ __fccMediaTime\?: number \}\)\.__fccMediaTime = 0;\r?\n\t\t\tvoid ensurePackSeqFrame\(cache, 0\);\r?\n\t\t\tcontinue;/,
  `(object.userData as { __fccMediaTime?: number }).__fccMediaTime = 0;
\t\t\t// Decode + upload frame 0 so first blit has a real CanvasTexture (fcc-tl-flower-18).
\t\t\tconst bit0 = await ensurePackSeqFrame(cache, 0);
\t\t\tif (bit0) {
\t\t\t\tuploadPackBitmap(cache, bit0, 0);
\t\t\t\tmarkPackVideoFrameReady();
\t\t\t}
\t\t\t// Prefetch a short window so scrub/play does not stall on frame 1+.
\t\t\tfor (let d = 1; d <= Math.min(8, names.length - 1); d++) {
\t\t\t\tvoid ensurePackSeqFrame(cache, d);
\t\t\t}
\t\t\tcontinue;`
);

// 5) seekPackTimelineVideo: pass cache to packMediaKind
s = s.replace(
  /const kind = packMediaKind\(ud\.fccVideoPlayer\);\r?\n\tif \(kind === "gif" \|\| kind === "imageSequence"\) \{/,
  `const kind = packMediaKind(ud.fccVideoPlayer, ud.__fccMediaCache);
\tif (kind === "gif" || kind === "imageSequence") {`
);

// 6) syncPackVideos: pass cache to packMediaKind; force needsUpdate before blit
s = s.replace(
  /const mediaKind = packMediaKind\(vp\);\r?\n\t\t\tif \(mediaKind === "gif" \|\| mediaKind === "imageSequence"\) \{\r?\n\t\t\t\tconst tex = samplePackMediaTexture\(ud, \{ loop: vp\.loop !== false \}\);\r?\n\t\t\t\tif \(!tex\) continue;/,
  `const mediaKind = packMediaKind(vp, ud.__fccMediaCache);
\t\t\tif (mediaKind === "gif" || mediaKind === "imageSequence") {
\t\t\t\tconst tex = samplePackMediaTexture(ud, { loop: vp.loop !== false });
\t\t\t\tif (!tex) continue;
\t\t\t\t// CanvasTexture may have been updated in a microtask; force GPU re-upload.
\t\t\t\ttex.needsUpdate = true;`
);

if (s === orig) {
  console.error("NO CHANGES APPLIED");
  process.exit(1);
}
fs.writeFileSync(path, s);
console.log("pack-video.ts patched, delta bytes", s.length - orig.length);
console.log("has infer", s.includes("Infer from attached cache"));
console.log("has await frame0", s.includes("Decode + upload frame 0"));
console.log("has force needsUpdate", s.includes("force GPU re-upload"));
console.log("has seq frame warn", s.includes('[vfxpack] sequence frame'));
"
