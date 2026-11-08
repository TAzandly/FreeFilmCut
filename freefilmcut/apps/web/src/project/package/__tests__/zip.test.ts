import { describe, expect, test } from "bun:test";
import {
	PROJECT_PACKAGE_FORMAT,
	PROJECT_PACKAGE_FORMAT_VERSION,
} from "../types";
import { buildProjectPackageZip, parseProjectPackageZip } from "../zip";
import type { SerializedProject } from "@/services/storage/types";

const sampleProject: SerializedProject = {
	metadata: {
		id: "proj-original",
		name: "Demo Cut",
		duration: 120,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-02T00:00:00.000Z",
	},
	scenes: [
		{
			id: "scene-1",
			name: "Main scene",
			isMain: true,
			tracks: {
				overlay: [],
				main: {
					id: "track-main",
					name: "Main",
					type: "video",
					elements: [],
					transitions: [],
					muted: false,
					hidden: false,
				},
				audio: [],
			},
			bookmarks: [],
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		},
	],
	currentSceneId: "scene-1",
	settings: {
		fps: { numerator: 30, denominator: 1 },
		canvasSize: { width: 1920, height: 1080 },
		background: { type: "color", color: "#000000" },
	},
	version: 31,
};

describe("project package zip", () => {
	test("round-trips project json and media files", async () => {
		const file = new File([new Uint8Array([1, 2, 3, 4])], "clip.mp4", {
			type: "video/mp4",
			lastModified: 1_700_000_000_000,
		});

		const built = await buildProjectPackageZip({
			project: sampleProject,
			assets: [
				{
					metadata: {
						id: "media-1",
						name: "clip.mp4",
						type: "video",
						size: 4,
						lastModified: 1_700_000_000_000,
						width: 1920,
						height: 1080,
						duration: 5,
					},
					file,
				},
			],
		});

		expect(built.filename).toBe("Demo Cut.ffcdraft.zip");

		const bytes = new Uint8Array(await built.blob.arrayBuffer());
		const parsed = await parseProjectPackageZip({ bytes });

		expect(parsed.meta.format).toBe(PROJECT_PACKAGE_FORMAT);
		expect(parsed.meta.formatVersion).toBe(PROJECT_PACKAGE_FORMAT_VERSION);
		expect(parsed.meta.name).toBe("Demo Cut");
		expect(parsed.project.metadata.id).toBe("proj-original");
		expect(parsed.project.scenes).toHaveLength(1);
		expect(parsed.assets).toHaveLength(1);
		expect(parsed.assets[0]?.metadata.id).toBe("media-1");
		expect(await parsed.assets[0]?.file.arrayBuffer()).toEqual(
			new Uint8Array([1, 2, 3, 4]).buffer,
		);
	});

	test("skips ephemeral media on export", async () => {
		const built = await buildProjectPackageZip({
			project: sampleProject,
			assets: [
				{
					metadata: {
						id: "ephemeral-1",
						name: "temp.png",
						type: "image",
						size: 2,
						lastModified: Date.now(),
						ephemeral: true,
					},
					file: new File([new Uint8Array([9, 9])], "temp.png", {
						type: "image/png",
					}),
				},
			],
		});

		const bytes = new Uint8Array(await built.blob.arrayBuffer());
		const parsed = await parseProjectPackageZip({ bytes });
		expect(parsed.assets).toHaveLength(0);
	});
});
