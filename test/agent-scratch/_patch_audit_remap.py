# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src")

def write(p: Path, text: str):
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)

motion = ROOT / "vfxpack" / "text-anim-motion.ts"
mt = motion.read_text(encoding="utf-8")

old_sample = """function sampleKeys(
\tkeys: Array<{ t: number; v: number }> | undefined,
\ttime: number,
\tinterp: string = \"linear\",
): number | null {
\tif (!keys || keys.length === 0) return null;
\tconst sorted = keys;
\tif (time <= sorted[0].t) return sorted[0].v;
\tif (time >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].v;
\tfor (let i = 0; i < sorted.length - 1; i++) {
\t\tconst a = sorted[i];
\t\tconst b = sorted[i + 1];
\t\tif (time >= a.t && time <= b.t) {
\t\t\tif (interp === \"step\" || b.t === a.t) return a.v;
\t\t\tconst u = (time - a.t) / (b.t - a.t);
\t\t\treturn a.v + (b.v - a.v) * u;
\t\t}
\t}
\treturn sorted[sorted.length - 1].v;
}"""

new_sample = """function sampleKeys(
\tkeys: Array<{ t: number; v: number; ease?: string }> | undefined,
\ttime: number,
\tinterp: string = \"linear\",
): number | null {
\tif (!keys || keys.length === 0) return null;
\tconst sorted = keys;
\tif (time <= sorted[0].t) return sorted[0].v;
\tif (time >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].v;
\tfor (let i = 0; i < sorted.length - 1; i++) {
\t\tconst a = sorted[i];
\t\tconst b = sorted[i + 1];
\t\tif (time >= a.t && time <= b.t) {
\t\t\tif (interp === \"step\" || b.t === a.t) return a.v;
\t\t\tconst u = applyAnimEase(a.ease, (time - a.t) / (b.t - a.t));
\t\t\treturn a.v + (b.v - a.v) * u;
\t\t}
\t}
\treturn sorted[sorted.length - 1].v;
}"""

if old_sample not in mt:
    raise SystemExit("motion sampleKeys block not found")
if "applyAnimEase" not in mt:
    needle = 'from "@/vfxpack/sticker-motion";'
    if needle not in mt:
        raise SystemExit("sticker-motion import not found")
    mt = mt.replace(needle, needle + '\nimport { applyAnimEase } from "@/vfxpack/freecapcut-anim";', 1)
mt = mt.replace(old_sample, new_sample, 1)

old_pose = """\tif (inPayload && spans.in && t >= spans.in[0] && t < spans.in[1]) {
\t\treturn sampleTextAnimPack(inPayload, t - spans.in[0], {
\t\t\tloop: false,
\t\t\tplayDuration: inDur,
\t\t});
\t}
\tif (loopPayload && spans.loop && t >= spans.loop[0] && t < spans.loop[1]) {
\t\treturn sampleTextAnimPack(loopPayload, t - spans.loop[0], {
\t\t\tloop: true,
\t\t\tplayDuration: loopDur > 0 ? loopDur : undefined,
\t\t});
\t}
\tif (outPayload && spans.out && t >= spans.out[0] && t <= spans.out[1] + 1e-6) {
\t\treturn sampleTextAnimPack(outPayload, t - spans.out[0], {
\t\t\tloop: false,
\t\t\tplayDuration: outDur,
\t\t});
\t}"""

new_pose = """\tif (inPayload && spans.in && t >= spans.in[0] && t < spans.in[1]) {
\t\treturn sampleTextAnimPack(inPayload, t - spans.in[0], {
\t\t\tloop: false,
\t\t\tplayDuration: Math.max(1e-4, spans.in[1] - spans.in[0]),
\t\t});
\t}
\tif (loopPayload && spans.loop && t >= spans.loop[0] && t < spans.loop[1]) {
\t\treturn sampleTextAnimPack(loopPayload, t - spans.loop[0], {
\t\t\tloop: true,
\t\t\tplayDuration: loopDur > 0 ? loopDur : undefined,
\t\t});
\t}
\tif (outPayload && spans.out && t >= spans.out[0] && t <= spans.out[1] + 1e-6) {
\t\treturn sampleTextAnimPack(outPayload, t - spans.out[0], {
\t\t\tloop: false,
\t\t\tplayDuration: Math.max(1e-4, spans.out[1] - spans.out[0]),
\t\t});
\t}"""

if old_pose not in mt:
    raise SystemExit("resolveAppliedTextPose sample block not found")
mt = mt.replace(old_pose, new_pose, 1)
write(motion, mt)
print("patched text-anim-motion.ts")

ap = ROOT / "vfxpack" / "textanim" / "apply-pack.ts"
at = ap.read_text(encoding="utf-8")

