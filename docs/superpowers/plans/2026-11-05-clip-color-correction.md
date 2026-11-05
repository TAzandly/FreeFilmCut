# Clip Color Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CapCut-style Color Correction (enable + intensity) on Adjustment → Basic: one-shot histogram analysis into a 9-D vector, GPU apply via CapCut’s open frag math, stacked before existing `colorGrade`.

**Architecture:** New `src/color-correction/` module (settings, CapCut Lua math port, analyzer, GLSL helpers, frame sample + analysis runner). Params `colorCorrection.*` on video/image. Resolve samples intensity keyframes; compositor injects correction uniforms into the existing color-grade material patch **before** `applyFccColorGrade`. Analysis runs async on enable; cached JSON on the element.

**Tech Stack:** Next.js / React editor (`freefilmcut/apps/web`), bun:test, Three.js MeshBasicMaterial `onBeforeCompile`, existing param registry / keyframes / `videoCache`.

**Spec:** `docs/superpowers/specs/2026-11-05-clip-color-correction-design.md`

**CapCut reference (local):**  
`D:\GrokbotWork\剪映资源\调色相关\7416258989467374091\9e1cfdca2b07a183049bfc9b5ed32895\AmazingFeature_colorCorrection\`  
(`lua/SeekModeScript.lua`, `xshader/colorCorrection.frag`)

---

## File map

| File | Responsibility |
|------|----------------|
| `freefilmcut/apps/web/src/color-correction/math.ts` (create) | CapCut Lua → uniforms (scale, contrast/highlight/shadow/BW/brightness/sat/temp-tint) |
| `freefilmcut/apps/web/src/color-correction/__tests__/math.test.ts` (create) | Unit tests vs Lua formulas |
| `freefilmcut/apps/web/src/color-correction/settings.ts` (create) | Types, param keys, read/parse analysis, resolve intensity at time, identity helpers |
| `freefilmcut/apps/web/src/color-correction/__tests__/settings.test.ts` (create) | Param + resolve tests |
| `freefilmcut/apps/web/src/color-correction/analyze.ts` (create) | ImageData → 9 floats (post s1/s2) |
| `freefilmcut/apps/web/src/color-correction/__tests__/analyze.test.ts` (create) | Synthetic dark/flat/cast frames |
| `freefilmcut/apps/web/src/color-correction/shader-core.ts` (create) | GLSL helpers ported from CapCut frag |
| `freefilmcut/apps/web/src/color-correction/sample-frame.ts` (create) | Mid-trim frame via `videoCache` / image canvas |
| `freefilmcut/apps/web/src/color-correction/run-analysis.ts` (create) | Orchestrate sample → analyze → JSON string |
| `freefilmcut/apps/web/src/color-correction/index.ts` (create) | Public exports |
| `freefilmcut/apps/web/src/color-correction/param-defs.ts` (create) | Param definitions for registry |
| `freefilmcut/apps/web/src/params/registry.ts` | Register colorCorrection params on video/image |
| `freefilmcut/apps/web/src/services/renderer/compositor/color-grade-material.ts` | Inject correction uniforms + preamble; `applyColorCorrectionToMaterial` |
| `freefilmcut/apps/web/src/services/renderer/nodes/visual-node.ts` | `colorCorrection?` on params + resolved state |
| `freefilmcut/apps/web/src/services/renderer/scene-builder.ts` | `readColorCorrectionFromParams` into node params |
| `freefilmcut/apps/web/src/services/renderer/resolve.ts` | `resolveColorCorrectionAtTime`; null when inactive |
| `freefilmcut/apps/web/src/services/renderer/compositor/frame-descriptor.ts` | Pass `colorCorrection` on paint items |
| `freefilmcut/apps/web/src/services/renderer/compositor/three-compositor.ts` | Call apply correction alongside grade |
| `freefilmcut/apps/web/src/services/renderer/cut-transition.ts` | Carry + apply correction on cut sides (same stack) |
| `freefilmcut/apps/web/src/color-grade/apply-canvas.ts` | Add correction uniforms + `applyFccColorCorrection` before grade in the OffscreenCanvas blit (cut-transition parity) |
| `freefilmcut/apps/web/src/components/editor/panels/properties/media-properties-view.tsx` | Color Correction section above Basic sliders + analysis trigger |
| `freefilmcut/apps/web/src/components/editor/panels/properties/color-correction-section.tsx` (create) | UI section: enable, reset, intensity; kicks analysis |

---

### Task 1: CapCut math port (TDD)

**Files:**
- Create: `freefilmcut/apps/web/src/color-correction/math.ts`
- Create: `freefilmcut/apps/web/src/color-correction/__tests__/math.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, test } from "bun:test";
import {
	IDENTITY_ANALYSIS,
	intensityScale,
	packColorCorrectionUniforms,
	type ColorCorrectionAnalysis,
} from "../math";

