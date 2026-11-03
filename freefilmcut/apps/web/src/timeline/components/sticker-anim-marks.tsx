"use client";

import type { EffectElement, StickerElement } from "@/timeline";
import { stickerAnimSpans } from "@/vfxpack/sticker-motion";
import { usePackRegistry } from "@/vfxpack/pack-registry";
import type { LoadedVfxPack } from "@/vfxpack/types";
import { mediaTimeToSeconds } from "@/wasm";

function durationOf(packs: LoadedVfxPack[], packId: string | null | undefined): number {
	if (!packId) return 0;
	const pack = packs.find((entry) => entry.id === packId);
	const duration = pack?.manifest.motion?.duration ?? pack?.manifest.duration;
	return typeof duration === "number" && duration > 0 ? duration : 0;
}

function Mark({ start, end, clipDuration }: { start: number; end: number; clipDuration: number }) {
	if (clipDuration <= 0 || end <= start) return null;
	const left = (start / clipDuration) * 100;
	const width = ((end - start) / clipDuration) * 100;
	return (
		<div
			className="pointer-events-none absolute bottom-1 h-0.5 bg-white"
			style={{ left: `${left}%`, width: `${width}%` }}
		>
			<div
				className="absolute top-1/2 right-0 h-0 w-0 -translate-y-1/2 border-y-[3px] border-l-[6px] border-y-transparent border-l-white"
			/>
		</div>
	);
}

export function StickerAnimMarks({
	element,
}: {
	element: StickerElement | EffectElement;
}) {
	const packs = usePackRegistry((state) => state.packs);
	const anims = element.stickerAnims;
	if (!anims) return null;
	const clipDuration = mediaTimeToSeconds({ time: element.duration });
	const spans = stickerAnimSpans({
		clipDuration,
		inDuration: durationOf(packs, anims.in?.packId),
		outDuration: durationOf(packs, anims.out?.packId),
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