if "applyAnimEase" not in at:
    at = at.replace(
        'from "@/vfxpack/text-anim-motion";',
        'from "@/vfxpack/text-anim-motion";\nimport { applyAnimEase } from "@/vfxpack/freecapcut-anim";',
        1,
    )

old_ap_sample = """function sampleKeys(
\tkeys: Array<{ t: number; v: number }> | undefined,
\ttime: number,
\tinterp: string = \"linear\",
): number | null {
\tif (!keys || keys.length === 0) return null;
\tif (time <= keys[0].t) return keys[0].v;
\tif (time >= keys[keys.length - 1].t) return keys[keys.length - 1].v;
\tfor (let i = 0; i < keys.length - 1; i++) {
\t\tconst a = keys[i];
\t\tconst b = keys[i + 1];
\t\tif (time >= a.t && time <= b.t) {
\t\t\tif (interp === \"step\" || b.t === a.t) return a.v;
\t\t\tconst u = (time - a.t) / (b.t - a.t);
\t\t\treturn a.v + (b.v - a.v) * u;
\t\t}
\t}
\treturn keys[keys.length - 1].v;
}"""

new_ap_sample = """function sampleKeys(
\tkeys: Array<{ t: number; v: number; ease?: string }> | undefined,
\ttime: number,
\tinterp: string = \"linear\",
): number | null {
\tif (!keys || keys.length === 0) return null;
\tif (time <= keys[0].t) return keys[0].v;
\tif (time >= keys[keys.length - 1].t) return keys[keys.length - 1].v;
\tfor (let i = 0; i < keys.length - 1; i++) {
\t\tconst a = keys[i];
\t\tconst b = keys[i + 1];
\t\tif (time >= a.t && time <= b.t) {
\t\t\tif (interp === \"step\" || b.t === a.t) return a.v;
\t\t\tconst u = applyAnimEase(a.ease, (time - a.t) / (b.t - a.t));
\t\t\treturn a.v + (b.v - a.v) * u;
\t\t}
\t}
\treturn keys[keys.length - 1].v;
}"""

if old_ap_sample not in at:
    raise SystemExit("apply-pack sampleKeys not found")
at = at.replace(old_ap_sample, new_ap_sample, 1)

old_resolve_body = """\tconst t = Number(localTimeSec) || 0;
\tif (inPayload && spans.in && t >= spans.in[0] && t < spans.in[1]) {
\t\treturn {
\t\t\tpayload: inPayload,
\t\t\tphaseLocalTime: t - spans.in[0],
\t\t\tloop: false,
\t\t\tplayDuration: inDur,
\t\t};
\t}
\tif (loopPayload && spans.loop && t >= spans.loop[0] && t < spans.loop[1]) {
\t\treturn {
\t\t\tpayload: loopPayload,
\t\t\tphaseLocalTime: t - spans.loop[0],
\t\t\tloop: true,
\t\t\tplayDuration: loopDur > 0 ? loopDur : textAnimAuthoredDuration(loopPayload),
\t\t};
\t}
\tif (outPayload && spans.out && t >= spans.out[0] && t <= spans.out[1] + 1e-6) {
\t\treturn {
\t\t\tpayload: outPayload,
\t\t\tphaseLocalTime: t - spans.out[0],
\t\t\tloop: false,
\t\t\tplayDuration: outDur,
\t\t};
\t}
\treturn null;
}"""

new_resolve_body = """\tconst t = Number(localTimeSec) || 0;
\tif (inPayload && spans.in && t >= spans.in[0] && t < spans.in[1]) {
\t\t// Stretch into the *active wall window* (span), not uncapped assignment
\t\t// Duration when Duration > clip (stickerAnimSpans clamps the span).
\t\tconst wall = Math.max(1e-4, spans.in[1] - spans.in[0]);
\t\treturn {
\t\t\tpayload: inPayload,
\t\t\tphaseLocalTime: t - spans.in[0],
\t\t\tloop: false,
\t\t\tplayDuration: wall,
\t\t};
\t}
\tif (loopPayload && spans.loop && t >= spans.loop[0] && t < spans.loop[1]) {
\t\t// Loop: one authored cycle stretches into assignment cycle length (not whole mid span).
\t\treturn {
\t\t\tpayload: loopPayload,
\t\t\tphaseLocalTime: t - spans.loop[0],
\t\t\tloop: true,
\t\t\tplayDuration: loopDur > 0 ? loopDur : textAnimAuthoredDuration(loopPayload),
\t\t};
\t}
\tif (outPayload && spans.out && t >= spans.out[0] && t <= spans.out[1] + 1e-6) {
\t\tconst wall = Math.max(1e-4, spans.out[1] - spans.out[0]);
\t\treturn {
\t\t\tpayload: outPayload,
\t\t\tphaseLocalTime: t - spans.out[0],
\t\t\tloop: false,
\t\t\tplayDuration: wall,
\t\t};
\t}
\treturn null;
}"""

