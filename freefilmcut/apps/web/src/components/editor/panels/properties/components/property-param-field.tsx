"use client";

import type {
	ParamDefinition,
	NumberParamDefinition,
	VectorParamDefinition,
	ParamValue,
} from "@/params";
import {
	formatNumberForDisplay,
	getFractionDigitsForStep,
	snapToStep,
} from "@/utils/math";
import { SectionField } from "@/components/section";
import { NumberField } from "@/components/ui/number-field";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ColorPicker } from "@/components/ui/color-picker";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { usePropertyDraft } from "../hooks/use-property-draft";
import { KeyframeToggle } from "./keyframe-toggle";
import { Textarea } from "@/components/ui/textarea";
import { LocalFontPicker } from "@/components/ui/local-font-picker";

export function PropertyParamField({
	param,
	value,
	onPreview,
	onCommit,
	keyframe,
}: {
	param: ParamDefinition;
	value: ParamValue;
	onPreview: (value: ParamValue) => void;
	onCommit: () => void;
	keyframe?: {
		isActive: boolean;
		isDisabled: boolean;
		onToggle: () => void;
	};
}) {
	return (
		<SectionField
			label={param.label}
			beforeLabel={
				keyframe && param.keyframable !== false ? (
					<KeyframeToggle
						isActive={keyframe.isActive}
						isDisabled={keyframe.isDisabled}
						title={`Toggle ${param.label.toLowerCase()} keyframe`}
						onToggle={keyframe.onToggle}
					/>
				) : undefined
			}
		>
			<ParamInput
				param={param}
				value={value}
				onPreview={onPreview}
				onCommit={onCommit}
			/>
		</SectionField>
	);
}

