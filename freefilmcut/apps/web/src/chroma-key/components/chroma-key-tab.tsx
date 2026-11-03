"use client";

import {
	Section,
	SectionContent,
	SectionFields,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import { ElementParamFields } from "@/components/editor/panels/properties/components/element-params-tab";
import { Switch } from "@/components/ui/switch";
import { useEditor } from "@/editor/use-editor";
import { getElementParams } from "@/params/registry";
import { CHROMA_KEY_PANEL_KEYS } from "@/chroma-key/settings";
import type { ImageElement, VideoElement } from "@/timeline";

/**
 * Panel keys live in `chroma-key/settings.ts` so the tab, the param registry and
 * a unit test can agree on one list. Set form here because `param.key` is a
 * plain `string`.
 *
 * Order follows the reference panel: pick the colour first, then judge the key.
 */
const PANEL_KEYS: ReadonlySet<string> = new Set(CHROMA_KEY_PANEL_KEYS);

const ENABLED_KEY = "chromaKey.enabled";

/**
 * 抠像 (keying) tab for image and video clips.
 *
 * Only 色度抠图 (chroma key) for now. It is deliberately built out of ordinary
 * registered params, which is what gives it three things for free:
 *
 *  - the eyedropper — `PropertyParamField` renders a `ColorPicker`, which wraps
 *    the browser's native `EyeDropper` and can sample straight off the preview;
 *  - keyframe diamonds and animation, shared with every other param;
 *  - one preview write per frame while a slider is dragged
 *    (`useCoalescedPreview` sits inside `useKeyframedParamProperty`).
 */
export function ChromaKeyTab({
	element,
	trackId,
}: {
	element: ImageElement | VideoElement;
	trackId: string;
}) {
	const params = element.params;
	const enabled = params[ENABLED_KEY] === true;

	return (
		<Section
			sectionKey={`${element.id}:chromaKey`}
			collapsible
			defaultOpen
			showBottomBorder
		>
			<SectionHeader
				leading={
					<ChromaKeyEnabledSwitch
						element={element}
						trackId={trackId}
						enabled={enabled}
					/>
				}
			>
				<SectionTitle>Chroma Key</SectionTitle>
			</SectionHeader>
			<SectionContent className="pt-1">
				{enabled ? null : (
					<p className="text-muted-foreground pb-3 text-xs leading-relaxed">
						Adjusting any control below switches chroma key on.
					</p>
				)}
				<SectionFields>
					<ElementParamFields
						element={element}
						trackId={trackId}
						params={getElementParams({ element }).filter((param) =>
							PANEL_KEYS.has(param.key),
						)}
					/>
				</SectionFields>
			</SectionContent>
		</Section>
	);
}

/**
 * A bare switch, not a `PropertyParamField`.
 *
 * `PropertyParamField` renders a label stacked above the control (it is built
 * for a `SectionField` row), which would turn an 11-unit-high section header
 * into a two-line block. Toggling is also a discrete edit, so it goes through
 * `updateElements` and lands on the undo stack as one step — unlike a slider
 * drag, which streams through the preview overlay.
 */
function ChromaKeyEnabledSwitch({
	element,
	trackId,
	enabled,
}: {
	element: ImageElement | VideoElement;
	trackId: string;
	enabled: boolean;
}) {
	const editor = useEditor();

	const handleChange = (next: boolean) => {
		editor.timeline.updateElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					patch: {
						params: { ...element.params, [ENABLED_KEY]: next },
					},
				},
			],
		});
	};

	return (
		<Switch
			checked={enabled}
			onCheckedChange={handleChange}
			aria-label="Enable chroma key"
		/>
	);
}