if old_resolve_body not in at:
    raise SystemExit("resolveActive body not found")
at = at.replace(old_resolve_body, new_resolve_body, 1)

old_write = """function writeTrackOverrides(
\tobject: Object3D,
\tpayload: TextAnimPackPayload,
\tphaseLocalTime: number,
\tloop: boolean,
\tplayDuration?: number,
): void {
\tconst authored = Math.max(0.1, textAnimAuthoredDuration(payload) || Number(payload.duration) || 0.5);
\tconst play = playDuration != null && playDuration > 0 ? playDuration : authored;
\tconst t = mapLoopTime(
\t\tremapTextAnimSampleTime(phaseLocalTime, play, authored),
\t\tauthored,
\t\tloop,
\t);
\tbeginTextAnimTarget(object, t);
\tfor (const tr of payload.tracks || []) {
\t\tif (!tr?.path?.startsWith(\"textAnim.\") || !tr.keys?.length) continue;
\t\tconst sub = tr.path.slice(\"textAnim.\".length);
\t\tconst v = sampleKeys(tr.keys, t, tr.interp === \"step\" ? \"step\" : \"linear\");
\t\tif (v == null || !Number.isFinite(v)) continue;
\t\tsetTextAnimOverride(object, sub, v, tr.keys);
\t}
}"""

new_write = """function writeTrackOverrides(
\tobject: Object3D,
\tpayload: TextAnimPackPayload,
\tphaseLocalTime: number,
\tloop: boolean,
\tplayDuration?: number,
): void {
\tconst authored = Math.max(0.1, textAnimAuthoredDuration(payload) || Number(payload.duration) || 0.5);
\tconst play = playDuration != null && playDuration > 0 ? playDuration : authored;
\tconst t = mapLoopTime(
\t\tremapTextAnimSampleTime(phaseLocalTime, play, authored),
\t\tauthored,
\t\tloop,
\t);
\tbeginTextAnimTarget(object, t);
\tconst written = new Set<string>();
\tfor (const tr of payload.tracks || []) {
\t\tif (!tr?.path?.startsWith(\"textAnim.\") || !tr.keys?.length) continue;
\t\tconst sub = tr.path.slice(\"textAnim.\".length);
\t\tconst v = sampleKeys(tr.keys, t, tr.interp === \"step\" ? \"step\" : \"linear\");
\t\tif (v == null || !Number.isFinite(v)) continue;
\t\tsetTextAnimOverride(object, sub, v, tr.keys);
\t\twritten.add(sub);
\t}
\t// Engine defaults missing progress to 1 (end state) — that makes wipe/bend look
\t// \"gone\" after Duration stretch if a track failed to write. Synthesize 0..1 from
\t// remapped sample time so every progress-driven component stays on the stretch clock.
\tfor (const comp of payload.components || []) {
\t\tif (!comp?.id) continue;
\t\tconst progKey = `${comp.id}.progress`;
\t\tif (written.has(progKey)) continue;
\t\tconst u = authored > 1e-6 ? Math.max(0, Math.min(1, t / authored)) : 1;
\t\tsetTextAnimOverride(object, progKey, loop ? ((t % authored) / authored) : u);
\t}
}"""

if old_write not in at:
    raise SystemExit("writeTrackOverrides not found")
at = at.replace(old_write, new_write, 1)
write(ap, at)
print("patched apply-pack.ts")

fx = ROOT / "vfxpack" / "textanim" / "TextGeomFx.js"
ft = fx.read_text(encoding="utf-8")
old_ag = """function applyGroupFx( group, fx, debug ) {

\tconst bounds = fx ? textRootBounds( group ) : null;
\tconst bend = fx && bounds ? fx.bend : null;
\tconst wipe = fx && bounds ? fx.wipe : null;
\tconst needs = !! ( bend || wipe );
"""
new_ag = """function applyGroupFx( group, fx, debug ) {

\tlet bounds = fx ? textRootBounds( group ) : null;
\t// Troika layout can lag one frame after Duration / char-split rebuild; without
\t// bounds wipe was forced off (mask \"disappears\"). Reuse last good ink box.
\tif ( bounds ) {

\t\tgroup.userData.__fccGeomFxBounds = bounds;

\t} else if ( fx && group.userData && group.userData.__fccGeomFxBounds ) {

\t\tbounds = group.userData.__fccGeomFxBounds;

\t}
\tconst bend = fx && bounds ? fx.bend : null;
\tconst wipe = fx && bounds ? fx.wipe : null;
\tconst needs = !! ( bend || wipe );
"""
if old_ag not in ft:
    raise SystemExit("applyGroupFx head not found")
ft = ft.replace(old_ag, new_ag, 1)
write(fx, ft)
print("patched TextGeomFx bounds fallback")
print("ALL_OK")
