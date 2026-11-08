"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { NumberField } from "@/components/ui/number-field";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ColorPicker } from "@/components/ui/color-picker";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	Section,
	SectionContent,
	SectionField,
	SectionFields,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import { KeyframeToggle } from "@/components/editor/panels/properties/components/keyframe-toggle";
import { ElementParamsTab } from "@/components/editor/panels/properties/components/element-params-tab";
import { useElementPreview } from "@/timeline/hooks/use-element-preview";
import { useEditor } from "@/editor/use-editor";
import { usePackRegistry } from "@/vfxpack/pack-registry";
import { normalizeVfxPackType } from "@/vfxpack/pack-placement";
import { packLibraryThumb } from "@/vfxpack/preview-assets";
import type { LoadedVfxPack } from "@/vfxpack/types";
import { textAnimPackDuration } from "@/vfxpack/text-anim-motion";
import { isEmbeddedTextAnimPackId } from "@/vfxpack/text-template-textanim";
import { mediaTimeFromSeconds, mediaTimeToSeconds, addMediaTime } from "@/wasm";
import { cn } from "@/utils/ui";
import { formatNumberForDisplay, snapToStep } from "@/utils/math";
import { usePropertyDraft } from "@/components/editor/panels/properties/hooks/use-property-draft";
import { useImeSafeText } from "@/components/editor/panels/properties/hooks/use-ime-safe-text";
import type { TextElement } from "@/timeline";
import type { ParamValues } from "@/params";
import {
	loadFlowerPackCatalog,
	type LoadedFlowerPackPreset,
} from "@/vfxpack/flower-pack-catalog";
import {
	applyFlowerPresetToTextElement,
	clearFlowerStyleFromTextElement,
} from "@/vfxpack/timeline-flower-text";
import {
	createSolidContent,
	getDefaultTextOuterShadow,
	getDefaultTextOuterStroke,
	normalizeFlowerStyle,
	setDefaultTextOuterShadow,
	setDefaultTextOuterStroke,
	type FlowerStyle,
} from "@/vfxpack/flower-style";
import {
	buildTextTemplateApply,
	describeTextTemplateApply,
	isTextTemplateClip,
} from "@/vfxpack/apply-text-template";
import { toast } from "sonner";
import { Search } from "lucide-react";

type TextPage = "text" | "animation";
type TextSubTab = "basic" | "bubbles" | "effects" | "templates";
type AnimPhase = "in" | "out" | "loop";
type AnimFilter = "favorites" | "all";

const SCALE_MIN = 1;
const SCALE_MAX = 500;

const STYLE_PRESET_COLORS = [
	"#ffffff",
	"#000000",
	"#ff4d4f",
	"#faad14",
	"#52c41a",
	"#1677ff",
	"#722ed1",
	"#eb2f96",
	"#13c2c2",
	"#f5222d",
] as const;

const TYPOGRAPHY_PARAM_KEYS = [
	"fontFamily",
	"fontSize",
	"color",
	"fontWeight",
	"fontStyle",
	"textDecoration",
	"letterSpacing",
	"lineHeight",
	"background.enabled",
	"background.color",
	"background.cornerRadius",
	"background.paddingX",
	"background.paddingY",
	"background.offsetX",
	"background.offsetY",
] as const;

function readNumber({
	params,
	key,
	fallback,
}: {
	params: ParamValues | undefined;
	key: string;
	fallback: number;
}): number {
	const v = params?.[key];
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
}

function readString({
	params,
	key,
	fallback,
}: {
	params: ParamValues | undefined;
	key: string;
	fallback: string;
}): string {
	const v = params?.[key];
	return typeof v === "string" ? v : fallback;
}

function asTextSubTab(value: string): TextSubTab {
	if (
		value === "basic" ||
		value === "bubbles" ||
		value === "effects" ||
		value === "templates"
	)
		return value;
	return "basic";
}

function asAnimPhase(value: string): AnimPhase {
	if (value === "in" || value === "out" || value === "loop") return value;
	return "in";
}

export function TextPropertiesView({
	element,
	trackId,
	page,
}: {
	element: TextElement;
	trackId: string;
	page: TextPage;
}) {
	if (page === "animation") {
		return <TextAnimationPage element={element} trackId={trackId} />;
	}
	return <TextPage element={element} trackId={trackId} />;
}

