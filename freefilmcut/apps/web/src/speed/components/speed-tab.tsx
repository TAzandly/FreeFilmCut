import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/editor/use-editor";
import { NumberField } from "@/components/ui/number-field";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HugeiconsIcon } from "@hugeicons/react";
import { DashboardSpeed02Icon } from "@hugeicons/core-free-icons";
import {
	buildConstantRetime,
	buildRetimeFromCurvePreset,
	getTimelineDurationForSourceSpan,
	isCurveRetime,
	RETIME_CURVE_PRESETS,
	type RetimeCurvePresetId,
} from "@/retime";
import {
	DEFAULT_RETIME_RATE,
	MIN_RETIME_RATE,
	MAX_RETIME_RATE,
	clampRetimeRate,
	canMaintainPitch,
} from "@/retime/rate";
import type { AudioElement, VideoElement } from "@/timeline";
import {
	Section,
	SectionContent,
	SectionField,
	SectionFields,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import { usePropertyDraft } from "@/components/editor/panels/properties/hooks/use-property-draft";
import {
	formatNumberForDisplay,
	getFractionDigitsForStep,
	snapToStep,
} from "@/utils/math";
import { mediaTimeToSeconds, roundMediaTime, TICKS_PER_SECOND } from "@/wasm";
import { cn } from "@/utils/ui";

const SPEED_STEP = 0.01;
const SPEED_FRACTION_DIGITS = getFractionDigitsForStep({ step: SPEED_STEP });
const DURATION_STEP = 0.1;
const DURATION_FRACTION_DIGITS = getFractionDigitsForStep({
	step: DURATION_STEP,
});

type SpeedMode = "normal" | "curve";

function asSpeedMode(value: string): SpeedMode {
	return value === "curve" ? "curve" : "normal";
}

function rateToDisplay({ rate }: { rate: number }): string {
	return formatNumberForDisplay({
		value: rate,
		fractionDigits: SPEED_FRACTION_DIGITS,
	});
}

function durationToDisplay({ seconds }: { seconds: number }): string {
	return formatNumberForDisplay({
		value: seconds,
		fractionDigits: DURATION_FRACTION_DIGITS,
	});
}

function parseSpeedInput({ input }: { input: string }): number | null {
	const parsed = parseFloat(input);
	if (Number.isNaN(parsed)) return null;
	return clampRetimeRate({
		rate: snapToStep({ value: parsed, step: SPEED_STEP }),
	});
}

function parseDurationInput({ input }: { input: string }): number | null {
	const parsed = parseFloat(input);
	if (Number.isNaN(parsed) || parsed <= 0) return null;
	return snapToStep({ value: parsed, step: DURATION_STEP });
}

function buildRetime({
	rate,
	maintainPitch,
}: {
	rate: number;
	maintainPitch: boolean;
}) {
	if (rate === DEFAULT_RETIME_RATE && !maintainPitch) return undefined;
	return buildConstantRetime({ rate, maintainPitch });
}

function visibleSourceSpanTicks({
	element,
}: {
	element: AudioElement | VideoElement;
}): number {
	const sourceDuration =
		typeof element.sourceDuration === "number"
			? element.sourceDuration
			: element.duration * (element.retime?.rate ?? DEFAULT_RETIME_RATE) +
				element.trimStart +
				element.trimEnd;
	return Math.max(0, sourceDuration - element.trimStart - element.trimEnd);
}

function activeCurvePresetId({
	element,
}: {
	element: AudioElement | VideoElement;
}): RetimeCurvePresetId {
	if (!isCurveRetime({ retime: element.retime })) return "none";
	const id = element.retime?.curveId;
	const match = RETIME_CURVE_PRESETS.find((preset) => preset.id === id);
	return match?.id ?? "custom";
}

export function SpeedTab({
	element,
	trackId,
}: {
	element: AudioElement | VideoElement;
	trackId: string;
}) {
	const curveActive = isCurveRetime({ retime: element.retime });
	const [mode, setMode] = useState<SpeedMode>(curveActive ? "curve" : "normal");

	useEffect(() => {
		setMode(isCurveRetime({ retime: element.retime }) ? "curve" : "normal");
	}, [element.id, element.retime?.mode]);

	return (
		<Tabs
			value={mode}
			onValueChange={(value) => setMode(asSpeedMode(value))}
			variant="default"
			className="flex min-h-0 flex-1 flex-col"
		>
			<div className="px-3 pt-3">
				<TabsList aria-label="Speed modes" className="w-full justify-start gap-1">
					<TabsTrigger value="normal">Normal</TabsTrigger>
					<TabsTrigger value="curve">Curve</TabsTrigger>
				</TabsList>
			</div>
			<TabsContent value="normal" className="min-h-0 flex-1 overflow-auto px-0 py-0">
				<NormalSpeedPanel element={element} trackId={trackId} />
			</TabsContent>
			<TabsContent value="curve" className="min-h-0 flex-1 overflow-auto px-0 py-0">
				<CurveSpeedPanel element={element} trackId={trackId} />
			</TabsContent>
		</Tabs>
	);
}

function NormalSpeedPanel({
	element,
	trackId,
}: {
	element: AudioElement | VideoElement;
	trackId: string;
}) {
	const editor = useEditor();
	const rate = clampRetimeRate({
		rate: element.retime?.rate ?? DEFAULT_RETIME_RATE,
	});
	const isPitchPreserveAvailable = canMaintainPitch({ rate });
	const maintainPitch = element.retime?.maintainPitch ?? false;
	const pendingRateRef = useRef(rate);
	const durationSeconds = mediaTimeToSeconds({ time: element.duration });
	const pendingDurationRef = useRef(durationSeconds);
	const sourceSpanTicks = visibleSourceSpanTicks({ element });

	const previewRetime = ({
		nextRate,
		nextMaintainPitch,
	}: {
		nextRate: number;
		nextMaintainPitch: boolean;
	}) => {
		const nextRetime = buildRetime({
			rate: nextRate,
			maintainPitch: nextMaintainPitch,
		});
		const nextDuration = roundMediaTime({
			time: getTimelineDurationForSourceSpan({
				sourceSpan: sourceSpanTicks,
				retime: nextRetime,
			}),
		});
		editor.timeline.previewElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					updates: { retime: nextRetime, duration: nextDuration },
				},
			],
		});
	};

	const commitRetime = ({
		rate: nextRate,
		maintainPitch: nextMaintainPitch,
	}: {
		rate: number;
		maintainPitch: boolean;
	}) => {
		editor.timeline.updateElementRetime({
			trackId,
			elementId: element.id,
			retime: buildRetime({ rate: nextRate, maintainPitch: nextMaintainPitch }),
		});
	};

	const commitDurationSeconds = ({ seconds }: { seconds: number }) => {
		if (sourceSpanTicks <= 0 || seconds <= 0) return;
		const sourceSpanSeconds = sourceSpanTicks / TICKS_PER_SECOND;
		const nextRate = clampRetimeRate({
			rate: sourceSpanSeconds / seconds,
		});
		commitRetime({ rate: nextRate, maintainPitch });
	};

	const speedDraft = usePropertyDraft({
		displayValue: rateToDisplay({ rate }),
		parse: (input) => parseSpeedInput({ input }),
		onPreview: (nextRate) => {
			pendingRateRef.current = nextRate;
			previewRetime({ nextRate, nextMaintainPitch: maintainPitch });
		},
		onCommit: () => {
			commitRetime({ rate: pendingRateRef.current, maintainPitch });
		},
	});

	const durationDraft = usePropertyDraft({
		displayValue: durationToDisplay({ seconds: durationSeconds }),
		parse: (input) => parseDurationInput({ input }),
		onPreview: (nextSeconds) => {
			pendingDurationRef.current = nextSeconds;
			if (sourceSpanTicks <= 0 || nextSeconds <= 0) return;
			const sourceSpanSeconds = sourceSpanTicks / TICKS_PER_SECOND;
			const nextRate = clampRetimeRate({
				rate: sourceSpanSeconds / nextSeconds,
			});
			previewRetime({ nextRate, nextMaintainPitch: maintainPitch });
		},
		onCommit: () => {
			commitDurationSeconds({ seconds: pendingDurationRef.current });
		},
	});

	return (
		<Section collapsible sectionKey={`${element.id}:speed-normal`}>
			<SectionHeader>
				<SectionTitle>Normal</SectionTitle>
			</SectionHeader>
			<SectionContent>
				<SectionFields>
					<SectionField label="Speed">
						<NumberField
							icon={<HugeiconsIcon icon={DashboardSpeed02Icon} />}
							value={speedDraft.displayValue}
							suffix="x"
							scrubRanges={[
								{ from: 0.01, to: 1, pixelsPerUnit: 160 },
								{ from: 1, to: 5, pixelsPerUnit: 48 },
							]}
							scrubClamp={{ min: MIN_RETIME_RATE, max: MAX_RETIME_RATE }}
							onFocus={() => {
								pendingRateRef.current = rate;
								speedDraft.onFocus();
							}}
							onChange={speedDraft.onChange}
							onBlur={speedDraft.onBlur}
							onScrub={speedDraft.scrubTo}
							onScrubEnd={speedDraft.commitScrub}
							onReset={() =>
								commitRetime({ rate: DEFAULT_RETIME_RATE, maintainPitch })
							}
							isDefault={rate === DEFAULT_RETIME_RATE}
						/>
					</SectionField>
					<SectionField label="Duration">
						<NumberField
							value={durationDraft.displayValue}
							suffix="s"
							scrubRanges={[{ from: 0.1, to: 600, pixelsPerUnit: 24 }]}
							scrubClamp={{ min: 0.1, max: 36000 }}
							onFocus={() => {
								pendingDurationRef.current = durationSeconds;
								durationDraft.onFocus();
							}}
							onChange={durationDraft.onChange}
							onBlur={durationDraft.onBlur}
							onScrub={durationDraft.scrubTo}
							onScrubEnd={durationDraft.commitScrub}
						/>
					</SectionField>
					<div className="flex items-center justify-between">
						<span className="text-sm">Change pitch</span>
						<Switch
							checked={!maintainPitch}
							disabled={!isPitchPreserveAvailable}
							onCheckedChange={(checked) =>
								commitRetime({ rate, maintainPitch: !checked })
							}
						/>
					</div>
				</SectionFields>
			</SectionContent>
		</Section>
	);
}

