"use client";

import { useParams } from "next/navigation";
import {
	ResizablePanelGroup,
	ResizablePanel,
	ResizableHandle,
} from "@/components/ui/resizable";
import { AssetsPanel } from "@/components/editor/panels/assets";
import { PropertiesPanel } from "@/components/editor/panels/properties";
import { Timeline } from "@/timeline/components";
import { PreviewPanel } from "@/preview/components";
import { EditorHeader } from "@/components/editor/editor-header";
import { EditorProvider } from "@/components/providers/editor-provider";
import { Onboarding } from "@/components/editor/onboarding";
import { MigrationDialog } from "@/project/components/migration-dialog";
import { usePanelStore } from "@/editor/panel-store";
import { usePasteMedia } from "@/media/use-paste-media";
import { MobileGate } from "@/components/editor/mobile-gate";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "@/editor/use-editor";
import type { MediaTime } from "@/wasm";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { ChangelogNotification } from "@/changelog/components/changelog-notification";
import {
	createPreviewOverlayControl,
	isPreviewOverlayVisible,
	mergePreviewOverlaySources,
} from "@/preview/overlays";
import { usePreviewStore } from "@/preview/preview-store";
import { getGuidePreviewOverlaySource } from "@/guides";
import {
	bookmarkNotesPreviewOverlay,
	getBookmarkPreviewOverlaySource,
	getBookmarksActiveAtTime,
} from "@/timeline/bookmarks/index";
import { installInteractionPerf } from "@/diagnostics/interaction-perf";

export default function Editor() {
	const params = useParams();
	const projectId = params.project_id as string;

	return (
		<MobileGate>
			<EditorProvider projectId={projectId}>
				<div className="bg-background flex h-screen w-screen flex-col overflow-hidden">
					<DegradedRendererBanner />
					<EditorHeader />
					<div className="min-h-0 min-w-0 flex-1">
						<EditorLayout />
					</div>
					<Onboarding />
					<MigrationDialog />
					<ChangelogNotification />
					<InteractionPerfProbe />
				</div>
			</EditorProvider>
		</MobileGate>
	);
}

/**
 * Dev-only: installs pointer/long-task counters used to verify drag coalescing.
 * Enable at runtime with `window.__interactionPerf = true` in the console.
 */
function InteractionPerfProbe() {
	useEffect(() => {
		if (process.env.NODE_ENV === "production") return;
		return installInteractionPerf();
	}, []);

	return null;
}

function DegradedRendererBanner() {
	const isDegraded = useEditor((e) => e.renderer.isDegraded);
	const [dismissed, setDismissed] = useState(false);
	if (!isDegraded || dismissed) return null;

	return (
		<div className="bg-accent border-b h-9 flex items-center justify-center gap-2 text-xs text-muted-foreground">
			<span>For the best experience, open FreeFilmCut in Chrome.</span>
			<Button
				variant="text"
				size="icon"
				className="p-0 w-auto [&_svg]:size-3.5"
				onClick={() => setDismissed(true)}
				aria-label="Dismiss"
			>
				<HugeiconsIcon icon={Cancel01Icon} />
			</Button>
		</div>
	);
}

