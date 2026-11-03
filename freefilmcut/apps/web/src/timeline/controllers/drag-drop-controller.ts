import {
	applyFlowerPresetToTextElement,
	FLOWER_EFFECT_DEFAULT_CONTENT,
	FLOWER_EFFECT_DEFAULT_FONT_SIZE,
} from "@/vfxpack/timeline-flower-text";
import { buildTextTemplateApply } from "@/vfxpack/apply-text-template";
import {
	createDefaultFlowerStyle,
	createSolidContent,
} from "@/vfxpack/flower-style";
import { DEFAULTS } from "@/timeline/defaults";
import type { DragEvent } from "react";
import { processMediaAssets } from "@/media/processing";
import { showMediaUploadToast } from "@/media/upload-toast";
import {
	DEFAULT_NEW_ELEMENT_DURATION,
	toElementDurationTicks,
} from "@/timeline/creation";
import { BASE_TIMELINE_PIXELS_PER_SECOND } from "@/timeline/scale";
import type { FrameRate } from "opencut-wasm";
import {
	buildTextElement,
	buildGraphicElement,
	buildStickerElement,
	buildElementFromMedia,
	buildEffectElement,
} from "@/timeline/element-utils";
import { AddTrackCommand, InsertElementCommand } from "@/commands/timeline";
import { BatchCommand } from "@/commands";
import type { Command } from "@/commands/base-command";
import { computeDropTarget } from "@/timeline/components/drop-target";
import type { TimelineDragSource } from "@/timeline/drag-source";
import type {
	TrackType,
	DropTarget,
	ElementType,
	SceneTracks,
	TimelineTrack,
	CreateTimelineElement,
} from "@/timeline";
import type { TimelineDragData } from "@/timeline/drag";
import type { MediaAsset } from "@/media/types";
import type { ProcessedMediaAsset } from "@/media/processing";
import { roundFrameTime, type MediaTime } from "@/wasm";
import { parseVfxPackIdFromEffectType } from "@/vfxpack/effect-id";
import { getPackRegistrySnapshot } from "@/vfxpack/pack-registry";
import { normalizeVfxPackType } from "@/vfxpack/pack-placement";
import { getVfxPackElementDuration } from "@/vfxpack/duration";
import { resolveTransitionCutDrop } from "@/timeline/controllers/transition-cut-drop";

// --- Config ---

export interface DragDropConfig {
	zoomLevel: number;
	getContainerEl: () => HTMLDivElement | null;
	getHeaderEl: () => HTMLElement | null;
	getTracksScrollEl: () => HTMLDivElement | null;
	getActiveProjectFps: () => FrameRate | null;
	getActiveProjectId: () => string | null;
	getSceneTracks: () => SceneTracks;
	getCurrentPlayheadTime: () => MediaTime;
	getMediaAssets: () => MediaAsset[];
	dragSource: TimelineDragSource;
	addMediaAsset: (args: {
		projectId: string;
		asset: ProcessedMediaAsset;
	}) => Promise<MediaAsset | null>;
	executeCommand: (command: Command) => void;
	insertElement: (args: {
		placement: { mode: "explicit"; trackId: string };
		element: CreateTimelineElement;
	}) => void;
	addClipEffect: (args: {
		trackId: string;
		elementId: string;
		effectType: string;
	}) => void;
	upsertTransition: (args: {
		trackId: string;
		fromElementId: string;
		toElementId: string;
		packId: string;
	}) => void;
}

export interface DragDropConfigRef {
	readonly current: DragDropConfig;
}

// --- State ---

interface DragOverState {
	kind: "over";
	dropTarget: DropTarget | null;
	elementType: ElementType | null;
}

type DragDropState = { kind: "idle" } | DragOverState;

interface TimelineCoords {
	mouseX: number;
	mouseY: number;
}

// --- Pure helpers ---

function elementTypeFromDrag({
	dragData,
}: {
	dragData: TimelineDragData;
}): ElementType {
	switch (dragData.type) {
		case "text":
			return "text";
		case "graphic":
			return "graphic";
		case "sticker":
			return "sticker";
		case "effect":
			return "effect";
		case "media":
			return dragData.mediaType;
	}
}

function getTargetElementTypesForDrag({
	dragData,
}: {
	dragData: TimelineDragData;
}): string[] | undefined {
	if (dragData.type === "effect") return dragData.targetElementTypes;
	if (dragData.type === "media") return dragData.targetElementTypes;
	return undefined;
}

