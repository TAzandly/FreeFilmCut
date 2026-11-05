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

const NormalizeScale = 50;
const MinIntensity = -1;
const MaxIntensity = 1;
const ContrastPivot = 0.435;
const Eps = 1e-5;
const baseTemperature = 6500;
const baseTint = 0;

const extraData = [
	0, 0.18006, 0.26352, -0.24341, 10, 0.18066, 0.26589, -0.25479, 20, 0.18133,
	0.26846, -0.26876, 30, 0.18208, 0.27119, -0.28539, 40, 0.18293, 0.27407,
	-0.3047, 50, 0.18388, 0.27709, -0.32675, 60, 0.18494, 0.28021, -0.35156, 70,
	0.18611, 0.28342, -0.37915, 80, 0.1874, 0.28668, -0.40955, 90, 0.1888, 0.28997,
	-0.44278, 100, 0.19032, 0.29326, -0.47888, 125, 0.19462, 0.30141, -0.58204,
	150, 0.19962, 0.30921, -0.70471, 175, 0.20525, 0.31647, -0.84901, 200,
	0.21142, 0.32312, -1.0182, 225, 0.21807, 0.32909, -1.2168, 250, 0.22511,
	0.33439, -1.4512, 275, 0.23247, 0.33904, -1.7298, 300, 0.2401, 0.34308,
	-2.0637, 325, 0.24792, 0.34655, -2.4681, 350, 0.25591, 0.34951, -2.9641,
	375, 0.264, 0.352, -3.5814, 400, 0.27218, 0.35407, -4.3633, 425, 0.28039,
	0.35577, -5.3762, 450, 0.28863, 0.35714, -6.7262, 475, 0.29685, 0.35823,
	-8.5955, 500, 0.30505, 0.35907, -11.324, 525, 0.3132, 0.35968, -15.628,
	550, 0.32129, 0.36011, -23.325, 575, 0.32931, 0.36038, -40.77, 600, 0.33724,
	0.36051, -116.45,
];

const A: [[number, number, number], [number, number, number], [number, number, number]] =
	[
		[0.8951, 0.2664, -0.1614],
		[-0.7502, 1.7135, 0.0367],
		[0.0389, -0.0685, 1.0296],
	];

const B: [[number, number, number], [number, number, number], [number, number, number]] =
	[
		[0.987, -0.1471, 0.16],
		[0.4323, 0.5184, 0.0493],
		[-0.0085, 0.04, 0.9685],
	];

const P: [[number, number, number], [number, number, number], [number, number, number]] =
	[
		[0.4123907992659595, 0.357584339383878, 0.1804807884018343],
		[0.21263900587151036, 0.715168678767756, 0.07219231536073371],
		[0.019330818715591832, 0.11919477979462598, 0.9505321522496607],
	];

const Q: [[number, number, number], [number, number, number], [number, number, number]] =
	[
		[3.2409699419045213, -1.5373831775700935, -0.4986107602930033],
		[-0.9692436362808796, 1.8759675015077208, 0.04155505740717562],
		[0.05563007969699364, -0.20397695888897655, 1.0569715142428784],
	];

const IDENTITY_MAT3: [
	[number, number, number],
	[number, number, number],
	[number, number, number],
] = [
	[1, 0, 0],
	[0, 1, 0],
	[0, 0, 1],
];

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function mix(x: number, y: number, a: number): number {
	return x * (1 - a) + y * a;
}

function boolToInt(flag: boolean): number {
	return flag ? 1 : 0;
}

type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];

function mat3xVec3(mat3: Mat3, vec3: Vec3): Vec3 {
	return [
		mat3[0][0] * vec3[0] + mat3[0][1] * vec3[1] + mat3[0][2] * vec3[2],
		mat3[1][0] * vec3[0] + mat3[1][1] * vec3[1] + mat3[1][2] * vec3[2],
		mat3[2][0] * vec3[0] + mat3[2][1] * vec3[1] + mat3[2][2] * vec3[2],
	];
}

