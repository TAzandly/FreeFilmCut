"use client";

import { useEffect, useRef, useState } from "react";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import { useEditor } from "@/editor/use-editor";
import { DEFAULTS } from "@/timeline/defaults";
import { buildTextElement } from "@/timeline/element-utils";
import type { MediaTime } from "@/wasm";
import {
	applyFlowerPresetToTextElement,
	FLOWER_EFFECT_DEFAULT_CONTENT,
	FLOWER_EFFECT_DEFAULT_FONT_SIZE,
} from "@/vfxpack/timeline-flower-text";
import {
	createDefaultFlowerStyle,
	createSolidContent,
} from "@/vfxpack/flower-style";
import {
	loadFlowerPackCatalog,
	type LoadedFlowerPackPreset,
} from "@/vfxpack/flower-pack-catalog";
import type { ParamValues } from "@/params";
import { cn } from "@/utils/ui";
import { usePackRegistry, normalizeVfxPackType } from "@/vfxpack";
import type { LoadedVfxPack } from "@/vfxpack/types";
import { packLibraryThumb } from "@/vfxpack/preview-assets";
import { toast } from "sonner";
import {
	buildTextTemplateApply,
	describeTextTemplateApply,
} from "@/vfxpack/apply-text-template";


type TextSubTab = "new" | "flower" | "template";

const SUB_TABS: { id: TextSubTab; label: string }[] = [
	{ id: "new", label: "Add text" },
	{ id: "flower", label: "Effects" },
	{ id: "template", label: "Text templates" },
];

export function TextView() {
	const editor = useEditor();
	const [subTab, setSubTab] = useState<TextSubTab>("new");

	const handleAddToTimeline = ({
		currentTime,
		presetId,
		name,
		content,
	}: {
		currentTime: MediaTime;
		presetId: string | null;
		name: string;
		content?: string;
	}) => {
		const activeScene = editor.scenes.getActiveScene();
		if (!activeScene) return;

		let params = {
			...DEFAULTS.text.element.params,
			content:
				typeof content === "string" && content.length > 0
					? content
					: DEFAULTS.text.element.params.content,
		} as ParamValues;
		let flowerStyle: unknown = undefined;
		let flowerBaseFontSize: number | null | undefined = undefined;
		let flowerDesignCanvasHeight: number | null | undefined = undefined;
		let flowerTemplateId: string | null | undefined = undefined;
		let textTemplateMediaPlayers: Array<Record<string, unknown>> | null | undefined = undefined;
		let textTemplatePackId: string | null | undefined = undefined;
		if (presetId) {
			// New Effects clip: fixed default text/size; never pack UIText / pack name.
			params = {
				...params,
				content: FLOWER_EFFECT_DEFAULT_CONTENT,
				fontSize: FLOWER_EFFECT_DEFAULT_FONT_SIZE,
			} as ParamValues;
			const patch = applyFlowerPresetToTextElement({ params, presetId });
			params = patch.params;
			flowerStyle = patch.flowerStyle;
			flowerBaseFontSize = patch.flowerBaseFontSize;
			flowerDesignCanvasHeight = patch.flowerDesignCanvasHeight;
			flowerTemplateId = patch.flowerTemplateId;
			textTemplateMediaPlayers = patch.textTemplateMediaPlayers ?? null;
			textTemplatePackId = patch.textTemplatePackId ?? null;
		} else {
			const fillColor =
				typeof params.color === "string" && params.color
					? params.color
					: "#ffffff";
			flowerStyle = createDefaultFlowerStyle({
				fill: {
					alpha: 1,
					content: createSolidContent(fillColor, 1),
				},
			});
			flowerBaseFontSize = null;
			flowerDesignCanvasHeight = null;
			flowerTemplateId = null;
			textTemplateMediaPlayers = null;
			textTemplatePackId = null;
		}

		const element = buildTextElement({
			raw: {
				...DEFAULTS.text.element,
				name,
				params,
				flowerStyle,
				flowerBaseFontSize,
				flowerDesignCanvasHeight,
				flowerTemplateId,
				textTemplateMediaPlayers,
				textTemplatePackId,
			},
			startTime: currentTime,
		});

		editor.timeline.insertElement({
			element,
			placement: { mode: "auto" },
		});
	};

	return (
		<div className="flex h-full min-h-0">
			{/* CapCut-style left sub-nav under Text */}
			<nav className="border-border flex w-[88px] shrink-0 flex-col gap-0.5 border-r px-1.5 py-3">
				{SUB_TABS.map((tab) => (
					<button
						key={tab.id}
						type="button"
						onClick={() => setSubTab(tab.id)}
						className={cn(
							"rounded-md px-2 py-2 text-left text-xs leading-snug transition-colors",
							subTab === tab.id
								? "bg-secondary text-primary font-medium"
								: "text-muted-foreground hover:bg-accent hover:text-foreground",
						)}
					>
						{tab.label}
					</button>
				))}
			</nav>

			<div className="scrollbar-hidden min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-3">
				{subTab === "new" && (
					<NewTextTab
						onAdd={({ currentTime }) =>
							handleAddToTimeline({
								currentTime,
								presetId: null,
								name: "Default text",
								content: "Default text",
							})
						}
					/>
				)}
				{subTab === "flower" && (
					<FlowerLibraryTab
						onAdd={({ currentTime, presetId, name }) =>
							handleAddToTimeline({
								currentTime,
								presetId,
								name,
								content: FLOWER_EFFECT_DEFAULT_CONTENT,
							})
						}
					/>
				)}
				{subTab === "template" && <TextTemplateTab />}
			</div>
		</div>
	);
}