function getDurationForDrag({
	dragData,
	mediaAssets,
}: {
	dragData: TimelineDragData;
	mediaAssets: MediaAsset[];
}): MediaTime {
	if (dragData.type === "media") {
		const media = mediaAssets.find((asset) => asset.id === dragData.id);
		return toElementDurationTicks({ seconds: media?.duration });
	}
	if (dragData.type === "effect") {
		const packId = parseVfxPackIdFromEffectType({
			effectType: dragData.effectType,
		});
		if (packId) {
			const pack = getPackRegistrySnapshot().packs.find((p) => p.id === packId);
			if (pack) return getVfxPackElementDuration({ pack });
		}
	}
	return DEFAULT_NEW_ELEMENT_DURATION;
}

function orderedTracks({
	sceneTracks,
}: {
	sceneTracks: SceneTracks;
}): TimelineTrack[] {
	return [...sceneTracks.overlay, sceneTracks.main, ...sceneTracks.audio];
}

function transitionPackIdFromDrag({
	dragData,
}: {
	dragData: TimelineDragData;
}): string | null {
	if (dragData.type !== "effect") return null;
	const packId = parseVfxPackIdFromEffectType({
		effectType: dragData.effectType,
	});
	if (!packId) return null;
	const pack = getPackRegistrySnapshot().packs.find((item) => item.id === packId);
	if (!pack || normalizeVfxPackType(pack.type) !== "transition") return null;
	return packId;
}

// --- Controller ---

export class DragDropController {
	private state: DragDropState = { kind: "idle" };
	private enterCount = 0;
	private readonly subscribers = new Set<() => void>();
	private readonly configRef: DragDropConfigRef;

	constructor(deps: { configRef: DragDropConfigRef }) {
		this.configRef = deps.configRef;
		this.onDragEnter = this.onDragEnter.bind(this);
		this.onDragOver = this.onDragOver.bind(this);
		this.onDragLeave = this.onDragLeave.bind(this);
		this.onDrop = this.onDrop.bind(this);
	}

	private get config(): DragDropConfig {
		return this.configRef.current;
	}

	get isDragOver(): boolean {
		return this.state.kind !== "idle";
	}

	get dropTarget(): DropTarget | null {
		return this.state.kind === "over" ? this.state.dropTarget : null;
	}

	get dragElementType(): ElementType | null {
		return this.state.kind === "over" ? this.state.elementType : null;
	}

	subscribe(fn: () => void): () => void {
		this.subscribers.add(fn);
		return () => this.subscribers.delete(fn);
	}

	destroy(): void {
		this.subscribers.clear();
	}

	// --- Drag event handlers (bound, stable, passed as React props) ---

	onDragEnter(event: DragEvent): void {
		event.preventDefault();
		const hasAsset = this.config.dragSource.isActive();
		const hasFiles = event.dataTransfer.types.includes("Files");
		if (!hasAsset && !hasFiles) return;

		this.enterCount += 1;
		if (this.state.kind === "idle") {
			this.setOver({ dropTarget: null, elementType: null });
		}
	}

	onDragOver(event: DragEvent): void {
		event.preventDefault();

		const coords = this.getMouseTimelineCoords({ event });
		if (!coords) return;

		const dragData = this.config.dragSource.getActive();
		const hasFiles = event.dataTransfer.types.includes("Files");
		const isExternal = hasFiles && !dragData;

		if (!dragData) {
			if (hasFiles && isExternal) {
				this.setOver({ dropTarget: null, elementType: null });
			}
			return;
		}

		if (this.handleTransitionDragOver({ event, dragData, coords })) {
			return;
		}

		const elementType = elementTypeFromDrag({ dragData });
		const duration = getDurationForDrag({
			dragData,
			mediaAssets: this.config.getMediaAssets(),
		});
		const targetElementTypes = getTargetElementTypesForDrag({ dragData });

		const sceneTracks = this.config.getSceneTracks();
		const target = computeDropTarget({
			elementType,
			mouseX: coords.mouseX,
			mouseY: coords.mouseY,
			tracks: sceneTracks,
			playheadTime: this.config.getCurrentPlayheadTime(),
			isExternalDrop: isExternal,
			elementDuration: duration,
			pixelsPerSecond: BASE_TIMELINE_PIXELS_PER_SECOND,
			zoomLevel: this.config.zoomLevel,
			targetElementTypes,
		});

		const fps = this.config.getActiveProjectFps();
		target.xPosition = fps
			? roundFrameTime({ time: target.xPosition, fps })
			: target.xPosition;

		this.setOver({ dropTarget: target, elementType });
		event.dataTransfer.dropEffect = "copy";
	}

