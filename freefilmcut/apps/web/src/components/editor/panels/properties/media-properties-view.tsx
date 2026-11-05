"use client";

import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { Search } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	Section,
	SectionContent,
	SectionField,
	SectionFields,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import {
	ElementParamFields,
	ElementParamsTab,
} from "./components/element-params-tab";
import { ColorCorrectionSection } from "./color-correction-section";
import { getElementParams } from "@/params/registry";
import {
	COLOR_GRADE_HSL_PARAM_KEYS,
	curvePointsToParamValue,
	type CurveChannel,
} from "@/color-grade";
import {
	CurvesEditor,
	curvesFromParamStrings,
} from "@/color-grade/components/curves-editor";
import { ChromaKeyTab } from "@/chroma-key/components/chroma-key-tab";
import { MasksTab } from "@/masks/components/masks-tab";
import { SpeedTab } from "@/speed/components/speed-tab";
import type {
	ImageElement,
	MediaAnimAssignment,
	VideoElement,
} from "@/timeline";
import { useElementPreview } from "@/timeline/hooks/use-element-preview";
import type { ParamValues } from "@/params";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { ColorPicker } from "@/components/ui/color-picker";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/utils/ui";
	import {
		BACKGROUND_FILL_MODE_OPTIONS,
		activeBackgroundFillKind,
		type BackgroundFillMode,
		readBackgroundFillFromParams,
	} from "@/background/fill";
import {
	getBackgroundFillStylesSnapshot,
	loadBackgroundFillStyles,
	type BackgroundFillStyleEntry,
} from "@/background/fill-styles";
import { useEditor } from "@/editor/use-editor";
import { usePackRegistry } from "@/vfxpack/pack-registry";
import { normalizeVfxPackType } from "@/vfxpack/pack-placement";
import { packLibraryThumb } from "@/vfxpack/preview-assets";
import type { LoadedVfxPack } from "@/vfxpack/types";
import {
	mediaAnimPackNativeDuration,
	type MediaAnimPhase,
} from "@/vfxpack/media-anim";
import {
	addMediaTime,
	mediaTimeFromSeconds,
	mediaTimeToSeconds,
} from "@/wasm";
import { NumberField } from "@/components/ui/number-field";

type MediaHost = ImageElement | VideoElement;

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

function pickParams({
	element,
	keys,
}: {
	element: MediaHost;
	keys: readonly string[];
}) {
	return getElementParams({ element }).filter((param) => keys.includes(param.key));
}

export type MediaPropertiesPage =
	| "video"
	| "animation"
	| "adjustment"
	| "audio"
	| "speed";

type CanvasSubTab = "basic" | "keying" | "mask";

function asCanvasSubTab(value: string): CanvasSubTab {
	if (value === "keying" || value === "mask") return value;
	return "basic";
}

export function MediaPropertiesView({
	element,
	trackId,
	page,
}: {
	element: MediaHost;
	trackId: string;
	page: MediaPropertiesPage;
}) {
	if (page === "animation") {
		return <MediaAnimationPage element={element} trackId={trackId} />;
	}
	if (page === "adjustment") {
		return <AdjustmentPage element={element} trackId={trackId} />;
	}
	if (page === "audio") {
		if (element.type !== "video") return null;
		return <AudioPage element={element} trackId={trackId} />;
	}
	if (page === "speed") {
		if (element.type !== "video") return null;
		return <SpeedPage element={element} trackId={trackId} />;
	}
	return <CanvasPage element={element} trackId={trackId} />;
}

type AdjustmentSubTab = "basic" | "hsl" | "curves";

function asAdjustmentSubTab(value: string): AdjustmentSubTab {
	if (value === "hsl" || value === "curves") return value;
	return "basic";
}

const COLOR_GRADE_BASIC_KEYS = [
	"colorGrade.temperature",
	"colorGrade.tint",
	"colorGrade.saturation",
	"colorGrade.brightness",
	"colorGrade.contrast",
	"colorGrade.exposure",
	"colorGrade.highlights",
	"colorGrade.shadows",
] as const;

