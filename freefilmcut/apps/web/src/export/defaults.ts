import type { ExportOptions } from "./index";

export const DEFAULT_EXPORT_OPTIONS = {
	format: "mp4",
	quality: "high",
	resolution: "1080p",
	includeAudio: true,
} satisfies ExportOptions;
