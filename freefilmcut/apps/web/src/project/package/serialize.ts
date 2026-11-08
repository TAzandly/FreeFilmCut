import type { TProject } from "@/project/types";
import { getProjectDurationFromScenes } from "@/timeline/scenes";
import type { SceneTracks } from "@/timeline";
import type {
	SerializedProject,
	SerializedScene,
} from "@/services/storage/types";

function stripAudioBuffers({ tracks }: { tracks: SceneTracks }): SceneTracks {
	return {
		...tracks,
		audio: tracks.audio.map((track) => ({
			...track,
			elements: track.elements.map((element) => {
				const { buffer: _buffer, ...rest } = element;
				return rest;
			}),
		})),
	};
}

export function serializeProjectForPackage({
	project,
}: {
	project: TProject;
}): SerializedProject {
	const duration =
		project.metadata.duration ??
		getProjectDurationFromScenes({ scenes: project.scenes });

	const serializedScenes: SerializedScene[] = project.scenes.map((scene) => ({
		id: scene.id,
		name: scene.name,
		isMain: scene.isMain,
		tracks: stripAudioBuffers({ tracks: scene.tracks }),
		bookmarks: scene.bookmarks,
		createdAt: scene.createdAt.toISOString(),
		updatedAt: scene.updatedAt.toISOString(),
	}));

	return {
		metadata: {
			id: project.metadata.id,
			name: project.metadata.name,
			thumbnail: project.metadata.thumbnail,
			duration,
			createdAt: project.metadata.createdAt.toISOString(),
			updatedAt: project.metadata.updatedAt.toISOString(),
		},
		scenes: serializedScenes,
		currentSceneId: project.currentSceneId,
		settings: project.settings,
		version: project.version,
		timelineViewState: project.timelineViewState,
	};
}

export function sanitizePackageFolderName({ name }: { name: string }): string {
	const cleaned = name
		.trim()
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
		.replace(/\s+/g, " ")
		.replace(/[. ]+$/g, "");
	return cleaned || "Untitled Project";
}
