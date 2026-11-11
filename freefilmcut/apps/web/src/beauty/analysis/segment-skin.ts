import { preloadDlmvSkin, segmentSkinDlmv } from "./dlmv-skin";
import {
	type SkinSegmentation,
	preloadSelfieSkin,
	segmentSkinSelfie,
} from "./selfie-skin";

export type { SkinSegmentation };

/**
 * Preferred skin segmentation: DLMV (all skin), then Selfie Multiclass.
 * Smooth / whiten use this mask directly — not clipped to face landmarks.
 */
export async function segmentSkin(
	image: Parameters<typeof segmentSkinDlmv>[0],
): Promise<SkinSegmentation | null> {
	return (await segmentSkinDlmv(image)) ?? (await segmentSkinSelfie(image));
}

/** Warm the preferred skin model (falls back to selfie if DLMV is missing). */
export async function preloadSkinSegmentation(): Promise<void> {
	try {
		await preloadDlmvSkin();
	} catch {
		await preloadSelfieSkin();
	}
}