function CurveSpeedPanel({
	element,
	trackId,
}: {
	element: AudioElement | VideoElement;
	trackId: string;
}) {
	const editor = useEditor();
	const selected = activeCurvePresetId({ element });
	const maintainPitch = element.retime?.maintainPitch ?? false;

	const applyPreset = ({ presetId }: { presetId: RetimeCurvePresetId }) => {
		editor.timeline.updateElementRetime({
			trackId,
			elementId: element.id,
			retime: buildRetimeFromCurvePreset({
				presetId,
				maintainPitch,
			}),
		});
	};

	return (
		<Section collapsible sectionKey={`${element.id}:speed-curve`}>
			<SectionHeader>
				<SectionTitle>Curve</SectionTitle>
			</SectionHeader>
			<SectionContent>
				<div className="grid grid-cols-2 gap-2 px-0.5 pb-2">
					{RETIME_CURVE_PRESETS.map((preset) => {
						const isSelected = selected === preset.id;
						return (
							<button
								key={preset.id}
								type="button"
								className={cn(
									"rounded-md border px-2 py-2.5 text-left text-xs transition-colors",
									isSelected
										? "border-primary bg-primary/10"
										: "border-border/60 hover:border-border hover:bg-muted/40",
								)}
								onClick={() => applyPreset({ presetId: preset.id })}
							>
								<div className="font-medium">{preset.label}</div>
								<CurveMiniSpark keys={preset.keys} />
							</button>
						);
					})}
				</div>
				<p className="text-muted-foreground px-0.5 text-[11px]">
					Presets remap playback rate over the clip. Custom key editing comes
					later.
				</p>
			</SectionContent>
		</Section>
	);
}

function CurveMiniSpark({
	keys,
}: {
	keys: readonly { t: number; rate: number }[];
}) {
	const width = 120;
	const height = 28;
	const maxRate = Math.max(1, ...keys.map((key) => key.rate));
	const points = keys
		.map((key) => {
			const x = key.t * width;
			const y = height - (key.rate / maxRate) * (height - 4) - 2;
			return `${x},${y}`;
		})
		.join(" ");

	return (
		<svg
			viewBox={`0 0 ${width} ${height}`}
			className="text-muted-foreground mt-1.5 h-7 w-full"
			aria-hidden
		>
			<polyline
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				points={points}
			/>
		</svg>
	);
}