function vec3xMat3(vec3: Vec3, mat3: Mat3): Vec3 {
	return [
		mat3[0][0] * vec3[0] + mat3[1][0] * vec3[1] + mat3[2][0] * vec3[2],
		mat3[0][1] * vec3[0] + mat3[1][1] * vec3[1] + mat3[2][1] * vec3[2],
		mat3[0][2] * vec3[0] + mat3[1][2] * vec3[1] + mat3[2][2] * vec3[2],
	];
}

function mat3xMat3(mat3_1: Mat3, mat3_2: Mat3): Mat3 {
	return [
		vec3xMat3(mat3_1[0], mat3_2),
		vec3xMat3(mat3_1[1], mat3_2),
		vec3xMat3(mat3_1[2], mat3_2),
	];
}

function diag(vec3: Vec3): Mat3 {
	return [
		[vec3[0], 0, 0],
		[0, vec3[1], 0],
		[0, 0, vec3[2]],
	];
}

/** CapCut: scale = 1/NormalizeScale/0.8 * sliderIntensity; NormalizeScale=50 */
export function intensityScale({ intensity }: { intensity: number }): number {
	const slider = Math.min(100, Math.max(0, intensity)) / 100;
	return (1 / NormalizeScale / 0.8) * slider;
}

function getTemperatureTintParam(
	temperatureIntensity: number,
	tintIntensity: number,
): [number, number] {
	const t = temperatureIntensity;
	const t2 = t * t;
	const t3 = t2 * t;
	const temperatureParam = 6500 - 1970 * t + 876 * t2 - 2630 * t3;
	const tintParam = tintIntensity * 100;
	return [temperatureParam, tintParam];
}

function computeTemperatureTintVec3(temperature: number, tint: number): Vec3 {
	const x = 1_000_000 / temperature;
	const y = tint * 0.0001;
	// Lua 1-based index 5 → 0-based index 4
	let index = 4;
	let data = extraData[index]!;
	index += 4;
	while (data <= x && index < extraData.length) {
		data = extraData[index]!;
		index += 4;
	}
	const factor =
		(data - x) / (data - extraData[index - 2 * 4]!);
	const temp_1: [number, number] = [
		mix(extraData[index - 3]!, extraData[index - 7]!, factor),
		mix(extraData[index - 2]!, extraData[index - 6]!, factor),
	];
	const a = extraData[index - 5]!;
	const b = extraData[index - 1]!;
	const sqA = Math.sqrt(a * a + 1);
	const sqB = Math.sqrt(b * b + 1);
	const temp_2: [number, number] = [
		mix(1 / sqB, 1 / sqA, factor),
		mix(b / sqB, a / sqA, factor),
	];
	const factor2 = Math.sqrt(temp_2[0] * temp_2[0] + temp_2[1] * temp_2[1]);
	temp_1[0] = (y * temp_2[0]) / factor2 + temp_1[0];
	temp_1[1] = (y * temp_2[1]) / factor2 + temp_1[1];
	const temp_2_scalar = -4 * temp_1[1] + temp_1[0] + 2;
	let aOut = (temp_1[0] * 1.5) / temp_2_scalar;
	let bOut = temp_1[1] / temp_2_scalar;
	aOut = clamp(aOut, 0.000001, 0.999999);
	bOut = clamp(bOut, 0.000001, 0.999999);
	if (aOut + bOut > 0.999999) {
		const t = 0.999999 / (aOut + bOut);
		aOut /= t;
		bOut /= t;
	}
	return [aOut / bOut, 1, (1 - aOut - bOut) / bOut];
}

function computeTemperatureTintMat3(vec3: Vec3, vec3Base: Vec3): Mat3 {
	let v = mat3xVec3(A, vec3);
	const vBase = mat3xVec3(A, vec3Base);
	const D = diag([
		v[0] / vBase[0],
		v[1] / vBase[1],
		v[2] / vBase[2],
	]);
	let param = mat3xMat3(D, A);
	param = mat3xMat3(B, param);
	param = mat3xMat3(param, P);
	param = mat3xMat3(Q, param);
	return param;
}