function AdjustmentPage({
	element,
	trackId,
}: {
	element: MediaHost;
	trackId: string;
}) {
	const [subTab, setSubTab] = useState<AdjustmentSubTab>("basic");
	const basicParams = pickParams({ element, keys: COLOR_GRADE_BASIC_KEYS });
	const hslParams = pickParams({ element, keys: COLOR_GRADE_HSL_PARAM_KEYS });

	return (
		<div className="flex h-full flex-col">
			<div className="flex h-11 shrink-0 items-center border-b px-3.5">
				<SectionTitle>Adjustment</SectionTitle>
			</div>
			<Tabs
				value={subTab}
				onValueChange={(value) => setSubTab(asAdjustmentSubTab(value))}
				variant="default"
				className="flex min-h-0 flex-1 flex-col"
			>
				<div className="px-3 pt-3">
					<TabsList
						aria-label="Adjustment sections"
						className="w-full justify-start gap-1"
					>
						<TabsTrigger value="basic">Basic</TabsTrigger>
						<TabsTrigger value="hsl">HSL</TabsTrigger>
						<TabsTrigger value="curves">Curves</TabsTrigger>
					</TabsList>
				</div>
				<TabsContent value="basic" className="min-h-0 flex-1 overflow-auto px-0 py-0">
					<ColorCorrectionSection element={element} trackId={trackId} />
					<Section
						collapsible
						defaultOpen
						sectionKey={`${element.id}:color-basic`}
					>
						<SectionHeader>
							<SectionTitle>Basic</SectionTitle>
						</SectionHeader>
						<SectionContent>
							<SectionFields>
								<ElementParamFields
									element={element}
									trackId={trackId}
									params={basicParams}
								/>
							</SectionFields>
						</SectionContent>
					</Section>
				</TabsContent>
				<TabsContent value="hsl" className="min-h-0 flex-1 overflow-auto px-0 py-0">
					<Section
						collapsible
						defaultOpen
						sectionKey={`${element.id}:color-hsl`}
					>
						<SectionHeader>
							<SectionTitle>HSL</SectionTitle>
						</SectionHeader>
						<SectionContent>
							<SectionFields>
								<ElementParamFields
									element={element}
									trackId={trackId}
									params={hslParams}
								/>
							</SectionFields>
						</SectionContent>
					</Section>
				</TabsContent>
				<TabsContent
					value="curves"
					className="min-h-0 flex-1 overflow-auto px-0 py-0"
				>
					<AdjustmentCurvesTab element={element} trackId={trackId} />
				</TabsContent>
			</Tabs>
		</div>
	);
}

function AdjustmentCurvesTab({
	element,
	trackId,
}: {
	element: MediaHost;
	trackId: string;
}) {
	const { renderElement, previewUpdates, commit } = useElementPreview({
		trackId,
		elementId: element.id,
		fallback: element,
	});
	const params = renderElement.params ?? {};
	const curves = curvesFromParamStrings({
		master:
			typeof params["colorGrade.curves.master"] === "string"
				? params["colorGrade.curves.master"]
				: undefined,
		r:
			typeof params["colorGrade.curves.r"] === "string"
				? params["colorGrade.curves.r"]
				: undefined,
		g:
			typeof params["colorGrade.curves.g"] === "string"
				? params["colorGrade.curves.g"]
				: undefined,
		b:
			typeof params["colorGrade.curves.b"] === "string"
				? params["colorGrade.curves.b"]
				: undefined,
	});

	return (
		<Section collapsible defaultOpen sectionKey={`${element.id}:color-curves`}>
			<SectionHeader>
				<SectionTitle>Curves</SectionTitle>
			</SectionHeader>
			<SectionContent className="px-0">
				<CurvesEditor
					curves={curves}
					onPreview={(channel: CurveChannel, points) => {
						previewUpdates({
							params: {
								...params,
								[`colorGrade.curves.${channel}`]:
									curvePointsToParamValue(points),
							},
						});
					}}
					onCommit={() => commit()}
				/>
			</SectionContent>
		</Section>
	);
}

