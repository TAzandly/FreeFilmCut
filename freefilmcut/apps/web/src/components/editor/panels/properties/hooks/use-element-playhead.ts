import { useEffect, useState } from "react";
import { useEditor } from "@/editor/use-editor";
import { getElementLocalTime } from "@/animation";
import { addMediaTime, mediaTime, type MediaTime } from "@/wasm";

/**
 * fcc-tl-flower-66: do not useEditor(getCurrentTime) — that React-subscribes the
 * whole properties tree to playback.notify on every scrub seek.
 * Seek → setState; play ticks only when trackPlayhead is true (keyframed params).
 */
export function useElementPlayhead({
	startTime,
	duration,
	trackPlayhead = false,
}: {
	startTime: MediaTime;
	duration: MediaTime;
	trackPlayhead?: boolean;
}) {
	const editor = useEditor();
	const [playheadTime, setPlayheadTime] = useState<MediaTime>(() =>
		editor.playback.getCurrentTime(),
	);

	useEffect(() => {
		const sync = (time: MediaTime) => setPlayheadTime(time);
		const unsubSeek = editor.playback.onSeek(sync);
		const unsubUpdate = trackPlayhead
			? editor.playback.onUpdate(sync)
			: () => {};
		return () => {
			unsubSeek();
			unsubUpdate();
		};
	}, [editor.playback, trackPlayhead]);

	const localTime = mediaTime({
		ticks: getElementLocalTime({
			timelineTime: playheadTime,
			elementStartTime: startTime,
			elementDuration: duration,
		}),
	});
	const isPlayheadWithinElementRange =
		playheadTime >= startTime &&
		playheadTime <= addMediaTime({ a: startTime, b: duration });

	return { localTime, isPlayheadWithinElementRange };
}