function getSaturationParam(intensity: number): number {
	return intensity + 1;
}

function getBrightnessParam(intensity: number): number {
	let param = intensity;
	if (intensity > 0 && intensity <= 0.7) {
		param = 0.3 * intensity;
	} else if (intensity > 0.7 && intensity <= 1) {
		param = 0.6333 * intensity - 0.2333;
	}
	return param;
}

function getContrastSigmoidXFactor(intensity: number): number {
	return Math.exp(8.33 * intensity - 12.16) + 5.82 * intensity - 1.72;
}

function getContrastSigmoidParam(
	x: number,
	intensity: number,
	pivot: number,
): [number, number] {
	const a = getContrastSigmoidXFactor(intensity);
	const s = 1 / (1 + Math.exp(-a * (x - pivot)));
	const y = s + pivot - 0.5;
	const k = a * s * (1 - s);
	return [y, k];
}

function getContrastParam(
	intensity: number,
	pivot: number,
): [
	number,
	number,
	number,
	number,
	number,
	number,
	number,
] {
	let param = 1;
	if (intensity <= 0) {
		param = intensity * 0.4 + 1;
	} else {
		param = intensity * 0.6 + 1;
	}

	const xFactor = getContrastSigmoidXFactor(param);
	const [leftValue, leftSlope] = getContrastSigmoidParam(0, param, pivot);
	const [rightValue, rightSlope] = getContrastSigmoidParam(1, param, pivot);
	const [, pivotSlope] = getContrastSigmoidParam(pivot, param, pivot);
	const leftDiff = 0 - leftValue;
	const rightDiff = 1 - rightValue;
	const leftSlopeDiff = pivotSlope - leftSlope;
	const rightSlopeDiff = pivotSlope - rightSlope;

	return [
		param,
		xFactor,
		leftDiff,
		rightDiff,
		leftSlopeDiff,
		rightSlopeDiff,
		pivotSlope,
	];
}

function getHighlightParam(intensity: number): number {
	const p = intensity;
	const p2 = p * p;
	const p3 = p2 * p;
	const p4 = p3 * p;
	return 1 + 0.503 * p + 0.183 * p2 + 0.147 * p3 + 0.067 * p4;
}

function getShadowParam(intensity: number): number {
	const p = intensity;
	const p2 = p * p;
	const p3 = p2 * p;
	const p4 = p3 * p;
	return 1 - 0.503 * p + 0.183 * p2 - 0.147 * p3 + 0.067 * p4;
}

function getBlackWhiteParam(
	blackIntensity: number,
	whiteIntensity: number,
): [number, number] {
	let xw = 1;
	let yw = 1;
	let xb = 0;
	let yb = 0;
	const MAX_RANGE = 0.5;
	const EPS_BW = 0.005;

	if (whiteIntensity >= 0) {
		xw = 1 - whiteIntensity * MAX_RANGE;
		yw = 1;
	} else {
		xw = 1;
		yw = 1 + whiteIntensity * MAX_RANGE;
	}

	if (blackIntensity >= 0) {
		xb = 0;
		yb = blackIntensity * MAX_RANGE;
	} else {
		xb = -blackIntensity * MAX_RANGE;
		yb = 0;
	}

	xw = Math.max(xw, EPS_BW);
	yw = Math.max(yw, EPS_BW);
	xb = Math.min(xb, xw - EPS_BW);
	yb = Math.min(yb, yw - EPS_BW);

	const slope = (yw - yb) / (xw - xb);
	const bias = yb - slope * xb;
	return [slope, bias];
}

