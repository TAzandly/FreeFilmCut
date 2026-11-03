"use client";

import type { ImageElement, VideoElement } from "@/timeline";
import { mediaAnimSpans } from "@/vfxpack/media-anim";
import { mediaTimeToSeconds } from "@/wasm";

function Mark({ start, end, clipDuration }: { start: number; end: number; clipDuration: number }) {
	if (clipDuration <= 0 || end <= start) return null;
	const left = (start / clipDuration) * 100;
	const width = ((end - start) / clipDuration) * 100;
	return (
		<div
			className="pointer-events-none absolute bottom-1 h-0.5 bg-sky-300"
			style={{ left: `${left}%`, width: `${width}%` }}
		>
			<div className="absolute top-1/2 right-0 h-0 w-0 -translate-y-1/2 border-y-[3px] border-l-[6px] border-y-transparent border-l-sky-300" />
		</div>
	);
}

export function ClipAnimMarks({
	element,
}: {
	element: VideoElement | ImageElement;
}) {
	const anims = element.mediaAnims;
	if (!anims) return null;
	if (!anims.in?.packId && !anims.out?.packId && !anims.combo?.packId) return null;

	const clipDuration = mediaTimeToSeconds({ time: element.duration });
	const spans = mediaAnimSpans({
		clipDurationSec: clipDuration,
		assignment: anims,
	});

	return (
		<>
			{spans.in ? <Mark start={spans.in[0]} end={spans.in[1]} clipDuration={clipDuration} /> : null}
			{spans.out ? <Mark start={spans.out[0]} end={spans.out[1]} clipDuration={clipDuration} /> : null}
			{spans.combo ? (
				<Mark start={spans.combo[0]} end={spans.combo[1]} clipDuration={clipDuration} />
			) : null}
		</>
	);
}
