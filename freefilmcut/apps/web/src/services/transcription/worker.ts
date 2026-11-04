import {
	env,
	pipeline,
	type AutomaticSpeechRecognitionPipeline,
	type AutomaticSpeechRecognitionOutput,
} from "@huggingface/transformers";
import type { TranscriptionSegment } from "@/transcription/types";
import {
	DEFAULT_CHUNK_LENGTH_SECONDS,
	DEFAULT_STRIDE_SECONDS,
	DEFAULT_TRANSCRIPTION_SAMPLE_RATE,
} from "@/transcription/audio";
import { detectWhisperLanguageCode } from "./detect-language";

function extractSegments(
	result: AutomaticSpeechRecognitionOutput,
	audioDurationSec: number,
): TranscriptionSegment[] {
	const segments: TranscriptionSegment[] = [];

	for (const chunk of result.chunks ?? []) {
		const text = chunk.text?.trim() ?? "";
		if (!text) continue;

		const ts = chunk.timestamp;
		let start: number | null | undefined;
		let end: number | null | undefined;
		if (Array.isArray(ts)) {
			start = ts[0];
			end = ts[1];
		}

		// Skip only when we have no usable start; null end is common on last chunk.
		if (start == null && end == null) continue;

		const safeStart = start ?? 0;
		const safeEnd = end ?? safeStart;
		segments.push({
			text: chunk.text,
			start: safeStart,
			end: safeEnd > safeStart ? safeEnd : Math.max(safeStart, audioDurationSec),
		});
	}

	if (segments.length === 0 && result.text?.trim()) {
		segments.push({
			text: result.text,
			start: 0,
			end: Math.max(audioDurationSec, 0.01),
		});
	}

	return segments;
}

// Persist Whisper weights in the browser Cache API so the first run downloads
// once and later runs load from local cache (no re-download).
env.allowLocalModels = false;
env.useBrowserCache = true;

export type WorkerMessage =
	| { type: "init"; modelId: string; remoteHosts?: string[] }
	| { type: "transcribe"; audio: Float32Array; language: string }
	| { type: "cancel" };

const DEFAULT_REMOTE_HOSTS = [
	"https://huggingface.co/",
	// Fallback when huggingface.co returns 401/blocked (common on some networks).
	"https://hf-mirror.com/",
];

function normalizeRemoteHost(host: string): string {
	const trimmed = host.trim();
	if (!trimmed) return "";
	return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

export type WorkerResponse =
	| {
			type: "init-progress";
			progress: number;
			/** download = fetching from network; cache = reading browser cache */
			source: "download" | "cache";
	  }
	| { type: "init-complete"; source: "download" | "cache" }
	| { type: "init-error"; error: string }
	| { type: "transcribe-progress"; progress: number }
	| {
			type: "transcribe-complete";
			text: string;
			segments: TranscriptionSegment[];
			/** Resolved language code (after auto-detect when requested). */
			language: string;
	  }
	| { type: "transcribe-error"; error: string }
	| { type: "cancelled" };

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let cancelled = false;
let lastReportedProgress = -1;
let sawNetworkDownload = false;
const fileBytes = new Map<string, { loaded: number; total: number }>();

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
	const message = event.data;

	switch (message.type) {
		case "init":
			await handleInit({
				modelId: message.modelId,
				remoteHosts: message.remoteHosts,
			});
			break;
		case "transcribe":
			await handleTranscribe({
				audio: message.audio,
				language: message.language,
			});
			break;
		case "cancel":
			cancelled = true;
			self.postMessage({ type: "cancelled" } satisfies WorkerResponse);
			break;
	}
};

