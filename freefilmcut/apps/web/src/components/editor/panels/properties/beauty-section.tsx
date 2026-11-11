"use client";

import { useEffect, useState } from "react";
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
	ensureBeautyModels,
	getBeautyModelStatus,
	readBeautyFromParams,
	resetBeautyModelEnsure,
	subscribeBeautyModelStatus,
	type BeautyModelStatus,
} from "@/beauty";

type MediaHost = ImageElement | VideoElement;

const BEAUTY_SLIDER_KEYS = new Set<string>(BEAUTY_SLIDER_PARAM_KEYS);
const ENABLED_KEY = BEAUTY_PARAM_KEYS.enabled;

function statusLabel(status: BeautyModelStatus): string | null {
	if (status.phase === "downloading") {
		return `Downloading beauty models… ${status.percent}%`;
	}
	if (status.phase === "ready") return "Beauty models ready";
	if (status.phase === "error") {
		return status.message || "Failed to download beauty models";
	}
	return null;
}

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
	const [modelStatus, setModelStatus] = useState<BeautyModelStatus>(() =>
		getBeautyModelStatus(),
	);
	const [showReady, setShowReady] = useState(false);

	useEffect(() => subscribeBeautyModelStatus(setModelStatus), []);

	useEffect(() => {
		if (modelStatus.phase !== "ready") {
			setShowReady(false);
			return;
		}
		setShowReady(true);
		const timer = window.setTimeout(() => setShowReady(false), 3000);
		return () => window.clearTimeout(timer);
	}, [modelStatus]);

	useEffect(() => {
		if (!beauty.enabled) return;
		void ensureBeautyModels().catch(() => {
			/* status already set */
		});
	}, [beauty.enabled]);

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
		if (checked) {
			void ensureBeautyModels().catch(() => {
				/* status already set */
			});
		}
	};

	const handleRetry = () => {
		resetBeautyModelEnsure();
		void ensureBeautyModels().catch(() => {
			/* status already set */
		});
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

	const visibleStatus =
		modelStatus.phase === "downloading" ||
		modelStatus.phase === "error" ||
		(modelStatus.phase === "ready" && showReady)
			? modelStatus
			: null;
	const label = visibleStatus ? statusLabel(visibleStatus) : null;

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
			{label ? (
				<div className="flex items-center gap-2 px-4 pb-2 text-xs text-muted-foreground">
					<span className="min-w-0 flex-1 leading-snug">{label}</span>
					{modelStatus.phase === "error" ? (
						<Button
							variant="ghost"
							size="sm"
							className="h-6 shrink-0 px-2 text-xs"
							onClick={(event) => {
								event.stopPropagation();
								handleRetry();
							}}
						>
							Retry
						</Button>
					) : null}
				</div>
			) : null}
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