function NewTextTab({
	onAdd,
}: {
	onAdd: ({ currentTime }: { currentTime: MediaTime }) => void;
}) {
	return (
		<div className="flex flex-col gap-3">
			<div
				className="grid gap-2"
				style={{
					gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))",
				}}
			>
				<DraggableItem
					name="Default text"
					preview={
						<div className="bg-accent/80 flex size-full items-center justify-center rounded-md">
							<span className="select-none text-center text-sm font-medium">
								Default text
							</span>
						</div>
					}
					dragData={{
						id: "text-tpl-default",
						type: DEFAULTS.text.element.type,
						name: "Default text",
						content: "Default text",
						flowerPresetId: null,
					}}
					aspectRatio={1}
					onAddToTimeline={onAdd}
					shouldShowLabel={false}
					containerClassName="w-full"
					isRounded
					variant="card"
				/>
			</div>
		</div>
	);
}

function FlowerCoverThumb({
	cover,
	preview,
	name,
}: {
	cover: string;
	preview?: string | null;
	name: string;
}) {
	const imgRef = useRef<HTMLImageElement>(null);
	const [hovering, setHovering] = useState(false);
	const [playId, setPlayId] = useState(0);
	useEffect(() => {
		const img = imgRef.current;
		if (!img) return;
		if (hovering && preview) {
			img.src = "";
			img.src = preview;
			return;
		}
		if (cover) img.src = cover;
	}, [hovering, preview, cover, playId]);

	if (!cover) {
		return (
			<div className="bg-accent flex size-full items-center justify-center rounded">
				<span className="select-none px-1 text-center text-xs">{name}</span>
			</div>
		);
	}

	return (
		// eslint-disable-next-line @next/next/no-img-element
		<img
			ref={imgRef}
			src={cover}
			alt={name}
			className="size-full rounded object-cover"
			draggable={false}
			onMouseEnter={() => {
				if (!preview) return;
				setPlayId((v) => v + 1);
				setHovering(true);
			}}
			onMouseLeave={() => setHovering(false)}
		/>
	);
}

