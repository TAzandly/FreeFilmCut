import type { ColorGradeSettings } from "./settings";
import { isColorGradeCurvesIdentity, isColorGradeIdentity } from "./settings";
import { bakeCurveLut, LUT_SIZE } from "./curves";
import { COLOR_GRADE_SHADER_HELPERS } from "./shader-core";
import { packColorGradeUniforms } from "./uniforms";

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

${COLOR_GRADE_SHADER_HELPERS.replace(/texture2D/g, "texture")}

// Match Three.js MeshBasic + SRGBColorSpace: grade in linear, store sRGB bytes
// for the OffscreenCanvas / CanvasTexture round-trip.
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
	vec3 graded = applyFccColorGrade(linear);
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
		};
		return blitCtx;
	} catch (error) {
		console.warn("[color-grade] WebGL2 blit unavailable", error);
		return null;
	}
}

/**
 * Apply full color grade to an image source.
 * Returns the original source unchanged when grade is identity or GPU unavailable.
 *
 * The graded result is the shared grade canvas itself (no GPU→CPU readback):
 * it is only valid until the next call, so draw it before grading again.
 */
export function applyColorGradeToImageSource({
	source,
	width,
	height,
	grade,
}: {
	source: CanvasImageSource;
	width: number;
	height: number;
	grade: ColorGradeSettings;
}): { source: CanvasImageSource; width: number; height: number } {
	if (isColorGradeIdentity({ grade })) {
		return { source, width, height };
	}

	const ctx = ensureBlitContext();
	if (!ctx || !blitCanvas) {
		return { source, width, height };
	}

	const { gl, program, vao, srcTex, lutTex, locations } = ctx;
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

	gl.uniform1f(locations.enabled, 1);
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
	gl.uniform1f(locations.lutEnabled, lutEnabled ? 1 : 0);

	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, srcTex);
	gl.uniform1i(locations.src, 0);
	gl.activeTexture(gl.TEXTURE1);
	gl.bindTexture(gl.TEXTURE_2D, lutTex);
	gl.uniform1i(locations.lut, 1);

	gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

	return { source: blitCanvas, width: w, height: h };
}
