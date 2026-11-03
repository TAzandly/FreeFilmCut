// node _tanim_check/t1.mjs
import {
	createDefaultTextAnim,
	normalizeTextAnim,
	ensureTextAnimOnUI,
	createDefaultComponent,
	migrateV1,
} from '../three.js/editor/js/textanim/TextAnimTypes.js?v=fcc-tanim-1';
import { sampleTextAnim, textAnimTimelineEnd, textAnimNeedsCharSplit } from '../three.js/editor/js/textanim/TextAnimEngine.js?v=fcc-tanim-1';
import { listTextAnims } from '../three.js/editor/js/textanim/TextAnimRegistry.js?v=fcc-tanim-1';

let fails = 0;
function ok(cond, msg, extra) {
	if (!cond) { fails++; console.log('FAIL', msg, extra !== undefined ? JSON.stringify(extra) : ''); }
	else console.log('ok  ', msg);
}
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

console.log('registry:', listTextAnims('char').map(d => d.type).join(','), '|', listTextAnims('text').map(d=>d.type).join(','));

// ---- 1. v1 migration (defaults) ----
const v1 = {
	format: 'freecapcut.textanim/1',
	enabled: true,
	previewPhase: 'in',
	in: {
		duration: 1, stagger: { overlap: 0.65, order: 'ltr', seed: 1 }, ease: 'cubicOut',
		channels: {
			opacity: { from: 0, to: 1 }, offsetX: { from: 0, to: 0 }, offsetY: { from: -36, to: 0 },
			scale: { from: 0.55, to: 1 }, scaleX: null, scaleY: null,
			rotateX: { from: 0, to: 0 }, rotateY: { from: 0, to: 0 }, rotateZ: { from: -0.35, to: 0 },
		},
		modulators: {
			wave: { enabled: true, amp: 12, freq: 1.25, phase: 0 },
			bend: { enabled: false, amount: 0.15 },
			wipeReveal: { enabled: true, direction: 'ltr', soft: 0.08, edgeIntensity: 2.5, edgeWidth: 0.03 },
		},
	},
	out: {
		duration: 1, stagger: { overlap: 0.65, order: 'ltr', seed: 1 }, ease: 'cubicOut',
		channels: {
			opacity: { from: 1, to: 0 }, offsetX: { from: 0, to: 0 }, offsetY: { from: 36, to: 0 },
			scale: { from: 1, to: 0.55 }, rotateX: { from: 0, to: 0 }, rotateY: { from: 0, to: 0 },
			rotateZ: { from: 0.35, to: 0 },
		},
		modulators: { wave: { enabled: false, amp: 12, freq: 1.25, phase: 0 }, bend: { enabled: false, amount: 0.15 }, wipeReveal: { enabled: false, direction: 'ltr', soft: 0.12, edgeIntensity: 2.5, edgeWidth: 0.04 } },
	},
	loop: null,
};

const anim = normalizeTextAnim(v1);
console.log('migrated types:', anim.components.map(c => c.type + '(' + c.id + ')').join(', '));
ok(anim.format === 'freecapcut.textanim/2', 'format is v2');
ok(anim.components.length === 3, 'charIn + wave + wipeReveal migrated', anim.components.map(c=>c.type));
ok(anim.components[0].type === 'charIn', 'first is charIn');
ok(near(anim.components[0].selector.delay, 0.35), 'overlap 0.65 → delay 0.35', anim.components[0].selector.delay);
ok(anim.components[1].params.speed === 1.25, 'wave speed mirrors v1 freq');
ok(anim.legacy && anim.legacy.format === 'freecapcut.textanim/1', 'legacy kept');
ok(!anim.components.some(c => c.type === 'charOut'), 'default (untouched) out phase NOT migrated');

// untouched out with edit → migrated
const v1b = JSON.parse(JSON.stringify(v1));
v1b.out.channels.offsetY = { from: 120, to: 0 };
const animB = normalizeTextAnim(v1b);
ok(animB.components.some(c => c.type === 'charOut' && c.params.offsetY[0] === 120), 'edited out phase migrated');

// ---- 2. sampling: 6 chars, t=0 / t=1 ----
const N = 6;
const s0 = sampleTextAnim(anim, 0, N);
ok(s0.needsCharSplit === true, 'needsCharSplit true (has char comps)');
ok(s0.charPoses.length === N, 'pose count');
console.log('t=0 opacity:', s0.charPoses.map(p => p.opacity.toFixed(2)).join(','), 'offsetY:', s0.charPoses.map(p=>p.offsetY.toFixed(1)).join(','));
ok(s0.charPoses[0].opacity < 0.01, 't=0 first char hidden');

const sEnd = sampleTextAnim(anim, 1.2, N);
console.log('t=1.2 opacity:', sEnd.charPoses.map(p => p.opacity.toFixed(2)).join(','), 'offsetY:', sEnd.charPoses.map(p=>p.offsetY.toFixed(1)).join(','));
ok(sEnd.charPoses.every(p => near(p.opacity, 1, 1e-3)), 't=end all opaque');
ok(Math.abs(sEnd.charPoses[0].scaleX - 1) < 1e-3, 'scale settles at 1');

// stagger: last char starts later → at t=0.1 first char further along than last
const sMid = sampleTextAnim(anim, 0.15, N);
ok(sMid.charPoses[0].opacity > sMid.charPoses[N - 1].opacity, 'stagger: first char leads', {
	a: sMid.charPoses[0].opacity, b: sMid.charPoses[N - 1].opacity,
});

