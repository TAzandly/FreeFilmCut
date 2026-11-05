import type { MediaTime } from "@/wasm";
import { analyzeColorCorrection } from "./analyze";
import type { ColorCorrectionAnalysis } from "./math";
import { sampleColorCorrectionFrame } from "./sample-frame";

export async function runColorCorrectionAnalysis({
	mediaId,
	file,
	elementId,
	elementType,
	trimStart,
	trimEnd,
	duration,
}: {
	mediaId: string;
	file: File;
	elementId?: string;
	elementType: "video" | "image";
	trimStart: MediaTime;
	trimEnd: MediaTime;
	duration: MediaTime;
}): Promise<ColorCorrectionAnalysis | null> {
	const imageData = await sampleColorCorrectionFrame({
		mediaId,
		file,
		elementId,
		elementType,
		trimStart,
		trimEnd,
		duration,
	});
	if (!imageData) return null;
	return analyzeColorCorrection({ imageData });
}
