/**
 * Face FX GPU shaders — warp2d + eyeRay + procedural rabbit-ear overlay.
 * UV space matches beauty/compositor (flipY=false layer textures).
 */

export const FACE_FX_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Max faces processed in one warp / ray / ear pass. */
export const FACE_FX_GPU_MAX_FACES = 4;

/**
 * Warp2d: inverse-map UV using the same math as `sampleFaceWarpUv`.
 * uFaces[i] = (centerU, centerV, radius, strength)
 * uPreset: 0=bulge 1=pinch 2=stretchY 3=wave
 */
export const FACE_FX_WARP_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
uniform sampler2D tInput;
uniform int uFaceCount;
uniform int uPreset;
uniform float uTime;
uniform vec4 uFaces[${FACE_FX_GPU_MAX_FACES}];
varying vec2 vUv;

float falloff(float dist, float radius) {
	if (radius <= 1e-6) return 0.0;
	float t = clamp(dist / radius, 0.0, 1.0);
	float s = 1.0 - t;
	return s * s * (3.0 - 2.0 * s);
}

vec2 warpOne(vec2 uv, vec4 face) {
	vec2 c = face.xy;
	float radius = face.z;
	float strength = clamp(face.w, 0.0, 2.0);
	if (strength <= 1e-6) return uv;
	vec2 d = uv - c;
	float dist = length(d);
	float w = falloff(dist, radius);
	if (w <= 1e-6) return uv;
	float amp = strength * w;
	if (uPreset == 1) {
		float scale = max(0.15, 1.0 - amp * 0.35);
		return c + d / scale;
	}
	if (uPreset == 2) {
		float scaleY = max(0.2, 1.0 - amp * 0.4);
		return vec2(uv.x, c.y + d.y / scaleY);
	}
	if (uPreset == 3) {
		float phase = dist * 18.0 - uTime * 6.0;
		float ripple = sin(phase) * amp * 0.04;
		float ang = atan(d.y, d.x);
		return uv + vec2(cos(ang), sin(ang)) * ripple;
	}
	// bulge
	float push = 1.0 + amp * 0.45;
	return c + d / push;
}

void main() {
	vec2 uv = vUv;
	for (int i = 0; i < ${FACE_FX_GPU_MAX_FACES}; i++) {
		if (i >= uFaceCount) break;
		uv = warpOne(uv, uFaces[i]);
	}
	gl_FragColor = texture2D(tInput, clamp(uv, 0.0, 1.0));
}
`;

/**
 * Eye laser: soft beams from each eye along face-forward (down-image ≈ +Y in UV
 * when looking "out" from the face toward camera is tricky — use outward from
 * nose bridge through each eye, then continue past the eye).
 * uRays[i] = (ox, oy, dx, dy) normalized dir in UV; length/width via uniforms.
 */
export const FACE_FX_RAY_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
uniform sampler2D tInput;
uniform int uRayCount;
uniform vec4 uRays[${FACE_FX_GPU_MAX_FACES * 2}];
uniform vec3 uColor;
uniform float uLength;
uniform float uWidth;
varying vec2 vUv;

float beam(vec2 p, vec2 o, vec2 dir, float len, float width) {
	vec2 d = normalize(dir);
	vec2 v = p - o;
	float along = dot(v, d);
	if (along < 0.0 || along > len) return 0.0;
	float across = length(v - d * along);
	float core = 1.0 - smoothstep(0.0, width, across);
	float tip = 1.0 - smoothstep(len * 0.7, len, along);
	return core * tip;
}

void main() {
	vec4 base = texture2D(tInput, vUv);
	float glow = 0.0;
	for (int i = 0; i < ${FACE_FX_GPU_MAX_FACES * 2}; i++) {
		if (i >= uRayCount) break;
		vec4 r = uRays[i];
		glow += beam(vUv, r.xy, r.zw, uLength, uWidth);
	}
	glow = clamp(glow, 0.0, 1.0);
	vec3 rgb = base.rgb + uColor * glow;
	gl_FragColor = vec4(rgb, base.a);
}
`;

/**
 * Procedural rabbit ears: two teardrop quads above forehead.
 * uEars[i] = (cx, cy, faceW, faceH) — ear pair anchored at forehead.
 */
export const FACE_FX_EARS_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
uniform sampler2D tInput;
uniform int uEarCount;
uniform vec4 uEars[${FACE_FX_GPU_MAX_FACES}];
uniform vec3 uEarColor;
varying vec2 vUv;

float earMask(vec2 uv, vec2 tip, vec2 base, float halfW) {
	vec2 axis = tip - base;
	float len = length(axis);
	if (len < 1e-5) return 0.0;
	vec2 n = axis / len;
	vec2 t = vec2(-n.y, n.x);
	vec2 v = uv - base;
	float along = dot(v, n);
	float across = abs(dot(v, t));
	if (along < 0.0 || along > len) return 0.0;
	float taper = mix(halfW, halfW * 0.15, along / len);
	float edge = 1.0 - smoothstep(taper * 0.7, taper, across);
	float tipFade = 1.0 - smoothstep(len * 0.85, len, along);
	return edge * tipFade;
}

void main() {
	vec4 base = texture2D(tInput, vUv);
	float m = 0.0;
	for (int i = 0; i < ${FACE_FX_GPU_MAX_FACES}; i++) {
		if (i >= uEarCount) break;
		vec4 e = uEars[i];
		vec2 forehead = e.xy;
		float fw = e.z;
		float fh = e.w;
		vec2 leftBase = forehead + vec2(-fw * 0.22, -fh * 0.02);
		vec2 rightBase = forehead + vec2(fw * 0.22, -fh * 0.02);
		vec2 leftTip = leftBase + vec2(-fw * 0.12, -fh * 0.55);
		vec2 rightTip = rightBase + vec2(fw * 0.12, -fh * 0.55);
		float halfW = fw * 0.14;
		m = max(m, earMask(vUv, leftTip, leftBase, halfW));
		m = max(m, earMask(vUv, rightTip, rightBase, halfW));
	}
	vec3 rgb = mix(base.rgb, uEarColor, clamp(m, 0.0, 1.0));
	gl_FragColor = vec4(rgb, base.a);
}
`;

export function faceFxWarpPresetId(
	preset: string,
): 0 | 1 | 2 | 3 {
	switch (preset) {
		case "pinch":
			return 1;
		case "stretchY":
			return 2;
		case "wave":
			return 3;
		default:
			return 0;
	}
}
