"use client";

import { memo, useCallback, useMemo } from "react";
import {
	Section,
	SectionContent,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import { ColorPickerContent } from "@/components/ui/color-picker";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { DEFAULT_BACKGROUND_COLOR } from "@/background/color";
import { patternCraftGradients } from "@/data/colors/pattern-craft";
import { colors } from "@/data/colors/solid";
import { syntaxUIGradients } from "@/data/colors/syntax-ui";
import { useEditor } from "@/editor/use-editor";
import { cn } from "@/utils/ui";

const CUSTOM_COLOR_SWATCH_BACKGROUND =
	"conic-gradient(from 180deg at 50% 50%, #ff5e5e 0deg, #ffb35e 55deg, #fff26b 110deg, #6bff8f 165deg, #5ee7ff 220deg, #6f7cff 275deg, #d76bff 330deg, #ff5e9b 360deg)";

const BackgroundPreviews = memo(
	({
		backgrounds,
		currentBackgroundColor,
		isColorBackground,
		onSelect,
		useBackgroundColor = false,
	}: {
		backgrounds: readonly string[];
		currentBackgroundColor: string;
		isColorBackground: boolean;
		onSelect: (bg: string) => void;
		useBackgroundColor?: boolean;
	}) => {
		return useMemo(
			() =>
				backgrounds.map((bg) => (
					<button
						key={bg}
						className={cn(
							"border-foreground/15 hover:border-primary aspect-square size-20 cursor-pointer rounded-sm border",
							isColorBackground &&
								bg.toLowerCase() === currentBackgroundColor.toLowerCase() &&
								"border-primary border-2",
						)}
						style={
							useBackgroundColor
								? { backgroundColor: bg }
								: {
										background: bg,
										backgroundSize: "cover",
										backgroundPosition: "center",
										backgroundRepeat: "no-repeat",
									}
						}
						onClick={() => onSelect(bg)}
						type="button"
						aria-label={`Select background ${bg}`}
					/>
				)),
			[
				backgrounds,
				isColorBackground,
				currentBackgroundColor,
				onSelect,
				useBackgroundColor,
			],
		);
	},
);

BackgroundPreviews.displayName = "BackgroundPreviews";

function CustomColorPreview({
	currentBackgroundColor,
	isSelected,
	onPreview,
	onCommit,
}: {
	currentBackgroundColor: string;
	isSelected: boolean;
	onPreview: (color: string) => void;
	onCommit: (color: string) => void;
}) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					className={cn(
						"border-foreground/15 hover:border-primary relative aspect-square size-20 cursor-pointer overflow-hidden rounded-sm border",
						isSelected && "border-primary border-2",
					)}
					type="button"
					aria-label="Pick a custom background color"
				>
					<span
						className="absolute inset-0"
						style={{ background: CUSTOM_COLOR_SWATCH_BACKGROUND }}
					/>
					<span
						className="absolute right-1 bottom-1 size-5 rounded-sm border border-white/70 shadow-sm"
						style={{ backgroundColor: currentBackgroundColor }}
					/>
				</button>
			</PopoverTrigger>
			<ColorPickerContent
				value={currentBackgroundColor.replace(/^#/, "").toUpperCase()}
				onChange={(color) => onPreview(`#${color}`)}
				onChangeEnd={(color) => onCommit(`#${color}`)}
			/>
		</Popover>
	);
}

const COLOR_SECTIONS = [
	{
		id: "colors",
		title: "Colors",
		backgrounds: colors,
		useBackgroundColor: true,
		showCustomPicker: true,
	},
	{
		id: "pattern-craft",
		title: "Pattern craft",
		backgrounds: patternCraftGradients,
		showCustomPicker: false,
	},
	{
		id: "syntax-ui",
		title: "Syntax UI",
		backgrounds: syntaxUIGradients,
		showCustomPicker: false,
	},
] as const;

export function BackgroundContent() {
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActive());

	const previewBackgroundColor = useCallback(
		async (color: string) => {
			await editor.project.updateSettings({
				settings: { background: { type: "color", color } },
				pushHistory: false,
			});
		},
		[editor.project],
	);

	const commitBackgroundColor = useCallback(
		async (color: string) => {
			await editor.project.updateSettings({
				settings: { background: { type: "color", color } },
				pushHistory: true,
			});
		},
		[editor.project],
	);

	const isColorBackground = activeProject.settings.background.type === "color";

	const currentBackgroundColor = isColorBackground
		? activeProject.settings.background.color
		: DEFAULT_BACKGROUND_COLOR;

	const hasPresetColorMatch = colors.some(
		(color) => color.toLowerCase() === currentBackgroundColor.toLowerCase(),
	);

	const handlePresetColorSelect = useCallback(
		(color: string) => {
			void commitBackgroundColor(color);
		},
		[commitBackgroundColor],
	);

	return (
		<div className="flex flex-col">
			{COLOR_SECTIONS.map((section, index) => (
				<Section
					key={section.id}
					collapsible
					defaultOpen={index === 0}
					sectionKey={`settings:background-${section.id}`}
					showTopBorder={index > 0}
				>
					<SectionHeader>
						<SectionTitle>{section.title}</SectionTitle>
					</SectionHeader>
					<SectionContent>
						<div className="flex flex-wrap gap-2">
							{section.showCustomPicker ? (
								<CustomColorPreview
									currentBackgroundColor={currentBackgroundColor}
									isSelected={isColorBackground && !hasPresetColorMatch}
									onPreview={previewBackgroundColor}
									onCommit={commitBackgroundColor}
								/>
							) : null}
							<BackgroundPreviews
								backgrounds={section.backgrounds}
								currentBackgroundColor={currentBackgroundColor}
								isColorBackground={isColorBackground}
								onSelect={handlePresetColorSelect}
								useBackgroundColor={
									"useBackgroundColor" in section
										? section.useBackgroundColor
										: false
								}
							/>
						</div>
					</SectionContent>
				</Section>
			))}
		</div>
	);
}
