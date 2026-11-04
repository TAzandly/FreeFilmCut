import { Tensor } from "@huggingface/transformers";
import { LANGUAGES } from "@/transcription/languages";
import { DEFAULT_TRANSCRIPTION_SAMPLE_RATE } from "@/transcription/audio";

/** Languages offered in the Captions UI — detection is restricted to these. */
const DETECTABLE_CODES = new Set(LANGUAGES.map((lang) => lang.code));

type WhisperLangModel = {
	generation_config?: {
		is_multilingual?: boolean;
		decoder_start_token_id?: number;
		lang_to_id?: Record<string, number>;
	};
	(
		inputs: Record<string, unknown>,
	): Promise<{ logits: { dims: number[]; data: ArrayLike<number> } }>;
};

type WhisperProcessor = (audio: Float32Array) => Promise<{
	input_features: unknown;
}>;

/**
 * Whisper language ID via a single decoder step after `<|startoftranscript|>`.
 * transformers.js still defaults missing `language` to English (TODO upstream),
 * so we detect ourselves before calling the ASR pipeline.
 */
export async function detectWhisperLanguageCode({
	audio,
	model,
	processor,
}: {
	audio: Float32Array;
	model: WhisperLangModel;
	processor: WhisperProcessor;
}): Promise<string> {
	const generationConfig = model.generation_config;
	if (
		!generationConfig?.is_multilingual ||
		!generationConfig.lang_to_id ||
		generationConfig.decoder_start_token_id == null
	) {
		return "en";
	}

	const maxSamples = DEFAULT_TRANSCRIPTION_SAMPLE_RATE * 30;
	const clip = audio.length > maxSamples ? audio.subarray(0, maxSamples) : audio;
	const { input_features } = await processor(clip);

	const sot = BigInt(generationConfig.decoder_start_token_id);
	const decoder_input_ids = new Tensor(
		"int64",
		BigInt64Array.from([sot]),
		[1, 1],
	);

	const { logits } = await model({
		input_features,
		decoder_input_ids,
	});

	const dims = logits.dims;
	const vocab = dims[dims.length - 1] ?? 0;
	const offset = (dims[0] * dims[1] - 1) * vocab;

	let bestScore = Number.NEGATIVE_INFINITY;
	let bestCode = "en";

	for (const [token, id] of Object.entries(generationConfig.lang_to_id)) {
		// Tokens look like `<|zh|>`.
		const code = token.slice(2, -2);
		if (!DETECTABLE_CODES.has(code as (typeof LANGUAGES)[number]["code"])) {
			continue;
		}
		const score = Number(logits.data[offset + Number(id)]);
		if (score > bestScore) {
			bestScore = score;
			bestCode = code;
		}
	}

	return bestCode;
}