function CanvasPage({
	element,
	trackId,
}: {
	element: MediaHost;
	trackId: string;
}) {
	const [subTab, setSubTab] = useState<CanvasSubTab>("basic");

	return (
		<div className="flex h-full flex-col">
			<div className="flex h-11 shrink-0 items-center border-b px-3.5">
				<SectionTitle>Video</SectionTitle>
			</div>
			<Tabs
				value={subTab}
				onValueChange={(value) => setSubTab(asCanvasSubTab(value))}
				variant="default"
				className="flex min-h-0 flex-1 flex-col"
			>
				<div className="px-3 pt-3">
					<TabsList aria-label="Video sections" className="w-full justify-start gap-1">
						<TabsTrigger value="basic">Basic</TabsTrigger>
						<TabsTrigger value="keying">Keying</TabsTrigger>
						<TabsTrigger value="mask">Mask</TabsTrigger>
					</TabsList>
				</div>
				<TabsContent value="basic" className="min-h-0 flex-1 overflow-auto px-0 py-0">
					<BasicTab element={element} trackId={trackId} />
				</TabsContent>
				<TabsContent value="keying" className="min-h-0 flex-1 overflow-auto px-0 py-0">
					<ChromaKeyTab element={element} trackId={trackId} />
				</TabsContent>
				<TabsContent value="mask" className="min-h-0 flex-1 overflow-auto px-0 py-0">
					<MasksTab element={element} trackId={trackId} />
				</TabsContent>
			</Tabs>
		</div>
	);
}