// ---- 3. wipe pass ----
const w0 = s0.passOps.find(o => o.kind === 'wipe');
ok(!!w0, 'wipe pass op present');
ok(near(w0.progress, 0), 'wipe progress 0 at t=0', w0.progress);
const wHalf = sampleTextAnim(anim, 0.5, N).passOps.find(o => o.kind === 'wipe');
ok(near(wHalf.progress, 0.5), 'wipe progress 0.5 at t=0.5', wHalf.progress);
const wEnd = sampleTextAnim(anim, 5, N).passOps.find(o => o.kind === 'wipe');
ok(near(wEnd.progress, 1), 'wipe progress clamps to 1');

// invert
const inv = createDefaultComponent(anim, 'wipeReveal');
inv.params.invert = true;
inv.time.start = 0; inv.time.duration = 1;
const animInv = { format: 'x', enabled: true, components: [inv], legacy: null };
ok(near(sampleTextAnim(animInv, 0.25, N).passOps[0].progress, 0.75), 'invert flip');

// ---- 4. text-only stack does NOT split glyphs ----
const wipeOnly = { format: 'x', enabled: true, components: [createDefaultComponent(anim, 'wipeReveal')], legacy: null };
ok(textAnimNeedsCharSplit(wipeOnly) === false, 'wipe-only keeps single Text mesh');
ok(sampleTextAnim(wipeOnly, 0.4, N).charPoses === null, 'wipe-only produces no poses');

// ---- 5. wave ramp (v1 parity) ----
const waveOnly = { format: 'x', enabled: true, components: [createDefaultComponent(anim, 'wave')], legacy: null };
const wv = waveOnly.components[0];
ok(wv.time.loop === 'infinite', 'wave default infinite');
const tw0 = sampleTextAnim(waveOnly, 0, N).charPoses[0].offsetY;
const expect0 = Math.sin(0) * 12 * 0.35;
ok(near(tw0, expect0, 1e-6), 'wave t=0 = sin(0)*amp*ramp', { tw0, expect0 });
const twLater = sampleTextAnim(waveOnly, 3.3, N).charPoses[0].offsetY;
const expectLater = Math.sin(0 + 3.3 * Math.PI * 2 * 1) * 12 * 1;
ok(near(twLater, expectLater, 1e-6), 'wave full amp after ramp', { twLater, expectLater });

// ---- 6. charOut window after charIn ----
const outAnim = { format: 'x', enabled: true, components: [], legacy: null };
const outComp = createDefaultComponent(outAnim, 'charOut');
outComp.time.start = 1; outComp.time.duration = 1;
outAnim.components.push(outComp);
const beforeOut = sampleTextAnim(outAnim, 0.5, N).charPoses[0];
ok(near(beforeOut.opacity, 1, 1e-6), 'charOut before window = identity');
const afterOut = sampleTextAnim(outAnim, 2.2, N).charPoses[0];
ok(afterOut.opacity < 0.01, 'charOut after window = hidden', afterOut.opacity);

// ---- 7. typewriter hard cut ----
const tw = { format: 'x', enabled: true, components: [], legacy: null };
const twc = createDefaultComponent(tw, 'typewriter');
twc.selector.delay = 1; twc.selector.ease = 'linear'; twc.time.duration = 1;
tw.components.push(twc);
const twHalf = sampleTextAnim(tw, 0.5, 6).charPoses.map(p => p.opacity);
console.log('typewriter @50%:', twHalf.join(','));
ok(twHalf[0] === 1 && twHalf[5] === 0, 'typewriter shows leading chars only');

// ---- 8. selector range ----
const rAnim = { format: 'x', enabled: true, components: [], legacy: null };
const rc = createDefaultComponent(rAnim, 'charIn');
rc.selector.start = 0.5; rc.selector.end = 1; rc.selector.delay = 0;
rAnim.components.push(rc);
const rp = sampleTextAnim(rAnim, 2, 6).charPoses.map(p => +p.opacity.toFixed(2));
console.log('range [0.5,1] @done:', rp.join(','));
ok(rp[0] === 1 && rp[1] === 1 && rp[2] === 1, 'chars outside range untouched (identity)');

// ---- 9. ensureTextAnimOnUI identity + idempotency ----
const ui = { textAnim: JSON.parse(JSON.stringify(anim)) };
const a1 = ensureTextAnimOnUI(ui);
const a2 = ensureTextAnimOnUI(ui);
ok(a1 === a2 && ui.textAnim === a1, 'identity stable across ensure calls');
const comp0 = a1.components[0];
ok(ensureTextAnimOnUI(ui).components[0] === comp0, 'component object identity stable');

// v1 upgrade through ensure
const ui2 = { textAnim: JSON.parse(JSON.stringify(v1)) };
const up = ensureTextAnimOnUI(ui2);
ok(up.format === 'freecapcut.textanim/2', 'ensure upgrades v1 in place');

// ---- 10. timeline end ----
ok(near(textAnimTimelineEnd(anim), 1, 1e-6), 'timeline end = wipe/in duration', textAnimTimelineEnd(anim));

// ---- 11. no functions in doc (auto-save safety) ----
const ser = JSON.stringify(anim, (k, v) => (typeof v === 'function' ? '__FN__' : v));
ok(!ser.includes('__FN__'), 'document is pure JSON');

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILED');
process.exit(fails ? 1 : 0);
