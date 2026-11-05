import {
	packColorCorrectionUniforms,
	type ResolvedColorCorrection,
} from "@/color-correction";
import { COLOR_CORRECTION_SHADER_HELPERS } from "@/color-correction/shader-core";
import type { ColorGradeSettings } from "./settings";
import { isColorGradeCurvesIdentity, isColorGradeIdentity } from "./settings";
import { bakeCurveLut, LUT_SIZE } from "./curves";
import { COLOR_GRADE_SHADER_HELPERS } from "./shader-core";
import { packColorGradeUniforms } from "./uniforms";

type CorrectionBlitLocations = {
	enabled: WebGLUniformLocation | null;
	enableTemperatureTint: WebGLUniformLocation | null;
	enableHighlight: WebGLUniformLocation | null;
	enableShadow: WebGLUniformLocation | null;
	enableSaturation: WebGLUniformLocation | null;
	enableBrightness: WebGLUniformLocation | null;
	enableContrast: WebGLUniformLocation | null;
	enableBlackWhite: WebGLUniformLocation | null;
	temperatureTintRed: WebGLUniformLocation | null;
	temperatureTintGreen: WebGLUniformLocation | null;
	temperatureTintBlue: WebGLUniformLocation | null;
	saturationParam: WebGLUniformLocation | null;
	brightnessParam: WebGLUniformLocation | null;
	contrastParam: WebGLUniformLocation | null;
	contrastPivot: WebGLUniformLocation | null;
	contrastXFactor: WebGLUniformLocation | null;
	contrastLeftDiff: WebGLUniformLocation | null;
	contrastRightDiff: WebGLUniformLocation | null;
	contrastLeftSlopeDiff: WebGLUniformLocation | null;
	contrastRightSlopeDiff: WebGLUniformLocation | null;
	contrastPivotSlope: WebGLUniformLocation | null;
	highlightParam: WebGLUniformLocation | null;
	shadowParam: WebGLUniformLocation | null;
	blackWhiteSlope: WebGLUniformLocation | null;
	blackWhiteBias: WebGLUniformLocation | null;
};

type GradeBlitContext = {
	gl: WebGL2RenderingContext;
	program: WebGLProgram;
	vao: WebGLVertexArrayObject;
	srcTex: WebGLTexture;
	lutTex: WebGLTexture;
	locations: {
		enabled: WebGLUniformLocation | null;
		temp: WebGLUniformLocation | null;
		tint: WebGLUniformLocation | null;
		sat: WebGLUniformLocation | null;
		bright: WebGLUniformLocation | null;
		contrast: WebGLUniformLocation | null;
		exposure: WebGLUniformLocation | null;
		highlights: WebGLUniformLocation | null;
		shadows: WebGLUniformLocation | null;
		hslHue: WebGLUniformLocation | null;
		hslSat: WebGLUniformLocation | null;
		hslLuma: WebGLUniformLocation | null;
		lut: WebGLUniformLocation | null;
		lutEnabled: WebGLUniformLocation | null;
		src: WebGLUniformLocation | null;
	};
	correction: CorrectionBlitLocations;
};

let blitCtx: GradeBlitContext | null = null;
let blitCanvas: OffscreenCanvas | null = null;

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
	vUv = aPos * 0.5 + 0.5;
	gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
uniform sampler2D uSrc;
out vec4 outColor;

${COLOR_CORRECTION_SHADER_HELPERS}
${COLOR_GRADE_SHADER_HELPERS.replace(/texture2D/g, "texture")}

	// Match Three.js MeshBasic + SRGBColorSpace: correction then grade in linear,
	// store sRGB bytes for the OffscreenCanvas / CanvasTexture round-trip.
float fccSrgbToLinear(float c) {
	return c < 0.04045 ? c * 0.0773993808 : pow(c * 0.9478672986 + 0.0521327014, 2.4);
}
float fccLinearToSrgb(float c) {
	return c < 0.0031308 ? c * 12.92 : 1.055 * pow(c, 0.41666) - 0.055;
}
vec3 fccSrgbToLinear3(vec3 c) {
	return vec3(fccSrgbToLinear(c.r), fccSrgbToLinear(c.g), fccSrgbToLinear(c.b));
}
vec3 fccLinearToSrgb3(vec3 c) {
	return vec3(fccLinearToSrgb(c.r), fccLinearToSrgb(c.g), fccLinearToSrgb(c.b));
}

