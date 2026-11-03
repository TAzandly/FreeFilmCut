/**
 * Shared GLSL body for Basic + global HSL + curve LUT.
 * Used by the layer material patch and the transition OffscreenCanvas blit.
 */

export const COLOR_GRADE_SHADER_HELPERS = /* glsl */ `
#ifndef FCC_COLOR_GRADE_HELPERS
#define FCC_COLOR_GRADE_HELPERS

uniform float uColorGradeEnabled;
uniform float uColorGradeTemp;
uniform float uColorGradeTint;
uniform float uColorGradeSat;
uniform float uColorGradeBright;
uniform float uColorGradeContrast;
uniform float uColorGradeExposure;
uniform float uColorGradeHighlights;
uniform float uColorGradeShadows;

uniform float uColorGradeHslHue;
uniform float uColorGradeHslSat;
uniform float uColorGradeHslLuma;

uniform sampler2D uColorGradeLut;
uniform float uColorGradeLutEnabled;

vec3 fccRgbToHsl(vec3 c) {
	float maxc = max(c.r, max(c.g, c.b));
	float minc = min(c.r, min(c.g, c.b));
	float l = (maxc + minc) * 0.5;
	float d = maxc - minc;
	if (d < 1e-5) {
		return vec3(0.0, 0.0, l);
	}
	float s = l > 0.5 ? d / (2.0 - maxc - minc) : d / (maxc + minc);
	float h;
	if (maxc == c.r) {
		h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
	} else if (maxc == c.g) {
		h = (c.b - c.r) / d + 2.0;
	} else {
		h = (c.r - c.g) / d + 4.0;
	}
	h /= 6.0;
	return vec3(h, s, l);
}

float fccHue2rgb(float p, float q, float t) {
	if (t < 0.0) t += 1.0;
	if (t > 1.0) t -= 1.0;
	if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
	if (t < 0.5) return q;
	if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
	return p;
}

vec3 fccHslToRgb(vec3 hsl) {
	float h = hsl.x;
	float s = hsl.y;
	float l = hsl.z;
	if (s < 1e-5) {
		return vec3(l);
	}
	float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
	float p = 2.0 * l - q;
	return vec3(
		fccHue2rgb(p, q, h + 1.0 / 3.0),
		fccHue2rgb(p, q, h),
		fccHue2rgb(p, q, h - 1.0 / 3.0)
	);
}

float fccSampleLutRow(float v, float row) {
	return texture2D(uColorGradeLut, vec2(clamp(v, 0.0, 1.0), (row + 0.5) / 4.0)).r;
}

vec3 applyFccColorGrade(vec3 linearRgb) {
	if (uColorGradeEnabled < 0.5) {
		return linearRgb;
	}
	vec3 c = max(linearRgb, vec3(0.0));

	// --- Basic ---
	c.r *= 1.0 + uColorGradeTemp * 0.18;
	c.b *= 1.0 - uColorGradeTemp * 0.18;
	c.g *= 1.0 + uColorGradeTint * 0.16;
	c.r *= 1.0 - uColorGradeTint * 0.08;
	c.b *= 1.0 - uColorGradeTint * 0.08;

	c *= exp2(uColorGradeExposure);
	c += uColorGradeBright;
	c = (c - vec3(0.5)) * uColorGradeContrast + vec3(0.5);

	float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
	c = mix(vec3(luma), c, uColorGradeSat);

	float hi = smoothstep(0.35, 1.0, luma);
	float sh = 1.0 - smoothstep(0.0, 0.45, luma);
	c += vec3(hi * uColorGradeHighlights + sh * uColorGradeShadows);
	c = max(c, vec3(0.0));

	// --- Global HSL ---
	vec3 hsl = fccRgbToHsl(clamp(c, 0.0, 1.0));
	hsl.x = fract(hsl.x + uColorGradeHslHue * 0.5);
	hsl.y = clamp(hsl.y * (1.0 + uColorGradeHslSat), 0.0, 1.0);
	hsl.z = clamp(hsl.z + uColorGradeHslLuma * 0.5, 0.0, 1.0);
	c = fccHslToRgb(hsl);

	// --- Curves LUT (master then per-channel) ---
	if (uColorGradeLutEnabled > 0.5) {
		float mR = fccSampleLutRow(c.r, 0.0);
		float mG = fccSampleLutRow(c.g, 0.0);
		float mB = fccSampleLutRow(c.b, 0.0);
		c.r = fccSampleLutRow(mR, 1.0);
		c.g = fccSampleLutRow(mG, 2.0);
		c.b = fccSampleLutRow(mB, 3.0);
	}

	return max(c, vec3(0.0));
}

#endif
`;
