import type { ReactNode } from "react";
import type {
	EffectElement,
	GraphicElement,
	ImageElement,
	MaskableElement,
	RetimableElement,
	StickerElement,
	TextElement,
	VisualElement,
	VideoElement,
	AudioElement,
	TimelineElement,
} from "@/timeline";
import type { MediaAsset } from "@/media/types";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	TextFontIcon,
	ArrowExpandIcon,
	RainDropIcon,
	MusicNote03Icon,
	MagicWand05Icon,
	DashboardSpeed02Icon,
	HappyIcon,
	KeyframeIcon,
	Target01Icon,
	Video01Icon,
	SlidersHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { ElementParamsTab } from "./components/element-params-tab";
import { ClipEffectsTab, StandaloneEffectTab } from "@/effects/components/effects-tab";
import { MasksTab } from "@/masks/components/masks-tab";
import { SpeedTab } from "@/speed/components/speed-tab";
import { GraphicTab } from "@/graphics/components/graphic-tab";
import { OcShapesIcon } from "@/components/icons";
import { parseVfxPackIdFromEffectType } from "@/vfxpack/effect-id";
import { normalizeVfxPackType } from "@/vfxpack/pack-placement";
import { getPackRegistrySnapshot } from "@/vfxpack/pack-registry";
import { StickerPropertiesView } from "./sticker-properties-view";
import { TextPropertiesView } from "./text-properties-view";
import { MediaPropertiesView } from "./media-properties-view";
import { isTextTemplateClip } from "@/vfxpack/apply-text-template";

const TRANSFORM_PARAM_KEYS = [
	"transform.positionX",
	"transform.positionY",
	"transform.scaleX",
	"transform.scaleY",
	"transform.rotate",
] as const;

const BLENDING_PARAM_KEYS = ["opacity", "blendMode"] as const;
const AUDIO_PARAM_KEYS = [
	"volume",
	"muted",
	"fadeInSec",
	"fadeOutSec",
] as const;

export type TabContentProps = {
	trackId: string;
};

export type PropertiesTabDef = {
	id: string;
	label: string;
	icon: ReactNode;
	content: (props: TabContentProps) => ReactNode;
};

export type ElementPropertiesConfig = {
	defaultTab: string;
	tabs: PropertiesTabDef[];
};

function buildTransformTab({
	element,
}: {
	element: VisualElement;
}): PropertiesTabDef {
	return {
		id: "transform",
		label: "Transform",
		icon: <HugeiconsIcon icon={ArrowExpandIcon} size={16} />,
		content: ({ trackId }) => (
			<ElementParamsTab
				element={element}
				trackId={trackId}
				paramKeys={TRANSFORM_PARAM_KEYS}
				sectionKey="transform"
			/>
		),
	};
}

function buildBlendingTab({
	element,
}: {
	element: VisualElement;
}): PropertiesTabDef {
	return {
		id: "blending",
		label: "Blending",
		icon: <HugeiconsIcon icon={RainDropIcon} size={16} />,
		content: ({ trackId }) => (
			<ElementParamsTab
				element={element}
				trackId={trackId}
				paramKeys={BLENDING_PARAM_KEYS}
				sectionKey="blending"
			/>
		),
	};
}

function buildAudioTab({
	element,
}: {
	element: AudioElement | VideoElement;
}): PropertiesTabDef {
	return {
		id: "audio",
		label: "Audio",
		icon: <HugeiconsIcon icon={MusicNote03Icon} size={16} />,
		content: ({ trackId }) => (
			<ElementParamsTab
				element={element}
				trackId={trackId}
				paramKeys={AUDIO_PARAM_KEYS}
				sectionKey="audio"
			/>
		),
	};
}

function buildSpeedTab({
	element,
}: {
	element: RetimableElement;
}): PropertiesTabDef {
	return {
		id: "speed",
		label: "Speed",
		icon: <HugeiconsIcon icon={DashboardSpeed02Icon} size={16} />,
		content: ({ trackId }) => <SpeedTab element={element} trackId={trackId} />,
	};
}

function buildMasksTab({
	element,
}: {
	element: MaskableElement;
}): PropertiesTabDef {
	return {
		id: "masks",
		label: "Masks",
		icon: <OcShapesIcon size={16} />,
		content: ({ trackId }) => <MasksTab element={element} trackId={trackId} />,
	};
}