function TextPage({ element, trackId }: { element: TextElement; trackId: string }) {
	const [subTab, setSubTab] = useState<TextSubTab>("basic");
	// fcc-tl-flower-63: text-template panel = Basic + Templates (no Bubbles/Effects).
	// fcc-tl-flower-64: Basic color also rewrites solid flowerStyle.fill for Default text.
	// Ordinary text / flower Effects keep Bubbles + Effects.
	const isTpl = isTextTemplateClip(element);
	const effectiveSubTab: TextSubTab = isTpl
		? subTab === "templates"
			? "templates"
			: "basic"
		: subTab === "templates"
			? "basic"
			: subTab;

	return (
		<div className="flex h-full flex-col">
			<div className="flex h-11 shrink-0 items-center border-b px-3.5">
				<SectionTitle>Text</SectionTitle>
			</div>
			<Tabs
				value={effectiveSubTab}
				onValueChange={(value) => setSubTab(asTextSubTab(value))}
				variant="default"
				className="flex min-h-0 flex-1 flex-col"
			>
				<div className="px-3 pt-3">
					<TabsList aria-label="Text sections" className="w-full justify-start gap-1">
						<TabsTrigger value="basic">Basic</TabsTrigger>
						{isTpl ? (
							<TabsTrigger value="templates">Templates</TabsTrigger>
						) : (
							<>
								<TabsTrigger value="bubbles">Bubbles</TabsTrigger>
								<TabsTrigger value="effects">Effects</TabsTrigger>
							</>
						)}
					</TabsList>
				</div>
				<TabsContent value="basic" className="min-h-0 flex-1 overflow-auto px-0 py-0">
					<BasicTab element={element} trackId={trackId} />
				</TabsContent>
				{isTpl ? (
					<TabsContent
						value="templates"
						className="min-h-0 flex-1 overflow-auto px-3 py-3"
					>
						<TemplatesTab element={element} trackId={trackId} />
					</TabsContent>
				) : (
					<>
						<TabsContent
							value="bubbles"
							className="min-h-0 flex-1 overflow-auto px-3 py-4"
						>
							<BubblesTab />
						</TabsContent>
						<TabsContent
							value="effects"
							className="min-h-0 flex-1 overflow-auto px-3 py-3"
						>
							<EffectsTab element={element} trackId={trackId} />
						</TabsContent>
					</>
				)}
			</Tabs>
		</div>
	);
}