function axisIntensity(
	analysisValue: number,
	scale: number,
): number {
	return clamp(analysisValue * scale, MinIntensity, MaxIntensity);
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
	const scale = intensityScale({ intensity });

	const temperatureIntensity = axisIntensity(analysis.temperature, scale);
	const tintIntensity = axisIntensity(analysis.tint, scale);
	const saturationIntensity = axisIntensity(analysis.saturation, scale);
	const brightnessIntensity = axisIntensity(analysis.brightness, scale);
	const contrastIntensity = axisIntensity(analysis.contrast, scale);
	const highlightIntensity = axisIntensity(analysis.highlight, scale);
	const shadowIntensity = axisIntensity(analysis.shadow, scale);
	const whiteIntensity = axisIntensity(analysis.white, scale);
	const blackIntensity = axisIntensity(analysis.black, scale);

	const enableTemperatureTint = boolToInt(
		Math.abs(temperatureIntensity) > Eps || Math.abs(tintIntensity) > Eps,
	);
	const enableSaturation = boolToInt(Math.abs(saturationIntensity) > Eps);
	const enableBrightness = boolToInt(Math.abs(brightnessIntensity) > Eps);
	const enableContrast = boolToInt(Math.abs(contrastIntensity) > Eps);
	const enableHighlight = boolToInt(Math.abs(highlightIntensity) > Eps);
	const enableShadow = boolToInt(Math.abs(shadowIntensity) > Eps);
	const enableBlackWhite = boolToInt(
		Math.abs(blackIntensity) > Eps || Math.abs(whiteIntensity) > Eps,
	);

	let ttParam = IDENTITY_MAT3;
	if (enableTemperatureTint === 1) {
		const [temperatureParam, tintParam] = getTemperatureTintParam(
			temperatureIntensity,
			tintIntensity,
		);
		const vec3 = computeTemperatureTintVec3(temperatureParam, tintParam);
		const vec3Base = computeTemperatureTintVec3(baseTemperature, baseTint);
		ttParam = computeTemperatureTintMat3(vec3, vec3Base);
	}

	let saturationParam = 1;
	if (enableSaturation === 1) {
		saturationParam = getSaturationParam(saturationIntensity);
	}

	let brightnessParam = 0;
	if (enableBrightness === 1) {
		brightnessParam = getBrightnessParam(brightnessIntensity);
	}

	let contrastParam = 1;
	let contrastXFactor = 1;
	let contrastLeftDiff = 0;
	let contrastRightDiff = 0;
	let contrastLeftSlopeDiff = 0;
	let contrastRightSlopeDiff = 0;
	let contrastPivotSlope = 1;
	if (enableContrast === 1) {
		[
			contrastParam,
			contrastXFactor,
			contrastLeftDiff,
			contrastRightDiff,
			contrastLeftSlopeDiff,
			contrastRightSlopeDiff,
			contrastPivotSlope,
		] = getContrastParam(contrastIntensity, ContrastPivot);
	}

	let highlightParam = 0;
	if (enableHighlight === 1) {
		highlightParam = getHighlightParam(highlightIntensity);
	}

	let shadowParam = 0;
	if (enableShadow === 1) {
		shadowParam = getShadowParam(shadowIntensity);
	}

	let blackWhiteSlope = 1;
	let blackWhiteBias = 0;
	if (enableBlackWhite === 1) {
		[blackWhiteSlope, blackWhiteBias] = getBlackWhiteParam(
			blackIntensity,
			whiteIntensity,
		);
	}

	return {
		enableTemperatureTint,
		enableSaturation,
		enableBrightness,
		enableContrast,
		enableHighlight,
		enableShadow,
		enableBlackWhite,
		temperatureTintRed: [...ttParam[0]],
		temperatureTintGreen: [...ttParam[1]],
		temperatureTintBlue: [...ttParam[2]],
		saturationParam,
		brightnessParam,
		contrastParam,
		contrastPivot: ContrastPivot,
		contrastXFactor,
		contrastLeftDiff,
		contrastRightDiff,
		contrastLeftSlopeDiff,
		contrastRightSlopeDiff,
		contrastPivotSlope,
		highlightParam,
		shadowParam,
		blackWhiteSlope,
		blackWhiteBias,
	};
}