function buildClipEffectsTab({
	element,
}: {
	element: VisualElement;
}): PropertiesTabDef {
	return {
		id: "effects",
		label: "Effects",
		icon: <HugeiconsIcon icon={MagicWand05Icon} size={16} />,
		content: ({ trackId }) => (
			<ClipEffectsTab element={element} trackId={trackId} />
		),
	};
}

function buildTextTab({ element }: { element: TextElement }): PropertiesTabDef {
	return {
		id: "text",
		label: "Text",
		icon: <HugeiconsIcon icon={TextFontIcon} size={16} />,
		content: ({ trackId }) => (
			<TextPropertiesView element={element} trackId={trackId} page="text" />
		),
	};
}

function buildTextAnimationTab({
	element,
}: {
	element: TextElement;
}): PropertiesTabDef {
	return {
		id: "animation",
		label: "Animation",
		icon: <HugeiconsIcon icon={KeyframeIcon} size={16} />,
		content: ({ trackId }) => (
			<TextPropertiesView
				element={element}
				trackId={trackId}
				page="animation"
			/>
		),
	};
}

function buildGraphicTab({
	element,
}: {
	element: GraphicElement;
}): PropertiesTabDef {
	return {
		id: "graphic",
		label: "Graphic",
		icon: <OcShapesIcon size={16} />,
		content: ({ trackId }) => <GraphicTab element={element} trackId={trackId} />,
	};
}

function buildStandaloneEffectTab({
	element,
}: {
	element: EffectElement;
}): PropertiesTabDef {
	return {
		id: "effects",
		label: "Effects",
		icon: <HugeiconsIcon icon={MagicWand05Icon} size={16} />,
		content: ({ trackId }) => (
			<StandaloneEffectTab element={element} trackId={trackId} />
		),
	};
}

function getTextConfig({
	element,
}: {
	element: TextElement;
}): ElementPropertiesConfig {
	// Text-templates: hide Animation (pack embeds textAnim). Ordinary flower Effects: show it.
	const tabs = [buildTextTab({ element })];
	if (!isTextTemplateClip(element)) {
		tabs.push(buildTextAnimationTab({ element }));
	}
	return {
		defaultTab: "text",
		tabs,
	};
}

	function getVideoConfig({
		element,
		mediaAsset,
	}: {
		element: VideoElement;
		mediaAsset: MediaAsset | undefined;
	}): ElementPropertiesConfig {
		const showAudioTab = mediaAsset?.hasAudio !== false;
		const tabs: PropertiesTabDef[] = [
			{
				id: "video",
				label: "Video",
				icon: <HugeiconsIcon icon={Video01Icon} size={16} />,
				content: ({ trackId }) => (
					<MediaPropertiesView element={element} trackId={trackId} page="video" />
				),
			},
			{
				id: "animation",
				label: "Animation",
				icon: <HugeiconsIcon icon={KeyframeIcon} size={16} />,
				content: ({ trackId }) => (
					<MediaPropertiesView
						element={element}
						trackId={trackId}
						page="animation"
					/>
				),
			},
			{
				id: "adjustment",
				label: "Adjustment",
				icon: <HugeiconsIcon icon={SlidersHorizontalIcon} size={16} />,
				content: ({ trackId }) => (
					<MediaPropertiesView
						element={element}
						trackId={trackId}
						page="adjustment"
					/>
				),
			},
			{
				id: "beauty",
				label: "Beauty",
				icon: <HugeiconsIcon icon={HappyIcon} size={16} />,
				content: ({ trackId }) => (
					<MediaPropertiesView
						element={element}
						trackId={trackId}
						page="beauty"
					/>
				),
			},
		];
		if (showAudioTab) {
			tabs.push({
				id: "audio",
				label: "Audio",
				icon: <HugeiconsIcon icon={MusicNote03Icon} size={16} />,
				content: ({ trackId }) => (
					<MediaPropertiesView element={element} trackId={trackId} page="audio" />
				),
			});
		}
		tabs.push({
			id: "speed",
			label: "Speed",
			icon: <HugeiconsIcon icon={DashboardSpeed02Icon} size={16} />,
			content: ({ trackId }) => (
				<MediaPropertiesView element={element} trackId={trackId} page="speed" />
			),
		});
		return {
			defaultTab: "video",
			tabs,
		};
	}

	function getImageConfig({
		element,
	}: {
		element: ImageElement;
	}): ElementPropertiesConfig {
		return {
			defaultTab: "video",
			tabs: [
				{
					id: "video",
					label: "Video",
					icon: <HugeiconsIcon icon={Video01Icon} size={16} />,
					content: ({ trackId }) => (
						<MediaPropertiesView
							element={element}
							trackId={trackId}
							page="video"
						/>
					),
				},
				{
					id: "animation",
					label: "Animation",
					icon: <HugeiconsIcon icon={KeyframeIcon} size={16} />,
					content: ({ trackId }) => (
						<MediaPropertiesView
							element={element}
							trackId={trackId}
							page="animation"
						/>
					),
				},
				{
					id: "adjustment",
					label: "Adjustment",
					icon: <HugeiconsIcon icon={SlidersHorizontalIcon} size={16} />,
					content: ({ trackId }) => (
						<MediaPropertiesView
							element={element}
							trackId={trackId}
							page="adjustment"
						/>
					),
				},
				{
					id: "beauty",
					label: "Beauty",
					icon: <HugeiconsIcon icon={HappyIcon} size={16} />,
					content: ({ trackId }) => (
						<MediaPropertiesView
							element={element}
							trackId={trackId}
							page="beauty"
						/>
					),
				},
			],
		};
	}