function BasicTab({ element, trackId }: { element: TextElement; trackId: string }) {
	const editor = useEditor();
	const { renderElement, previewUpdates, commit } = useElementPreview({
		trackId,
		elementId: element.id,
		fallback: element,
	});
	const params = renderElement.params ?? {};
	const content = readString({ params, key: "content", fallback: "Default text" });
	const color = readString({ params, key: "color", fallback: "#ffffff" });
	const textAlign = readString({ params, key: "textAlign", fallback: "center" });
	const uniform = params["transform.uniformScale"] !== false;
	const scaleX = readNumber({ params, key: "transform.scaleX", fallback: 1 });
	const scaleY = readNumber({ params, key: "transform.scaleY", fallback: 1 });
	const posX = readNumber({ params, key: "transform.positionX", fallback: 0 });
	const posY = readNumber({ params, key: "transform.positionY", fallback: 0 });
	const rotate = readNumber({ params, key: "transform.rotate", fallback: 0 });
	const opacity = readNumber({ params, key: "opacity", fallback: 1 });
	const isTpl = isTextTemplateClip(renderElement);
	/** Default text only — hide stroke/shadow when Effects / text-template applied. */
	const isDefaultText =
		!isTpl && !(renderElement as TextElement).flowerTemplateId;
	const typographyKeys = isTpl
		? TYPOGRAPHY_PARAM_KEYS.filter((key) => key !== "fontFamily")
		: TYPOGRAPHY_PARAM_KEYS;

	const fillColor = color;
	const outerStroke = isDefaultText
		? getDefaultTextOuterStroke((renderElement as TextElement).flowerStyle)
		: null;
	const outerShadow = isDefaultText
		? getDefaultTextOuterShadow((renderElement as TextElement).flowerStyle)
		: null;
	const strokeEnabled = !!(outerStroke && outerStroke.enable);
	const strokeColor = outerStroke?.content?.solid?.color ?? "#000000";
	const strokeWidth = outerStroke?.width ?? 4;
	const shadowEnabled = !!(outerShadow && outerShadow.enable);
	const shadowDistance = outerShadow?.distance ?? 4;
	const shadowAngle = outerShadow?.angle ?? -45;
	const shadowBlur = outerShadow?.diffuse ?? 2;
	const shadowColor = outerShadow?.content?.solid?.color ?? "#000000";
	const shadowAlpha = outerShadow?.alpha ?? 0.75;

	const patchParams = (patch: ParamValues) => {
		previewUpdates({ params: { ...renderElement.params, ...patch } });
	};
	const commitParams = (patch: ParamValues) => {
		patchParams(patch);
		commit();
	};

	const previewFlowerStyle = (nextStyle: FlowerStyle) => {
		previewUpdates({ flowerStyle: nextStyle });
	};
	const commitFlowerStyle = (nextStyle: FlowerStyle) => {
		previewFlowerStyle(nextStyle);
		commit();
	};

	const applyStroke = ({
		enable,
		width,
		color: strokeCol,
		previewOnly = false,
	}: {
		enable: boolean;
		width: number;
		color: string;
		previewOnly?: boolean;
	}) => {
		const next = setDefaultTextOuterStroke(
			(renderElement as TextElement).flowerStyle,
			{ enable, width, color: strokeCol },
			{ fillColor },
		);
		if (previewOnly) previewFlowerStyle(next);
		else commitFlowerStyle(next);
	};

	const applyShadow = ({
		enable,
		distance,
		angle,
		diffuse,
		color: shadowCol,
		alpha,
		previewOnly = false,
	}: {
		enable: boolean;
		distance: number;
		angle: number;
		diffuse: number;
		color: string;
		alpha: number;
		previewOnly?: boolean;
	}) => {
		const next = setDefaultTextOuterShadow(
			(renderElement as TextElement).flowerStyle,
			{ enable, distance, angle, diffuse, color: shadowCol, alpha },
			{ fillColor },
		);
		if (previewOnly) previewFlowerStyle(next);
		else commitFlowerStyle(next);
	};

	/** fcc-tl-flower-64: color swatch must also rewrite solid flowerStyle.fill (Default text stamps one). */
	const commitColor = (next: string) => {
		const nextParams = { ...(renderElement.params ?? {}), color: next } as ParamValues;
		const rawStyle = (renderElement as TextElement).flowerStyle;
		if (rawStyle && typeof rawStyle === "object") {
			const style = normalizeFlowerStyle(rawStyle) as FlowerStyle;
			const fillRt = style.fill?.content?.renderType;
			if (!fillRt || fillRt === "solid") {
				const nextStyle: FlowerStyle = {
					...style,
					fill: {
						alpha: style.fill?.alpha ?? 1,
						content: createSolidContent(next, 1),
					},
				};
				editor.timeline.updateElements({
					updates: [
						{
							trackId,
							elementId: element.id,
							patch: { params: nextParams, flowerStyle: nextStyle },
						},
					],
				});
				return;
			}
		}
		commitParams({ color: next });
	};

	const contentField = useImeSafeText({
		value: content,
		onChange: (next) => patchParams({ content: next }),
		onBlurCommit: commit,
	});

	return (
		<div className="flex flex-col pb-4">
			<div className="space-y-3 px-3.5 pt-3">
				<Textarea
					value={contentField.value}
					placeholder="Default text"
					className="min-h-[72px] resize-none"
					onFocus={contentField.onFocus}
					onCompositionStart={contentField.onCompositionStart}
					onCompositionEnd={contentField.onCompositionEnd}
					onChange={contentField.onChange}
					onBlur={contentField.onBlur}
				/>
				<StylePresetsRow
					activeColor={color}
					onPick={(next) => commitColor(next)}
				/>
			</div>

			<Section collapsible defaultOpen sectionKey={`${element.id}:text-position`}>
				<SectionHeader
					trailing={
						<div className="flex items-center gap-0.5 opacity-50">
							<DecorativeKeyframe />
						</div>
					}
				>
					<SectionTitle>Position & size</SectionTitle>
				</SectionHeader>
				<SectionContent>
					<SectionFields>
						<PercentSliderRow
							label="Scale"
							percent={(uniform ? scaleX : scaleX) * 100}
							onPreview={(percent) => {
								const scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, percent)) / 100;
								if (uniform) {
									patchParams({
										"transform.scaleX": scale,
										"transform.scaleY": scale,
									});
								} else {
									patchParams({ "transform.scaleX": scale });
								}
							}}
							onCommit={commit}
						/>
						<SectionField label="Uniform scale">
							<Switch
								checked={uniform}
								onCheckedChange={(checked) => {
									commitParams(
										checked
											? {
													"transform.uniformScale": true,
													"transform.scaleY": scaleX,
												}
											: { "transform.uniformScale": false },
									);
								}}
							/>
						</SectionField>
						{!uniform && (
							<PercentSliderRow
								label="Scale Y"
								percent={scaleY * 100}
								onPreview={(percent) => {
									const scale =
										Math.min(SCALE_MAX, Math.max(SCALE_MIN, percent)) / 100;
									patchParams({ "transform.scaleY": scale });
								}}
								onCommit={commit}
							/>
						)}
						<SectionField label="Position">
							<div className="flex items-center gap-2">
								<AxisInput
									prefix="X"
									value={posX}
									onPreview={(v) => patchParams({ "transform.positionX": v })}
									onCommit={commit}
								/>
								<AxisInput
									prefix="Y"
									value={posY}
									onPreview={(v) => patchParams({ "transform.positionY": v })}
									onCommit={commit}
								/>
							</div>
						</SectionField>
						<RotateField
							rotate={rotate}
							onPreview={(v) => patchParams({ "transform.rotate": v })}
							onCommit={commit}
						/>
						<SectionField label="Align">
							<AlignButtons
								value={textAlign}
								onChange={(next) => commitParams({ textAlign: next })}
							/>
						</SectionField>
					</SectionFields>
				</SectionContent>
			</Section>

			<Section collapsible defaultOpen sectionKey={`${element.id}:text-blend`}>
				<SectionHeader
					leading={
						<span className="bg-primary/20 text-primary flex size-4 items-center justify-center rounded-sm text-[10px]">
							✓
						</span>
					}
					trailing={<DecorativeKeyframe />}
				>
					<SectionTitle>Blend</SectionTitle>
				</SectionHeader>
				<SectionContent>
					<SectionFields>
						<PercentSliderRow
							label="Opacity"
							percent={opacity * 100}
							min={0}
							max={100}
							onPreview={(percent) =>
								patchParams({
									opacity: Math.min(100, Math.max(0, percent)) / 100,
								})
							}
							onCommit={commit}
						/>
					</SectionFields>
				</SectionContent>
			</Section>

			{isDefaultText && (
				<Section
					collapsible
					defaultOpen={false}
					sectionKey={`${element.id}:text-stroke`}
				>
					<SectionHeader
						leading={
							<Checkbox
								checked={strokeEnabled}
								onCheckedChange={(checked) => {
									const on = checked === true;
									applyStroke({
										enable: on,
										width: on ? Math.max(strokeWidth, 2) : strokeWidth,
										color: strokeColor,
									});
								}}
								onClick={(event) => event.stopPropagation()}
								aria-label="Enable stroke"
							/>
						}
					>
						<SectionTitle>Stroke</SectionTitle>
					</SectionHeader>
					{strokeEnabled && (
						<SectionContent>
							<SectionFields>
								<UnitSliderRow
									label="Width"
									value={strokeWidth}
									min={0}
									max={40}
									step={0.5}
									onPreview={(width) =>
										applyStroke({
											enable: true,
											width,
											color: strokeColor,
											previewOnly: true,
										})
									}
									onCommit={commit}
								/>
								<SectionField label="Color">
									<ColorPicker
										value={strokeColor.replace("#", "").toUpperCase()}
										onChange={(c) =>
											applyStroke({
												enable: true,
												width: strokeWidth,
												color: `#${c}`,
												previewOnly: true,
											})
										}
										onChangeEnd={(c) =>
											applyStroke({
												enable: true,
												width: strokeWidth,
												color: `#${c}`,
											})
										}
									/>
								</SectionField>
							</SectionFields>
						</SectionContent>
					)}
				</Section>
			)}

			{isDefaultText && (
				<Section
					collapsible
					defaultOpen={false}
					sectionKey={`${element.id}:text-shadow`}
				>
					<SectionHeader
						leading={
							<Checkbox
								checked={shadowEnabled}
								onCheckedChange={(checked) => {
									const on = checked === true;
									applyShadow({
										enable: on,
										distance: on ? Math.max(shadowDistance, 2) : shadowDistance,
										angle: shadowAngle,
										diffuse: shadowBlur,
										color: shadowColor,
										alpha: shadowAlpha,
									});
								}}
								onClick={(event) => event.stopPropagation()}
								aria-label="Enable shadow"
							/>
						}
					>
						<SectionTitle>Shadow</SectionTitle>
					</SectionHeader>
					{shadowEnabled && (
						<SectionContent>
							<SectionFields>
								<UnitSliderRow
									label="Distance"
									value={shadowDistance}
									min={0}
									max={64}
									step={0.5}
									onPreview={(distance) =>
										applyShadow({
											enable: true,
											distance,
											angle: shadowAngle,
											diffuse: shadowBlur,
											color: shadowColor,
											alpha: shadowAlpha,
											previewOnly: true,
										})
									}
									onCommit={commit}
								/>
								<UnitSliderRow
									label="Angle"
									value={shadowAngle}
									min={-180}
									max={180}
									step={1}
									suffix="°"
									onPreview={(angle) =>
										applyShadow({
											enable: true,
											distance: shadowDistance,
											angle,
											diffuse: shadowBlur,
											color: shadowColor,
											alpha: shadowAlpha,
											previewOnly: true,
										})
									}
									onCommit={commit}
								/>
								<UnitSliderRow
									label="Blur"
									value={shadowBlur}
									min={0}
									max={32}
									step={0.5}
									onPreview={(diffuse) =>
										applyShadow({
											enable: true,
											distance: shadowDistance,
											angle: shadowAngle,
											diffuse,
											color: shadowColor,
											alpha: shadowAlpha,
											previewOnly: true,
										})
									}
									onCommit={commit}
								/>
								<PercentSliderRow
									label="Opacity"
									percent={shadowAlpha * 100}
									min={0}
									max={100}
									onPreview={(percent) =>
										applyShadow({
											enable: true,
											distance: shadowDistance,
											angle: shadowAngle,
											diffuse: shadowBlur,
											color: shadowColor,
											alpha: Math.min(100, Math.max(0, percent)) / 100,
											previewOnly: true,
										})
									}
									onCommit={commit}
								/>
								<SectionField label="Color">
									<ColorPicker
										value={shadowColor.replace("#", "").toUpperCase()}
										onChange={(c) =>
											applyShadow({
												enable: true,
												distance: shadowDistance,
												angle: shadowAngle,
												diffuse: shadowBlur,
												color: `#${c}`,
												alpha: shadowAlpha,
												previewOnly: true,
											})
										}
										onChangeEnd={(c) =>
											applyShadow({
												enable: true,
												distance: shadowDistance,
												angle: shadowAngle,
												diffuse: shadowBlur,
												color: `#${c}`,
												alpha: shadowAlpha,
											})
										}
									/>
								</SectionField>
							</SectionFields>
						</SectionContent>
					)}
				</Section>
			)}

			<Section collapsible defaultOpen sectionKey={`${element.id}:text-typography`}>
				<SectionHeader>
					<SectionTitle>Typography</SectionTitle>
				</SectionHeader>
				<SectionContent className="pt-0">
					<ElementParamsTab
						element={renderElement}
						trackId={trackId}
						paramKeys={typographyKeys}
						sectionKey="text-typography-fields"
					/>
				</SectionContent>
			</Section>
		</div>
	);
}

