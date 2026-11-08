/**
 * CapCut color-correction GLSL, applied before the layer color grade.
 * Uniforms use the uColorCorrection* prefix (packed by packColorCorrectionUniforms).
 */

export const COLOR_CORRECTION_SHADER_HELPERS = /* glsl */ `
#ifndef FCC_COLOR_CORRECTION_HELPERS
#define FCC_COLOR_CORRECTION_HELPERS

uniform float uColorCorrectionEnabled;
uniform float uColorCorrectionEnableTemperatureTint;
uniform float uColorCorrectionEnableHighlight;
uniform float uColorCorrectionEnableShadow;
uniform float uColorCorrectionEnableSaturation;
uniform float uColorCorrectionEnableBrightness;
uniform float uColorCorrectionEnableContrast;
uniform float uColorCorrectionEnableBlackWhite;
uniform float uColorCorrectionEnableMidtoneLift;
uniform float uColorCorrectionMidtoneLiftAmount;

uniform vec3 uColorCorrectionTemperatureTintRed;
uniform vec3 uColorCorrectionTemperatureTintGreen;
uniform vec3 uColorCorrectionTemperatureTintBlue;
uniform float uColorCorrectionSaturationParam;
uniform float uColorCorrectionBrightnessParam;
uniform float uColorCorrectionContrastParam;
uniform float uColorCorrectionContrastPivot;
uniform float uColorCorrectionContrastXFactor;
uniform float uColorCorrectionContrastLeftDiff;
uniform float uColorCorrectionContrastRightDiff;
uniform float uColorCorrectionContrastLeftSlopeDiff;
uniform float uColorCorrectionContrastRightSlopeDiff;
uniform float uColorCorrectionContrastPivotSlope;
uniform float uColorCorrectionHighlightParam;
uniform float uColorCorrectionShadowParam;
uniform float uColorCorrectionBlackWhiteSlope;
uniform float uColorCorrectionBlackWhiteBias;

const vec3 SaturationLuminanceFactor = vec3(0.208540, 0.702086, 0.089374);

vec3 adjustShadow(vec3 color, float p) {
	vec3 color2 = color * color;
	vec3 color3 = color2 * color;
	vec3 resColor = pow(color, vec3(p)) + (p - 1.0) * (color2 - color3);
	return resColor;
}

vec3 adjustHighlight(vec3 color, float p) {
	vec3 t = 1.0 - color;
	vec3 t2 = t * t;
	vec3 t3 = t2 * t;
	vec3 resColor = 1.0 - pow(t, vec3(p)) - (p - 1.0) * (t2 - t3);
	return resColor;
}

float getContrastSigmoidValue(float x, float xFactor, float pivot) {
	float res = 1.0 / (1.0 + exp(-xFactor * (x - pivot))) + pivot - 0.5;
	return res;
}

float getContrastSigmoidDerivative(float x, float xFactor, float pivot) {
	float s = 1.0 / (1.0 + exp(-xFactor * (x - pivot)));
	float k = xFactor * s * (1.0 - s);
	return k;
}

float enchanceContrast(float x, float xFactor, float pivot) {
	float res = getContrastSigmoidValue(x, xFactor, pivot);
	float k = getContrastSigmoidDerivative(x, xFactor, pivot);
	if (x <= pivot) {
		float scale = (uColorCorrectionContrastPivotSlope - k) / uColorCorrectionContrastLeftSlopeDiff;
		scale = scale * scale;
		res = res + scale * uColorCorrectionContrastLeftDiff;
	} else {
		float scale = (uColorCorrectionContrastPivotSlope - k) / uColorCorrectionContrastRightSlopeDiff;
		scale = scale * scale;
		res = res + scale * uColorCorrectionContrastRightDiff;
	}
	return res;
}

vec3 applyFccColorCorrection(vec3 rgb) {
	if (uColorCorrectionEnabled < 0.5) {
		return rgb;
	}

	// contrast > highlight > shadow > black/white > brightness > temperature/tint > saturation
	vec3 color = rgb;

	if (uColorCorrectionEnableContrast > 0.5) {
		if (uColorCorrectionContrastParam <= 1.0) {
			color = uColorCorrectionContrastParam * (color - vec3(uColorCorrectionContrastPivot)) + vec3(uColorCorrectionContrastPivot);
		} else {
			color.r = enchanceContrast(color.r, uColorCorrectionContrastXFactor, uColorCorrectionContrastPivot);
			color.g = enchanceContrast(color.g, uColorCorrectionContrastXFactor, uColorCorrectionContrastPivot);
			color.b = enchanceContrast(color.b, uColorCorrectionContrastXFactor, uColorCorrectionContrastPivot);
		}
		color = clamp(color, 0.0, 1.0);
	}

	if (uColorCorrectionEnableHighlight > 0.5) {
		color = adjustHighlight(color, uColorCorrectionHighlightParam);
		color = clamp(color, 0.0, 1.0);
	}

	if (uColorCorrectionEnableShadow > 0.5) {
		color = adjustShadow(color, uColorCorrectionShadowParam);
		color = clamp(color, 0.0, 1.0);
	}

	if (uColorCorrectionEnableBlackWhite > 0.5) {
		color = uColorCorrectionBlackWhiteSlope * color + vec3(uColorCorrectionBlackWhiteBias);
		color = clamp(color, 0.0, 1.0);
	}

	if (uColorCorrectionEnableBrightness > 0.5) {
		float p = 0.0;
		if (uColorCorrectionBrightnessParam > 0.0) {
			p = 1.0 + uColorCorrectionBrightnessParam * 5.0;
		} else {
			p = 1.0 / (1.0 - uColorCorrectionBrightnessParam * 2.5);
			color -= vec3(-uColorCorrectionBrightnessParam * 0.01);
		}
		color = 1.0 - pow(1.0 - color, vec3(p));
		color = clamp(color, 0.0, 1.0);
	}

	if (uColorCorrectionEnableTemperatureTint > 0.5) {
		vec3 src = color;
		color.r = dot(src, uColorCorrectionTemperatureTintRed);
		color.g = dot(src, uColorCorrectionTemperatureTintGreen);
		color.b = dot(src, uColorCorrectionTemperatureTintBlue);
		color = clamp(color, 0.0, 1.0);
	}

	if (uColorCorrectionEnableSaturation > 0.5) {
		vec3 baseAdjustVec = SaturationLuminanceFactor * (1.0 - uColorCorrectionSaturationParam);

		vec3 adjustVec = baseAdjustVec + vec3(uColorCorrectionSaturationParam, 0.0, 0.0);
		color.r = dot(color, adjustVec);

		adjustVec = baseAdjustVec + vec3(0.0, uColorCorrectionSaturationParam, 0.0);
		color.g = dot(color, adjustVec);

		adjustVec = baseAdjustVec + vec3(0.0, 0.0, uColorCorrectionSaturationParam);
		color.b = dot(color, adjustVec);
		color = clamp(color, 0.0, 1.0);
	}

	// CapCut-style 亮度 curve: lift midtones, keep black/white pins.
	// amount 0..1 from Intensity; peak lift ≈ 0.28 at midtones when amount=1.
	if (uColorCorrectionEnableMidtoneLift > 0.5) {
		float a = uColorCorrectionMidtoneLiftAmount;
		color.r = clamp(color.r + a * 4.0 * color.r * (1.0 - color.r) * 0.28, 0.0, 1.0);
		color.g = clamp(color.g + a * 4.0 * color.g * (1.0 - color.g) * 0.28, 0.0, 1.0);
		color.b = clamp(color.b + a * 4.0 * color.b * (1.0 - color.b) * 0.28, 0.0, 1.0);
	}

	return clamp(color, 0.0, 1.0);
}

#endif
`;