function getStickerConfig({
	element,
}: {
	element: StickerElement;
}): ElementPropertiesConfig {
	return buildStickerPropertyTabs({ element });
}

function getGraphicConfig({
	element,
}: {
	element: GraphicElement;
}): ElementPropertiesConfig {
	return {
		defaultTab: "graphic",
		tabs: [
			buildGraphicTab({ element }),
			buildTransformTab({ element }),
			buildBlendingTab({ element }),
			buildMasksTab({ element }),
			buildClipEffectsTab({ element }),
		],
	};
}

function getAudioConfig({
	element,
}: {
	element: AudioElement;
}): ElementPropertiesConfig {
	return {
		defaultTab: "audio",
		tabs: [buildAudioTab({ element }), buildSpeedTab({ element })],
	};
}

function getEffectConfig({
	element,
}: {
	element: EffectElement;
}): ElementPropertiesConfig {
	if (isStickerPackEffect({ element })) {
		return buildStickerPropertyTabs({ element });
	}
	return {
		defaultTab: "effects",
		tabs: [buildStandaloneEffectTab({ element })],
	};
}

function isStickerPackEffect({ element }: { element: EffectElement }): boolean {
	const packId = parseVfxPackIdFromEffectType({ effectType: element.effectType });
	if (!packId) return false;
	const pack = getPackRegistrySnapshot().packs.find((entry) => entry.id === packId);
	return pack != null && normalizeVfxPackType(pack.type) === "sticker";
}

function buildStickerPropertyTabs({
	element,
}: {
	element: StickerElement | EffectElement;
}): ElementPropertiesConfig {
	return {
		defaultTab: "sticker",
		tabs: [
			{
				id: "sticker",
				label: "Sticker",
				icon: <HugeiconsIcon icon={HappyIcon} size={16} />,
				content: ({ trackId }) => (
					<StickerPropertiesView
						element={element}
						trackId={trackId}
						page="sticker"
					/>
				),
			},
			{
				id: "animation",
				label: "Animation",
				icon: <HugeiconsIcon icon={KeyframeIcon} size={16} />,
				content: ({ trackId }) => (
					<StickerPropertiesView
						element={element}
						trackId={trackId}
						page="animation"
					/>
				),
			},
			{
				id: "tracking",
				label: "Tracking",
				icon: <HugeiconsIcon icon={Target01Icon} size={16} />,
				content: ({ trackId }) => (
					<StickerPropertiesView
						element={element}
						trackId={trackId}
						page="tracking"
					/>
				),
			},
		],
	};
}

export function getPropertiesConfig({
	element,
	mediaAssets,
}: {
	element: TimelineElement;
	mediaAssets: MediaAsset[];
}): ElementPropertiesConfig {
	switch (element.type) {
		case "text":
			return getTextConfig({ element });
		case "video": {
			const mediaAsset = mediaAssets.find((a) => a.id === element.mediaId);
			return getVideoConfig({ element, mediaAsset });
		}
		case "image":
			return getImageConfig({ element });
		case "sticker":
			return getStickerConfig({ element });
		case "graphic":
			return getGraphicConfig({ element });
		case "audio":
			return getAudioConfig({ element });
		case "effect":
			return getEffectConfig({ element });
	}
}
