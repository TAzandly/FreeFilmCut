import { remapTextAnimSampleTime, textAnimAuthoredDuration } from "./src/vfxpack/text-anim-motion.ts";
import { sampleWipeRevealProgress, normalizeTextAnim, ensureTextAnimOnUI } from "./src/vfxpack/textanim/TextAnim.js";
import "./src/vfxpack/textanim/TextAnimBuiltins.js";

const payload = {
  duration: 1,
  category: "in",
  components: [
    { id: "c_wipeReveal_1", type: "wipeReveal", scope: "text", enabled: true, params: { direction: "ltr", soft: 0.08, edgeIntensity: 2.5, edgeWidth: 0.03, fillDim: 1, fillRange: 0.12, fillPower: 2.5, blendMode: "normal", invert: false }, channels: {} },
  ],
  tracks: [
    { path: "textAnim.c_wipeReveal_1.progress", keys: [{ t: 0, v: 0, ease: "easeOut" }, { t: 1, v: 1 }] },
  ],
};

function sampleKeys(keys, time) {
  if (time <= keys[0].t) return keys[0].v;
  if (time >= keys[keys.length - 1].t) return keys[keys.length - 1].v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (time >= a.t && time <= b.t) {
      const u = (time - a.t) / (b.t - a.t);
      return a.v + (b.v - a.v) * u;
    }
  }
  return keys[keys.length - 1].v;
}
function mapLoopTime(time, duration, loop) {
  const d = Math.max(0.0001, duration);
  let t = Number(time) || 0;
  if (loop) { t = t % d; if (t < 0) t += d; return t; }
  return Math.max(0, Math.min(d, t));
}

function sampleAt(wall, play) {
  const authored = Math.max(0.1, textAnimAuthoredDuration(payload) || 0.5);
  const t = mapLoopTime(remapTextAnimSampleTime(wall, play, authored), authored, false);
  const values = new Map();
  for (const tr of payload.tracks) {
    const sub = tr.path.slice("textAnim.".length);
    values.set(sub, sampleKeys(tr.keys, t));
  }
  const anim = normalizeTextAnim({ format: "freecapcut.textanim/3", enabled: true, components: payload.components });
  const wipe = sampleWipeRevealProgress(anim, { time: t, values });
  return { wall, play, authored, t, progressValue: values.get("c_wipeReveal_1.progress"), wipe };
}

for (const play of [1, 2, 0.5]) {
  console.log("--- play", play);
  for (const wall of [0, 0.25, 0.5, 1, 1.5, 2]) {
    if (wall > play && play < 2) continue;
    console.log(sampleAt(wall, play));
  }
}
