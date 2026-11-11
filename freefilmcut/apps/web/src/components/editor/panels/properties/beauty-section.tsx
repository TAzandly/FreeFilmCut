"use client";

import { Button } from "@/components/ui/button";
import {
	Section,
	SectionContent,
	SectionFields,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import { ElementParamFields } from "./components/element-params-tab";
import { getElementParams } from "@/params/registry";
import type { ImageElement, VideoElement } from "@/timeline";
import { useElementPreview } from "@/timeline/hooks/use-element-preview";
import type { ParamValues } from "@/params";
import {
	BEAUTY_PARAM_KEYS,
	DEFAULT_BEAUTY_PARAMS,
	readBeautyFromParams,
} from "@/beauty";

type MediaHost = ImageElement | VideoElement;

const BEAUTY_KEYS = new Set<string>(Object.values(BEAUTY_PARAM_KEYS));

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
		(param) => BEAUTY_KEYS.has(param.key),
	);
	const beauty = readBeautyFromParams({ params: renderElement.params });

	const hasNonDefault = Object.values(beauty).some((value) => value > 0);

	const handleReset = () => {
		const next: ParamValues = {
			...(renderElement.params ?? {}),
			[BEAUTY_PARAM_KEYS.smooth]: DEFAULT_BEAUTY_PARAMS.smooth,
			[BEAUTY_PARAM_KEYS.whiten]: DEFAULT_BEAUTY_PARAMS.whiten,
			[BEAUTY_PARAM_KEYS.eye]: DEFAULT_BEAUTY_PARAMS.eye,
			[BEAUTY_PARAM_KEYS.faceSlim]: DEFAULT_BEAUTY_PARAMS.faceSlim,
			[BEAUTY_PARAM_KEYS.noseSlim]: DEFAULT_BEAUTY_PARAMS.noseSlim,
		};
		previewUpdates({ params: next });
		commit();
	};

	return (
		<Section collapsible defaultOpen sectionKey={`${element.id}:beauty`}>
			<SectionHeader
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
				<SectionTitle>美颜</SectionTitle>
			</SectionHeader>
			<SectionContent>
				<SectionFields>
					<ElementParamFields
						element={renderElement}
						trackId={trackId}
						params={beautyParams}
					/>
				</SectionFields>
			</SectionContent>
		</Section>
	);
}
