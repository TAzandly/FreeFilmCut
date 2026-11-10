"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { NumberField } from "@/components/ui/number-field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	Section,
	SectionContent,
	SectionField,
	SectionFields,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import { usePropertyDraft } from "@/components/editor/panels/properties/hooks/use-property-draft";
import { useElementPlayhead } from "@/components/editor/panels/properties/hooks/use-element-playhead";
import { useKeyframedParamProperty } from "@/components/editor/panels/properties/hooks/use-keyframed-param-property";
import { KeyframeToggle } from "@/components/editor/panels/properties/components/keyframe-toggle";
import { useElementPreview } from "@/timeline/hooks/use-element-preview";
import { useEditor } from "@/editor/use-editor";
import { usePackRegistry } from "@/vfxpack/pack-registry";
import { normalizeVfxPackType } from "@/vfxpack/pack-placement";
import { packLibraryThumb } from "@/vfxpack/preview-assets";
import { VfxPackImportButton } from "@/vfxpack/components/vfxpack-import-button";
import type { LoadedVfxPack } from "@/vfxpack/types";
import { addMediaTime, mediaTimeFromSeconds, mediaTimeToSeconds } from "@/wasm";
import { cn } from "@/utils/ui";
import { resolveAnimationPathValueAtTime, upsertPathKeyframe } from "@/animation";
import type { EffectElement, StickerElement } from "@/timeline";
import {
	coerceParamValue,
	getParamChannelLayout,
	type NumberParamDefinition,
	type ParamValues,
} from "@/params";
import { getCanvasTransformParams } from "@/params/registry";
import { formatNumberForDisplay, snapToStep } from "@/utils/math";

type StickerHost = EffectElement | StickerElement;

const SCALE_MIN = 1;
const SCALE_MAX = 500;

export function StickerPropertiesView({
	element,
	trackId,
	page,
}: {
	element: StickerHost;
	trackId: string;
	page: "sticker" | "animation" | "tracking";
}) {
	if (page === "animation") {
		return <StickerAnimationPage element={element} trackId={trackId} />;
	}
	if (page === "tracking") return <StickerTrackingPage />;
	return <StickerTransformPage element={element} trackId={trackId} />;
}

function StickerTransformPage({
	element,
	trackId,
}: {
	element: StickerHost;
	trackId: string;
}) {
	const { renderElement, previewUpdates, commit } = useElementPreview({
		trackId,
		elementId: element.id,
		fallback: element,
	});
	const { localTime, isPlayheadWithinElementRange } = useElementPlayhead({
		startTime: renderElement.startTime,
		duration: renderElement.duration,
	});
	const params = renderElement.params ?? {};
	const uniform = params["transform.uniformScale"] !== false;
	const scaleX = readNumber(params, "transform.scaleX", 1);

	const write = (patch: ParamValues) => {
		previewUpdates({ params: { ...renderElement.params, ...patch } });
	};

	return (
		<div className="flex h-full flex-col">
			<div className="flex h-11 shrink-0 items-center border-b px-3.5">
				<SectionTitle>Sticker</SectionTitle>
			</div>
			<Section sectionKey={`${element.id}:sticker-transform`}>
				<SectionHeader>
					<SectionTitle>Transform</SectionTitle>
				</SectionHeader>
				<SectionContent>
					<SectionFields>
						{uniform ? (
							<UniformScaleField
								element={renderElement}
								trackId={trackId}
								localTime={localTime}
								isPlayheadWithinElementRange={isPlayheadWithinElementRange}
								onPreview={previewUpdates}
								onCommit={commit}
							/>
						) : (
							<>
								<StickerAxisField
									element={renderElement}
									trackId={trackId}
									paramKey="transform.scaleX"
									label="Scale X"
									displayMultiplier={100}
									suffix="%"
									displayMin={SCALE_MIN}
									displayMax={SCALE_MAX}
									displayStep={1}
									localTime={localTime}
									isPlayheadWithinElementRange={isPlayheadWithinElementRange}
								/>
								<StickerAxisField
									element={renderElement}
									trackId={trackId}
									paramKey="transform.scaleY"
									label="Scale Y"
									displayMultiplier={100}
									suffix="%"
									displayMin={SCALE_MIN}
									displayMax={SCALE_MAX}
									displayStep={1}
									localTime={localTime}
									isPlayheadWithinElementRange={isPlayheadWithinElementRange}
								/>
							</>
						)}
						<SectionField label="Uniform scale">
							<Switch
								checked={uniform}
								onCheckedChange={(checked) => {
									write(
										checked
											? {
													"transform.uniformScale": true,
													"transform.scaleY": scaleX,
												}
											: { "transform.uniformScale": false },
									);
									commit();
								}}
							/>
						</SectionField>
						<StickerAxisField
							element={renderElement}
							trackId={trackId}
							paramKey="transform.positionX"
							label="Position X"
							localTime={localTime}
							isPlayheadWithinElementRange={isPlayheadWithinElementRange}
						/>
						<StickerAxisField
							element={renderElement}
							trackId={trackId}
							paramKey="transform.positionY"
							label="Position Y"
							localTime={localTime}
							isPlayheadWithinElementRange={isPlayheadWithinElementRange}
						/>
						<StickerAxisField
							element={renderElement}
							trackId={trackId}
							paramKey="transform.rotate"
							label="Rotation"
							suffix="°"
							localTime={localTime}
							isPlayheadWithinElementRange={isPlayheadWithinElementRange}
						/>
					</SectionFields>
				</SectionContent>
			</Section>
		</div>
	);
}