function BasicTab({
	element,
	trackId,
}: {
	element: MediaHost;
	trackId: string;
}) {
	const transformParams = pickParams({ element, keys: TRANSFORM_PARAM_KEYS });
	const blendParams = pickParams({ element, keys: BLENDING_PARAM_KEYS });

	return (
		<div className="flex flex-col pb-4">
			<Section collapsible defaultOpen sectionKey={`${element.id}:media-transform`}>
				<SectionHeader>
					<SectionTitle>Position & size</SectionTitle>
				</SectionHeader>
				<SectionContent>
					<SectionFields>
						<ElementParamFields
							element={element}
							trackId={trackId}
							params={transformParams}
						/>
					</SectionFields>
				</SectionContent>
			</Section>
			<Section collapsible defaultOpen sectionKey={`${element.id}:media-blend`}>
				<SectionHeader>
					<SectionTitle>Blend</SectionTitle>
				</SectionHeader>
				<SectionContent>
					<SectionFields>
						<ElementParamFields
							element={element}
							trackId={trackId}
							params={blendParams}
						/>
					</SectionFields>
				</SectionContent>
			</Section>
				<BackgroundFillSection element={element} trackId={trackId} />
			</div>
		);
	}

	function asFillMode(value: string): BackgroundFillMode {
		if (
			value === "blur" ||
			value === "color" ||
			value === "style" ||
			value === "none"
		) {
			return value;
		}
		return "none";
	}

	function BackgroundFillSection({
		element,
		trackId,
	}: {
		element: MediaHost;
		trackId: string;
	}) {
	const { renderElement, previewUpdates, commit } = useElementPreview({
		trackId,
		elementId: element.id,
		fallback: element,
	});
	const fill = readBackgroundFillFromParams({ params: renderElement.params });
	const enabled = fill.enabled;
	const fillKind = activeBackgroundFillKind({ fill });
	const [styles, setStyles] = useState<BackgroundFillStyleEntry[]>(() =>
		getBackgroundFillStylesSnapshot(),
	);

	useEffect(() => {
		void loadBackgroundFillStyles().then(setStyles);
	}, []);

	const patchParams = (patch: ParamValues) => {
		previewUpdates({
			params: { ...(renderElement.params ?? {}), ...patch },
		});
	};
	const commitParams = (patch: ParamValues) => {
		patchParams(patch);
		commit();
	};

	return (
		<Section
			collapsible
			defaultOpen={enabled}
			sectionKey={`${element.id}:media-bg-fill`}
		>
			<SectionHeader>
				<SectionTitle>Background fill</SectionTitle>
			</SectionHeader>
			<SectionContent>
				<SectionFields>
					<div className="flex items-center justify-between px-0.5">
						<span className="text-sm">Enabled</span>
						<Switch
							checked={enabled}
							onCheckedChange={(checked) => {
								if (checked) {
									const restored =
										typeof renderElement.params?.["backgroundFill.lastKind"] ===
										"string"
											? asFillMode(
													String(
														renderElement.params["backgroundFill.lastKind"],
													),
												)
											: fillKind;
									const mode =
										restored === "none" ? "blur" : restored;
									commitParams({
										"backgroundFill.enabled": true,
										"backgroundFill.mode": mode,
										"backgroundFill.lastKind": mode,
									});
									return;
								}
								commitParams({
									"backgroundFill.enabled": false,
									"backgroundFill.mode": "none",
									"backgroundFill.lastKind": fillKind,
								});
							}}
						/>
					</div>
					{enabled && (
						<>
							<SectionField label="Type">
									<Select
										value={fillKind}
										onValueChange={(value) => {
											const mode = asFillMode(value);
											if (mode === "none") return;
											const patch: ParamValues = {
												"backgroundFill.enabled": true,
												"backgroundFill.mode": mode,
												"backgroundFill.lastKind": mode,
											};
											if (mode === "color") {
												// Ensure a visible CSS color (picker emits bare hex).
												const raw = fill.color?.replace(/^#/, "") ?? "";
												patch["backgroundFill.color"] =
													raw.length > 0
														? `#${raw}`
														: "#FFFFFF";
											}
											if (mode === "style" && !fill.styleId && styles[0]) {
												patch["backgroundFill.styleId"] = styles[0].id;
											}
											commitParams(patch);
										}}
									>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{BACKGROUND_FILL_MODE_OPTIONS.filter(
											(option) => option.value !== "none",
										).map((option) => (
											<SelectItem key={option.value} value={option.value}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</SectionField>
								{fillKind === "blur" && (
								<SectionField label="Blur">
									<div className="flex w-full items-center gap-2">
										<Slider
											min={0}
											max={100}
											step={1}
											value={[fill.blurIntensity]}
											onValueChange={(values) => {
												const next = values[0];
												if (next === undefined) return;
												patchParams({
													"backgroundFill.blurIntensity": next,
												});
											}}
											onValueCommit={() => commit()}
											className="flex-1"
										/>
										<span className="text-muted-foreground w-8 text-right text-xs tabular-nums">
											{Math.round(fill.blurIntensity)}
										</span>
									</div>
								</SectionField>
							)}
								{fillKind === "color" && (
								<SectionField label="Color">
									<ColorPicker
										value={fill.color.replace(/^#/, "").toUpperCase()}
										onChange={(color) =>
											patchParams({
												"backgroundFill.color": `#${color.replace(/^#/, "")}`,
											})
										}
										onChangeEnd={(color) =>
											commitParams({
												"backgroundFill.color": `#${color.replace(/^#/, "")}`,
											})
										}
									/>
								</SectionField>
							)}
								{fillKind === "style" && (
								<div className="grid grid-cols-3 gap-2 px-0.5 pt-1">
									{styles.map((style) => {
										const selected = fill.styleId === style.id;
										return (
											<button
												key={style.id}
												type="button"
												className={cn(
													"overflow-hidden rounded-md border bg-muted/40 text-left",
													selected
														? "border-primary ring-1 ring-primary"
														: "border-transparent hover:border-border",
												)}
													onClick={() =>
														commitParams({
															"backgroundFill.enabled": true,
															"backgroundFill.styleId": style.id,
															"backgroundFill.mode": "style",
														})
													}
											>
												<div className="aspect-square w-full overflow-hidden">
													<img
														src={style.posterUrl ?? style.url}
														alt=""
														className="size-full object-cover"
														draggable={false}
													/>
												</div>
												<div className="truncate px-1.5 py-1 text-[10px]">
													{style.name}
												</div>
											</button>
										);
									})}
									{styles.length === 0 && (
										<p className="text-muted-foreground col-span-3 text-[11px]">
											No fill styles found.
										</p>
									)}
								</div>
							)}
						</>
					)}
				</SectionFields>
			</SectionContent>
		</Section>
	);
}

function AudioPage({
	element,
	trackId,
}: {
	element: VideoElement;
	trackId: string;
}) {
	return (
		<div className="flex h-full flex-col">
			<div className="flex h-11 shrink-0 items-center border-b px-3.5">
				<SectionTitle>Audio</SectionTitle>
			</div>
			<div className="min-h-0 flex-1 overflow-auto">
				<ElementParamsTab
					element={element}
					trackId={trackId}
					paramKeys={AUDIO_PARAM_KEYS}
					sectionKey="media-audio"
				/>
			</div>
		</div>
	);
}

function SpeedPage({
	element,
	trackId,
}: {
	element: VideoElement;
	trackId: string;
}) {
	return (
		<div className="flex h-full flex-col">
			<div className="flex h-11 shrink-0 items-center border-b px-3.5">
				<SectionTitle>Speed</SectionTitle>
			</div>
			<div className="min-h-0 flex-1 overflow-auto">
				<SpeedTab element={element} trackId={trackId} />
			</div>
		</div>
	);
}

function asMediaAnimPhase(value: string): MediaAnimPhase {
	if (value === "out" || value === "combo") return value;
	return "in";
}

function MediaAnimationPage({
	element,
	trackId,
}: {
	element: MediaHost;
	trackId: string;
}) {
	const editor = useEditor();
	const packs = usePackRegistry((state) => state.packs);
	const [phase, setPhase] = useState<MediaAnimPhase>("in");
	const [query, setQuery] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const previewTimer = useRef<number | null>(null);
	const assignment = element.mediaAnims ?? {};
	const selectedId = assignment[phase]?.packId ?? null;
	const selectedDuration = assignment[phase]?.durationSec;
	const durationSec =
		selectedDuration ??
		mediaAnimPackNativeDuration({
			pack: packs.find((p) => p.id === selectedId),
		});
	const [durationDraft, setDurationDraft] = useState(String(durationSec));

	const visible = useMemo(() => {
		const q = query.trim().toLowerCase();
		return packs.filter((pack) => {
			if (normalizeVfxPackType(pack.type) !== "clip-anim") return false;
			const packPhase = pack.manifest.phase;
			const resolved: MediaAnimPhase =
				packPhase === "out" || packPhase === "combo" ? packPhase : "in";
			if (resolved !== phase) return false;
			if (!q) return true;
			const name = (pack.displayName || pack.id).toLowerCase();
			return name.includes(q) || pack.id.toLowerCase().includes(q);
		});
	}, [packs, phase, query]);

	useEffect(() => {
		setDurationDraft(String(durationSec));
	}, [durationSec, selectedId, phase]);

	useEffect(() => {
		return () => {
			if (previewTimer.current != null) window.clearTimeout(previewTimer.current);
		};
	}, []);

	const writeAssignment = ({
		packId,
		durationSec: nextDuration,
	}: {
		packId: string | null;
		durationSec?: number;
	}) => {
		const current = element.mediaAnims ?? {};
		let next: MediaAnimAssignment;
		if (!packId) {
			next = { ...current, [phase]: null };
		} else {
			const pack = packs.find((entry) => entry.id === packId);
			const native = mediaAnimPackNativeDuration({ pack });
			const slot = {
				packId,
				durationSec:
					typeof nextDuration === "number" && nextDuration > 0
						? nextDuration
						: native,
			};
			if (phase === "combo") {
				next = { in: null, out: null, combo: slot };
			} else {
				next = { ...current, combo: null, [phase]: slot };
			}
		}
		editor.timeline.updateElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					patch: { mediaAnims: next },
				},
			],
		});
		return next;
	};

	const playAssignmentPreview = ({
		packId,
		durationSec: nextDuration,
	}: {
		packId: string;
		durationSec?: number;
	}) => {
		if (previewTimer.current != null) {
			window.clearTimeout(previewTimer.current);
			previewTimer.current = null;
		}
		const clipDuration = mediaTimeToSeconds({ time: element.duration });
		const playSec = Math.min(
			typeof nextDuration === "number" && nextDuration > 0
				? nextDuration
				: mediaAnimPackNativeDuration({
						pack: packs.find((entry) => entry.id === packId),
					}),
			clipDuration,
		);
		let startSec = 0;
		if (phase === "out") {
			startSec = Math.max(0, clipDuration - playSec);
		} else if (phase === "combo") {
			startSec = 0;
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

	const assign = ({
		packId,
		durationSec: nextDuration,
	}: {
		packId: string | null;
		durationSec?: number;
	}) => {
		writeAssignment({ packId, durationSec: nextDuration });
		if (!packId) {
			if (previewTimer.current != null) {
				window.clearTimeout(previewTimer.current);
				previewTimer.current = null;
			}
			editor.playback.pause();
			return;
		}
		playAssignmentPreview({ packId, durationSec: nextDuration });
	};

	const commitDuration = ({
		next,
		preview,
	}: {
		next: number;
		preview: boolean;
	}) => {
		if (!selectedId || !Number.isFinite(next) || next <= 0) return;
		const clamped = Math.min(120, Math.max(0.1, next));
		setDurationDraft(String(clamped));
		writeAssignment({ packId: selectedId, durationSec: clamped });
		if (preview) {
			playAssignmentPreview({ packId: selectedId, durationSec: clamped });
		}
	};

	return (
		<div className="flex h-full flex-col">
			<div className="flex h-11 shrink-0 items-center border-b px-3.5">
				<SectionTitle>Animation</SectionTitle>
			</div>
			<Tabs
				value={phase}
				onValueChange={(value) => setPhase(asMediaAnimPhase(value))}
				variant="underline"
				className="flex min-h-0 flex-1 flex-col"
			>
				<TabsList aria-label="Clip animation">
					<TabsTrigger value="in">In</TabsTrigger>
					<TabsTrigger value="out">Out</TabsTrigger>
					<TabsTrigger value="combo">Combo</TabsTrigger>
				</TabsList>
				<TabsContent value={phase} className="flex min-h-0 flex-1 flex-col px-0 py-0">
					<div className="flex items-center gap-2 px-3 pt-3">
						<span className="text-muted-foreground text-xs">
							Clip animation library
						</span>
						<div className="ml-auto">
							<button
								type="button"
								className="text-muted-foreground hover:text-foreground rounded-md p-1.5"
								aria-label="Search"
								onClick={() => setSearchOpen((v) => !v)}
							>
								<Search className="size-4" />
							</button>
						</div>
					</div>
					{searchOpen && (
						<div className="px-3 pt-2">
							<input
								value={query}
								onChange={(e) => setQuery(e.currentTarget.value)}
								placeholder="Search clip animations"
								className="border-input bg-accent h-8 w-full rounded-md border px-2.5 text-sm outline-none"
							/>
						</div>
					)}
					{selectedId && (
						<div className="px-3 pt-2">
							<SectionField label="Duration">
								<NumberField
									value={durationDraft}
									suffix="s"
									scrubRanges={[{ from: 0.1, to: 30, pixelsPerUnit: 40 }]}
									scrubClamp={{ min: 0.1, max: 120 }}
									onChange={(event) => {
										setDurationDraft(event.currentTarget.value);
									}}
									onScrub={(next) => {
										if (!Number.isFinite(next) || next <= 0) return;
										commitDuration({ next, preview: false });
									}}
									onScrubEnd={() => {
										const parsed = parseFloat(durationDraft);
										commitDuration({ next: parsed, preview: true });
									}}
									onBlur={() => {
										const parsed = parseFloat(durationDraft);
										if (!Number.isFinite(parsed) || parsed <= 0) {
											setDurationDraft(String(durationSec));
											return;
										}
										commitDuration({ next: parsed, preview: true });
									}}
								/>
							</SectionField>
						</div>
					)}
					<div className="min-h-0 flex-1 overflow-auto px-3 py-3">
						<div className="flex flex-wrap content-start gap-x-2.5 gap-y-3">
							<AnimChoice
								label="None"
								active={selectedId == null}
								onClick={() => assign({ packId: null })}
							>
								<NoneMark />
							</AnimChoice>
							{visible.map((pack) => (
								<AnimChoice
									key={pack.id}
									label={pack.displayName || pack.id}
									active={pack.id === selectedId}
									onClick={() => assign({ packId: pack.id })}
								>
									<ClipAnimThumb pack={pack} />
								</AnimChoice>
							))}
						</div>
						{visible.length === 0 && (
							<p className="text-muted-foreground py-6 text-center text-sm">
								No clip-anim packs yet. Export from the editor (pack type Clip
								animation, phase In/Out/Combo), place under
								vfxpacks/clip-anims/in|out|combo/, and list the .vfxpack filename
								in that folder&apos;s index.json.
							</p>
						)}
					</div>
				</TabsContent>
			</Tabs>
		</div>
	);
}

function ClipAnimThumb({ pack }: { pack: LoadedVfxPack }) {
	const { poster, hover } = packLibraryThumb({ pack });
	const imgRef = useRef<HTMLImageElement>(null);
	const [hovering, setHovering] = useState(false);
	useEffect(() => {
		const img = imgRef.current;
		if (!img) return;
		if (hovering && hover) {
			img.src = "";
			img.src = hover;
			return;
		}
		if (poster) img.src = poster;
	}, [hovering, hover, poster]);
	if (!poster) {
		return (
			<div className="text-muted-foreground flex size-full items-center justify-center px-1 text-center text-[9px] leading-tight">
				{(pack.displayName || pack.id).slice(0, 8)}
			</div>
		);
	}
	return (
		// eslint-disable-next-line @next/next/no-img-element
		<img
			ref={imgRef}
			src={poster}
			alt=""
			className="size-full object-cover"
			onMouseEnter={() => setHovering(true)}
			onMouseLeave={() => setHovering(false)}
		/>
	);
}

function AnimChoice({
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
		<button
			type="button"
			className="flex w-[50px] flex-col items-center gap-1"
			onClick={onClick}
		>
			<div
				className={cn(
					"size-[50px] overflow-hidden rounded-md border-2 bg-[#2a2a2a]",
					active ? "border-[#3b82f6]" : "border-transparent",
				)}
			>
				{children}
			</div>
			<span className="text-muted-foreground w-full truncate text-center text-[10px] leading-tight">
				{label}
			</span>
		</button>
	);
}

function NoneMark() {
	return (
		<div className="text-muted-foreground flex size-full items-center justify-center">
			<svg
				viewBox="0 0 24 24"
				className="size-7"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.6"
				aria-hidden="true"
			>
				<circle cx="12" cy="12" r="8" />
				<path d="M7.5 16.5 L16.5 7.5" />
			</svg>
		</div>
	);
}