function StylePresetsRow({
	activeColor,
	onPick,
}: {
	activeColor: string;
	onPick: (color: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const colors = expanded ? STYLE_PRESET_COLORS : STYLE_PRESET_COLORS.slice(0, 8);
	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap gap-1.5">
				{colors.map((c) => {
					const active = activeColor.toLowerCase() === c.toLowerCase();
					return (
						<button
							key={c}
							type="button"
							title={c}
							onClick={() => onPick(c)}
							className={cn(
								"size-8 rounded-md border-2 transition-colors",
								active ? "border-primary" : "border-transparent",
							)}
							style={{ backgroundColor: c }}
						/>
					);
				})}
			</div>
			<button
				type="button"
				className="text-muted-foreground hover:text-foreground flex items-center justify-center self-center rounded-md px-2 py-0.5 text-xs"
				onClick={() => setExpanded((v) => !v)}
				aria-label={expanded ? "Collapse style presets" : "Expand style presets"}
			>
				{expanded ? "▴" : "▾"}
			</button>
		</div>
	);
}

function BubblesTab() {
	return (
		<div className="border-border bg-accent/30 flex min-h-[160px] flex-col items-center justify-center rounded-md border border-dashed px-4 py-10 text-center">
			<p className="text-muted-foreground text-sm">No bubbles yet</p>
			<p className="text-muted-foreground mt-1 text-[11px] leading-relaxed opacity-80">
				Bubble packs will appear here.
			</p>
		</div>
	);
}

/** Switch text-template pack on the selected clip (Assets → Text templates source). fcc-tl-flower-63 */
function TemplatesTab({ element, trackId }: { element: TextElement; trackId: string }) {
	const editor = useEditor();
	const packs = usePackRegistry((state) => state.packs);
	const { renderElement } = useElementPreview({
		trackId,
		elementId: element.id,
		fallback: element,
	});
	const templates = useMemo(
		() =>
			packs.filter((pack) => normalizeVfxPackType(pack.type) === "text-template"),
		[packs],
	);
	const selectedId = renderElement.textTemplatePackId ?? null;

	const applyTemplate = (pack: LoadedVfxPack) => {
		const params = { ...(renderElement.params ?? {}) } as ParamValues;
		const applied = buildTextTemplateApply(pack);
		// Keep the user's typed content when switching template type (same rule as Effects apply).
		const keepContent =
			typeof params.content === "string" && params.content.length > 0
				? params.content
				: applied.content;
		editor.timeline.updateElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					patch: {
						name: pack.displayName || renderElement.name || "Text template",
						params: {
							...params,
							...applied.paramsPatch,
							content: keepContent,
						},
						flowerStyle: applied.flowerStyle,
						flowerBaseFontSize: applied.flowerBaseFontSize,
						flowerDesignCanvasHeight: null,
						flowerTemplateId: pack.id,
						textTemplatePackId: applied.textTemplatePackId,
						textStickers: applied.textStickers,
						textTemplateMediaPlayers: applied.textTemplateMediaPlayers,
						textFxStack: applied.textFxStack,
						textAnims: applied.textAnims,
					},
				},
			],
		});
		toast.message("Text template applied", {
			description: describeTextTemplateApply(applied),
		});
	};

	return (
		<div className="flex flex-col gap-3">
			<div className="text-muted-foreground text-xs font-medium">
				Templates
				<span className="ml-1 opacity-60">({templates.length})</span>
			</div>
			{templates.length === 0 ? (
				<div className="border-border bg-accent/30 flex min-h-[140px] flex-col items-center justify-center rounded-md border border-dashed px-4 py-8 text-center">
					<p className="text-muted-foreground text-sm">No text templates yet</p>
					<p className="text-muted-foreground mt-1 text-[11px] leading-relaxed opacity-80">
						Export Pack type = Text template into public/vfxpacks/text-templates/
						and list it in index.json.
					</p>
				</div>
			) : (
				<div
					className="grid gap-2"
					style={{ gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))" }}
				>
					{templates.map((pack) => {
						const active = selectedId === pack.id;
						const { poster } = packLibraryThumb({ pack });
						return (
							<button
								key={pack.id}
								type="button"
								onClick={() => applyTemplate(pack)}
								className={cn(
									"flex flex-col items-center gap-1 rounded-md p-1",
									active && "bg-secondary",
								)}
							>
								<div
									className={cn(
										"size-[64px] overflow-hidden rounded-md border-2 bg-[#2a2a2a]",
										active ? "border-primary" : "border-transparent",
									)}
								>
									{poster ? (
										// eslint-disable-next-line @next/next/no-img-element
										<img
											src={poster}
											alt={pack.displayName}
											className="size-full object-cover"
											draggable={false}
										/>
									) : (
										<div className="text-muted-foreground flex size-full items-center justify-center px-1 text-center text-[10px]">
											{pack.displayName}
										</div>
									)}
								</div>
								<span className="text-muted-foreground w-full truncate text-center text-[10px]">
									{pack.displayName}
								</span>
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}

function EffectsTab({ element, trackId }: { element: TextElement; trackId: string }) {
	const editor = useEditor();
	const { renderElement } = useElementPreview({
		trackId,
		elementId: element.id,
		fallback: element,
	});
	const selectedId = renderElement.flowerTemplateId ?? null;
	const [presets, setPresets] = useState<LoadedFlowerPackPreset[]>([]);
	useEffect(() => {
		let cancelled = false;
		void loadFlowerPackCatalog().then((list) => {
			if (!cancelled) setPresets(list);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const applyPreset = (presetId: string | null) => {
		const params = { ...(renderElement.params ?? {}) } as ParamValues;
		if (!presetId) {
			const fillColor =
				typeof params.color === "string" && params.color ? params.color : "#ffffff";
			const canvasHeight =
				editor.project.getActive().settings.canvasSize?.height ?? 1080;
			const wasFlowerSized =
				Number(renderElement.flowerBaseFontSize) > 0;
			const cleared = clearFlowerStyleFromTextElement({
				params,
				canvasHeight,
				wasFlowerSized,
				fillColor,
			});
			editor.timeline.updateElements({
				updates: [
					{
						trackId,
						elementId: element.id,
						patch: {
							params: cleared.params ?? params,
							flowerStyle: cleared.flowerStyle,
							flowerBaseFontSize: cleared.flowerBaseFontSize,
							flowerDesignCanvasHeight: cleared.flowerDesignCanvasHeight,
							flowerTemplateId: cleared.flowerTemplateId,
							textTemplateMediaPlayers: cleared.textTemplateMediaPlayers ?? null,
							textTemplatePackId: cleared.textTemplatePackId ?? null,
						},
					},
				],
			});
			return;
		}
		const patch = applyFlowerPresetToTextElement({ params, presetId });
		// Properties apply: style only - keep the user's typed content (and fontSize).
		const keepContent =
			typeof params.content === "string" ? params.content : patch.params.content;
		const keepFontSize = params.fontSize;
		editor.timeline.updateElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					patch: {
						params: {
							...patch.params,
							content: keepContent,
							...(keepFontSize !== undefined ? { fontSize: keepFontSize } : {}),
						},
						flowerStyle: patch.flowerStyle,
						flowerBaseFontSize: patch.flowerBaseFontSize,
						flowerDesignCanvasHeight: patch.flowerDesignCanvasHeight,
						flowerTemplateId: patch.flowerTemplateId,
						textTemplateMediaPlayers: patch.textTemplateMediaPlayers ?? null,
						textTemplatePackId: patch.textTemplatePackId ?? null,
					},
				},
			],
		});
	};

	return (
		<div className="flex flex-col gap-3">
			<div className="text-muted-foreground text-xs font-medium">
				Effects
				<span className="ml-1 opacity-60">({presets.length})</span>
			</div>
			<div
				className="grid gap-2"
				style={{ gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))" }}
			>
				<button
					type="button"
					onClick={() => applyPreset(null)}
					className={cn(
						"flex flex-col items-center gap-1 rounded-md p-1",
						selectedId == null && "bg-secondary",
					)}
				>
					<div
						className={cn(
							"bg-accent flex size-[64px] items-center justify-center rounded-md border-2",
							selectedId == null ? "border-primary" : "border-transparent",
						)}
					>
						<NoneMark />
					</div>
					<span className="text-muted-foreground w-full truncate text-center text-[10px]">
						None
					</span>
				</button>
				{presets.map((preset) => {
					const active = selectedId === preset.id;
					return (
						<button
							key={preset.id}
							type="button"
							onClick={() => applyPreset(preset.id)}
							className={cn(
								"flex flex-col items-center gap-1 rounded-md p-1",
								active && "bg-secondary",
							)}
						>
							<div
								className={cn(
									"size-[64px] overflow-hidden rounded-md border-2 bg-[#2a2a2a]",
									active ? "border-primary" : "border-transparent",
								)}
							>
								{preset.cover ? (
									// eslint-disable-next-line @next/next/no-img-element
									<img
										src={preset.cover}
										alt={preset.name}
										className="size-full object-cover"
										draggable={false}
									/>
								) : (
									<div className="text-muted-foreground flex size-full items-center justify-center px-1 text-center text-[10px]">
										{preset.name}
									</div>
								)}
							</div>
							<span className="text-muted-foreground w-full truncate text-center text-[10px]">
								{preset.name}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

function packTextAnimDuration(pack: LoadedVfxPack | undefined): number {
	return textAnimPackDuration(pack, null);
}

function TextAnimationPage({
	element,
	trackId,
}: {
	element: TextElement;
	trackId: string;
}) {
	const editor = useEditor();
	const packs = usePackRegistry((state) => state.packs);
	const [phase, setPhase] = useState<AnimPhase>("in");
	const [query, setQuery] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const previewTimer = useRef<number | null>(null);
	const selectedId = element.textAnims?.[phase]?.packId ?? null;
	const visible = useMemo(() => {
		const q = query.trim().toLowerCase();
		return packs.filter((pack) => {
			if (normalizeVfxPackType(pack.type) !== "text-anim") return false;
			// fcc-tl-flower-62: hide text-template virtual packs from flower Animation library
			if (isEmbeddedTextAnimPackId(pack.id)) return false;
			const packPhase = pack.manifest.phase ?? pack.manifest.textAnim?.category;
			const resolved =
				packPhase === "in" || packPhase === "out" || packPhase === "loop"
					? packPhase
					: "in";
			if (resolved !== phase) return false;
			if (!q) return true;
			const name = (pack.displayName || pack.id).toLowerCase();
			return name.includes(q) || pack.id.toLowerCase().includes(q);
		});
	}, [packs, phase, query]);

	useEffect(() => {
		return () => {
			if (previewTimer.current != null) window.clearTimeout(previewTimer.current);
		};
	}, []);

	const durationOf = (packId: string | null | undefined) => {
		// Phase length = animation resource timeline only (no Duration override).
		return packTextAnimDuration(packs.find((pack) => pack.id === packId));
	};

	const assign = (packId: string | null) => {
		const current = element.textAnims ?? {};
		editor.timeline.updateElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					patch: {
						textAnims: {
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
		const inDuration =
			phase === "in" ? durationOf(packId) : durationOf(current.in?.packId);
		const outDuration =
			phase === "out" ? durationOf(packId) : durationOf(current.out?.packId);
		const loopDuration =
			phase === "loop" ? durationOf(packId) : durationOf(current.loop?.packId);
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
			playSec = Math.min(loopDuration || end - startSec, Math.max(0, end - startSec));
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
				onValueChange={(value) => setPhase(asAnimPhase(value))}
				variant="underline"
				className="flex min-h-0 flex-1 flex-col"
			>
				<TabsList aria-label="Text animation">
					<TabsTrigger value="in">In</TabsTrigger>
					<TabsTrigger value="out">Out</TabsTrigger>
					<TabsTrigger value="loop">Loop</TabsTrigger>
				</TabsList>
				<TabsContent value={phase} className="flex min-h-0 flex-1 flex-col px-0 py-0">
					<div className="flex items-center gap-2 px-3 pt-3">
						<span className="text-muted-foreground text-xs">Text animation library</span>
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
								placeholder="Search text animations"
								className="border-input bg-accent h-8 w-full rounded-md border px-2.5 text-sm outline-none"
							/>
						</div>
					)}
					<div className="min-h-0 flex-1 overflow-auto px-3 py-3">
						<div className="flex flex-wrap content-start gap-x-2.5 gap-y-3">
							<AnimChoice
								label="None"
								active={selectedId == null}
								onClick={() => assign(null)}
							>
								<NoneMark />
							</AnimChoice>
							{visible.map((pack) => (
								<AnimChoice
									key={pack.id}
									label={pack.displayName || pack.id}
									active={pack.id === selectedId}
									onClick={() => assign(pack.id)}
								>
									<TextAnimThumb pack={pack} />
								</AnimChoice>
							))}
						</div>
						{visible.length === 0 && (
							<p className="text-muted-foreground py-6 text-center text-sm">
								No text animation packs yet. Export from the editor (pack type Text
								animation), place under vfxpacks/text-anims/in|out|loop/, and list the
								.vfxpack filename in that folder&apos;s index.json.
							</p>
						)}
					</div>
				</TabsContent>
			</Tabs>
		</div>
	);
}

function TextAnimThumb({ pack }: { pack: LoadedVfxPack }) {
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
		<button type="button" className="flex w-[50px] flex-col items-center gap-1" onClick={onClick}>
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

function DecorativeKeyframe() {
	return (
		<KeyframeToggle
			isActive={false}
			isDisabled
			title="Keyframes coming soon"
			onToggle={() => undefined}
		/>
	);
}

function UnitSliderRow({
	label,
	value,
	min,
	max,
	step = 1,
	suffix,
	onPreview,
	onCommit,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	step?: number;
	suffix?: string;
	onPreview: (value: number) => void;
	onCommit: () => void;
}) {
	const display = formatNumberForDisplay({
		value,
		maxFractionDigits: step < 1 ? 1 : 0,
	});
	const draft = usePropertyDraft({
		displayValue: display,
		parse: (input) => {
			const parsed = Number.parseFloat(input);
			if (Number.isNaN(parsed)) return null;
			return snapToStep({
				value: Math.min(max, Math.max(min, parsed)),
				step,
			});
		},
		onPreview,
		onCommit,
	});

	return (
		<SectionField label={label}>
			<div className="flex w-full items-center gap-2">
				<Slider
					className="flex-1"
					min={min}
					max={max}
					step={step}
					value={[Math.min(max, Math.max(min, value))]}
					onValueChange={(vals) => onPreview(vals[0] ?? value)}
					onValueCommit={() => onCommit()}
				/>
				<NumberField
					value={draft.displayValue}
					suffix={suffix}
					className="w-[72px]"
					isDefault={false}
					onFocus={draft.onFocus}
					onChange={draft.onChange}
					onBlur={draft.onBlur}
					onScrub={(next) =>
						onPreview(
							Math.min(max, Math.max(min, snapToStep({ value: next, step }))),
						)
					}
					onScrubEnd={onCommit}
				/>
			</div>
		</SectionField>
	);
}

function PercentSliderRow({
	label,
	percent,
	min = SCALE_MIN,
	max = SCALE_MAX,
	onPreview,
	onCommit,
}: {
	label: string;
	percent: number;
	min?: number;
	max?: number;
	onPreview: (percent: number) => void;
	onCommit: () => void;
}) {
	const display = formatNumberForDisplay({
		value: percent,
		maxFractionDigits: 0,
	});
	const draft = usePropertyDraft({
		displayValue: display,
		parse: (input) => {
			const parsed = Number.parseFloat(input);
			if (Number.isNaN(parsed)) return null;
			return snapToStep({
				value: Math.min(max, Math.max(min, parsed)),
				step: 1,
			});
		},
		onPreview,
		onCommit,
	});

	return (
		<SectionField label={label} beforeLabel={<DecorativeKeyframe />}>
			<div className="flex w-full items-center gap-2">
				<Slider
					className="flex-1"
					min={min}
					max={max}
					step={1}
					value={[Math.min(max, Math.max(min, percent))]}
					onValueChange={(vals) => onPreview(vals[0] ?? percent)}
					onValueCommit={() => onCommit()}
				/>
				<NumberField
					value={draft.displayValue}
					suffix="%"
					className="w-[68px]"
					isDefault={false}
					onFocus={draft.onFocus}
					onChange={draft.onChange}
					onBlur={draft.onBlur}
					onScrub={(next) =>
						onPreview(Math.min(max, Math.max(min, snapToStep({ value: next, step: 1 }))))
					}
					onScrubEnd={onCommit}
				/>
			</div>
		</SectionField>
	);
}

function AxisInput({
	prefix,
	value,
	onPreview,
	onCommit,
}: {
	prefix: string;
	value: number;
	onPreview: (value: number) => void;
	onCommit: () => void;
}) {
	const display = formatNumberForDisplay({ value, maxFractionDigits: 0 });
	const draft = usePropertyDraft({
		displayValue: display,
		parse: (input) => {
			const parsed = Number.parseFloat(input);
			if (Number.isNaN(parsed)) return null;
			return snapToStep({ value: parsed, step: 1 });
		},
		onPreview,
		onCommit,
	});
	return (
		<div className="flex items-center gap-1">
			<span className="text-muted-foreground text-[10px]">{prefix}</span>
			<NumberField
				value={draft.displayValue}
				className="w-[72px]"
				onFocus={draft.onFocus}
				onChange={draft.onChange}
				onBlur={draft.onBlur}
				onScrub={(next) => onPreview(snapToStep({ value: next, step: 1 }))}
				onScrubEnd={onCommit}
			/>
		</div>
	);
}


function RotateField({
	rotate,
	onPreview,
	onCommit,
}: {
	rotate: number;
	onPreview: (value: number) => void;
	onCommit: () => void;
}) {
	const display = formatNumberForDisplay({
		value: rotate,
		maxFractionDigits: 2,
	});
	const draft = usePropertyDraft({
		displayValue: display,
		parse: (input) => {
			const parsed = Number.parseFloat(input);
			if (Number.isNaN(parsed)) return null;
			return snapToStep({ value: parsed, step: 0.01 });
		},
		onPreview,
		onCommit,
	});
	return (
		<SectionField label="Rotate" beforeLabel={<DecorativeKeyframe />}>
			<NumberField
				value={draft.displayValue}
				suffix="°"
				className="w-[88px]"
				onFocus={draft.onFocus}
				onChange={draft.onChange}
				onBlur={draft.onBlur}
				onScrub={(next) => onPreview(snapToStep({ value: next, step: 0.01 }))}
				onScrubEnd={onCommit}
			/>
		</SectionField>
	);
}


function AlignButtons({
	value,
	onChange,
}: {
	value: string;
	onChange: (next: string) => void;
}) {
	const items: { id: string; label: string; icon: ReactNode }[] = [
		{ id: "left", label: "Left", icon: <AlignIcon kind="left" /> },
		{ id: "center", label: "Center", icon: <AlignIcon kind="center" /> },
		{ id: "right", label: "Right", icon: <AlignIcon kind="right" /> },
	];
	return (
		<div className="flex items-center gap-1">
			{items.map((item) => (
				<Button
					key={item.id}
					type="button"
					size="icon"
					variant={value === item.id ? "secondary" : "ghost"}
					aria-label={item.label}
					className="size-8"
					onClick={() => onChange(item.id)}
				>
					{item.icon}
				</Button>
			))}
		</div>
	);
}

function AlignIcon({ kind }: { kind: "left" | "center" | "right" }) {
	const lines =
		kind === "left"
			? [4, 4, 4]
			: kind === "right"
				? [10, 10, 10]
				: [7, 7, 7];
	const widths = [14, 10, 12];
	return (
		<svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
			{lines.map((x, i) => (
				<rect key={i} x={x} y={5 + i * 5} width={widths[i]} height={2} rx={0.5} />
			))}
		</svg>
	);
}
