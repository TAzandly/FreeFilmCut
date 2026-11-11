"use client";

import { Button } from "@/components/ui/button";
import {
	Section,
	SectionContent,
	SectionFields,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import { Switch } from "@/components/ui/switch";
import { ElementParamFields } from "./components/element-params-tab";
import { getElementParams } from "@/params/registry";
import type { ImageElement, VideoElement } from "@/timeline";
import { useElementPreview } from "@/timeline/hooks/use-element-preview";
import type { ParamValues } from "@/params";
import {
	BEAUTY_PARAM_KEYS,
	BEAUTY_SLIDER_PARAM_KEYS,
	DEFAULT_BEAUTY_PARAMS,
	readBeautyFromParams,
} from "@/beauty";

type MediaHost = ImageElement | VideoElement;

const BEAUTY_SLIDER_KEYS = new Set<string>(BEAUTY_SLIDER_PARAM_KEYS);
const ENABLED_KEY = BEAUTY_PARAM_KEYS.enabled;

export function BeautySection({
	element,
	trackId,
}: {
	element: MediaHost;
	trackId: string;
}) {
	const { renderElement, previewUpdates, commit } =
		useElementPreview<MediaHost>({
			trackId,
			elementId: element.id,
			fallback: element,
		});
	const beautyParams = getElementParams({ element: renderElement }).filter(
		(param) => BEAUTY_SLIDER_KEYS.has(param.key),
	);
	const beauty = readBeautyFromParams({ params: renderElement.params });

	const hasNonDefault =
		beauty.enabled ||
		beauty.smooth > 0 ||
		beauty.whiten > 0 ||
		beauty.eye > 0 ||
		beauty.faceSlim > 0 ||
		beauty.vFace > 0 ||
		beauty.noseSlim > 0;

	const commitParams = (patch: ParamValues) => {
		previewUpdates({
			params: {
				...(renderElement.params ?? {}),
				...patch,
			},
		});
		commit();
	};

	const handleEnabled = (checked: boolean) => {
		commitParams({ [ENABLED_KEY]: checked });
	};

	const handleReset = () => {
		commitParams({
			[ENABLED_KEY]: DEFAULT_BEAUTY_PARAMS.enabled,
			[BEAUTY_PARAM_KEYS.smooth]: DEFAULT_BEAUTY_PARAMS.smooth,
			[BEAUTY_PARAM_KEYS.whiten]: DEFAULT_BEAUTY_PARAMS.whiten,
			[BEAUTY_PARAM_KEYS.eye]: DEFAULT_BEAUTY_PARAMS.eye,
			[BEAUTY_PARAM_KEYS.faceSlim]: DEFAULT_BEAUTY_PARAMS.faceSlim,
			[BEAUTY_PARAM_KEYS.vFace]: DEFAULT_BEAUTY_PARAMS.vFace,
			[BEAUTY_PARAM_KEYS.noseSlim]: DEFAULT_BEAUTY_PARAMS.noseSlim,
		});
	};

	return (
		<Section collapsible defaultOpen sectionKey={`${element.id}:beauty`}>
			<SectionHeader
				leading={
					<Switch
						checked={beauty.enabled}
						onCheckedChange={handleEnabled}
						onClick={(event) => event.stopPropagation()}
						aria-label="Enable beauty"
					/>
				}
				trailing={
					hasNonDefault ? (
						<Button
							variant="ghost"
							size="sm"
							className="h-7 px-2 text-xs"
							onClick={(event) => {
								event.stopPropagation();
								handleReset();
							}}
						>
							Reset
						</Button>
					) : null
				}
			>
				<SectionTitle>Beauty</SectionTitle>
			</SectionHeader>
			{beauty.enabled ? (
				<SectionContent>
					<SectionFields>
						<ElementParamFields
							element={renderElement}
							trackId={trackId}
							params={beautyParams}
						/>
					</SectionFields>
				</SectionContent>
			) : null}
		</Section>
	);
}