	onDragLeave(event: DragEvent): void {
		event.preventDefault();
		if (this.enterCount === 0) return;
		this.enterCount -= 1;
		if (this.enterCount === 0) {
			this.setIdle();
		}
	}

	onDrop(event: DragEvent): void {
		event.preventDefault();
		this.enterCount = 0;

		const dragData = this.config.dragSource.getActive();
		const hasFiles = event.dataTransfer.files?.length > 0;
		if (!dragData && !hasFiles) return;

		const currentTarget = this.dropTarget;
		this.setIdle();

		try {
			if (dragData) {
				if (transitionPackIdFromDrag({ dragData })) {
					this.executeTransitionDrop({
						target: currentTarget,
						dragData,
					});
					return;
				}
				if (!currentTarget) return;
				this.executeAssetDrop({ target: currentTarget, dragData });
				return;
			}

			const coords = this.getMouseTimelineCoords({ event });
			if (!coords) return;
			this.executeFileDrop({
				files: Array.from(event.dataTransfer.files),
				mouseX: coords.mouseX,
				mouseY: coords.mouseY,
			}).catch((error) => {
				console.error("Failed to process file drop:", error);
			});
		} catch (error) {
			console.error("Failed to process drop:", error);
		}
	}

	// --- Private ---

	private setOver(state: {
		dropTarget: DropTarget | null;
		elementType: ElementType | null;
	}): void {
		this.state = { kind: "over", ...state };
		this.notify();
	}

	private setIdle(): void {
		this.state = { kind: "idle" };
		this.notify();
	}

	private notify(): void {
		for (const fn of this.subscribers) fn();
	}

	private getMouseTimelineCoords({
		event,
	}: {
		event: DragEvent;
	}): TimelineCoords | null {
		const scrollContainer = this.config.getTracksScrollEl();
		const referenceRect =
			scrollContainer?.getBoundingClientRect() ??
			this.config.getContainerEl()?.getBoundingClientRect();
		if (!referenceRect) return null;

		const scrollLeft = scrollContainer?.scrollLeft ?? 0;
		const scrollTop = scrollContainer?.scrollTop ?? 0;
		const headerHeight =
			this.config.getHeaderEl()?.getBoundingClientRect().height ?? 0;

		return {
			mouseX: event.clientX - referenceRect.left + scrollLeft,
			mouseY: event.clientY - referenceRect.top + scrollTop - headerHeight,
		};
	}

	private handleTransitionDragOver({
		event,
		dragData,
		coords,
	}: {
		event: DragEvent;
		dragData: TimelineDragData;
		coords: TimelineCoords;
	}): boolean {
		if (!transitionPackIdFromDrag({ dragData })) return false;

		const target = resolveTransitionCutDrop({
			mouseX: coords.mouseX,
			mouseY: coords.mouseY,
			tracks: orderedTracks({ sceneTracks: this.config.getSceneTracks() }),
			zoomLevel: this.config.zoomLevel,
		});
		this.setOver({ dropTarget: target, elementType: "effect" });
		event.dataTransfer.dropEffect = target ? "copy" : "none";
		return true;
	}

	private executeTransitionDrop({
		target,
		dragData,
	}: {
		target: DropTarget | null;
		dragData: TimelineDragData;
	}): void {
		const packId = transitionPackIdFromDrag({ dragData });
		const cut = target?.transitionCut;
		if (!packId || !cut) return;

		this.config.upsertTransition({
			trackId: cut.trackId,
			fromElementId: cut.fromElementId,
			toElementId: cut.toElementId,
			packId,
		});
	}

	// Shared insertion logic — new track vs existing track.
	private insertAtTarget({
		element,
		target,
		trackType,
	}: {
		element: CreateTimelineElement;
		target: DropTarget;
		trackType: TrackType;
	}): void {
		if (target.isNewTrack) {
			const addTrackCmd = new AddTrackCommand({
				type: trackType,
				index: target.trackIndex,
			});
			this.config.executeCommand(
				new BatchCommand([
					addTrackCmd,
					new InsertElementCommand({
						element,
						placement: { mode: "explicit", trackId: addTrackCmd.getTrackId() },
					}),
				]),
			);
			return;
		}

		const tracks = orderedTracks({ sceneTracks: this.config.getSceneTracks() });
		const track = tracks[target.trackIndex];
		if (!track) return;
		this.config.insertElement({
			placement: { mode: "explicit", trackId: track.id },
			element,
		});
	}

