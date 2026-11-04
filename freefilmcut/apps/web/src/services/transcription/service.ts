import type {
	TranscriptionLanguage,
	TranscriptionResult,
	TranscriptionProgress,
	TranscriptionModelId,
} from "@/transcription/types";
import {
	DEFAULT_TRANSCRIPTION_MODEL,
	TRANSCRIPTION_MODELS,
} from "@/transcription/models";
import type { WorkerMessage, WorkerResponse } from "./worker";

type ProgressCallback = (progress: TranscriptionProgress) => void;

class TranscriptionService {
	private worker: Worker | null = null;
	private currentModelId: TranscriptionModelId | null = null;
	private isInitialized = false;
	private isInitializing = false;

	async transcribe({
		audioData,
		language = "auto",
		modelId = DEFAULT_TRANSCRIPTION_MODEL,
		onProgress,
	}: {
		audioData: Float32Array;
		language?: TranscriptionLanguage;
		modelId?: TranscriptionModelId;
		onProgress?: ProgressCallback;
	}): Promise<TranscriptionResult> {
		await this.ensureWorker({ modelId, onProgress });

		return new Promise((resolve, reject) => {
			if (!this.worker) {
				reject(new Error("Worker not initialized"));
				return;
			}

			const handleMessage = (event: MessageEvent<WorkerResponse>) => {
				const response = event.data;

				switch (response.type) {
					case "transcribe-progress":
						onProgress?.({
							status: "transcribing",
							progress: response.progress,
							message: "Transcribing audio...",
						});
						break;

					case "transcribe-complete":
						this.worker?.removeEventListener("message", handleMessage);
						resolve({
							text: response.text,
							segments: response.segments,
							language: response.language || language,
						});
						break;

					case "transcribe-error":
						this.worker?.removeEventListener("message", handleMessage);
						reject(new Error(response.error));
						break;

					case "cancelled":
						this.worker?.removeEventListener("message", handleMessage);
						reject(new Error("Transcription cancelled"));
						break;
				}
			};

			this.worker.addEventListener("message", handleMessage);

			this.worker.postMessage({
				type: "transcribe",
				audio: audioData,
				language,
			} satisfies WorkerMessage);
		});
	}

	cancel() {
		this.worker?.postMessage({ type: "cancel" } satisfies WorkerMessage);
	}

	private async ensureWorker({
		modelId,
		onProgress,
	}: {
		modelId: TranscriptionModelId;
		onProgress?: ProgressCallback;
	}): Promise<void> {
		const needsNewModel = this.currentModelId !== modelId;

		if (this.worker && this.isInitialized && !needsNewModel) {
			return;
		}

		if (this.isInitializing && !needsNewModel) {
			await this.waitForInit();
			return;
		}

		this.terminate();
		this.isInitializing = true;
		this.isInitialized = false;

		const model = TRANSCRIPTION_MODELS.find((m) => m.id === modelId);
		if (!model) {
			throw new Error(`Unknown model: ${modelId}`);
		}

		this.worker = new Worker(new URL("./worker.ts", import.meta.url), {
			type: "module",
		});

		return new Promise((resolve, reject) => {
			if (!this.worker) {
				reject(new Error("Failed to create worker"));
				return;
			}

			const handleMessage = (event: MessageEvent<WorkerResponse>) => {
				const response = event.data;

				switch (response.type) {
					case "init-progress": {
						const verb =
							response.source === "download"
								? "Downloading"
								: "Loading cached";
						onProgress?.({
							status: "loading-model",
							progress: response.progress,
							message: `${verb} ${model.name} ${Math.round(response.progress)}%`,
						});
						break;
					}

					case "init-complete":
						this.worker?.removeEventListener("message", handleMessage);
						this.isInitialized = true;
						this.isInitializing = false;
						this.currentModelId = modelId;
						onProgress?.({
							status: "loading-model",
							progress: 100,
							message:
								response.source === "download"
									? `${model.name} saved for offline use`
									: `${model.name} ready (cached)`,
						});
						resolve();
						break;

					case "init-error":
						this.worker?.removeEventListener("message", handleMessage);
						this.isInitializing = false;
						this.terminate();
						reject(new Error(response.error));
						break;
				}
			};

			this.worker.addEventListener("message", handleMessage);

			const customHost =
				typeof process !== "undefined"
					? process.env.NEXT_PUBLIC_HF_REMOTE_HOST?.trim()
					: undefined;
			const preferMirror =
				typeof navigator !== "undefined" &&
				navigator.language.toLowerCase().startsWith("zh");
			const defaultHosts = preferMirror
				? ["https://hf-mirror.com/", "https://huggingface.co/"]
				: ["https://huggingface.co/", "https://hf-mirror.com/"];
			this.worker.postMessage({
				type: "init",
				modelId: model.huggingFaceId,
				remoteHosts: customHost
					? [customHost, ...defaultHosts]
					: defaultHosts,
			} satisfies WorkerMessage);
		});
	}

	private waitForInit(): Promise<void> {
		return new Promise((resolve) => {
			const checkInit = () => {
				if (this.isInitialized) {
					resolve();
				} else if (!this.isInitializing) {
					resolve();
				} else {
					setTimeout(checkInit, 100);
				}
			};
			checkInit();
		});
	}

	terminate() {
		this.worker?.terminate();
		this.worker = null;
		this.isInitialized = false;
		this.isInitializing = false;
		this.currentModelId = null;
	}
}

export const transcriptionService = new TranscriptionService();