function UniformScaleField({
	element,
	trackId,
	localTime,
	isPlayheadWithinElementRange,
	onPreview,
	onCommit,
}: {
	element: StickerHost;
	trackId: string;
	localTime: ReturnType<typeof useElementPlayhead>["localTime"];
	isPlayheadWithinElementRange: boolean;
	onPreview: (updates: Partial<StickerHost>) => void;
	onCommit: () => void;
}) {
	const editor = useEditor();
	const scaleParam = requireTransformParam("transform.scaleX");
	const scaleYParam = requireTransformParam("transform.scaleY");
	const scaleX = resolvedNumber({
		element,
		key: "transform.scaleX",
		fallback: 1,
		localTime,
	});
	const scaleY = resolvedNumber({
		element,
		key: "transform.scaleY",
		fallback: 1,
		localTime,
	});
	const scaleXKeys = useKeyframedParamProperty({
		param: scaleParam,
		trackId,
		elementId: element.id,
		animations: element.animations,
		propertyPath: "transform.scaleX",
		localTime,
		isPlayheadWithinElementRange,
		resolvedValue: scaleX,
		buildBaseUpdates: ({ value }) => ({
			params: {
				...element.params,
				"transform.scaleX": value,
				"transform.scaleY": value,
			},
		}),
	});
	const scaleYKeys = useKeyframedParamProperty({
		param: scaleYParam,
		trackId,
		elementId: element.id,
		animations: element.animations,
		propertyPath: "transform.scaleY",
		localTime,
		isPlayheadWithinElementRange,
		resolvedValue: scaleY,
		buildBaseUpdates: ({ value }) => ({
			params: { ...element.params, "transform.scaleY": value },
		}),
	});

	const previewScale = (percent: number) => {
		const scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, percent)) / 100;
		const xAnimated =
			scaleXKeys.hasAnimatedKeyframes && isPlayheadWithinElementRange;
		const yAnimated =
			scaleYKeys.hasAnimatedKeyframes && isPlayheadWithinElementRange;
		if (!xAnimated && !yAnimated) {
			onPreview({
				params: {
					...element.params,
					"transform.scaleX": scale,
					"transform.scaleY": scale,
				},
			});
			return;
		}
		let animations = element.animations;
		const params = { ...element.params };
		if (xAnimated) {
			animations = upsertPathKeyframe({
				animations,
				propertyPath: "transform.scaleX",
				time: localTime,
				value: scale,
				channelLayout: getParamChannelLayout({ param: scaleParam }),
				coerceValue: ({ value }) => coerceParamValue({ param: scaleParam, value }),
			});
		} else {
			params["transform.scaleX"] = scale;
		}
		if (yAnimated) {
			animations = upsertPathKeyframe({
				animations,
				propertyPath: "transform.scaleY",
				time: localTime,
				value: scale,
				channelLayout: getParamChannelLayout({ param: scaleYParam }),
				coerceValue: ({ value }) =>
					coerceParamValue({ param: scaleYParam, value }),
			});
		} else {
			params["transform.scaleY"] = scale;
		}
		onPreview({ params, animations });
	};

	const toggleKeyframe = () => {
		if (!isPlayheadWithinElementRange) return;
		const removals = [
			scaleXKeys.keyframeIdAtTime
				? {
						trackId,
						elementId: element.id,
						propertyPath: "transform.scaleX" as const,
						keyframeId: scaleXKeys.keyframeIdAtTime,
					}
				: null,
			scaleYKeys.keyframeIdAtTime
				? {
						trackId,
						elementId: element.id,
						propertyPath: "transform.scaleY" as const,
						keyframeId: scaleYKeys.keyframeIdAtTime,
					}
				: null,
		].filter((entry) => entry !== null);
		if (removals.length > 0) {
			editor.timeline.removeKeyframes({ keyframes: removals });
			return;
		}
		editor.timeline.upsertKeyframes({
			keyframes: [
				{
					trackId,
					elementId: element.id,
					propertyPath: "transform.scaleX",
					time: localTime,
					value: scaleX,
				},
				{
					trackId,
					elementId: element.id,
					propertyPath: "transform.scaleY",
					time: localTime,
					value: scaleX,
				},
			],
		});
	};

	return (
		<PercentField
			label="Scale"
			percent={scaleX * 100}
			isDefault={scaleX === 1 && scaleY === 1}
			onPreview={previewScale}
			onCommit={onCommit}
			keyframe={{
				isActive: scaleXKeys.isKeyframedAtTime || scaleYKeys.isKeyframedAtTime,
				isDisabled: !isPlayheadWithinElementRange,
				onToggle: toggleKeyframe,
			}}
		/>
	);
}