void main() {
	vec4 texel = texture(uSrc, vUv);
	// RGBA8 upload keeps encoded bytes; decode before grade (preview path is linear).
	vec3 linear = fccSrgbToLinear3(texel.rgb);
	vec3 corrected = applyFccColorCorrection(linear);
	vec3 graded = applyFccColorGrade(corrected);
	outColor = vec4(fccLinearToSrgb3(graded), texel.a);
}
`;

function compileShader(
	gl: WebGL2RenderingContext,
	type: number,
	src: string,
): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) throw new Error("color-grade: createShader failed");
	gl.shaderSource(shader, src);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const info = gl.getShaderInfoLog(shader) ?? "unknown";
		gl.deleteShader(shader);
		throw new Error(`color-grade shader: ${info}`);
	}
	return shader;
}

function ensureBlitContext(): GradeBlitContext | null {
	if (blitCtx) return blitCtx;
	try {
		const canvas = new OffscreenCanvas(4, 4);
		const gl = canvas.getContext("webgl2", {
			premultipliedAlpha: false,
			preserveDrawingBuffer: true,
			antialias: false,
		});
		if (!gl) return null;

		const vs = compileShader(gl, gl.VERTEX_SHADER, VERT);
		const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG);
		const program = gl.createProgram();
		if (!program) return null;
		gl.attachShader(program, vs);
		gl.attachShader(program, fs);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			return null;
		}

		const vao = gl.createVertexArray();
		const buf = gl.createBuffer();
		if (!vao || !buf) return null;
		gl.bindVertexArray(vao);
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
			gl.STATIC_DRAW,
		);
		const loc = gl.getAttribLocation(program, "aPos");
		gl.enableVertexAttribArray(loc);
		gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

		const srcTex = gl.createTexture();
		const lutTex = gl.createTexture();
		if (!srcTex || !lutTex) return null;

		// Identity LUT
		const identity = new Uint8Array(LUT_SIZE * 4);
		for (let row = 0; row < 4; row++) {
			for (let i = 0; i < LUT_SIZE; i++) {
				identity[row * LUT_SIZE + i] = Math.round((i / (LUT_SIZE - 1)) * 255);
			}
		}
		gl.bindTexture(gl.TEXTURE_2D, lutTex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.R8,
			LUT_SIZE,
			4,
			0,
			gl.RED,
			gl.UNSIGNED_BYTE,
			identity,
		);

		blitCanvas = canvas;
		blitCtx = {
			gl,
			program,
			vao,
			srcTex,
			lutTex,
			locations: {
				enabled: gl.getUniformLocation(program, "uColorGradeEnabled"),
				temp: gl.getUniformLocation(program, "uColorGradeTemp"),
				tint: gl.getUniformLocation(program, "uColorGradeTint"),
				sat: gl.getUniformLocation(program, "uColorGradeSat"),
				bright: gl.getUniformLocation(program, "uColorGradeBright"),
				contrast: gl.getUniformLocation(program, "uColorGradeContrast"),
				exposure: gl.getUniformLocation(program, "uColorGradeExposure"),
				highlights: gl.getUniformLocation(program, "uColorGradeHighlights"),
				shadows: gl.getUniformLocation(program, "uColorGradeShadows"),
				hslHue: gl.getUniformLocation(program, "uColorGradeHslHue"),
				hslSat: gl.getUniformLocation(program, "uColorGradeHslSat"),
				hslLuma: gl.getUniformLocation(program, "uColorGradeHslLuma"),
				lut: gl.getUniformLocation(program, "uColorGradeLut"),
				lutEnabled: gl.getUniformLocation(program, "uColorGradeLutEnabled"),
				src: gl.getUniformLocation(program, "uSrc"),
			},
			correction: readCorrectionLocations({ gl, program }),
		};
		return blitCtx;
	} catch (error) {
		console.warn("[color-grade] WebGL2 blit unavailable", error);
		return null;
	}
}

function readCorrectionLocations({
	gl,
	program,
}: {
	gl: WebGL2RenderingContext;
	program: WebGLProgram;
}): CorrectionBlitLocations {
	const loc = (name: string) => gl.getUniformLocation(program, name);
	return {
		enabled: loc("uColorCorrectionEnabled"),
		enableTemperatureTint: loc("uColorCorrectionEnableTemperatureTint"),
		enableHighlight: loc("uColorCorrectionEnableHighlight"),
		enableShadow: loc("uColorCorrectionEnableShadow"),
		enableSaturation: loc("uColorCorrectionEnableSaturation"),
		enableBrightness: loc("uColorCorrectionEnableBrightness"),
		enableContrast: loc("uColorCorrectionEnableContrast"),
		enableBlackWhite: loc("uColorCorrectionEnableBlackWhite"),
		temperatureTintRed: loc("uColorCorrectionTemperatureTintRed"),
		temperatureTintGreen: loc("uColorCorrectionTemperatureTintGreen"),
		temperatureTintBlue: loc("uColorCorrectionTemperatureTintBlue"),
		saturationParam: loc("uColorCorrectionSaturationParam"),
		brightnessParam: loc("uColorCorrectionBrightnessParam"),
		contrastParam: loc("uColorCorrectionContrastParam"),
		contrastPivot: loc("uColorCorrectionContrastPivot"),
		contrastXFactor: loc("uColorCorrectionContrastXFactor"),
		contrastLeftDiff: loc("uColorCorrectionContrastLeftDiff"),
		contrastRightDiff: loc("uColorCorrectionContrastRightDiff"),
		contrastLeftSlopeDiff: loc("uColorCorrectionContrastLeftSlopeDiff"),
		contrastRightSlopeDiff: loc("uColorCorrectionContrastRightSlopeDiff"),
		contrastPivotSlope: loc("uColorCorrectionContrastPivotSlope"),
		highlightParam: loc("uColorCorrectionHighlightParam"),
		shadowParam: loc("uColorCorrectionShadowParam"),
		blackWhiteSlope: loc("uColorCorrectionBlackWhiteSlope"),
		blackWhiteBias: loc("uColorCorrectionBlackWhiteBias"),
	};
}

function writeCorrectionUniforms({
	gl,
	locations,
	colorCorrection,
}: {
	gl: WebGL2RenderingContext;
	locations: CorrectionBlitLocations;
	colorCorrection: ResolvedColorCorrection | null;
}): void {
	if (!colorCorrection) {
		gl.uniform1f(locations.enabled, 0);
		return;
	}
	const packed = packColorCorrectionUniforms({
		analysis: colorCorrection.analysis,
		intensity: colorCorrection.intensity,
	});
	gl.uniform1f(locations.enabled, 1);
	gl.uniform1f(locations.enableTemperatureTint, packed.enableTemperatureTint);
	gl.uniform1f(locations.enableHighlight, packed.enableHighlight);
	gl.uniform1f(locations.enableShadow, packed.enableShadow);
	gl.uniform1f(locations.enableSaturation, packed.enableSaturation);
	gl.uniform1f(locations.enableBrightness, packed.enableBrightness);
	gl.uniform1f(locations.enableContrast, packed.enableContrast);
	gl.uniform1f(locations.enableBlackWhite, packed.enableBlackWhite);
	gl.uniform3f(
		locations.temperatureTintRed,
		packed.temperatureTintRed[0],
		packed.temperatureTintRed[1],
		packed.temperatureTintRed[2],
	);
	gl.uniform3f(
		locations.temperatureTintGreen,
		packed.temperatureTintGreen[0],
		packed.temperatureTintGreen[1],
		packed.temperatureTintGreen[2],
	);
	gl.uniform3f(
		locations.temperatureTintBlue,
		packed.temperatureTintBlue[0],
		packed.temperatureTintBlue[1],
		packed.temperatureTintBlue[2],
	);
	gl.uniform1f(locations.saturationParam, packed.saturationParam);
	gl.uniform1f(locations.brightnessParam, packed.brightnessParam);
	gl.uniform1f(locations.contrastParam, packed.contrastParam);
	gl.uniform1f(locations.contrastPivot, packed.contrastPivot);
	gl.uniform1f(locations.contrastXFactor, packed.contrastXFactor);
	gl.uniform1f(locations.contrastLeftDiff, packed.contrastLeftDiff);
	gl.uniform1f(locations.contrastRightDiff, packed.contrastRightDiff);
	gl.uniform1f(locations.contrastLeftSlopeDiff, packed.contrastLeftSlopeDiff);
	gl.uniform1f(locations.contrastRightSlopeDiff, packed.contrastRightSlopeDiff);
	gl.uniform1f(locations.contrastPivotSlope, packed.contrastPivotSlope);
	gl.uniform1f(locations.highlightParam, packed.highlightParam);
	gl.uniform1f(locations.shadowParam, packed.shadowParam);
	gl.uniform1f(locations.blackWhiteSlope, packed.blackWhiteSlope);
	gl.uniform1f(locations.blackWhiteBias, packed.blackWhiteBias);
}

/**
 * Apply color correction (when active) then full color grade to an image source.
 * Returns the original source unchanged when both are inactive or GPU is unavailable.
 *
 * The result is the shared canvas itself (no GPU→CPU readback):
 * it is only valid until the next call, so draw it before calling again.
 */
export function applyColorGradeToImageSource({
	source,
	width,
	height,
	grade,
	colorCorrection = null,
}: {
	source: CanvasImageSource;
	width: number;
	height: number;
	grade: ColorGradeSettings;
	colorCorrection?: ResolvedColorCorrection | null;
}): { source: CanvasImageSource; width: number; height: number } {
	const gradeActive = !isColorGradeIdentity({ grade });
	if (!gradeActive && !colorCorrection) {
		return { source, width, height };
	}

	const ctx = ensureBlitContext();
	if (!ctx || !blitCanvas) {
		return { source, width, height };
	}

	const { gl, program, vao, srcTex, lutTex, locations, correction } = ctx;
	const w = Math.max(1, Math.round(width));
	const h = Math.max(1, Math.round(height));
	if (blitCanvas.width !== w || blitCanvas.height !== h) {
		blitCanvas.width = w;
		blitCanvas.height = h;
	}

	gl.bindTexture(gl.TEXTURE_2D, srcTex);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);

	const lutEnabled = !isColorGradeCurvesIdentity({ curves: grade.curves });
	if (lutEnabled) {
		const lut = bakeCurveLut(grade.curves);
		gl.bindTexture(gl.TEXTURE_2D, lutTex);
		gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.R8,
			LUT_SIZE,
			4,
			0,
			gl.RED,
			gl.UNSIGNED_BYTE,
			lut,
		);
	}

	// Draw straight into the canvas: its default framebuffer is already
	// display-oriented, so callers can drawImage it without a flip.
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);

	const packed = packColorGradeUniforms({ grade });
	gl.viewport(0, 0, w, h);
	gl.useProgram(program);
	gl.bindVertexArray(vao);

	gl.uniform1f(locations.enabled, gradeActive ? 1 : 0);
	gl.uniform1f(locations.temp, packed.temp);
	gl.uniform1f(locations.tint, packed.tint);
	gl.uniform1f(locations.sat, packed.sat);
	gl.uniform1f(locations.bright, packed.bright);
	gl.uniform1f(locations.contrast, packed.contrast);
	gl.uniform1f(locations.exposure, packed.exposure);
	gl.uniform1f(locations.highlights, packed.highlights);
	gl.uniform1f(locations.shadows, packed.shadows);
	gl.uniform1f(locations.hslHue, packed.hslHue);
	gl.uniform1f(locations.hslSat, packed.hslSat);
	gl.uniform1f(locations.hslLuma, packed.hslLuma);
	gl.uniform1f(locations.lutEnabled, gradeActive && lutEnabled ? 1 : 0);
	writeCorrectionUniforms({
		gl,
		locations: correction,
		colorCorrection,
	});

	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, srcTex);
	gl.uniform1i(locations.src, 0);
	gl.activeTexture(gl.TEXTURE1);
	gl.bindTexture(gl.TEXTURE_2D, lutTex);
	gl.uniform1i(locations.lut, 1);

	gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

	return { source: blitCanvas, width: w, height: h };
}