function FlowerLibraryTab({
	onAdd,
}: {
	onAdd: ({
		currentTime,
		presetId,
		name,
	}: {
		currentTime: MediaTime;
		presetId: string;
		name: string;
	}) => void;
}) {
	const [presets, setPresets] = useState<LoadedFlowerPackPreset[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		void loadFlowerPackCatalog().then((list) => {
			if (cancelled) return;
			setPresets(list);
			setLoading(false);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<div className="flex flex-col gap-3">
			<div className="text-muted-foreground text-xs font-medium">
				Effects
				<span className="ml-1 opacity-60">
					({loading ? "…" : presets.length})
				</span>
			</div>
			{!loading && presets.length === 0 ? (
				<p className="text-muted-foreground text-xs">No effects yet</p>
			) : (
				<div
					className="grid gap-2"
					style={{
						gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
					}}
				>
					{presets.map((tpl) => (
						<DraggableItem
							key={tpl.id}
							name={tpl.name}
							preview={
								<FlowerCoverThumb
									cover={tpl.cover}
									preview={tpl.preview}
									name={tpl.name}
								/>
							}
							dragData={{
								id: `text-flower-${tpl.id}`,
								type: DEFAULTS.text.element.type,
								name: tpl.name,
								content: FLOWER_EFFECT_DEFAULT_CONTENT,
								flowerPresetId: tpl.id,
							}}
							aspectRatio={1}
							onAddToTimeline={({ currentTime }) =>
								onAdd({
									currentTime,
									presetId: tpl.id,
									name: tpl.name,
								})
							}
							shouldShowLabel={true}
							containerClassName="w-full"
							isRounded
							variant="card"
						/>
					))}
				</div>
			)}
		</div>
	);
}

function TextTemplateThumb({ pack }: { pack: LoadedVfxPack }) {
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
		return (
			<div className="bg-accent flex size-full items-center justify-center rounded">
				<span className="select-none px-1 text-center text-xs">{pack.displayName}</span>
			</div>
		);
	}

	return (
		// eslint-disable-next-line @next/next/no-img-element
		<img
			ref={imgRef}
			src={poster}
			alt={pack.displayName}
			className="size-full rounded object-cover"
			draggable={false}
			onMouseEnter={() => {
				if (!hover) return;
				setPlayId((v) => v + 1);
				setHovering(true);
			}}
			onMouseLeave={() => setHovering(false)}
		/>
	);
}

function TextTemplateTab() {
	const editor = useEditor();
	const packs = usePackRegistry((state) => state.packs);
	const templates = packs.filter(
		(pack) => normalizeVfxPackType(pack.type) === "text-template",
	);

	const addFromPack = ({
		currentTime,
		pack,
	}: {
		currentTime: MediaTime;
		pack: LoadedVfxPack;
	}) => {
		const activeScene = editor.scenes.getActiveScene();
		if (!activeScene) return;

		const applied = buildTextTemplateApply(pack);
		const params = {
			...DEFAULTS.text.element.params,
			content: applied.content,
			...applied.paramsPatch,
		} as ParamValues;

		const element = buildTextElement({
			raw: {
				...DEFAULTS.text.element,
				name: pack.displayName || "Text template",
				params,
				flowerStyle: applied.flowerStyle,
				flowerBaseFontSize: applied.flowerBaseFontSize,
				flowerTemplateId: pack.id,
				textTemplatePackId: applied.textTemplatePackId,
				textStickers: applied.textStickers,
				textTemplateMediaPlayers: applied.textTemplateMediaPlayers,
				textFxStack: applied.textFxStack,
				textAnims: applied.textAnims,
			},
			startTime: currentTime,
		});

		editor.timeline.insertElement({
			element,
			placement: { mode: "auto" },
		});

		toast.message("Text template added", {
			description: describeTextTemplateApply(applied),
		});
	};

	return (
		<div className="flex flex-col gap-3">
			<div className="text-muted-foreground text-xs font-medium">
				Text templates
				<span className="ml-1 opacity-60">({templates.length})</span>
			</div>
			{templates.length === 0 ? (
				<div className="border-border bg-accent/30 flex min-h-[140px] flex-col items-center justify-center rounded-md border border-dashed px-4 py-8 text-center">
					<p className="text-muted-foreground text-sm">No text templates yet</p>
					<p className="text-muted-foreground mt-1 text-[11px] leading-relaxed opacity-80">
						Export Pack type = Text template from the Asset Editor into
						public/vfxpacks/text-templates/ and list it in index.json.
					</p>
				</div>
			) : (
				<div
					className="grid gap-2"
					style={{
						gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
					}}
				>
					{templates.map((pack) => (
						<DraggableItem
							key={pack.id}
							name={pack.displayName}
							preview={<TextTemplateThumb pack={pack} />}
							dragData={{
								id: `text-template-${pack.id}`,
								type: DEFAULTS.text.element.type,
								name: pack.displayName,
								content:
									pack.manifest.textTemplate?.text?.content ||
									pack.displayName,
								textTemplatePackId: pack.id,
							}}
							aspectRatio={1}
							onAddToTimeline={({ currentTime }) =>
								addFromPack({ currentTime, pack })
							}
							shouldShowLabel={true}
							containerClassName="w-full"
							isRounded
							variant="card"
						/>
					))}
				</div>
			)}
		</div>
	);
}
