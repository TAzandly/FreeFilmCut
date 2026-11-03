"use client";

import { useState, useEffect, useRef } from "react";
import { useEditor } from "@/editor/use-editor";
import { formatTimecode } from "opencut-wasm";
import { invokeAction } from "@/actions";
import { EditableTimecode } from "@/components/editable-timecode";
import { Button } from "@/components/ui/button";
import {
	FullScreenIcon,
	PauseIcon,
	PlayIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Separator } from "@/components/ui/separator";
import {
	Select,
	SelectTrigger,
	SelectContent,
	SelectItem,
	SelectSeparator,
} from "@/components/ui/select";
import { PREVIEW_ZOOM_PRESETS } from "@/preview/zoom";
import { usePreviewViewport } from "./preview-viewport";
import { usePreviewStore } from "@/preview/preview-store";
import {
	PLAYBACK_QUALITY_OPTIONS,
	type PlaybackQualityId,
} from "@/preview/playback-quality";
import type { MediaTime } from "@/wasm";

export function PreviewToolbar({
	onToggleFullscreen,
}: {
	onToggleFullscreen: () => void;
}) {
	return (
		<div className="grid grid-cols-[1fr_auto_1fr] items-center pb-3 pt-5 px-5">
			<TimecodeDisplay />
			<PlayPauseButton />
			<div className="justify-self-end flex items-center gap-2.5">
				<PlaybackQualitySelect />
				<ZoomSelect />
				<Separator orientation="vertical" className="h-4" />
				<Button variant="text" onClick={onToggleFullscreen}>
					<HugeiconsIcon icon={FullScreenIcon} />
				</Button>
			</div>
		</div>
	);
}

function TimecodeDisplay() {
	const editor = useEditor();
	const totalDuration = useEditor((e) => e.timeline.getTotalDuration());
	const fps = useEditor((e) => e.project.getActive().settings.fps);
	// React state only on seek/pause interactions. Play ticks update the span via
	// DOM so we do not commit react-dom every rAF (dev Violations ~100ms+).
	const [currentTime, setCurrentTime] = useState<MediaTime>(() =>
		editor.playback.getCurrentTime(),
	);
	const [editing, setEditing] = useState(false);
	const liveRef = useRef<HTMLButtonElement | null>(null);
	const fpsRef = useRef(fps);
	fpsRef.current = fps;

	useEffect(() => {
		const writeLive = (time: MediaTime) => {
			const el = liveRef.current;
			if (!el || editing) return;
			const next =
				formatTimecode({
					time,
					format: "HH:MM:SS:FF",
					rate: fpsRef.current,
				}) ?? "";
			if (el.textContent !== next) el.textContent = next;
		};
		writeLive(editor.playback.getCurrentTime());
		const onUpdate = (time: MediaTime) => writeLive(time);
		const onSeek = (time: MediaTime) => {
			setCurrentTime(time);
			writeLive(time);
		};
		const unsubscribeUpdate = editor.playback.onUpdate(onUpdate);
		const unsubscribeSeek = editor.playback.onSeek(onSeek);
		return () => {
			unsubscribeUpdate();
			unsubscribeSeek();
		};
	}, [editor.playback, editing]);

	if (editing) {
		return (
			<div className="flex items-center">
				<EditableTimecode
					time={currentTime}
					duration={totalDuration}
					format="HH:MM:SS:FF"
					fps={fps}
					startInEditMode
					onEditCancel={() => setEditing(false)}
					onTimeChange={({ time }) => {
						editor.playback.seek({ time });
						setCurrentTime(time);
						setEditing(false);
					}}
					className="text-center"
				/>
				<span className="text-muted-foreground px-2 font-mono text-xs">/</span>
				<span className="text-muted-foreground font-mono text-xs">
					{formatTimecode({
						time: totalDuration,
						format: "HH:MM:SS:FF",
						rate: fps,
					})}
				</span>
			</div>
		);
	}

	return (
		<div className="flex items-center">
			<button
				type="button"
				ref={liveRef}
				className="text-center font-mono text-xs min-w-[7.5rem] hover:text-foreground text-foreground"
				onClick={() => {
					const now = editor.playback.getCurrentTime();
					setCurrentTime(now);
					setEditing(true);
				}}
				aria-label="Edit timecode"
			/>
			<span className="text-muted-foreground px-2 font-mono text-xs">/</span>
			<span className="text-muted-foreground font-mono text-xs">
				{formatTimecode({
					time: totalDuration,
					format: "HH:MM:SS:FF",
					rate: fps,
				})}
			</span>
		</div>
	);
}

function PlaybackQualitySelect() {
	const playbackQuality = usePreviewStore((s) => s.playbackQuality);
	const setPlaybackQuality = usePreviewStore((s) => s.setPlaybackQuality);
	const current =
		PLAYBACK_QUALITY_OPTIONS.find((option) => option.id === playbackQuality) ??
		PLAYBACK_QUALITY_OPTIONS[0];

	return (
		<Select
			value={current.id}
			onValueChange={(value) => {
				setPlaybackQuality(value as PlaybackQualityId);
			}}
		>
			<SelectTrigger className="max-w-[9.5rem]">{current.label}</SelectTrigger>
			<SelectContent>
				{PLAYBACK_QUALITY_OPTIONS.map((option) => (
					<SelectItem key={option.id} value={option.id}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function ZoomSelect() {
	const { isAtFit, zoomPercent, fitToScreen, setViewportPercent } =
		usePreviewViewport();

	const displayLabel = isAtFit ? "Fit" : `${zoomPercent}%`;

	const onValueChange = (value: string) => {
		if (value === "fit") {
			fitToScreen();
		} else {
			setViewportPercent({ percent: Number(value) });
		}
	};

	return (
		<Select
			value={isAtFit ? "fit" : String(zoomPercent)}
			onValueChange={onValueChange}
		>
			<SelectTrigger className="tabular-nums">{displayLabel}</SelectTrigger>
			<SelectContent>
				<SelectItem value="fit">Fit</SelectItem>
				<SelectSeparator />
				{PREVIEW_ZOOM_PRESETS.map((preset) => (
					<SelectItem key={preset} value={String(preset)}>
						{preset}%
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function PlayPauseButton() {
	const isPlaying = useEditor((e) => e.playback.getIsPlaying());

	return (
		<Button
			variant="text"
			size="icon"
			onClick={() => invokeAction("toggle-play")}
		>
			<HugeiconsIcon icon={isPlaying ? PauseIcon : PlayIcon} />
		</Button>
	);
}