// fcc-tl-flower-65: scrub/seek must not React-render Assets+Properties+Timeline.
// Bookmark note overlays keep a narrow currentTime subscription in PreviewPanelWithOverlays.
function EditorLayout() {
	usePasteMedia();
	const { panels, setPanel } = usePanelStore();

	return (
		<ResizablePanelGroup
			direction="vertical"
			className="size-full gap-[0.18rem]"
			onLayout={(sizes) => {
				setPanel({
					panel: "mainContent",
					size: sizes[0] ?? panels.mainContent,
				});
				setPanel({
					panel: "timeline",
					size: sizes[1] ?? panels.timeline,
				});
			}}
		>
			<ResizablePanel
				defaultSize={panels.mainContent}
				minSize={30}
				maxSize={85}
				className="min-h-0"
			>
				<ResizablePanelGroup
					direction="horizontal"
					className="size-full gap-[0.19rem] px-3"
					onLayout={(sizes) => {
						setPanel({ panel: "tools", size: sizes[0] ?? panels.tools });
						setPanel({ panel: "preview", size: sizes[1] ?? panels.preview });
						setPanel({
							panel: "properties",
							size: sizes[2] ?? panels.properties,
						});
					}}
				>
					<ResizablePanel
						defaultSize={panels.tools}
						minSize={15}
						maxSize={40}
						className="min-w-0"
					>
						<AssetsPanel />
					</ResizablePanel>

					<ResizableHandle withHandle />

					<ResizablePanel
						defaultSize={panels.preview}
						minSize={30}
						className="min-h-0 min-w-0 flex-1"
					>
						<PreviewPanelWithOverlays />
					</ResizablePanel>

					<ResizableHandle withHandle />

					<ResizablePanel
						defaultSize={panels.properties}
						minSize={15}
						maxSize={40}
						className="min-w-0"
					>
						<PropertiesPanel />
					</ResizablePanel>
				</ResizablePanelGroup>
			</ResizablePanel>

			<ResizableHandle withHandle />

			<ResizablePanel
				defaultSize={panels.timeline}
				minSize={15}
				maxSize={70}
				className="min-h-0 px-3 pb-3"
			>
				<Timeline />
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}

function PreviewPanelWithOverlays() {
	const editor = useEditor();
	const activeScene = useEditor((ed) => ed.scenes.getActiveSceneOrNull());
	const activeGuide = usePreviewStore((state) => state.activeGuide);
	const overlays = usePreviewStore((state) => state.overlays);
	const setOverlayVisibility = usePreviewStore(
		(state) => state.setOverlayVisibility,
	);
	const showBookmarkNotes = isPreviewOverlayVisible({
		overlay: bookmarkNotesPreviewOverlay,
		overlays,
	});
	// fcc-tl-flower-65: do not subscribe getCurrentTime here; only bump React
	// when the visible bookmark-note set changes. Always read live time in useMemo.
	const [bookmarkOverlayEpoch, setBookmarkOverlayEpoch] = useState(0);
	const activeSceneRef = useRef(activeScene);
	activeSceneRef.current = activeScene;
	const noteKeyRef = useRef<string>("");

	useEffect(() => {
		const noteKeyAt = (time: MediaTime) => {
			const scene = activeSceneRef.current;
			if (!scene) return "";
			return getBookmarksActiveAtTime({
				bookmarks: scene.bookmarks,
				time,
			})
				.filter((b) => b.note != null && b.note.trim() !== "")
				.map((b) => String(b.time))
				.join(",");
		};
		noteKeyRef.current = noteKeyAt(editor.playback.getCurrentTime());
		const sync = (time: MediaTime) => {
			const next = noteKeyAt(time);
			if (next === noteKeyRef.current) return;
			noteKeyRef.current = next;
			setBookmarkOverlayEpoch((n) => n + 1);
		};
		const unsubSeek = editor.playback.onSeek(sync);
		const unsubUpdate = editor.playback.onUpdate(sync);
		return () => {
			unsubSeek();
			unsubUpdate();
		};
	}, [editor.playback]);

	const overlaySource = useMemo(
		() =>
			mergePreviewOverlaySources({
				sources: [
					getGuidePreviewOverlaySource({
						guideId: activeGuide,
					}),
					activeScene
						? getBookmarkPreviewOverlaySource({
								bookmarks: activeScene.bookmarks,
								time: editor.playback.getCurrentTime(),
								isVisible: showBookmarkNotes,
							})
						: {
								definitions: [bookmarkNotesPreviewOverlay],
								instances: [],
							},
				],
			}),
		// bookmarkOverlayEpoch intentionally triggers recompute with live playhead time
		[activeGuide, activeScene, bookmarkOverlayEpoch, showBookmarkNotes, editor.playback],
	);

	const overlayControls = useMemo(
		() =>
			overlaySource.definitions.map((overlay) =>
				createPreviewOverlayControl({ overlay, overlays }),
			),
		[overlaySource.definitions, overlays],
	);

	return (
		<PreviewPanel
			overlayControls={overlayControls}
			overlayInstances={overlaySource.instances}
			onOverlayVisibilityChange={setOverlayVisibility}
		/>
	);
}