function StickerAxisField({
	element,
	trackId,
	paramKey,
	label,
	suffix,
	displayMultiplier = 1,
	displayMin,
	displayMax,
	displayStep,
	localTime,
	isPlayheadWithinElementRange,
}: {
	element: StickerHost;
	trackId: string;
	paramKey: "transform.scaleX" | "transform.scaleY" | "transform.positionX" | "transform.positionY" | "transform.rotate";
	label: string;
	suffix?: string;
	displayMultiplier?: number;
	displayMin?: number;
	displayMax?: number;
	displayStep?: number;
	localTime: ReturnType<typeof useElementPlayhead>["localTime"];
	isPlayheadWithinElementRange: boolean;
}) {
	const param = requireTransformParam(paramKey);
	const fallback = typeof param.default === "number" ? param.default : 0;
	const resolved = resolvedNumber({
		element,
		key: paramKey,
		fallback,
		localTime,
	});
	const animated = useKeyframedParamProperty({
		param,
		trackId,
		elementId: element.id,
		animations: element.animations,
		propertyPath: paramKey,
		localTime,
		isPlayheadWithinElementRange,
		resolvedValue: resolved,
		buildBaseUpdates: ({ value }) => ({
			params: { ...element.params, [paramKey]: value },
		}),
	});
	const min = displayMin ?? param.min * displayMultiplier;
	const max = displayMax ?? (param.max ?? 100000) * displayMultiplier;
	const step = displayStep ?? param.step * displayMultiplier;

	return (
		<NumberRow
			label={label}
			value={resolved * displayMultiplier}
			min={min}
			max={max}
			step={step}
			suffix={suffix}
			isDefault={resolved === fallback}
			onPreview={(display) => animated.onPreview(display / displayMultiplier)}
			onCommit={animated.onCommit}
			keyframe={{
				isActive: animated.isKeyframedAtTime,
				isDisabled: !isPlayheadWithinElementRange,
				onToggle: animated.toggleKeyframe,
			}}
		/>
	);
}

function packMotionDuration(pack: LoadedVfxPack | undefined): number {
	const duration = pack?.manifest.motion?.duration ?? pack?.manifest.duration;
	return typeof duration === "number" && duration > 0 ? duration : 0;
}

