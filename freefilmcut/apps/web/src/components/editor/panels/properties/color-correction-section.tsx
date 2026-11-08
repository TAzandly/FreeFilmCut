"use client";

import { useEffect, useRef, useState } from "react";
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
import type { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import type { ParamValues } from "@/params";
import { getElementParams } from "@/params/registry";
import type { ImageElement, VideoElement } from "@/timeline";
import { useElementPreview } from "@/timeline/hooks/use-element-preview";
import {
	COLOR_CORRECTION_PARAM_KEYS,
	DEFAULT_COLOR_CORRECTION_INTENSITY,
	readColorCorrectionFromParams,
	runColorCorrectionAnalysis,
	serializeColorCorrectionAnalysis,
} from "@/color-correction";

type MediaHost = ImageElement | VideoElement;

const INTENSITY_KEY = COLOR_CORRECTION_PARAM_KEYS.intensity;
const ENABLED_KEY = COLOR_CORRECTION_PARAM_KEYS.enabled;
const ANALYSIS_KEY = COLOR_CORRECTION_PARAM_KEYS.analysis;

/**
 * In-flight analysis keyed by element id, shared across remounts.
 * Disable and Reset drop the token and bump the epoch so a late result
 * cannot write the cache back, and a new enable can start immediately.
 */
const analysisFlightTokenByElementId = new Map<string, number>();
const analysisEpochByElementId = new Map<string, number>();
let analysisFlightSeq = 0;

function invalidateColorCorrectionAnalysis({
	elementId,
}: {
	elementId: string;
}): void {
	analysisEpochByElementId.set(
		elementId,
		(analysisEpochByElementId.get(elementId) ?? 0) + 1,
	);
	analysisFlightTokenByElementId.delete(elementId);
}

function isCurrentColorCorrectionAnalysis({
	elementId,
	epoch,
}: {
	elementId: string;
	epoch: number;
}): boolean {
	return (analysisEpochByElementId.get(elementId) ?? 0) === epoch;
}

export function ColorCorrectionSection({
	element,
	trackId,
}: {
	element: MediaHost;
	trackId: string;
}) {
	const editor = useEditor();
	const { renderElement, previewUpdates, commit } =
		useElementPreview<MediaHost>({
			trackId,
			elementId: element.id,
			fallback: element,
		});
	const correction = readColorCorrectionFromParams({
		params: renderElement.params,
	});
	const intensityParams = getElementParams({ element: renderElement }).filter(
		(param) => param.key === INTENSITY_KEY,
	);
	const inFlightRef = useRef(analysisFlightTokenByElementId);
	const mountedRef = useRef(true);
	const [analyzingId, setAnalyzingId] = useState<string | null>(null);
	const analyzing = analyzingId === renderElement.id;

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	const commitParams = ({
		patch,
		removeAnalysis = false,
	}: {
		patch: ParamValues;
		removeAnalysis?: boolean;
	}) => {
		const next: ParamValues = {
			...(renderElement.params ?? {}),
			...patch,
		};
		if (removeAnalysis) {
			delete next[ANALYSIS_KEY];
		}
		previewUpdates({ params: next });
		commit();
	};

	const handleEnabled = (checked: boolean) => {
		if (!checked) {
			const elementId = renderElement.id;
			invalidateColorCorrectionAnalysis({ elementId });
			if (mountedRef.current) {
				setAnalyzingId((current) => (current === elementId ? null : current));
			}
			commitParams({ patch: { [ENABLED_KEY]: false } });
			return;
		}

		const patch: ParamValues = { [ENABLED_KEY]: true };
		if (typeof renderElement.params?.[INTENSITY_KEY] !== "number") {
			patch[INTENSITY_KEY] = DEFAULT_COLOR_CORRECTION_INTENSITY;
		}
		commitParams({ patch });
		if (correction.analysis) return;

		const elementId = renderElement.id;
		void startColorCorrectionAnalysis({
			editor,
			trackId,
			element: renderElement,
			inFlight: inFlightRef.current,
			onSettled: () => {
				if (!mountedRef.current) return;
				setAnalyzingId((current) => (current === elementId ? null : current));
			},
			onStarted: () => {
				if (mountedRef.current) setAnalyzingId(elementId);
			},
		});
	};

	const handleReset = () => {
		const elementId = renderElement.id;
		invalidateColorCorrectionAnalysis({ elementId });
		if (mountedRef.current) {
			setAnalyzingId((current) => (current === elementId ? null : current));
		}
		commitParams({
			patch: {
				[ENABLED_KEY]: false,
				[INTENSITY_KEY]: DEFAULT_COLOR_CORRECTION_INTENSITY,
			},
			removeAnalysis: true,
		});
	};

	return (
		<Section
			collapsible
			defaultOpen
			sectionKey={`${element.id}:color-correction`}
		>
			<SectionHeader
				leading={
					<Switch
						checked={correction.enabled}
						onCheckedChange={handleEnabled}
						onClick={(event) => event.stopPropagation()}
						aria-label="Enable color correction"
					/>
				}
				trailing={
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
				}
			>
				<SectionTitle>Color Correction</SectionTitle>
			</SectionHeader>
			{correction.enabled ? (
				<SectionContent>
					<SectionFields>
						{analyzing ? (
							<p className="text-muted-foreground px-0.5 text-xs">
								Analyzing…
							</p>
						) : null}
						<ElementParamFields
							element={renderElement}
							trackId={trackId}
							params={intensityParams}
						/>
					</SectionFields>
				</SectionContent>
			) : null}
		</Section>
	);
}

function startColorCorrectionAnalysis({
	editor,
	trackId,
	element,
	inFlight,
	onStarted,
	onSettled,
}: {
	editor: EditorCore;
	trackId: string;
	element: MediaHost;
	inFlight: Map<string, number>;
	onStarted: () => void;
	onSettled: () => void;
}): void {
	const elementId = element.id;
	if (inFlight.has(elementId)) return;

	const token = ++analysisFlightSeq;
	inFlight.set(elementId, token);
	const epoch = analysisEpochByElementId.get(elementId) ?? 0;
	onStarted();

	void runColorCorrectionAnalysisForElement({
		editor,
		trackId,
		element,
		token,
		epoch,
	}).finally(() => {
		const ownsFlight = inFlight.get(elementId) === token;
		if (ownsFlight) {
			inFlight.delete(elementId);
			onSettled();
		}
	});
}

async function runColorCorrectionAnalysisForElement({
	editor,
	trackId,
	element,
	token,
	epoch,
}: {
	editor: EditorCore;
	trackId: string;
	element: MediaHost;
	token: number;
	epoch: number;
}): Promise<void> {
	const elementId = element.id;
	const mediaId = element.mediaId;
	const stillCurrent = () =>
		isCurrentColorCorrectionAnalysis({ elementId, epoch }) &&
		analysisFlightTokenByElementId.get(elementId) === token;

	try {
		const asset =
			editor.media.getAssets().find((item) => item.id === mediaId) ?? null;
		if (!asset?.file) {
			console.warn(
				"Color correction analysis skipped: media file is unavailable.",
				{ mediaId },
			);
			return;
		}

		const analysis = await runColorCorrectionAnalysis({
			mediaId,
			file: asset.file,
			elementId,
			elementType: element.type,
			trimStart: element.trimStart,
			trimEnd: element.trimEnd,
			duration: element.duration,
		});
		if (!stillCurrent()) return;
		if (!analysis) {
			console.warn("Color correction analysis failed.", { mediaId });
			return;
		}

		const fresh = editor.timeline.getElementsWithTracks({
			elements: [{ trackId, elementId }],
		})[0]?.element;
		if (!fresh || !stillCurrent()) return;
		if (fresh.params[ENABLED_KEY] !== true) return;

		const patch: ParamValues = {
			[ANALYSIS_KEY]: serializeColorCorrectionAnalysis({ analysis }),
		};
		if (typeof fresh.params[INTENSITY_KEY] !== "number") {
			patch[INTENSITY_KEY] = DEFAULT_COLOR_CORRECTION_INTENSITY;
		}
		// Enable is already one undo step. A second entry would drop the
		// cache and leave enabled=true. This writes the live tracks only;
		// undo of enable restores the pre-enable snapshot.
		editor.timeline.updateElements({
			updates: [
				{
					trackId,
					elementId,
					patch: { params: patch },
				},
			],
			pushHistory: false,
		});
	} catch (error) {
		if (!stillCurrent()) return;
		console.warn("Color correction analysis failed.", error);
	}
}
