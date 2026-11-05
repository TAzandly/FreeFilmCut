# Clip color correction (色彩校正) v1

## Goal

Add CapCut-style **Color Correction** on clip Adjustment → Basic: one toggle, one intensity slider (keyframable). On enable, analyze the clip once into a 9-dimensional correction vector, then apply CapCut’s open GLSL pipeline scaled by intensity. Manual Basic / HSL / Curves remain unchanged and stack after correction.

## Approach

High-fidelity approximation of CapCut pack `AmazingFeature_colorCorrection`:

1. **Replace** proprietary `lens_ii_auto_color` with a histogram / percentile analyzer that emits the same 9 floats CapCut’s Lua reads from `lens_ii_auto_color_output`.
2. **Port** open `colorCorrection.frag` + `SeekModeScript.lua` intensity→uniform mapping (contrast → highlight → shadow → black/white → brightness → temperature/tint → saturation).
3. **Do not** ship Smart Color Adjustment (智能调色) in v1.

Source reference (local CapCut unpack):

`D:\GrokbotWork\剪映资源\调色相关\7416258989467374091\...\AmazingFeature_colorCorrection\`

## Scope

### In scope (v1)

| Item | Behavior |
|------|----------|
| UI | Adjustment → Basic, section above existing Basic sliders: enable, reset, intensity 0–100 |
| Analysis | On enable (and on reset / re-analyze): sample a representative frame, compute 9-D vector, cache on the element |
| Apply | GPU frag using CapCut open math; intensity scales the cached vector (no re-analyze while dragging) |
| Keyframes | `colorCorrection.intensity` keyframable via existing param keyframe system |
| Stack order | media → **color correction** → existing `colorGrade` Basic / HSL / Curves |
| Targets | Video and image clips that already use `colorGrade` (same media hosts as Adjustment page) |

### Out of scope (v1)

- Smart Color Adjustment (智能调色 / VHDR / scene presets)
- Embedding CapCut `kernel.bin` / Lens runtime
- Pixel-perfect match to CapCut auto_color ML output
- Per-frame re-analysis during scrub/play
- Color Clone
- Exposing the 9 analysis axes as user-editable sliders (intensity-only UX, like CapCut)

## UX

- **Placement:** `AdjustmentPage` → Basic tab, new collapsible section **above** the existing Basic param fields.
- **Controls:** checkbox (enable), reset control, intensity slider + numeric input (0–100), keyframe affordance on intensity (same pattern as other keyframable params).
- **Defaults:** disabled; when first enabled, intensity defaults to **80** (CapCut’s reference default in Lua: `0.8` in the scale formula).
- **Reset:** sets `enabled=false`, `intensity` back to default, clears cached `analysis`.
- **Re-analyze:** v1 has no separate button — reset (clears analysis) then enable again recomputes.
- Labels: English in UI for now (i18n separate); internal keys use `colorCorrection.*`.

## Data model

Element `params` (alongside existing `colorGrade.*`):

| Key | Type | Notes |
|-----|------|-------|
| `colorCorrection.enabled` | boolean | default `false` |
| `colorCorrection.intensity` | number 0–100 | keyframable; default `80` when enabled |
| `colorCorrection.analysis` | string (JSON array of 9 numbers) | cached post-`s1`/`s2` floats; absent when none |

### Analysis vector (order fixed — match CapCut Lua)

CapCut `SeekModeScript` reads `lens_ii_auto_color_output` indices, then applies `s1=1.2` / `s2=0.4` into `*IntensityFisrt`. **We store that post-scale vector** (same domain CapCut caches):

| Index | Name | CapCut post-scale |
|-------|------|-------------------|
| 0 | brightness | × `s1` (1.2) |
| 1 | contrast | × `s1` |
| 2 | highlight | × `s1` |
| 3 | shadow | × `s1` |
| 4 | saturation | × `s2` (0.4) |
| 5 | tint | × `s1` |
| 6 | temperature | × `s1` |
| 7 | white | × `s1` |
| 8 | black | × `s1` |

Serialize as JSON, e.g. `[0.12,-0.05,...]` (length exactly 9). Invalid/absent → treat as no analysis.

Intensity scale — port CapCut Lua literally (`NormalizeScale = 50`, slider in `[0,1]`):

```text
slider = intensity / 100
scale = (1.0 / 50.0 / 0.8) * slider   // = 0.025 * slider
axisIntensity = analysis[i] * scale
```

At intensity 80 → `scale = 0.02`; at 100 → `scale = 0.025`. Then map each axis through CapCut’s `getBrightnessParam` / `getContrastParam` / … / `getBlackWhiteParam` / temperature-tint matrix helpers into shader uniforms.

## Analysis algorithm (open substitute for auto_color)

### When

- Transition `enabled: false → true` with missing/invalid analysis.
- User reset that clears analysis, then enable again.
- Media identity change for that element (new `mediaId` / source) invalidates analysis.

### How

1. Resolve a representative source frame (prefer mid-trim still via existing video/image frame path; fallback first decodable frame).
2. Downscale to ~256–512 px max dimension (CPU or canvas).
3. Compute luma / chroma statistics (histogram + percentiles), estimate the 9 axes in CapCut’s intensity domain roughly `[-1, 1]` before/after `s1`/`s2` as chosen above.
4. Heuristics (v1, tunable):
   - **Brightness / contrast / black / white:** from luma mean and low/high percentiles vs targets (e.g. mean ~0.45–0.5, stretch ends gently).
   - **Highlight / shadow:** from upper/lower quartile mass vs midtones.
   - **Saturation:** from mean chroma vs target; keep conservative (`s2` already damps).
   - **Temperature / tint:** from average chroma bias in Lab or simple R–B / G balance; clamp hard so skin-heavy scenes don’t over-correct.
5. Run off the main render loop (async Worker or idle callback). Until analysis lands, **skip applying correction** (passthrough); do not stall scrubbing.

Exact numeric mapping tables are implementation details; unit-test against synthetic frames (too dark, too flat, blue cast) so signs and rough magnitudes are sane.

## GPU apply

### Shader

Port CapCut `colorCorrection.frag` apply order and helpers (`adjustShadow`, `adjustHighlight`, `enchanceContrast`, temperature-tint mat3, saturation luminance weights).

### Integration preference

1. **Preferred:** inject correction as a **preamble** inside the existing color-grade material patch (before `applyFccColorGrade`), gated by `uColorCorrectionEnabled`, so no extra draw call.
2. **Fallback:** separate fullscreen pass only if injection proves too tangled.

When `enabled` is false or analysis is missing, uniforms short-circuit (zero cost beyond a branch).

### Per-frame work

- Resolve `intensity` at playhead (keyframes).
- Scale cached analysis → uniforms (CPU, tiny).
- Write uniforms; shader runs only if enabled.

No histogram work on the hot path.

## Interaction with existing color grade

- Correction does **not** write into `colorGrade.temperature` etc. Manual sliders stay user-owned.
- Visual stack: correction first, then manual Basic/HSL/Curves.
- Identity: both off → existing early-out (`uColorGradeEnabled` and correction disabled).

## Performance

| Stage | Budget |
|-------|--------|
| Analysis | ~1–5 ms on downscaled frame, async, once per enable |
| Per-frame apply | same order as current Basic grade ALU; no extra pass if injected |
| Multi-clip | per enabled clip: cached analysis + cheap uniforms |

## Testing

- Unit: intensity scale math vs CapCut Lua formulas (contrast sigmoid params, highlight/shadow polynomials, black/white slope/bias, saturation param).
- Unit: analyzer on synthetic ImageData (dark / flat / cast) → expected axis signs.
- Shader / material: enabled+identity analysis ≈ passthrough; intensity 0 ≈ passthrough; intensity ramp changes luma/sat measurably.
- Manual: enable on a dull clip → looks corrected; scrub intensity; keyframe intensity; undo enable; switch media invalidates analysis.

## Risks

| Risk | Mitigation |
|------|------------|
| Analyzer ≠ CapCut ML look | Document as approximation; tune heuristics; keep shader path faithful |
| Temperature-tint port incomplete | Port Lua mat helpers + `extraData` table with CapCut; golden-frame compare optional |
| Analysis stalls UI | Always async; never block compositor |

## Future (not v1)

- Smart Color Adjustment (local contrast / scene LUT + intensity mix)
- User-visible 9-axis breakdown / “bake to Basic sliders”
- Higher-quality ML analyzer if a portable model is adopted later
