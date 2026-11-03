import type { TimelineElement, TrackType } from "@/timeline";
import { parseVfxPackIdFromEffectType } from "@/vfxpack/effect-id";
import { normalizeVfxPackType } from "@/vfxpack/pack-placement";
import type { PrimaryVfxPackType } from "@/vfxpack/types";
import { getPackRegistrySnapshot } from "@/vfxpack/pack-registry";

export const TIMELINE_AUDIO_WAVEFORM_COLOR = "rgba(255, 255, 255, 0.7)";

export const TIMELINE_TRACK_THEME: Record<
	TrackType,
	{
		elementClassName: string;
		waveformColor?: string;
	}
> = {
	video: { elementClassName: "transparent" },
	text: { elementClassName: "bg-[#5DBAA0]" },
	audio: {
		elementClassName: "bg-[#8F5DBA]",
		waveformColor: TIMELINE_AUDIO_WAVEFORM_COLOR,
	},
	graphic: { elementClassName: "bg-[#BA5D7A]" },
	effect: { elementClassName: "bg-[#5d93ba]" },
} as const;

export const SELECTED_TRACK_ROW_CLASS = "bg-accent/50";
export const DEFAULT_TIMELINE_BOOKMARK_COLOR = "#009dff";

/** Clip colors for imported packs. Built-in effects keep the effect-track blue. */
export const VFX_PACK_TIMELINE_CLASS: Record<PrimaryVfxPackType, string> = {
	sticker: "bg-[#E39B3A]",
	transition: "bg-[#C46B4A]",
	effect: "bg-[#4C8DDB]",
	filter: "bg-[#5EAE7A]",
	"art-text": "bg-[#D16BA5]",
	"sticker-anim": "bg-[#E8E8E8]",
	"text-anim": "bg-[#E8E8E8]",
	"text-template": "bg-[#D16BA5]",
	"clip-anim": "bg-[#E8E8E8]",
};

export const VFX_PACK_TIMELINE_COLOR: Record<PrimaryVfxPackType, string> = {
	sticker: "#E39B3A",
	transition: "#C46B4A",
	effect: "#4C8DDB",
	filter: "#5EAE7A",
	"art-text": "#D16BA5",
	"sticker-anim": "#E8E8E8",
	"text-anim": "#E8E8E8",
	"text-template": "#D16BA5",
	"clip-anim": "#E8E8E8",
};

export function vfxPackTimelineClassName({
	packId,
}: {
	packId: string;
}): string | null {
	const pack = getPackRegistrySnapshot().packs.find((entry) => entry.id === packId);
	if (!pack) return null;
	return VFX_PACK_TIMELINE_CLASS[normalizeVfxPackType(pack.type)];
}

export function getTimelineElementClassName({
	type,
	element,
}: {
	type: TrackType;
	element?: TimelineElement;
}): string {
	if (element?.type === "effect") {
		const packId = parseVfxPackIdFromEffectType({
			effectType: element.effectType,
		});
		if (packId) {
			const packClass = vfxPackTimelineClassName({ packId });
			if (packClass) return packClass;
		}
	}
	return TIMELINE_TRACK_THEME[type].elementClassName.trim();
}
