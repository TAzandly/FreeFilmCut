"use client";

import type { TextElement } from "@/timeline";
import { textAnimSpans, textAnimPackDuration } from "@/vfxpack/text-anim-motion";
import { usePackRegistry } from "@/vfxpack/pack-registry";
import type { LoadedVfxPack } from "@/vfxpack/types";
import { mediaTimeToSeconds } from "@/wasm";

function durationOf(packs: LoadedVfxPack[], packId: string | null | undefined, override?: number): number {
	if (!packId) return 0;
	if (typeof override === "number" && override > 0) return override;
	const pack = packs.find((entry) => entry.id === packId);
	return textAnimPackDuration(pack, null);
}

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

export function TextAnimMarks({ element }: { element: TextElement }) {
	const packs = usePackRegistry((state) => state.packs);
	const anims = element.textAnims;
	if (!anims) return null;
	const clipDuration = mediaTimeToSeconds({ time: element.duration });
	const spans = textAnimSpans({
		clipDuration,
		inDuration: durationOf(packs, anims.in?.packId, anims.in?.duration),
		outDuration: durationOf(packs, anims.out?.packId, anims.out?.duration),
		hasLoop: !!anims.loop?.packId,
	});
	return (
		<>
			{spans.in ? <Mark start={spans.in[0]} end={spans.in[1]} clipDuration={clipDuration} /> : null}
			{spans.out ? <Mark start={spans.out[0]} end={spans.out[1]} clipDuration={clipDuration} /> : null}
			{spans.loop ? <Mark start={spans.loop[0]} end={spans.loop[1]} clipDuration={clipDuration} /> : null}
		</>
	);
}