function StickerAnimationPage({
	element,
	trackId,
}: {
	element: StickerHost;
	trackId: string;
}) {
	const editor = useEditor();
	const packs = usePackRegistry((state) => state.packs);
	const [phase, setPhase] = useState<"in" | "out" | "loop">("in");
	const previewTimer = useRef<number | null>(null);
	const selectedId = element.stickerAnims?.[phase]?.packId ?? null;
	const visible = packs.filter((pack) => {
		if (normalizeVfxPackType(pack.type) !== "sticker-anim") return false;
		const packPhase = pack.manifest.phase;
		const resolved =
			packPhase === "in" || packPhase === "out" || packPhase === "loop"
				? packPhase
				: "in";
		return resolved === phase;
	});

	useEffect(() => {
		return () => {
			if (previewTimer.current != null) window.clearTimeout(previewTimer.current);
		};
	}, []);

	const durationOf = (packId: string | null | undefined) =>
		packMotionDuration(packs.find((pack) => pack.id === packId));

	const assign = (packId: string | null) => {
		const current = element.stickerAnims ?? {};
		editor.timeline.updateElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					patch: {
						stickerAnims: {
							...current,
							[phase]: packId ? { packId } : null,
						},
					},
				},
			],
		});
		if (previewTimer.current != null) {
			window.clearTimeout(previewTimer.current);
			previewTimer.current = null;
		}
		if (!packId) {
			editor.playback.pause();
			return;
		}
		const clipDuration = mediaTimeToSeconds({ time: element.duration });
		const inDuration = phase === "in" ? durationOf(packId) : durationOf(current.in?.packId);
		const outDuration = phase === "out" ? durationOf(packId) : durationOf(current.out?.packId);
		const loopDuration = phase === "loop" ? durationOf(packId) : durationOf(current.loop?.packId);
		let startSec = 0;
		let playSec = 0;
		if (phase === "in") {
			playSec = Math.min(inDuration, clipDuration);
		} else if (phase === "out") {
			playSec = Math.min(outDuration, clipDuration);
			startSec = Math.max(0, clipDuration - playSec);
		} else {
			startSec = Math.min(Math.max(0, inDuration), clipDuration);
			const end = Math.max(startSec, clipDuration - Math.min(Math.max(0, outDuration), clipDuration));
			playSec = Math.min(loopDuration, Math.max(0, end - startSec));
		}
		editor.playback.seek({
			time: addMediaTime({
				a: element.startTime,
				b: mediaTimeFromSeconds({ seconds: startSec }),
			}),
		});
		if (playSec < 0.05) return;
		editor.playback.play();
		previewTimer.current = window.setTimeout(() => {
			previewTimer.current = null;
			editor.playback.pause();
		}, playSec * 1000);
	};

	return (
		<div className="flex h-full flex-col">
			<div className="flex h-11 shrink-0 items-center border-b px-3.5">
				<SectionTitle>Animation</SectionTitle>
			</div>
			<Tabs
				value={phase}
				onValueChange={(value) => setPhase(value as "in" | "out" | "loop")}
				variant="underline"
				className="flex min-h-0 flex-1 flex-col"
			>
				<TabsList aria-label="Sticker animation">
					<TabsTrigger value="in">In</TabsTrigger>
					<TabsTrigger value="out">Out</TabsTrigger>
					<TabsTrigger value="loop">Loop</TabsTrigger>
				</TabsList>
				<TabsContent value={phase} className="min-h-0 flex-1 overflow-auto px-3 py-3">
					<div className="mb-3 flex items-center justify-between gap-2">
						<span className="text-muted-foreground text-xs">
							Sticker animation library
						</span>
						<VfxPackImportButton expectTypes={["sticker-anim"]} />
					</div>
					<div className="flex flex-wrap content-start gap-x-2.5 gap-y-3">
						<StickerAnimChoice
							label="None"
							active={selectedId == null}
							onClick={() => assign(null)}
						>
							<NoneMark />
						</StickerAnimChoice>
						{visible.map((pack) => (
							<StickerAnimChoice
								key={pack.id}
								label={pack.displayName}
								active={pack.id === selectedId}
								onClick={() => assign(pack.id)}
							>
								<StickerAnimThumb pack={pack} />
							</StickerAnimChoice>
						))}
					</div>
					{visible.length === 0 && (
						<p className="text-muted-foreground py-6 text-center text-sm">
							No sticker-anim packs yet. Export from the Asset Editor (pack type
							Sticker animation), then use Import VfxPack here. Same file/id
							replaces the previous import — no index.json needed.
						</p>
					)}
				</TabsContent>
			</Tabs>
		</div>
	);
}

function StickerAnimChoice({
	label,
	active,
	onClick,
	children,
}: {
	label: string;
	active: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button type="button" className="flex w-[50px] flex-col items-center gap-1" onClick={onClick}>
			<div
				className={cn(
					"size-[50px] overflow-hidden rounded-md border-2 bg-[#2a2a2a]",
					active ? "border-[#3b82f6]" : "border-transparent",
				)}
			>
				{children}
			</div>
			<span className="w-full truncate text-center text-[10px] leading-tight text-muted-foreground">
				{label}
			</span>
		</button>
	);
}

function NoneMark() {
	return (
		<div className="text-muted-foreground flex size-full items-center justify-center">
			<svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
				<circle cx="12" cy="12" r="8" />
				<path d="M7.5 16.5 L16.5 7.5" />
			</svg>
		</div>
	);
}

