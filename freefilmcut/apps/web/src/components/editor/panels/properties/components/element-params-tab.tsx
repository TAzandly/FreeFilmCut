"use client";

import { resolveAnimationPathValueAtTime } from "@/animation";
import { Section, SectionContent, SectionFields } from "@/components/section";
import { useElementPlayhead } from "@/components/editor/panels/properties/hooks/use-element-playhead";
import { useKeyframedParamProperty } from "@/components/editor/panels/properties/hooks/use-keyframed-param-property";
import { PropertyParamField } from "@/components/editor/panels/properties/components/property-param-field";
import type { ParamValue, ParamValues } from "@/params";
import {
	getElementParams,
	readElementParamValue,
	writeElementParamValue,
	type ElementParamDefinition,
} from "@/params/registry";
import type { TimelineElement } from "@/timeline";
import { useElementPreview } from "@/timeline/hooks/use-element-preview";
import type { MediaTime } from "@/wasm";

export function ElementParamsTab({
	element,
	trackId,
	paramKeys,
	sectionKey,
}: {
	element: TimelineElement;
	trackId: string;
	paramKeys?: readonly string[];
	sectionKey: string;
}) {
	const params = selectParams({ element, paramKeys });

	return (
		<Section sectionKey={`${element.id}:${sectionKey}`}>
			<SectionContent className="pt-4">
				<SectionFields>
					<ElementParamFields
						element={element}
						trackId={trackId}
						params={params}
					/>
				</SectionFields>
			</SectionContent>
		</Section>
	);
}

function selectParams({
	element,
	paramKeys,
}: {
	element: TimelineElement;
	paramKeys?: readonly string[];
}): ElementParamDefinition[] {
	return getElementParams({ element }).filter(
		(param) => !paramKeys || paramKeys.includes(param.key),
	);
}

/**
 * The field list, without the surrounding `Section`.
 *
 * Split out so a tab that owns its own section chrome — the chroma-key tab puts
 * the on/off switch in the section header, like a native NLE — can still reuse
 * the exact same keyframe/preview wiring instead of re-implementing it.
 */
export function ElementParamFields({
	element,
	trackId,
	params,
}: {
	element: TimelineElement;
	trackId: string;
	params: readonly ElementParamDefinition[];
}) {
	/**
	 * PropertiesPanel reads committed scene tracks, so it does not re-render on
	 * preview overlay writes. Sliders are fully controlled — without the live
	 * preview element the thumb snaps back and onPreview(0) can wipe the drag.
	 */
	const { renderElement } = useElementPreview({
		trackId,
		elementId: element.id,
		fallback: element,
	});
	const { localTime, isPlayheadWithinElementRange } = useElementPlayhead({
		startTime: renderElement.startTime,
		duration: renderElement.duration,
	});
	const baseValues = buildValues({ element: renderElement, params });

	return (
		<>
			{params
				.filter((param) => isVisible({ param, values: baseValues }))
				.map((param) => (
					<ElementParamField
						key={param.key}
						element={renderElement}
						trackId={trackId}
						param={param}
						baseValue={baseValues[param.key] ?? param.default}
						localTime={localTime}
						isPlayheadWithinElementRange={isPlayheadWithinElementRange}
					/>
				))}
		</>
	);
}

/**
 * One param, wired to keyframes and to the frame-coalesced preview writer.
 *
 * Takes the playhead as props rather than reading it: a tab with ten fields
 * would otherwise open ten separate subscriptions to the playback clock, which
 * is exactly the fan-out this panel was just cleared of.
 */
function ElementParamField({
	element,
	trackId,
	param,
	baseValue,
	localTime,
	isPlayheadWithinElementRange,
}: {
	element: TimelineElement;
	trackId: string;
	param: ElementParamDefinition;
	baseValue: ParamValue;
	localTime: MediaTime;
	isPlayheadWithinElementRange: boolean;
}) {
	const resolvedValue = resolveAnimationPathValueAtTime({
		animations: element.animations,
		propertyPath: param.key,
		localTime,
		fallbackValue: baseValue,
	});
	const animatedParam = useKeyframedParamProperty({
		param,
		trackId,
		elementId: element.id,
		animations: element.animations,
		propertyPath: param.key,
		localTime,
		isPlayheadWithinElementRange,
		resolvedValue,
		buildBaseUpdates: ({ value }) =>
			writeElementParamValue({ element, param, value }),
	});

	return (
		<PropertyParamField
			param={param}
			value={resolvedValue}
			onPreview={animatedParam.onPreview}
			onCommit={animatedParam.onCommit}
			keyframe={
				param.keyframable === false
					? undefined
					: {
							isActive: animatedParam.isKeyframedAtTime,
							isDisabled: !isPlayheadWithinElementRange,
							onToggle: animatedParam.toggleKeyframe,
						}
			}
		/>
	);
}

function buildValues({
	element,
	params,
}: {
	element: TimelineElement;
	params: readonly ElementParamDefinition[];
}): ParamValues {
	const values: ParamValues = {};
	for (const param of params) {
		const value = readElementParamValue({ element, param });
		if (value !== null) {
			values[param.key] = value;
		}
	}
	return values;
}

function isVisible({
	param,
	values,
}: {
	param: ElementParamDefinition;
	values: ParamValues;
}): boolean {
	return (param.dependencies ?? []).every((dependency) =>
		areParamValuesEqual({
			left: values[dependency.param],
			right: dependency.equals,
		}),
	);
}

function areParamValuesEqual({
	left,
	right,
}: {
	left: ParamValue | undefined;
	right: ParamValue;
}): boolean {
	return left === right;
}
