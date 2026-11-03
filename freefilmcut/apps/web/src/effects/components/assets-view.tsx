"use client";

import {
	useEffect,
	useRef,
	useCallback,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import { effectsRegistry, EFFECT_TARGET_ELEMENT_TYPES } from "@/effects";
import { effectPreviewService } from "@/services/renderer/effect-preview";
import { useEditor } from "@/editor/use-editor";
import { buildEffectElement } from "@/timeline/element-utils";
import type { EffectDefinition } from "@/effects/types";
import { Button } from "@/components/ui/button";
import { useFileUpload } from "@/media/use-file-upload";
import {
	loadVfxPackFromFile,
	usePackRegistry,
	toVfxPackEffectType,
	getVfxPackPlacement,
	VFX_PACK_TYPE_ORDER,
	VFX_PACK_TYPE_LABELS,
	normalizeVfxPackType,
	getVfxPackElementDuration,
} from "@/vfxpack";
import type { LoadedVfxPack, PrimaryVfxPackType } from "@/vfxpack";
import { packLibraryThumb } from "@/vfxpack/preview-assets";
import { toast } from "sonner";
import { cn } from "@/utils/ui";
import { HugeiconsIcon } from "@hugeicons/react";
import { CloudUploadIcon, MagicWand05Icon } from "@hugeicons/core-free-icons";

export function EffectsView() {
	return (
		<VfxPackPanel
			title="Effects"
			filterTypes={["effect"]}
			showBuiltInEffects
			emptyHint="Import a .vfxpack with Pack type = Effect (set in the Asset Editor)."
		/>
	);
}

type AdjustmentView = "filters" | "lut";

function isAdjustmentView(value: string): value is AdjustmentView {
	return value === "filters" || value === "lut";
}

/** Adjustment tab (CapCut 调节): Filters = filter-type packs, LUT = local LUT import. */
export function AdjustmentsVfxView() {
	const [view, setView] = useState<AdjustmentView>("filters");
	const viewTabs = (
		<Tabs
			value={view}
			onValueChange={(value) => {
				if (isAdjustmentView(value)) setView(value);
			}}
		>
			<TabsList>
				<TabsTrigger value="filters">Filters</TabsTrigger>
				<TabsTrigger value="lut">LUT</TabsTrigger>
			</TabsList>
		</Tabs>
	);

	if (view === "lut") {
		return (
			<PanelView actions={viewTabs}>
				<p className="text-muted-foreground mb-3 px-1 text-xs">
					Importing local LUT files is coming soon.
				</p>
			</PanelView>
		);
	}

	return (
		<VfxPackPanel
			headerTabs={viewTabs}
			filterTypes={["filter"]}
			showBuiltInEffects={false}
			emptyHint="Import a .vfxpack with Pack type = Filter (set in the Asset Editor), or add files under public/vfxpacks/adjustments/filters/."
		/>
	);
}

/** Transitions tab: only transition-type packs + import. */
export function TransitionsVfxView() {
	return (
		<VfxPackPanel
			title="Transitions"
			filterTypes={["transition"]}
			showBuiltInEffects={false}
			emptyHint="Import a .vfxpack with Pack type = Transition (set in the Asset Editor)."
		/>
	);
}

/** Stickers tab section: sticker-type packs plus import. */
export function StickerVfxPackSection({
	searchQuery = "",
}: {
	searchQuery?: string;
}) {
	const packs = usePackRegistry((s) => s.packs);
	const registerPack = usePackRegistry((s) => s.registerPack);
	const query = searchQuery.trim().toLowerCase();
	const stickerPacks = packs.filter((p) => {
		if (normalizeVfxPackType(p.type) !== "sticker") return false;
		if (!query) return true;
		const name = String(p.displayName || p.id || "").toLowerCase();
		return name.includes(query) || String(p.id).toLowerCase().includes(query);
	});

	const processVfxPacks = useCallback(
		async ({ files }: { files: File[] }) => {
			const packFiles = files.filter(
				(f) =>
					f.name.toLowerCase().endsWith(".vfxpack") ||
					f.name.toLowerCase().endsWith(".zip") ||
					f.type === "application/zip" ||
					f.type === "application/x-zip-compressed",
			);
			if (packFiles.length === 0) {
				toast.error("Please choose a .vfxpack file");
				return;
			}

			for (const file of packFiles) {
				try {
					const pack = await loadVfxPackFromFile({ file });
					registerPack(pack);
					const placement = getVfxPackPlacement({ type: pack.type });
					toast.success(`Imported ${pack.displayName}`, {
						description: `${placement.label} · ${placement.dragHint}`,
					});
				} catch (error) {
					console.error(error);
					toast.error(`Failed to import ${file.name}`, {
						description:
							error instanceof Error ? error.message : String(error),
					});
				}
			}
		},
		[registerPack],
	);

	const { openFilePicker, fileInputProps, isDragOver, dragProps } =
		useFileUpload({
			accept: ".vfxpack,application/zip",
			multiple: true,
			onFilesSelected: (files) => {
				void processVfxPacks({ files });
			},
		});

	return (
		<div
			className={cn(
				"relative mb-3 flex flex-col gap-2 px-2",
				isDragOver && "ring-2 ring-primary/60 ring-inset",
			)}
			{...dragProps}
		>
			<input {...fileInputProps} accept=".vfxpack,application/zip" />
			<div className="flex items-center justify-between gap-2 px-1">
				<div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
					VfxPack stickers
				</div>
				<Button variant="secondary" size="sm" onClick={openFilePicker}>
					<HugeiconsIcon icon={CloudUploadIcon} className="size-4" />
					Import VfxPack
				</Button>
			</div>
			{stickerPacks.length === 0 ? (
				<p className="text-muted-foreground px-1 text-xs">
					{query
						? `No stickers match "${searchQuery}".`
						: "Import a .vfxpack with Pack type = Sticker, or add files under public/vfxpacks/stickers/."}
				</p>
			) : (
				<div
					className="grid gap-2"
					style={{
						gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
					}}
				>
					{stickerPacks.map((pack) => (
						<VfxPackItem
							key={pack.id}
							pack={pack}
							onRemove={() => usePackRegistry.getState().removePack(pack.id)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function VfxPackPanel({
	title,
	headerTabs,
	filterTypes,
	showBuiltInEffects,
	emptyHint,
}: {
	title?: string;
	/** Replaces the title on the left of the header (sub-view switcher). */
	headerTabs?: ReactNode;
	/** null = show all primary types grouped */
	filterTypes: PrimaryVfxPackType[] | null;
	showBuiltInEffects: boolean;
	emptyHint?: string;
}) {
	const effects = effectsRegistry.getAll();
	const packs = usePackRegistry((s) => s.packs);
	const registerPack = usePackRegistry((s) => s.registerPack);
	const removePack = usePackRegistry((s) => s.removePack);

	const processVfxPacks = useCallback(
		async ({ files }: { files: File[] }) => {
			const packFiles = files.filter(
				(f) =>
					f.name.toLowerCase().endsWith(".vfxpack") ||
					f.name.toLowerCase().endsWith(".zip") ||
					f.type === "application/zip" ||
					f.type === "application/x-zip-compressed",
			);
			if (packFiles.length === 0) {
				toast.error("Please choose a .vfxpack file");
				return;
			}

			for (const file of packFiles) {
				try {
					const pack = await loadVfxPackFromFile({ file });
					registerPack(pack);
					const placement = getVfxPackPlacement({ type: pack.type });
					toast.success(`Imported ${pack.displayName}`, {
						description: `${placement.label} · ${placement.dragHint}`,
					});
				} catch (error) {
					console.error(error);
					toast.error(`Failed to import ${file.name}`, {
						description:
							error instanceof Error ? error.message : String(error),
					});
				}
			}
		},
		[registerPack],
	);

	const { openFilePicker, fileInputProps, isDragOver, dragProps } =
		useFileUpload({
			accept: ".vfxpack,application/zip",
			multiple: true,
			onFilesSelected: (files) => {
				void processVfxPacks({ files });
			},
		});

	const grouped = useMemo(() => {
		const map = new Map<PrimaryVfxPackType, LoadedVfxPack[]>();
		for (const type of VFX_PACK_TYPE_ORDER) map.set(type, []);
		for (const pack of packs) {
			const type = normalizeVfxPackType(pack.type);
			if (filterTypes && !filterTypes.includes(type)) continue;
			const bucket = map.get(type);
			if (!bucket) continue;
			bucket.push(pack);
		}
		return VFX_PACK_TYPE_ORDER.filter((t) => {
			if (filterTypes && !filterTypes.includes(t)) return false;
			return (map.get(t)?.length ?? 0) > 0;
		}).map((type) => ({
			type,
			label: VFX_PACK_TYPE_LABELS[type],
			packs: map.get(type)!,
		}));
	}, [packs, filterTypes]);

	const visiblePackCount = grouped.reduce((n, g) => n + g.packs.length, 0);

	const importButton = (
		<Button variant="secondary" size="sm" onClick={openFilePicker}>
			<HugeiconsIcon icon={CloudUploadIcon} className="size-4" />
			Import VfxPack
		</Button>
	);

	return (
		<PanelView
			title={headerTabs ? undefined : title}
			actions={
				headerTabs ? (
					<div className="flex w-full items-center justify-between gap-2">
						{headerTabs}
						{importButton}
					</div>
				) : (
					importButton
				)
			}
			{...dragProps}
			className={cn(isDragOver && "ring-2 ring-primary/60 ring-inset")}
		>
			<input {...fileInputProps} accept=".vfxpack,application/zip" />
			{grouped.map((group) => (
				<div key={group.type} className="mb-3 flex flex-col gap-2">
					<div className="text-muted-foreground px-1 text-xs font-medium uppercase tracking-wide">
						{group.label}
						<span className="ml-1 opacity-60">({group.packs.length})</span>
					</div>
					<div
						className="grid gap-2"
						style={{
							gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
						}}
					>
						{group.packs.map((pack) => (
							<VfxPackItem
								key={pack.id}
								pack={pack}
								onRemove={() => removePack(pack.id)}
							/>
						))}
					</div>
				</div>
			))}
			{visiblePackCount === 0 && emptyHint && (
				<p className="text-muted-foreground mb-3 px-1 text-xs">{emptyHint}</p>
			)}
			{showBuiltInEffects && <EffectsGrid effects={effects} />}
			{isDragOver && (
				<div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/70 text-sm font-medium">
					Drop .vfxpack to import
				</div>
			)}
		</PanelView>
	);
}

function VfxPackItem({
	pack,
	onRemove,
}: {
	pack: LoadedVfxPack;
	onRemove: () => void;
}) {
	const editor = useEditor();
	const effectType = toVfxPackEffectType({ packId: pack.id });
	const placement = getVfxPackPlacement({ type: pack.type });
	const handleAddToTimeline = useCallback(() => {
		const trackType = placement.insertTrackType;
		if (!trackType) return;

		const currentTime = editor.playback.getCurrentTime();
		const element = buildEffectElement({
			effectType,
			startTime: currentTime,
			name: pack.displayName,
			duration: getVfxPackElementDuration({ pack }),
		});

		editor.timeline.insertElement({
			placement: { mode: "auto", trackType },
			element,
		});
	}, [editor, effectType, pack, placement.insertTrackType]);

	const preview = <PackLibraryThumb pack={pack} />;

	return (
		<div className="flex flex-col gap-1">
			<DraggableItem
				name={pack.displayName}
				preview={preview}
				dragData={{
					id: effectType,
					name: pack.displayName,
					type: "effect",
					effectType,
					targetElementTypes: [...placement.targetElementTypes],
				}}
				onAddToTimeline={handleAddToTimeline}
				aspectRatio={1}
				isRounded
				variant="card"
				containerClassName="w-full"
			/>
			<div className="text-muted-foreground truncate px-0.5 text-[10px] leading-tight">
				{placement.label}
			</div>
			<Button
				variant="ghost"
				size="sm"
				className="h-6 px-1 text-[10px]"
				onClick={onRemove}
			>
				Remove
			</Button>
		</div>
	);
}

function PackLibraryThumb({ pack }: { pack: LoadedVfxPack }) {
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
			<div className="text-muted-foreground flex size-full flex-col items-center justify-center gap-1 p-2">
				<HugeiconsIcon icon={MagicWand05Icon} className="size-6" />
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

function EffectsGrid({ effects }: { effects: EffectDefinition[] }) {
	return (
		<div
			className="grid gap-2"
			style={{ gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))" }}
		>
			{effects.map((effect) => (
				<EffectItem key={effect.type} effect={effect} />
			))}
		</div>
	);
}

function EffectPreviewCanvas({ effectType }: { effectType: string }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const render = () => {
			if (canvasRef.current) {
				effectPreviewService.renderPreview({
					effectType,
					params: {},
					targetCanvas: canvasRef.current,
				});
			}
		};

		render();
		return effectPreviewService.onPreviewImageReady({ callback: render });
	}, [effectType]);

	return <canvas ref={canvasRef} className="size-full" />;
}

function EffectItem({ effect }: { effect: EffectDefinition }) {
	const editor = useEditor();

	const handleAddToTimeline = useCallback(() => {
		const currentTime = editor.playback.getCurrentTime();
		const element = buildEffectElement({
			effectType: effect.type,
			startTime: currentTime,
		});

		editor.timeline.insertElement({
			placement: { mode: "auto", trackType: "effect" },
			element,
		});
	}, [editor, effect.type]);

	const preview = <EffectPreviewCanvas effectType={effect.type} />;

	return (
		<DraggableItem
			name={effect.name}
			preview={preview}
			dragData={{
				id: effect.type,
				name: effect.name,
				type: "effect",
				effectType: effect.type,
				targetElementTypes: EFFECT_TARGET_ELEMENT_TYPES,
			}}
			onAddToTimeline={handleAddToTimeline}
			aspectRatio={1}
			isRounded
			variant="card"
			containerClassName="w-full"
		/>
	);
}
