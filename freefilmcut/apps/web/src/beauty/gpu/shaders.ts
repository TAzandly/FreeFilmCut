import { MAX_BEAUTY_FACES, WARP_SLOT, WARP_VEC4_PER_FACE } from "./warp-points";

/**
 * GLSL for the beauty pass (warp -> smooth -> whiten). Each pass is a
 * full-screen quad that reads `tInput` and writes one RT; `beauty-pass.ts`
 * ping-pongs them.
 *
 * Conventions shared by all passes:
 * - `vUv` is image UV with the same meaning as the layer texture (landmarks
 *   and the skin mask are normalized image coords, y down = `v` up from 0).
 * - `tInput` returns *linear* RGB (the layer texture is sRGB-decoded in
 *   hardware; ping-pong RTs are linear half-float). Smooth/whiten convert to
 *   an approximate display gamma internally so strengths behave like paint
 *   adjustments rather than light-space math.
 * - Alpha is passed through untouched.
 */

export const BEAUTY_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const WARP_FACES = MAX_BEAUTY_FACES;
const WARP_STRIDE = WARP_VEC4_PER_FACE;

/** Max displacement strengths at slider = 1 (see `warp-points.ts` for geometry). */
export const WARP_EYE_MAX = 0.5;
export const WARP_FACE_SLIM_MAX = 0.25;
export const WARP_NOSE_SLIM_MAX = 0.3;

/**
 * Warp: inverse-mapped UV displacement per face (up to MAX_BEAUTY_FACES).
 * - Eye enlarge: radial bulge `p' = c + (p - c) * (1 - a * (1 - (d/r)^2)^2)`.
 * - Face / nose slim: Gu local-translation warp, dragging each control point
 *   toward the facial axis by `strength * |t - s|`.
 * Positions live in aspect space (`x * aspect`) so radii are circular.
 */
export const BEAUTY_WARP_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tInput;
uniform float uAspect;
uniform int uFaceCount;
uniform float uEye;
uniform float uFaceSlim;
uniform float uNoseSlim;
uniform vec4 uWarp[${WARP_FACES * WARP_STRIDE}];
varying vec2 vUv;

vec2 eyeBulge(vec2 p, vec4 eye, float a) {
	float r = eye.z;
	if (r <= 0.0) return p;
	vec2 d = p - eye.xy;
	float q = dot(d, d) / (r * r);
	if (q >= 1.0) return p;
	float f = 1.0 - a * (1.0 - q) * (1.0 - q);
	return eye.xy + d * f;
}

vec2 dragPoint(vec2 p, vec4 st, float amount, float r) {
	vec2 m = (st.zw - st.xy) * amount;
	float mm = dot(m, m);
	if (mm < 1e-12 || r <= 0.0) return p;
	vec2 d = p - st.xy;
	float r2 = r * r;
	float dd = dot(d, d);
	if (dd >= r2) return p;
	float k = (r2 - dd) / ((r2 - dd) + mm);
	return p - k * k * m;
}

void main() {
	vec2 aspect = vec2(uAspect, 1.0);
	vec2 p = vUv * aspect;
	float eyeA = uEye * ${WARP_EYE_MAX.toFixed(3)};
	float slimA = uFaceSlim * ${WARP_FACE_SLIM_MAX.toFixed(3)};
	float noseA = uNoseSlim * ${WARP_NOSE_SLIM_MAX.toFixed(3)};
	for (int f = 0; f < ${WARP_FACES}; f++) {
		if (f >= uFaceCount) break;
		int b = f * ${WARP_STRIDE};
		vec4 radii = uWarp[b + ${WARP_SLOT.radii}];
		if (eyeA > 0.0) {
			p = eyeBulge(p, uWarp[b + ${WARP_SLOT.eyeLeft}], eyeA);
			p = eyeBulge(p, uWarp[b + ${WARP_SLOT.eyeRight}], eyeA);
		}
		if (slimA > 0.0) {
			for (int i = 0; i < 3; i++) {
				p = dragPoint(p, uWarp[b + ${WARP_SLOT.jawLeft} + i], slimA, radii.x);
				p = dragPoint(p, uWarp[b + ${WARP_SLOT.jawRight} + i], slimA, radii.x);
			}
		}
		if (noseA > 0.0) {
			p = dragPoint(p, uWarp[b + ${WARP_SLOT.noseLeft}], noseA, radii.y);
			p = dragPoint(p, uWarp[b + ${WARP_SLOT.noseRight}], noseA, radii.y);
		}
	}
	vec2 uv = clamp(p / aspect, vec2(0.0), vec2(1.0));
	gl_FragColor = texture2D(tInput, uv);
}
`;

const GAMMA_HELPERS = /* glsl */ `
vec3 toGamma(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }
vec3 toLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
`;

/**
 * Smooth: 16-tap golden-angle disc bilateral filter (spatial gaussian x range
 * weight, evaluated in display gamma), mixed in by `uSkinMask * uSmooth`.
 * Radius scales with image height so the look matches across resolutions.
 */
export const BEAUTY_SMOOTH_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tInput;
uniform sampler2D uSkinMask;
uniform vec2 uSize;
uniform float uSmooth;
varying vec2 vUv;
${GAMMA_HELPERS}
void main() {
	vec4 src = texture2D(tInput, vUv);
	float m = texture2D(uSkinMask, vUv).r * uSmooth;
	if (m <= 0.001) {
		gl_FragColor = src;
		return;
	}
	vec3 center = toGamma(src.rgb);
	float resScale = clamp(uSize.y / 720.0, 0.5, 3.0);
	float radiusPx = mix(1.5, 8.0, uSmooth) * resScale;
	vec2 texel = 1.0 / uSize;
	float sigmaR = 0.1;
	vec3 sum = center;
	float wsum = 1.0;
	for (int i = 0; i < 16; i++) {
		float fi = float(i);
		float rr = sqrt((fi + 0.5) / 16.0);
		float ang = fi * 2.39996323;
		vec2 off = vec2(cos(ang), sin(ang)) * rr;
		vec3 s = toGamma(texture2D(tInput, vUv + off * radiusPx * texel).rgb);
		vec3 dc = s - center;
		float range = exp(-dot(dc, dc) / (2.0 * sigmaR * sigmaR));
		float spatial = exp(-rr * rr * 1.5);
		float w = range * spatial;
		sum += s * w;
		wsum += w;
	}
	vec3 smoothed = sum / wsum;
	vec3 outRgb = toLinear(mix(center, smoothed, m));
	gl_FragColor = vec4(outRgb, src.a);
}
`;

/**
 * Whiten: gamma-lift luma and slightly desaturate, mixed in by
 * `uSkinMask * uWhiten`.
 */
export const BEAUTY_WHITEN_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tInput;
uniform sampler2D uSkinMask;
uniform float uWhiten;
varying vec2 vUv;
${GAMMA_HELPERS}
void main() {
	vec4 src = texture2D(tInput, vUv);
	float m = texture2D(uSkinMask, vUv).r * uWhiten;
	if (m <= 0.001) {
		gl_FragColor = src;
		return;
	}
	vec3 g = toGamma(src.rgb);
	vec3 lifted = pow(g, vec3(0.55));
	float l = dot(lifted, vec3(0.2126, 0.7152, 0.0722));
	lifted = mix(lifted, vec3(l), 0.18);
	gl_FragColor = vec4(toLinear(mix(g, lifted, m)), src.a);
}
`;