function StickerAnimThumb({ pack }: { pack: LoadedVfxPack }) {
	const { poster, hover } = packLibraryThumb({ pack });
	const imgRef = useRef<HTMLImageElement>(null);
	const [hovering, setHovering] = useState(false);
	const [playId, setPlayId] = useState(0);
	useEffect(() => {
		const img = imgRef.current;
		if (!img) return;
		if (hovering && hover) {
			img.src = "";
			img.src = hover;
			return;
		}
		if (poster) img.src = poster;
	}, [hovering, hover, poster, playId]);
	if (!poster) {
		return <div className="bg-muted size-full" />;
	}
	return (
		// eslint-disable-next-line @next/next/no-img-element
		<img
			ref={imgRef}
			src={poster}
			alt=""
			className="size-full object-contain"
			draggable={false}
			onMouseEnter={() => {
				if (!hover) return;
				setPlayId((value) => value + 1);
				setHovering(true);
			}}
			onMouseLeave={() => setHovering(false)}
		/>
	);
}

function StickerTrackingPage() {
	return (
		<div className="flex h-full flex-col">
			<div className="flex h-11 shrink-0 items-center border-b px-3.5">
				<SectionTitle>Tracking</SectionTitle>
			</div>
			<EmptyNote>Tracking is not available yet.</EmptyNote>
		</div>
	);
}

function EmptyNote({ children }: { children: string }) {
	return <p className="text-muted-foreground px-4 py-6 text-sm">{children}</p>;
}

function PercentField({
	label,
	percent,
	isDefault,
	onPreview,
	onCommit,
	keyframe,
}: {
	label: string;
	percent: number;
	isDefault: boolean;
	onPreview: (percent: number) => void;
	onCommit: () => void;
	keyframe?: KeyframeProps;
}) {
	return (
		<NumberRow
			label={label}
			value={percent}
			min={SCALE_MIN}
			max={SCALE_MAX}
			step={1}
			suffix="%"
			isDefault={isDefault}
			onPreview={onPreview}
			onCommit={onCommit}
			keyframe={keyframe}
		/>
	);
}

function NumberRow({
	label,
	value,
	min,
	max,
	step,
	suffix,
	isDefault,
	onPreview,
	onCommit,
	keyframe,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	suffix?: string;
	isDefault: boolean;
	onPreview: (value: number) => void;
	onCommit: () => void;
	keyframe?: KeyframeProps;
}) {
	const display = formatNumberForDisplay({
		value,
		maxFractionDigits: step < 1 ? 2 : 0,
	});
	const draft = usePropertyDraft({
		displayValue: display,
		parse: (input) => {
			const parsed = parseFloat(input);
			if (Number.isNaN(parsed)) return null;
			const snapped = snapToStep({ value: parsed, step });
			return Math.min(max, Math.max(min, snapped));
		},
		onPreview,
		onCommit,
	});

	return (
		<SectionField
			label={label}
			beforeLabel={
				keyframe ? (
					<KeyframeToggle
						isActive={keyframe.isActive}
						isDisabled={keyframe.isDisabled}
						title={`Toggle ${label.toLowerCase()} keyframe`}
						onToggle={keyframe.onToggle}
					/>
				) : undefined
			}
		>
			<NumberField
				value={draft.displayValue}
				suffix={suffix}
				dragSensitivity="slow"
				isDefault={isDefault}
				onFocus={draft.onFocus}
				onChange={draft.onChange}
				onBlur={draft.onBlur}
				onScrub={(next) => {
					const parsed = Math.min(max, Math.max(min, snapToStep({ value: next, step })));
					onPreview(parsed);
				}}
				onScrubEnd={onCommit}
				onReset={() => {
					onPreview(min === SCALE_MIN && suffix === "%" ? 100 : 0);
					onCommit();
				}}
			/>
		</SectionField>
	);
}

type KeyframeProps = {
	isActive: boolean;
	isDisabled: boolean;
	onToggle: () => void;
};

function requireTransformParam(
	key: "transform.scaleX" | "transform.scaleY" | "transform.positionX" | "transform.positionY" | "transform.rotate",
): NumberParamDefinition {
	const param = getCanvasTransformParams().find((entry) => entry.key === key);
	if (!param || param.type !== "number") {
		throw new Error(`Missing sticker transform param ${key}`);
	}
	return param;
}

function resolvedNumber({
	element,
	key,
	fallback,
	localTime,
}: {
	element: StickerHost;
	key: string;
	fallback: number;
	localTime: number;
}): number {
	const stored = readNumber(element.params ?? {}, key, fallback);
	const resolved = resolveAnimationPathValueAtTime({
		animations: element.animations,
		propertyPath: key,
		localTime,
		fallbackValue: stored,
	});
	return typeof resolved === "number" && Number.isFinite(resolved) ? resolved : stored;
}

function readNumber(params: ParamValues, key: string, fallback: number): number {
	const value = params[key];
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