	private executeAssetDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: TimelineDragData;
	}): void {
		switch (dragData.type) {
			case "text":
				this.executeTextDrop({ target, dragData });
				return;
			case "graphic":
				this.executeGraphicDrop({ target, dragData });
				return;
			case "sticker":
				this.executeStickerDrop({ target, dragData });
				return;
			case "effect":
				this.executeEffectDrop({ target, dragData });
				return;
			case "media":
				this.executeMediaDrop({ target, dragData });
				return;
		}
	}

	private executeTextDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: Extract<TimelineDragData, { type: "text" }> & {
			flowerPresetId?: string | null;
			content?: string;
			textTemplatePackId?: string | null;
		};
	}): void {
		let params = {
			...DEFAULTS.text.element.params,
			content:
				typeof dragData.content === "string"
					? dragData.content
					: DEFAULTS.text.element.params.content,
		};
		let flowerStyle: unknown = undefined;
		let flowerBaseFontSize: number | null | undefined = undefined;
		let flowerDesignCanvasHeight: number | null | undefined = undefined;
		let flowerTemplateId: string | null | undefined = undefined;
		let textTemplatePackId: string | null | undefined = undefined;
		let textStickers: Array<Record<string, unknown>> | null | undefined =
			undefined;
		let textTemplateMediaPlayers:
			| Array<Record<string, unknown>>
			| null
			| undefined = undefined;
		let textFxStack:
			| Record<string, unknown>
			| null
			| undefined = undefined;
		let textAnims:
			| import("@/timeline").TextElement["textAnims"]
			| null
			| undefined = undefined;

		const tplPackId =
			typeof dragData.textTemplatePackId === "string" &&
			dragData.textTemplatePackId
				? dragData.textTemplatePackId
				: null;
		if (tplPackId) {
			const pack = getPackRegistrySnapshot().packs.find((x) => x.id === tplPackId);
			if (pack && normalizeVfxPackType(pack.type) === "text-template") {
				const applied = buildTextTemplateApply(pack);
				params = {
					...params,
					content: applied.content,
					...applied.paramsPatch,
				};
				flowerStyle = applied.flowerStyle;
				flowerBaseFontSize = applied.flowerBaseFontSize;
				flowerDesignCanvasHeight = null;
				flowerTemplateId = pack.id;
				textTemplatePackId = applied.textTemplatePackId;
				textStickers = applied.textStickers;
				textTemplateMediaPlayers = applied.textTemplateMediaPlayers;
				textFxStack = applied.textFxStack;
				textAnims = applied.textAnims;
			}
		}

		const presetId =
			typeof (dragData as { flowerPresetId?: string | null }).flowerPresetId ===
			"string"
				? (dragData as { flowerPresetId: string }).flowerPresetId
				: null;
		if (!tplPackId && presetId) {
			// New Effects clip from drag: fixed default text/size; never pack UIText.
			params = {
				...params,
				content: FLOWER_EFFECT_DEFAULT_CONTENT,
				fontSize: FLOWER_EFFECT_DEFAULT_FONT_SIZE,
			};
			const patch = applyFlowerPresetToTextElement({ params, presetId });
			params = patch.params;
			flowerStyle = patch.flowerStyle;
			flowerBaseFontSize = patch.flowerBaseFontSize;
			flowerDesignCanvasHeight = patch.flowerDesignCanvasHeight;
			flowerTemplateId = patch.flowerTemplateId;
			textTemplateMediaPlayers = patch.textTemplateMediaPlayers ?? null;
			// Prefer art-text pack id for GIF/RT bytes in registry.
			textTemplatePackId = patch.textTemplatePackId ?? null;
		} else if (!tplPackId) {
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
				name: dragData.name || DEFAULTS.text.element.name,
				params,
				flowerStyle,
				flowerBaseFontSize,
				flowerDesignCanvasHeight,
				flowerTemplateId,
				textTemplatePackId,
				textStickers,
				textTemplateMediaPlayers,
				textFxStack,
				textAnims,
			},
			startTime: target.xPosition,
		});

		this.insertAtTarget({ element, target, trackType: "text" });
	}

	private executeStickerDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: Extract<TimelineDragData, { type: "sticker" }>;
	}): void {
		const element = buildStickerElement({
			stickerId: dragData.stickerId,
			name: dragData.name,
			startTime: target.xPosition,
		});
		this.insertAtTarget({ element, target, trackType: "graphic" });
	}

	private executeGraphicDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: Extract<TimelineDragData, { type: "graphic" }>;
	}): void {
		const element = buildGraphicElement({
			definitionId: dragData.definitionId,
			name: dragData.name,
			startTime: target.xPosition,
			params: dragData.params,
		});
		this.insertAtTarget({ element, target, trackType: "graphic" });
	}

	private executeMediaDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: Extract<TimelineDragData, { type: "media" }>;
	}): void {
		if (target.targetElement) {
			// Replace media source — not yet implemented
			return;
		}

		const mediaAsset = this.config
			.getMediaAssets()
			.find((asset) => asset.id === dragData.id);
		if (!mediaAsset) return;

		const trackType: TrackType =
			dragData.mediaType === "audio" ? "audio" : "video";
		const element = buildElementFromMedia({
			mediaId: mediaAsset.id,
			mediaType: mediaAsset.type,
			name: mediaAsset.name,
			duration: toElementDurationTicks({ seconds: mediaAsset.duration }),
			startTime: target.xPosition,
		});
		this.insertAtTarget({ element, target, trackType });
	}

	private executeEffectDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: Extract<TimelineDragData, { type: "effect" }>;
	}): void {
		if (target.targetElement) {
			this.config.addClipEffect({
				trackId: target.targetElement.trackId,
				elementId: target.targetElement.elementId,
				effectType: dragData.effectType,
			});
			return;
		}

		const packId = parseVfxPackIdFromEffectType({
			effectType: dragData.effectType,
		});
		const pack = packId
			? getPackRegistrySnapshot().packs.find((p) => p.id === packId)
			: undefined;
		const element = buildEffectElement({
			effectType: dragData.effectType,
			startTime: target.xPosition,
			name: dragData.name,
			duration: pack ? getVfxPackElementDuration({ pack }) : undefined,
		});

		const existingEffectTrack = orderedTracks({
			sceneTracks: this.config.getSceneTracks(),
		}).find((track) => track.type === "effect");

		if (existingEffectTrack) {
			this.config.insertElement({
				placement: { mode: "explicit", trackId: existingEffectTrack.id },
				element,
			});
			return;
		}

		this.insertAtTarget({ element, target, trackType: "effect" });
	}

	private async executeFileDrop({
		files,
		mouseX,
		mouseY,
	}: {
		files: File[];
		mouseX: number;
		mouseY: number;
	}): Promise<void> {
		const projectId = this.config.getActiveProjectId();
		if (!projectId) return;

		await showMediaUploadToast({
			filesCount: files.length,
			promise: async () => {
				const processedAssets = await processMediaAssets({ files });

				// Sequential on purpose: each iteration reads getSceneTracks()
				// to decide placement (reuse empty main vs new track) and that
				// decision depends on the effects of prior inserts.
				for (const asset of processedAssets) {
					const createdAsset = await this.config.addMediaAsset({
						projectId,
						asset,
					});
					if (!createdAsset) continue;

					const duration = toElementDurationTicks({
						seconds: createdAsset.duration,
					});

					const sceneTracks = this.config.getSceneTracks();
					const currentTime = this.config.getCurrentPlayheadTime();

					const reuseMainTrackId =
						createdAsset.type !== "audio" &&
						sceneTracks.overlay.length === 0 &&
						sceneTracks.audio.length === 0 &&
						sceneTracks.main.elements.length === 0
							? sceneTracks.main.id
							: null;

					if (reuseMainTrackId) {
						this.config.insertElement({
							placement: { mode: "explicit", trackId: reuseMainTrackId },
							element: buildElementFromMedia({
								mediaId: createdAsset.id,
								mediaType: createdAsset.type,
								name: createdAsset.name,
								duration,
								startTime: currentTime,
							}),
						});
						continue;
					}

					const dropTarget = computeDropTarget({
						elementType: createdAsset.type,
						mouseX,
						mouseY,
						tracks: sceneTracks,
						playheadTime: currentTime,
						isExternalDrop: true,
						elementDuration: duration,
						pixelsPerSecond: BASE_TIMELINE_PIXELS_PER_SECOND,
						zoomLevel: this.config.zoomLevel,
					});

					const trackType: TrackType =
						createdAsset.type === "audio" ? "audio" : "video";
					this.insertAtTarget({
						element: buildElementFromMedia({
							mediaId: createdAsset.id,
							mediaType: createdAsset.type,
							name: createdAsset.name,
							duration,
							startTime: dropTarget.xPosition,
						}),
						target: dropTarget,
						trackType,
					});
				}

				return {
					uploadedCount: processedAssets.length,
					assetNames: processedAssets.map((asset) => asset.name),
				};
			},
		});
	}
}
