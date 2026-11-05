import {
	IDENTITY_ANALYSIS,
	type ColorCorrectionAnalysis,
} from "./math";

/** CapCut post-scale factors (SeekModeScript). */
const S1 = 1.2;
const S2 = 0.4;

/** Skip pixels with alpha below this (0–255). */
const AlphaSkip = 8;

/** Target mean Rec.709 luma (0–1) for brightness heuristic. */
const LumaMeanTarget = 0.48;

/** Desired p95−p5 luma span for contrast heuristic. */
const ContrastTargetRange = 0.55;

/** Luma anchors for black / white point heuristics. */
const BlackAnchor = 0.02;
const WhiteAnchor = 0.98;

/** Target mean chroma (0–1) for saturation heuristic. */
const SatTarget = 0.18;

/** Expected fraction of pixels in lower / upper quartile bands. */
const QuartileMassTarget = 0.25;

/** Clamp white-balance raw axes before s1. */
const TempTintClamp = 0.5;

const Rec709R = 0.2126;
const Rec709G = 0.7152;
const Rec709B = 0.0722;

function clamp(v: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, v));
}

function rec709Luma(r: number, g: number, b: number): number {
	return (Rec709R * r + Rec709G * g + Rec709B * b) / 255;
}

function percentileFromHist(
	hist: Uint32Array,
	total: number,
	p: number,
): number {
	if (total <= 0) return 0;
	const target = total * p;
	let acc = 0;
	for (let i = 0; i < hist.length; i++) {
		acc += hist[i]!;
		if (acc >= target) return i / 255;
	}
	return 1;
}

function applyAxisScale(
	raw: ColorCorrectionAnalysis,
): ColorCorrectionAnalysis {
	return {
		brightness: clamp(raw.brightness * S1, -1, 1),
		contrast: clamp(raw.contrast * S1, -1, 1),
		highlight: clamp(raw.highlight * S1, -1, 1),
		shadow: clamp(raw.shadow * S1, -1, 1),
		saturation: clamp(raw.saturation * S2, -1, 1),
		tint: clamp(raw.tint * S1, -1, 1),
		temperature: clamp(raw.temperature * S1, -1, 1),
		white: clamp(raw.white * S1, -1, 1),
		black: clamp(raw.black * S1, -1, 1),
	};
}

export function analyzeColorCorrection({
	imageData,
}: {
	imageData: ImageData;
}): ColorCorrectionAnalysis {
	const { data, width, height } = imageData;
	const hist = new Uint32Array(256);
	let count = 0;
	let sumY = 0;
	let sumChroma = 0;
	let sumR = 0;
	let sumG = 0;
	let sumB = 0;
	let lowerMassCount = 0;
	let upperMassCount = 0;

	for (let i = 0; i < width * height; i++) {
		const o = i * 4;
		const a = data[o + 3]!;
		if (a < AlphaSkip) continue;

		const r = data[o]!;
		const g = data[o + 1]!;
		const b = data[o + 2]!;
		const y = rec709Luma(r, g, b);
		const bin = Math.min(255, Math.floor(y * 255));
		hist[bin]!++;

		count++;
		sumY += y;
		sumR += r;
		sumG += g;
		sumB += b;

		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		sumChroma += (max - min) / 255;

		if (y < 0.25) lowerMassCount++;
		if (y > 0.75) upperMassCount++;
	}

	if (count === 0) return { ...IDENTITY_ANALYSIS };

	const meanY = sumY / count;
	const meanChroma = sumChroma / count;
	const p5 = percentileFromHist(hist, count, 0.05);
	const p95 = percentileFromHist(hist, count, 0.95);
	const lowerMass = lowerMassCount / count;
	const upperMass = upperMassCount / count;

	const meanRn = sumR / count / 255;
	const meanGn = sumG / count / 255;
	const meanBn = sumB / count / 255;

	const raw: ColorCorrectionAnalysis = {
		brightness: clamp((LumaMeanTarget - meanY) / 0.35, -1, 1),
		contrast: clamp((ContrastTargetRange - (p95 - p5)) / ContrastTargetRange, -1, 1),
		highlight: clamp((QuartileMassTarget - upperMass) / 0.25, -1, 1),
		shadow: clamp((QuartileMassTarget - lowerMass) / 0.25, -1, 1),
		saturation: clamp((SatTarget - meanChroma) / SatTarget, -1, 1),
		tint: clamp(
			-(meanGn - (meanRn + meanBn) / 2) / 0.15,
			-TempTintClamp,
			TempTintClamp,
		),
		temperature: clamp(
			-(meanRn - meanBn) / 0.35,
			-TempTintClamp,
			TempTintClamp,
		),
		white: clamp((WhiteAnchor - p95) / 0.25, -1, 1),
		black: clamp((p5 - BlackAnchor) / 0.25, -1, 1),
	};

	return applyAxisScale(raw);
}