describe("intensityScale", () => {
	test("matches CapCut NormalizeScale=50 at 80%", () => {
		// scale = 1/50/0.8 * 0.8 = 0.02
		expect(intensityScale({ intensity: 80 })).toBeCloseTo(0.02, 8);
	});

	test("at 100%", () => {
		expect(intensityScale({ intensity: 100 })).toBeCloseTo(0.025, 8);
	});

	test("at 0%", () => {
		expect(intensityScale({ intensity: 0 })).toBe(0);
	});
});

describe("packColorCorrectionUniforms", () => {
	test("zero analysis → all enable flags false / identity-ish", () => {
		const u = packColorCorrectionUniforms({
			analysis: IDENTITY_ANALYSIS,
			intensity: 80,
		});
		expect(u.enableContrast).toBe(0);
		expect(u.enableBrightness).toBe(0);
		expect(u.enableSaturation).toBe(0);
	});

	test("positive brightness analysis enables brightness and scales with intensity", () => {
		const analysis: ColorCorrectionAnalysis = {
			...IDENTITY_ANALYSIS,
			brightness: 0.5, // post s1
		};
		const soft = packColorCorrectionUniforms({ analysis, intensity: 40 });
		const hard = packColorCorrectionUniforms({ analysis, intensity: 80 });
		expect(soft.enableBrightness).toBe(1);
		expect(hard.enableBrightness).toBe(1);
		expect(Math.abs(hard.brightnessParam)).toBeGreaterThan(
			Math.abs(soft.brightnessParam),
		);
	});

	test("getSaturationParam: intensity 0 → sat 1", () => {
		const analysis: ColorCorrectionAnalysis = {
			...IDENTITY_ANALYSIS,
			saturation: 0.4,
		};
		const u = packColorCorrectionUniforms({ analysis, intensity: 80 });
		// axisIntensity = 0.4 * 0.02 = 0.008; satParam = 1 + 0.008
		expect(u.saturationParam).toBeCloseTo(1.008, 5);
		expect(u.enableSaturation).toBe(1);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd freefilmcut/apps/web && bun test src/color-correction/__tests__/math.test.ts`  
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `math.ts`**

Port CapCut `SeekModeScript.lua` helpers literally. Core API:

```typescript
export type ColorCorrectionAnalysis = {
	brightness: number;
	contrast: number;
	highlight: number;
	shadow: number;
	saturation: number;
	tint: number;
	temperature: number;
	white: number;
	black: number;
};

export const IDENTITY_ANALYSIS: ColorCorrectionAnalysis = {
	brightness: 0,
	contrast: 0,
	highlight: 0,
	shadow: 0,
	saturation: 0,
	tint: 0,
	temperature: 0,
	white: 0,
	black: 0,
};

export const ANALYSIS_KEYS = [
	"brightness",
	"contrast",
	"highlight",
	"shadow",
	"saturation",
	"tint",
	"temperature",
	"white",
	"black",
] as const satisfies ReadonlyArray<keyof ColorCorrectionAnalysis>;

/** CapCut: scale = 1/NormalizeScale/0.8 * sliderIntensity; NormalizeScale=50 */
export function intensityScale({ intensity }: { intensity: number }): number {
	const slider = Math.min(100, Math.max(0, intensity)) / 100;
	return (1 / 50 / 0.8) * slider;
}

export type ColorCorrectionUniforms = {
	enableTemperatureTint: number;
	enableSaturation: number;
	enableBrightness: number;
	enableContrast: number;
	enableHighlight: number;
	enableShadow: number;
	enableBlackWhite: number;
	temperatureTintRed: [number, number, number];
	temperatureTintGreen: [number, number, number];
	temperatureTintBlue: [number, number, number];
	saturationParam: number;
	brightnessParam: number;
	contrastParam: number;
	contrastPivot: number;
	contrastXFactor: number;
	contrastLeftDiff: number;
	contrastRightDiff: number;
	contrastLeftSlopeDiff: number;
	contrastRightSlopeDiff: number;
	contrastPivotSlope: number;
	highlightParam: number;
	shadowParam: number;
	blackWhiteSlope: number;
	blackWhiteBias: number;
};

export function packColorCorrectionUniforms({
	analysis,
	intensity,
}: {
	analysis: ColorCorrectionAnalysis;
	intensity: number;
}): ColorCorrectionUniforms {
	// 1. scale = intensityScale(...)
	// 2. axisIntensity = analysis[k] * scale; clamp to [-1,1]
	// 3. enable* = abs(axis) > 1e-5
	// 4. CapCut getBrightnessParam / getContrastParam / getHighlightParam /
	//    getShadowParam / getBlackWhiteParam / getSaturationParam /
	//    getTemperatureTintParam + computeTemperatureTintVec3 + Mat3
	// Copy extraData table, A/B/P/Q matrices, ContrastPivot=0.435 from Lua.
}
```

Copy the `extraData` array and matrix constants from CapCut Lua verbatim (do not invent). Temperature-tint path must match CapCut when both temp and tint axes are non-zero.

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd freefilmcut/apps/web && bun test src/color-correction/__tests__/math.test.ts`

- [ ] **Step 5: Commit**

```bash
git add freefilmcut/apps/web/src/color-correction/math.ts freefilmcut/apps/web/src/color-correction/__tests__/math.test.ts
git commit -m "$(cat <<'EOF'
Add CapCut color-correction intensity→uniform math port.

EOF
)"
```

---

### Task 2: Settings + param serialization (TDD)

**Files:**
- Create: `freefilmcut/apps/web/src/color-correction/settings.ts`
- Create: `freefilmcut/apps/web/src/color-correction/param-defs.ts`
- Create: `freefilmcut/apps/web/src/color-correction/__tests__/settings.test.ts`
- Create: `freefilmcut/apps/web/src/color-correction/index.ts` (re-exports so far)

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, test } from "bun:test";
import { mediaTimeFromSeconds } from "@/wasm";
import {
	DEFAULT_COLOR_CORRECTION_INTENSITY,
	parseColorCorrectionAnalysis,
	readColorCorrectionFromParams,
	resolveColorCorrectionAtTime,
	serializeColorCorrectionAnalysis,
	isColorCorrectionActive,
} from "../settings";
import { IDENTITY_ANALYSIS } from "../math";

describe("analysis JSON", () => {
	test("round-trips 9 floats", () => {
		const a = { ...IDENTITY_ANALYSIS, brightness: 0.12, saturation: -0.05 };
		const s = serializeColorCorrectionAnalysis({ analysis: a });
		expect(parseColorCorrectionAnalysis({ raw: s })).toEqual(a);
	});

	test("rejects wrong length", () => {
		expect(parseColorCorrectionAnalysis({ raw: "[1,2,3]" })).toBeNull();
	});
});

describe("readColorCorrectionFromParams", () => {
	test("defaults disabled", () => {
		const c = readColorCorrectionFromParams({ params: {} });
		expect(c.enabled).toBe(false);
		expect(c.intensity).toBe(DEFAULT_COLOR_CORRECTION_INTENSITY);
		expect(c.analysis).toBeNull();
	});

	test("reads enabled + analysis", () => {
		const c = readColorCorrectionFromParams({
			params: {
				"colorCorrection.enabled": true,
				"colorCorrection.intensity": 60,
				"colorCorrection.analysis": serializeColorCorrectionAnalysis({
					analysis: { ...IDENTITY_ANALYSIS, contrast: 0.2 },
				}),
			},
		});
		expect(c.enabled).toBe(true);
		expect(c.intensity).toBe(60);
		expect(c.analysis?.contrast).toBe(0.2);
	});
});

describe("resolveColorCorrectionAtTime", () => {
	test("inactive when disabled or no analysis", () => {
		expect(
			isColorCorrectionActive({
				correction: resolveColorCorrectionAtTime({
					base: {
						enabled: true,
						intensity: 80,
						analysis: null,
					},
					animations: undefined,
					localTime: mediaTimeFromSeconds({ seconds: 0 }),
				}),
			}),
		).toBe(false);
	});

	test("samples intensity keyframe", () => {
		const resolved = resolveColorCorrectionAtTime({
			base: {
				enabled: true,
				intensity: 80,
				analysis: { ...IDENTITY_ANALYSIS, brightness: 0.5 },
			},
			localTime: mediaTimeFromSeconds({ seconds: 1 }),
			animations: {
				"colorCorrection.intensity": {
					keys: [
						{
							id: "a",
							time: mediaTimeFromSeconds({ seconds: 0 }),
							value: 0,
							segmentToNext: "linear",
							tangentMode: "auto",
						},
						{
							id: "b",
							time: mediaTimeFromSeconds({ seconds: 2 }),
							value: 100,
							segmentToNext: "linear",
							tangentMode: "auto",
						},
					],
				},
			},
		});
		expect(resolved).not.toBeNull();
		expect(resolved!.intensity).toBeCloseTo(50, 0);
	});
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd freefilmcut/apps/web && bun test src/color-correction/__tests__/settings.test.ts`

- [ ] **Step 3: Implement settings + param-defs**

```typescript
// settings.ts — essentials
export const COLOR_CORRECTION_PARAM_KEYS = {
	enabled: "colorCorrection.enabled",
	intensity: "colorCorrection.intensity",
	analysis: "colorCorrection.analysis",
} as const;

export const DEFAULT_COLOR_CORRECTION_INTENSITY = 80;

export type ColorCorrectionSettings = {
	enabled: boolean;
	intensity: number; // 0..100
	analysis: ColorCorrectionAnalysis | null;
};

/** Active for GPU when enabled + analysis present. */
export type ResolvedColorCorrection = {
	enabled: true;
	intensity: number;
	analysis: ColorCorrectionAnalysis;
};

export function serializeColorCorrectionAnalysis({
	analysis,
}: {
	analysis: ColorCorrectionAnalysis;
}): string {
	return JSON.stringify(ANALYSIS_KEYS.map((k) => analysis[k]));
}

export function parseColorCorrectionAnalysis({
	raw,
}: {
	raw: unknown;
}): ColorCorrectionAnalysis | null {
	// parse JSON array length 9; finite numbers; build object by ANALYSIS_KEYS order
}

export function readColorCorrectionFromParams({
	params,
}: {
	params: ParamValues | undefined;
}): ColorCorrectionSettings { /* ... */ }

export function resolveColorCorrectionAtTime(...): ResolvedColorCorrection | null {
	// if !enabled || !analysis → null
	// sample colorCorrection.intensity via resolveAnimationPathValueAtTime
	// clamp 0..100
}

export function isColorCorrectionActive({
	correction,
}: {
	correction: ResolvedColorCorrection | null;
}): boolean {
	return correction !== null;
}
```

`param-defs.ts`:

```typescript
export function buildColorCorrectionParamDefs(): ElementParamDefinition[] {
	return [
		{
			key: "colorCorrection.enabled",
			label: "Color Correction",
			type: "boolean",
			default: false,
			keyframable: false,
		},
		{
			key: "colorCorrection.intensity",
			label: "Correction Intensity",
			type: "number",
			default: 80,
			min: 0,
			max: 100,
			step: 1,
			keyframable: true,
			dependencies: [{ param: "colorCorrection.enabled", equals: true }],
		},
		// analysis is internal — NOT registered as a visible field
	];
}
```

Analysis stays a raw param string written by the analysis runner, not shown in `ElementParamFields`.

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git add freefilmcut/apps/web/src/color-correction/
git commit -m "$(cat <<'EOF'
Add color-correction settings and param serialization.

EOF
)"
```

---

### Task 3: Histogram analyzer (TDD)

**Files:**
- Create: `freefilmcut/apps/web/src/color-correction/analyze.ts`
- Create: `freefilmcut/apps/web/src/color-correction/__tests__/analyze.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, test } from "bun:test";
import { analyzeColorCorrection } from "../analyze";

function makeRgba({
	w,
	h,
	fill,
}: {
	w: number;
	h: number;
	fill: (x: number, y: number) => [number, number, number, number];
}): ImageData {
	const data = new Uint8ClampedArray(w * h * 4);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const [r, g, b, a] = fill(x, y);
			const i = (y * w + x) * 4;
			data[i] = r;
			data[i + 1] = g;
			data[i + 2] = b;
			data[i + 3] = a;
		}
	}
	return new ImageData(data, w, h);
}

describe("analyzeColorCorrection", () => {
	test("dark frame → positive brightness", () => {
		const img = makeRgba({
			w: 32,
			h: 32,
			fill: () => [20, 20, 20, 255],
		});
		const a = analyzeColorCorrection({ imageData: img });
		expect(a.brightness).toBeGreaterThan(0);
	});

	test("flat mid-gray → positive contrast", () => {
		const img = makeRgba({
			w: 32,
			h: 32,
			fill: () => [128, 128, 128, 255],
		});
		const a = analyzeColorCorrection({ imageData: img });
		expect(a.contrast).toBeGreaterThan(0);
	});

	test("strong blue cast → temperature/tint pull warm/opposite", () => {
		const img = makeRgba({
			w: 32,
			h: 32,
			fill: () => [40, 60, 200, 255],
		});
		const a = analyzeColorCorrection({ imageData: img });
		// Expect non-zero white-balance axes (signs depend on heuristic; assert magnitude)
		expect(
			Math.abs(a.temperature) + Math.abs(a.tint),
		).toBeGreaterThan(0.01);
	});

	test("outputs are finite and roughly in [-1,1] after s1/s2", () => {
		const img = makeRgba({
			w: 16,
			h: 16,
			fill: (x, y) => [x * 15, y * 15, 100, 255],
		});
		const a = analyzeColorCorrection({ imageData: img });
		for (const v of Object.values(a)) {
			expect(Number.isFinite(v)).toBe(true);
			expect(Math.abs(v)).toBeLessThanOrEqual(2); // allow mild overshoot before clamp in pack
		}
	});
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement analyzer**

```typescript
export function analyzeColorCorrection({
	imageData,
}: {
	imageData: ImageData;
}): ColorCorrectionAnalysis {
	// Skip a≈0 pixels. Build luma hist (Rec.709), mean chroma.
	// Targets (tunable constants at top of file):
	//   lumaMeanTarget ≈ 0.48
	//   lowPct=0.05, highPct=0.95 stretch vs 0.02/0.98
	// Map errors → raw axes in ~[-1,1], then apply CapCut s1=1.2 / s2=0.4:
	//   brightness,contrast,highlight,shadow,tint,temperature,white,black *= 1.2
	//   saturation *= 0.4
	// Clamp each to [-1, 1] after scale.
}
```

Heuristic sketch (keep simple, document constants):

- `brightness` ∝ `(lumaMeanTarget - meanY)`
- `contrast` ∝ `(targetRange - (p95-p5))` (boost when flat)
- `black` / `white` from p5 / p95 vs anchors
- `shadow` / `highlight` from lower/upper quartile vs mid
- `saturation` ∝ `(satTarget - meanChroma)`
- `temperature` from mean(R−B); `tint` from mean(G − (R+B)/2); clamp ±0.5 before s1

- [ ] **Step 4: Tests PASS** (adjust assertions if signs differ but keep “dark → +brightness” etc.)

- [ ] **Step 5: Commit**

```bash
git add freefilmcut/apps/web/src/color-correction/analyze.ts freefilmcut/apps/web/src/color-correction/__tests__/analyze.test.ts
git commit -m "$(cat <<'EOF'
Add histogram analyzer for color-correction 9-D vector.

EOF
)"
```

---

### Task 4: GLSL helpers + material injection

**Files:**
- Create: `freefilmcut/apps/web/src/color-correction/shader-core.ts`
- Modify: `freefilmcut/apps/web/src/services/renderer/compositor/color-grade-material.ts`
- Create or extend: `freefilmcut/apps/web/src/services/renderer/__tests__/color-correction-shader.test.ts` (string contains helpers / apply order)

- [ ] **Step 1: Write shader helper module**

Port CapCut `colorCorrection.frag` into `COLOR_CORRECTION_SHADER_HELPERS` string:

- Uniforms matching `ColorCorrectionUniforms` (+ `uColorCorrectionEnabled`)
- Functions: `adjustShadow`, `adjustHighlight`, `enchanceContrast` (keep CapCut spelling), saturation weights `0.208540, 0.702086, 0.089374`
- `vec3 applyFccColorCorrection(vec3 rgb)` — same order as CapCut comment: contrast → highlight → shadow → black/white → brightness → temperature/tint → saturation
- Early-out if `uColorCorrectionEnabled < 0.5`

- [ ] **Step 2: Extend color-grade-material**

1. Add correction uniform slots to the WeakMap uniforms object (or a second WeakMap).
2. Inject `COLOR_CORRECTION_SHADER_HELPERS` next to grade helpers (after `#include <common>`).
3. Change grade body to:

```glsl
diffuseColor.rgb = applyFccColorCorrection(diffuseColor.rgb);
diffuseColor.rgb = applyFccColorGrade(diffuseColor.rgb);
```

4. Bump `PROGRAM_CACHE_KEY` to `fcc-layer-color-grade-v4` (or `...-correction-v1`).

5. Export:

```typescript
export function applyColorCorrectionToMaterial({
	material,
	colorCorrection,
}: {
	material: THREE.Material;
	colorCorrection: ResolvedColorCorrection | null | undefined;
}): void {
	// null/undefined → enabled=0
	// else packColorCorrectionUniforms + write all uniforms + enabled=1
}
```

Always write (including off) so pooled meshes don’t leak prior clip state — same pattern as grade.

- [ ] **Step 3: Smoke test**

```typescript
import { describe, expect, test } from "bun:test";
import { COLOR_CORRECTION_SHADER_HELPERS } from "@/color-correction/shader-core";
import { injectColorGradeShader } from "../compositor/color-grade-material";

test("injection includes correction before grade", () => {
	const src = `
#include <common>
void main() {
#include <map_fragment>
}
`;
	const out = injectColorGradeShader({ fragmentShader: src });
	expect(out).toContain("applyFccColorCorrection");
	const iCorr = out.indexOf("applyFccColorCorrection");
	const iGrade = out.indexOf("applyFccColorGrade");
	expect(iCorr).toBeGreaterThan(-1);
	expect(iGrade).toBeGreaterThan(iCorr);
	expect(COLOR_CORRECTION_SHADER_HELPERS).toContain("uColorCorrectionEnableContrast");
});
```

Use `uColorCorrection*` uniform names (not CapCut’s `u_enable*`) for consistency with `uColorGrade*`.

- [ ] **Step 4: Run tests**

Run: `cd freefilmcut/apps/web && bun test src/services/renderer/__tests__/color-correction-shader.test.ts src/services/renderer/__tests__/color-grade-shader.test.ts`

- [ ] **Step 5: Commit**

```bash
git add freefilmcut/apps/web/src/color-correction/shader-core.ts \
  freefilmcut/apps/web/src/services/renderer/compositor/color-grade-material.ts \
  freefilmcut/apps/web/src/services/renderer/__tests__/color-correction-shader.test.ts
git commit -m "$(cat <<'EOF'
Inject CapCut color-correction shader before color grade.

EOF
)"
```

---

### Task 5: Renderer wiring (node → resolve → paint)

**Files:**
- Modify: `visual-node.ts`, `scene-builder.ts`, `resolve.ts`, `frame-descriptor.ts`, `three-compositor.ts`
- Modify: `cut-transition.ts` (and `apply-canvas.ts` if cut sides blit through it with grade only)

- [ ] **Step 1: Types**

On `VisualNodeParams` add `colorCorrection?: ColorCorrectionSettings` (base, like `colorGrade`).

On `ResolvedVisualNodeState` / `CutTransitionSide` add:

```typescript
colorCorrection: ResolvedColorCorrection | null;
```

- [ ] **Step 2: scene-builder**

```typescript
function buildColorCorrectionParam({ element }) {
	return {
		colorCorrection: readColorCorrectionFromParams({ params: element.params }),
	};
}
```

Spread into video/image node construction next to `buildColorGradeParam`.

- [ ] **Step 3: resolve**

Inside the visual resolve path (where `colorGrade` is sampled):

```typescript
const colorCorrection = params.colorCorrection
	? resolveColorCorrectionAtTime({
			base: params.colorCorrection,
			animations: params.animations,
			localTime,
		})
	: null;
// include on returned state
```

- [ ] **Step 4: frame-descriptor + three-compositor**

Thread `colorCorrection` onto paint items; call `applyColorCorrectionToMaterial` next to `applyColorGradeToMaterial` (always call, even with null).

- [ ] **Step 5: cut-transition**

When building cut sides that already attach `colorGrade`, also resolve/attach `colorCorrection`. Extend `applyColorGradeToImageSource` so the OffscreenCanvas blit runs `applyFccColorCorrection` before `applyFccColorGrade` (full preview/export parity).

- [ ] **Step 6: Typecheck**

Run: `cd freefilmcut/apps/web && bunx tsc --noEmit -p tsconfig.json 2>&1 | head -50`  
Expected: no new errors in touched files.

- [ ] **Step 7: Commit**

```bash
git add freefilmcut/apps/web/src/services/renderer freefilmcut/apps/web/src/color-grade/apply-canvas.ts
git commit -m "$(cat <<'EOF'
Wire color correction through resolve and compositor.

EOF
)"
```

---

### Task 6: Frame sample + analysis runner

**Files:**
- Create: `freefilmcut/apps/web/src/color-correction/sample-frame.ts`
- Create: `freefilmcut/apps/web/src/color-correction/run-analysis.ts`
- Update: `index.ts` exports

- [ ] **Step 1: `sample-frame.ts`**

```typescript
export async function sampleColorCorrectionFrame({
	mediaId,
	file,
	elementType,
	trimStart,
	trimEnd,
	duration,
	mediaDurationSeconds,
}: {
	mediaId: string;
	file: File;
	elementType: "video" | "image";
	trimStart: number; // seconds or MediaTime — match freeze-frame conventions
	trimEnd: number;
	duration: number;
	mediaDurationSeconds?: number;
}): Promise<ImageData | null> {
	// video: mid of trimmed range via videoCache.getFrameAt (streamKey: "color-correction")
	// image: draw file/bitmap to canvas at max dim 512, getImageData
	// downscale canvas so max(w,h) <= 512 before getImageData
}
```

Follow `captureFreezeFrameStill` patterns for canvas → pixels. Prefer mid-trim source time (not timeline mid if reversed — for v1 use forward mid of trim window; ignore reverse for analysis sample).

- [ ] **Step 2: `run-analysis.ts`**

```typescript
export async function runColorCorrectionAnalysis({
	mediaId,
	file,
	elementType,
	trimStart,
	trimEnd,
	duration,
}: { /* same as sample */ }): Promise<ColorCorrectionAnalysis | null> {
	const imageData = await sampleColorCorrectionFrame({ ... });
	if (!imageData) return null;
	return analyzeColorCorrection({ imageData });
}
```

- [ ] **Step 3: Commit**

```bash
git add freefilmcut/apps/web/src/color-correction/sample-frame.ts \
  freefilmcut/apps/web/src/color-correction/run-analysis.ts \
  freefilmcut/apps/web/src/color-correction/index.ts
git commit -m "$(cat <<'EOF'
Add color-correction frame sampling and analysis runner.

EOF
)"
```

---

### Task 7: Param registry + Adjustment UI

**Files:**
- Modify: `freefilmcut/apps/web/src/params/registry.ts` — spread `buildColorCorrectionParamDefs()` into video + image definitions (near color grade params)
- Create: `freefilmcut/apps/web/src/components/editor/panels/properties/color-correction-section.tsx`
- Modify: `media-properties-view.tsx` — render section above Basic fields

- [ ] **Step 1: Register params**

Import `buildColorCorrectionParamDefs` and add to video/image registry arrays alongside `colorGradeBasicParams`.

- [ ] **Step 2: ColorCorrectionSection component**

Behavior:

1. Show enable (boolean) + intensity (number) via `ElementParamFields` **or** thin wrappers using existing `PropertyParamField` / preview-commit hooks.
2. **Reset** control: write `enabled=false`, `intensity=80`, clear `colorCorrection.analysis` (leave intensity keyframes alone in v1).
3. When `enabled` flips to `true` and `analysis` is missing:
   - Resolve `MediaAsset` via `editor.media.getAssets()` + element `mediaId`
   - `runColorCorrectionAnalysis(...)`
   - On success: commit params patch `{ "colorCorrection.analysis": serialize..., "colorCorrection.intensity": current or 80, "colorCorrection.enabled": true }` via existing element update / preview commit path
   - On failure: leave enabled but no analysis (passthrough); `console.warn` once
4. Guard against double-trigger with an in-flight ref keyed by `element.id`.
5. Disable keeps cached analysis; Reset clears it (re-enable without reset is instant).

UI layout (Basic tab):

```tsx
<ColorCorrectionSection element={element} trackId={trackId} />
<Section ... Basic>
  <ElementParamFields params={basicParams} ... />
</Section>
```

Section title: **Color Correction**. Intensity hidden when disabled (param `dependencies` already handles if using registry fields).

- [ ] **Step 3: Manual smoke (dev)**

1. Open a dull video → Adjustment → Basic → enable Color Correction.
2. Expect brief async then visible lift; intensity 80 default.
3. Scrub intensity 0 → 100; 0 ≈ off.
4. Reset → off + no correction.
5. Keyframe intensity; play — strength animates.
6. Undo enable restores prior params.

- [ ] **Step 4: Commit**

```bash
git add freefilmcut/apps/web/src/params/registry.ts \
  freefilmcut/apps/web/src/components/editor/panels/properties/color-correction-section.tsx \
  freefilmcut/apps/web/src/components/editor/panels/properties/media-properties-view.tsx \
  freefilmcut/apps/web/src/color-correction/
git commit -m "$(cat <<'EOF'
Add Color Correction UI on Adjustment Basic with async analysis.

EOF
)"
```

---

### Task 8: Verification checklist

- [ ] **Step 1: Unit suite**

```bash
cd freefilmcut/apps/web && bun test \
  src/color-correction/__tests__/math.test.ts \
  src/color-correction/__tests__/settings.test.ts \
  src/color-correction/__tests__/analyze.test.ts \
  src/services/renderer/__tests__/color-correction-shader.test.ts
```

Expected: all PASS

- [ ] **Step 2: Manual checklist**

| Check | Pass? |
|-------|-------|
| Enable analyzes once; second enable with cache does not re-decode | |
| Intensity 0 passthrough; 100 stronger than 80 | |
| Manual Basic sliders still work and stack after correction | |
| Image clip works (not only video) | |
| Export/preview both show correction (same material path) | |
| No Smart Color UI anywhere | |

- [ ] **Step 3: Final commit only if leftover fixes**

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| Adjustment Basic UI enable/reset/intensity | 7 |
| Analysis once + cache JSON | 3, 6, 7 |
| CapCut frag + Lua scale | 1, 4 |
| Keyframable intensity | 2, 5, 7 |
| Stack correction → colorGrade | 4, 5 |
| Async analysis, no scrub stall | 6, 7 |
| No smart color | — (out of scope) |
| Video + image | 5, 6, 7 |

## Out of plan (do not implement)

- Smart Color Adjustment
- CapCut Lens binaries
- Editable 9-axis UI
- Per-frame re-analysis
