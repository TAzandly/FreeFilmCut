/**
 * Separable Gaussian blur for the R8 beauty skin mask.
 * Softens hard oval / segmentation edges so smooth/whiten don't leave a stamp.
 */

/** Default sigma in mask pixels (mask is typically 256²). */
export const SKIN_MASK_BLUR_SIGMA = 2.5;

function buildKernel(sigma: number): Float32Array {
	const radius = Math.max(1, Math.ceil(sigma * 2));
	const size = radius * 2 + 1;
	const kernel = new Float32Array(size);
	const inv = 1 / (2 * sigma * sigma);
	let sum = 0;
	for (let i = 0; i < size; i++) {
		const x = i - radius;
		const w = Math.exp(-x * x * inv);
		kernel[i] = w;
		sum += w;
	}
	for (let i = 0; i < size; i++) kernel[i] /= sum;
	return kernel;
}

function blurAxis(
	src: Uint8Array,
	dst: Uint8Array,
	width: number,
	height: number,
	kernel: Float32Array,
	horizontal: boolean,
): void {
	const radius = (kernel.length - 1) >> 1;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let acc = 0;
			for (let k = 0; k < kernel.length; k++) {
				const o = k - radius;
				const sx = horizontal ? Math.min(width - 1, Math.max(0, x + o)) : x;
				const sy = horizontal ? y : Math.min(height - 1, Math.max(0, y + o));
				acc += src[sy * width + sx] * kernel[k];
			}
			dst[y * width + x] = acc + 0.5;
		}
	}
}

/**
 * Return a new soft mask. `sigma <= 0` returns a copy of `mask`.
 * Values stay in 0..255 (edge pixels become mid-tones for soft blend).
 */
export function blurSkinMask(
	mask: Uint8Array,
	width: number,
	height: number,
	sigma = SKIN_MASK_BLUR_SIGMA,
): Uint8Array {
	const plane = width * height;
	if (width <= 0 || height <= 0 || mask.length < plane) {
		return new Uint8Array(mask);
	}
	if (!(sigma > 0)) return new Uint8Array(mask.subarray(0, plane));

	const kernel = buildKernel(sigma);
	const tmp = new Uint8Array(plane);
	const out = new Uint8Array(plane);
	blurAxis(mask, tmp, width, height, kernel, true);
	blurAxis(tmp, out, width, height, kernel, false);
	return out;
}