async function handleInit({
		modelId,
		remoteHosts,
	}: {
		modelId: string;
		remoteHosts?: string[];
	}) {
		const hosts = [
			...new Set(
				[...(remoteHosts ?? []), ...DEFAULT_REMOTE_HOSTS]
					.map(normalizeRemoteHost)
					.filter(Boolean),
			),
		];

		let lastError = "Failed to load model";

		for (const host of hosts) {
			lastReportedProgress = -1;
			sawNetworkDownload = false;
			fileBytes.clear();
			transcriber = null;
			env.remoteHost = host;
			env.allowLocalModels = false;
			env.useBrowserCache = true;
			env.allowRemoteModels = true;

			try {
				transcriber = (await pipeline(
					"automatic-speech-recognition",
					modelId,
					{
						dtype: "q4",
						device: "auto",
						progress_callback: (progressInfo: {
							status?: string;
							file?: string;
							loaded?: number;
							total?: number;
						}) => {
							const status = progressInfo.status;
							if (status === "download" || status === "progress") {
								sawNetworkDownload = true;
							}

							const file = progressInfo.file;
							if (!file) return;

							const loaded = progressInfo.loaded ?? 0;
							const total = progressInfo.total ?? 0;

							if (status === "progress" && total > 0) {
								fileBytes.set(file, { loaded, total });
							} else if (status === "done") {
								const existing = fileBytes.get(file);
								if (existing) {
									fileBytes.set(file, {
										loaded: existing.total,
										total: existing.total,
									});
								}
							}

							let totalLoaded = 0;
							let totalSize = 0;
							for (const entry of fileBytes.values()) {
								totalLoaded += entry.loaded;
								totalSize += entry.total;
							}

							if (totalSize === 0) return;

							const overallProgress = (totalLoaded / totalSize) * 100;
							const roundedProgress = Math.floor(overallProgress);
							const source = sawNetworkDownload ? "download" : "cache";

							if (roundedProgress !== lastReportedProgress) {
								lastReportedProgress = roundedProgress;
								self.postMessage({
									type: "init-progress",
									progress: roundedProgress,
									source,
								} satisfies WorkerResponse);
							}
						},
					},
				)) as unknown as AutomaticSpeechRecognitionPipeline;

				self.postMessage({
					type: "init-complete",
					source: sawNetworkDownload ? "download" : "cache",
				} satisfies WorkerResponse);
				return;
			} catch (error) {
				lastError =
					error instanceof Error ? error.message : "Failed to load model";
				console.warn(
					`[transcription] model load failed via ${host}:`,
					lastError,
				);
			}
		}

		const hint = /Unauthorized access to file/i.test(lastError)
			? " This model repo may be private or gated on Hugging Face — try Tiny/Small, or set NEXT_PUBLIC_HF_REMOTE_HOST to a reachable mirror."
			: " If this persists, set NEXT_PUBLIC_HF_REMOTE_HOST to a reachable Hugging Face mirror.";
		self.postMessage({
			type: "init-error",
			error: `${lastError} Tried: ${hosts.join(", ")}.${hint}`,
		} satisfies WorkerResponse);
	}

async function handleTranscribe({
	audio,
	language,
}: {
	audio: Float32Array;
	language: string;
}) {
	if (!transcriber) {
		self.postMessage({
			type: "transcribe-error",
			error: "Model not initialized",
		} satisfies WorkerResponse);
		return;
	}

	cancelled = false;

		try {
			// transformers.js still defaults missing `language` to English — detect ourselves.
			let resolvedLanguage =
				!language || language === "auto" ? "" : language;
			if (!resolvedLanguage) {
				// Pipeline exposes model/processor; types omit them for the call shape.
				const pipelineAny = transcriber as AutomaticSpeechRecognitionPipeline & {
					model: Parameters<typeof detectWhisperLanguageCode>[0]["model"];
					processor: Parameters<
						typeof detectWhisperLanguageCode
					>[0]["processor"];
				};
				resolvedLanguage = await detectWhisperLanguageCode({
					audio,
					model: pipelineAny.model,
					processor: pipelineAny.processor,
				});
				console.info(
					`[transcription] auto-detected language: ${resolvedLanguage}`,
				);
			}

			const rawResult = await transcriber(audio, {
				// 30s is the Whisper window max; 29 avoids known timestamp edge bugs.
				chunk_length_s: Math.min(DEFAULT_CHUNK_LENGTH_SECONDS, 29),
				stride_length_s: DEFAULT_STRIDE_SECONDS,
				language: resolvedLanguage,
				task: "transcribe",
				return_timestamps: true,
			});

			if (cancelled) return;

			const result: AutomaticSpeechRecognitionOutput = Array.isArray(rawResult)
				? rawResult[0]
				: rawResult;

			const audioDurationSec =
				audio.length / DEFAULT_TRANSCRIPTION_SAMPLE_RATE;
			const segments = extractSegments(result, audioDurationSec);

			self.postMessage({
				type: "transcribe-complete",
				text: result.text,
				segments,
				language: resolvedLanguage,
			} satisfies WorkerResponse);
	} catch (error) {
		if (cancelled) return;
		self.postMessage({
			type: "transcribe-error",
			error: error instanceof Error ? error.message : "Transcription failed",
		} satisfies WorkerResponse);
	}
}