function ParamInput({
	param,
	value,
	onPreview,
	onCommit,
}: {
	param: ParamDefinition;
	value: ParamValue;
	onPreview: (value: ParamValue) => void;
	onCommit: () => void;
}) {
	if (param.type === "number") {
		const numericValue = typeof value === "number" ? value : Number(value);
		if (param.control === "slider") {
			return (
				<SliderParamField
					param={param}
					value={numericValue}
					onPreview={onPreview}
					onCommit={onCommit}
				/>
			);
		}
		return (
			<NumberParamField
				param={param}
				value={numericValue}
				onPreview={onPreview}
				onCommit={onCommit}
			/>
		);
	}

	if (param.type === "boolean") {
		return (
			<Switch
				checked={Boolean(value)}
				onCheckedChange={(checked) => {
					onPreview(checked);
					onCommit();
				}}
			/>
		);
	}

	if (param.type === "select") {
		return (
			<Select
				value={String(value)}
				onValueChange={(selected) => {
					onPreview(selected);
					onCommit();
				}}
			>
				<SelectTrigger className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{param.options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		);
	}

	if (param.type === "color") {
		return (
			<ColorPicker
				value={String(value).replace(/^#/, "").toUpperCase()}
				onChange={(color) => onPreview(`#${color}`)}
				onChangeEnd={(color) => {
					onPreview(`#${color}`);
					onCommit();
				}}
			/>
		);
	}

	if (param.type === "text") {
		return (
			<Textarea
				value={String(value)}
				onChange={(event) => onPreview(event.currentTarget.value)}
				onBlur={onCommit}
			/>
		);
	}

	if (param.type === "font") {
		return (
			<LocalFontPicker
				value={String(value)}
				onChange={(family) => {
					onPreview(family);
					onCommit();
				}}
			/>
		);
	}

	if (param.type === "vector") {
		return (
			<VectorParamField
				param={param}
				value={Array.isArray(value) ? value : param.default}
				onPreview={onPreview}
				onCommit={onCommit}
			/>
		);
	}

	return null;
}

function VectorParamField({
	param,
	value,
	onPreview,
	onCommit,
}: {
	param: VectorParamDefinition;
	value: number[];
	onPreview: (value: ParamValue) => void;
	onCommit: () => void;
}) {
	const labels = ["X", "Y", "Z", "W"].slice(0, param.size);
	const nums = Array.from({ length: param.size }, (_, i) => {
		const n = Number(value[i]);
		return Number.isFinite(n) ? n : Number(param.default[i]) || 0;
	});
	return (
		<div className="flex flex-wrap items-center gap-1">
			{labels.map((label, index) => {
				const componentParam: NumberParamDefinition = {
					key: `${param.key}.${label.toLowerCase()}`,
					label,
					type: "number",
					default: Number(param.default[index]) || 0,
					min: param.min ?? Number.NEGATIVE_INFINITY,
					max: param.max,
					step: param.step ?? 0.01,
					shortLabel: label,
				};
				return (
					<div key={label} className="w-[4.5rem]">
						<NumberParamField
							param={componentParam}
							value={nums[index]}
							onPreview={(next) => {
								const out = nums.slice();
								out[index] = next;
								onPreview(out);
							}}
							onCommit={onCommit}
						/>
					</div>
				);
			})}
		</div>
	);
}

/**
 * Slider form of a number param.
 *
 * Radix reports every pointermove through `onValueChange`, so writes are run
 * through the same snap + clamp pipeline as scrubbing, and only when the value
 * actually moves — `useCoalescedPreview` collapses them to one preview write
 * per frame downstream, but skipping identical writes keeps the comparison in
 * `useKeyframedParamProperty` cheap too. `onValueCommit` is the pointer-up that
 * lands the edit on the undo stack.
 */
function SliderParamField({
	param,
	value,
	onPreview,
	onCommit,
}: {
	param: NumberParamDefinition;
	value: number;
	onPreview: (value: number) => void;
	onCommit: () => void;
}) {
	const { min, max, step, displayMultiplier = 1 } = param;
	const fractionDigits = getFractionDigitsForStep({ step });
	const ceiling = max ?? Math.max(min, 100);
	const displayValue = Math.min(ceiling, Math.max(min, value * displayMultiplier));

	const handleChange = (next: readonly number[]) => {
		const raw = next[0];
		if (raw === undefined) return;
		const snapped = snapToStep({ value: raw, step });
		if (snapped === displayValue) return;
		onPreview(snapped / displayMultiplier);
	};

	return (
		<div className="flex items-center gap-3">
			<Slider
				value={[displayValue]}
				min={min}
				max={ceiling}
				step={step}
				aria-label={param.label}
				onValueChange={handleChange}
				onValueCommit={() => onCommit()}
			/>
			<span className="text-muted-foreground w-9 shrink-0 text-right text-xs tabular-nums">
				{formatNumberForDisplay({
					value: displayValue,
					maxFractionDigits: fractionDigits,
				})}
			</span>
		</div>
	);
}

function NumberParamField({
	param,
	value,
	onPreview,
	onCommit,
}: {
	param: NumberParamDefinition;
	value: number;
	onPreview: (value: number) => void;
	onCommit: () => void;
}) {
	const { min, max, step, displayMultiplier = 1 } = param;
	const displayValue = value * displayMultiplier;
	const clampDisplayValue = (nextDisplayValue: number) =>
		Math.max(
			min,
			max !== undefined ? Math.min(max, nextDisplayValue) : nextDisplayValue,
		);

	const previewFromDisplay = (displayVal: number) => {
		const clamped = clampDisplayValue(
			snapToStep({ value: displayVal, step }),
		);
		onPreview(clamped / displayMultiplier);
	};

	const maxFractionDigits = getFractionDigitsForStep({ step });

	const draft = usePropertyDraft({
		displayValue: formatNumberForDisplay({
			value: displayValue,
			maxFractionDigits,
		}),
		parse: (input) => {
			const parsed = parseFloat(input);
			if (Number.isNaN(parsed)) return null;
			return clampDisplayValue(snapToStep({ value: parsed, step }));
		},
		onPreview: previewFromDisplay,
		onCommit,
	});

	const handleReset = () => {
		onPreview(param.default);
		onCommit();
	};

	return (
		<NumberField
			icon={param.shortLabel}
			value={draft.displayValue}
			suffix={param.unit === "dB" ? "dB" : undefined}
			dragSensitivity="slow"
			isDefault={value === param.default}
			onFocus={draft.onFocus}
			onChange={draft.onChange}
			onBlur={draft.onBlur}
			onScrub={previewFromDisplay}
			onScrubEnd={onCommit}
			onReset={handleReset}
		/>
	);
}
