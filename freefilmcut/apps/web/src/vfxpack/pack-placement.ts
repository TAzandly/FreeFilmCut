/**
 * FreeFilmCut: how imported .vfxpack types show up and drag onto the timeline (MVP).
 * Canonical types match the Asset Editor: sticker | transition | effect | filter | art-text
 */

import { VISUAL_ELEMENT_TYPES, type VisualElement } from "@/timeline";
import type { PrimaryVfxPackType } from "@/vfxpack/types";

export const PRIMARY_VFX_PACK_TYPES = [
	"sticker",
	"transition",
	"effect",
	"filter",
	"art-text",
	"sticker-anim",
	"text-anim",
	"text-template",
	"clip-anim",
] as const;

export const VFX_PACK_TYPE_LABELS: Record<PrimaryVfxPackType, string> = {
	sticker: "Stickers",
	transition: "Transitions",
	effect: "Effects",
	filter: "Filters",
	"art-text": "Art text",
	"sticker-anim": "Sticker animation",
	"text-anim": "文字动画",
	"text-template": "Text templates",
	"clip-anim": "Clip animation",
};

export const VFX_PACK_TYPE_ORDER: PrimaryVfxPackType[] = [
	"sticker",
	"transition",
	"effect",
	"filter",
	"art-text",
];

/** Map legacy / unknown manifest.type values onto the five primary types. */
export function normalizeVfxPackType(
	raw: string | undefined | null,
): PrimaryVfxPackType {
	const value = String(raw || "").trim().toLowerCase();
	if ((PRIMARY_VFX_PACK_TYPES as readonly string[]).includes(value)) {
		return value as PrimaryVfxPackType;
	}
	switch (value) {
		case "post-effect":
		case "posteffect":
		case "post_effect":
			return "filter";
		case "text-style":
		case "textstyle":
		case "text_style":
		case "arttext":
			return "art-text";
		case "textanim":
		case "text_anim":
		case "文字动画":
			return "text-anim";
		case "texttemplate":
		case "text_template":
			return "text-template";
		case "clipanim":
		case "clip_anim":
		case "media-anim":
		case "media_anim":
			return "clip-anim";
		case "scene":
		case "animation":
		case "overlay":
			return "effect";
		default:
			return "effect";
	}
}

export type VfxPackPlacement = {
	type: PrimaryVfxPackType;
	label: string;
	/**
	 * Timeline drag payload targetElementTypes:
	 * - non-empty => may attach onto matching clips
	 * - empty => create/use an effect track when insertTrackType is "effect"
	 */
	targetElementTypes: readonly VisualElement["type"][];
	/** Null skips effect-track insert (transitions land on a cut, not a track). */
	insertTrackType: "effect" | null;
	dragHint: string;
};

export function getVfxPackPlacement({
	type,
}: {
	type: string | undefined | null;
}): VfxPackPlacement {
	const normalized = normalizeVfxPackType(type);
	const label = VFX_PACK_TYPE_LABELS[normalized];

	switch (normalized) {
		case "filter":
			return {
				type: normalized,
				label,
				targetElementTypes: VISUAL_ELEMENT_TYPES,
				insertTrackType: "effect",
				dragHint:
					"Drop on a clip to attach, or on the timeline for an effect track",
			};
		case "effect":
			return {
				type: normalized,
				label,
				targetElementTypes: VISUAL_ELEMENT_TYPES,
				insertTrackType: "effect",
				dragHint:
					"Drop on a clip to attach, or on the timeline for an effect track",
			};
		case "sticker":
			return {
				type: normalized,
				label,
				targetElementTypes: [],
				insertTrackType: "effect",
				dragHint: "Drag onto the timeline (overlay / effect track)",
			};
		case "art-text":
			return {
				type: normalized,
				label,
				// Prefer applying onto an existing text clip; empty timeline still gets an effect-track clip.
				targetElementTypes: ["text"],
				insertTrackType: "effect",
				dragHint:
					"Drop on a text clip to apply the flower template, or on the timeline",
			};
		case "transition":
			return {
				type: normalized,
				label,
				targetElementTypes: [],
				insertTrackType: null,
				dragHint: "Drag onto the cut between two adjacent clips",
			};
		case "sticker-anim":
			return {
				type: normalized,
				label,
				targetElementTypes: [],
				insertTrackType: null,
				dragHint: "Apply from the sticker Animation tab",
			};
		case "text-anim":
			return {
				type: normalized,
				label,
				targetElementTypes: ["text"],
				insertTrackType: null,
				dragHint: "在文字 clip 的 Animation（入场/出场/循环）里选用",
			};
		case "text-template":
			return {
				type: normalized,
				label,
				targetElementTypes: ["text"],
				insertTrackType: null,
				dragHint: "Assets → Text → Text templates",
			};
		case "clip-anim":
			return {
				type: normalized,
				label,
				targetElementTypes: ["image", "video"],
				insertTrackType: null,
				dragHint: "Apply from the image/video Animation tab",
			};
	}
}


