/**
 * Decode audio tracks from videos packed inside a .vfxpack and place them
 * on the timeline for export / offline mix (same clip-local time as the picture).
 *
 * fcc-tl-flower-59: also mix MediaPlayer videos from text-template text clips
 * (textTemplatePackId). Effect-only collection missed flower text templates —
 * export had picture, no sound. Offline decode (not live HTMLVideoElement), so
 * flower-58 preview mute does not apply here.
 */
import {
	ALL_FORMATS,
	AudioBufferSink,
	BlobSource,
	Input,
} from "mediabunny";
import type { LoadedVfxPack } from "@/vfxpack/types";
import {
	getPackRegistrySnapshot,
	parseVfxPackIdFromEffectType,
	isVfxPackEffectType,
} from "@/vfxpack";
import type { EffectElement, TextElement, SceneTracks } from "@/timeline";
import { TICKS_PER_SECOND } from "@/wasm";

const MAX_AUDIO_CHANNELS = 2;

export type PackVideoAudioClip = {
	buffer: AudioBuffer;
	/** Timeline seconds where the effect clip starts. */
	startTime: number;
	/** Effect clip duration in seconds (picture + sound share this window). */
	duration: number;
	volume: number;
	loop: boolean;
};

function videoMime(path: string): string {
	const n = path.toLowerCase();
	if (n.endsWith(".webm")) return "video/webm";
	if (n.endsWith(".mov")) return "video/quicktime";
	if (n.endsWith(".ogv") || n.endsWith(".ogg")) return "video/ogg";
	return "video/mp4";
}

function listPackVideoSources(pack: LoadedVfxPack): Array<{
	path: string;
	loop: boolean;
	muted: boolean;
	volume: number;
}> {
	const scene = pack.scene;
	if (!scene?.nodes) return [];
	const out: Array<{
		path: string;
		loop: boolean;
		muted: boolean;
		volume: number;
	}> = [];

	for (const node of scene.nodes) {
		const ud = (node.userData as { fccVideoPlayer?: Record<string, unknown> } | undefined)
			?.fccVideoPlayer;
		const video = node.video;
		const isPlayer = node.kind === "videoPlayer" || !!video || !!ud;
		if (!isPlayer) continue;

		const merged = { ...(ud || {}), ...(video || {}) } as {
			path?: string;
			fileName?: string;
			loop?: boolean;
			muted?: boolean;
			volume?: number;
		};

		let path = merged.path || "";
		if (!path || !pack.files.has(path)) {
			const needle =
				String(merged.fileName || "")
					.split(/[/\\]/)
					.pop()
					?.toLowerCase() || "";
			const uuid8 = node.uuid.slice(0, 8).toLowerCase();
			for (const key of pack.files.keys()) {
				const lower = key.toLowerCase();
				if (!lower.startsWith("videos/")) continue;
				if (
					lower.includes(uuid8) ||
					(needle && lower.endsWith(needle)) ||
					(!needle && /\.(mp4|webm|mov|ogv|ogg)$/.test(lower))
				) {
					path = key;
					break;
				}
			}
		}
		if (!path || !pack.files.has(path)) continue;
		// gif / image / seq have no exportable audio track
		if (!/\.(mp4|webm|mov|ogv|ogg)$/i.test(path)) continue;

		out.push({
			path,
			loop: merged.loop !== false,
			muted: merged.muted === true,
			volume: Number.isFinite(Number(merged.volume))
				? Math.min(1, Math.max(0, Number(merged.volume)))
				: 1,
		});
	}

	return out;
}

async function decodeVideoFileAudio({
	bytes,
	path,
	audioContext,
}: {
	bytes: Uint8Array;
	path: string;
	audioContext: AudioContext;
}): Promise<AudioBuffer | null> {
	const copy = bytes.slice();
	const blob = new Blob([copy], { type: videoMime(path) });
	const file = new File([blob], path.split("/").pop() || "video.mp4", {
		type: videoMime(path),
	});
	const input = new Input({
		source: new BlobSource(file),
		formats: ALL_FORMATS,
	});

	try {
		const audioTrack = await input.getPrimaryAudioTrack();
		if (!audioTrack) return null;

		const sink = new AudioBufferSink(audioTrack);
		const targetSampleRate = audioContext.sampleRate;
		const chunks: AudioBuffer[] = [];
		let totalSamples = 0;

		for await (const { buffer } of sink.buffers(0)) {
			chunks.push(buffer);
			totalSamples += buffer.length;
		}
		if (chunks.length === 0) return null;

		const nativeSampleRate = chunks[0].sampleRate;
		const numChannels = Math.min(
			MAX_AUDIO_CHANNELS,
			chunks[0].numberOfChannels,
		);
		const nativeChannels = Array.from(
			{ length: numChannels },
			() => new Float32Array(totalSamples),
		);
		let offset = 0;
		for (const chunk of chunks) {
			for (let channel = 0; channel < numChannels; channel++) {
				const sourceData = chunk.getChannelData(
					Math.min(channel, chunk.numberOfChannels - 1),
				);
				nativeChannels[channel].set(sourceData, offset);
			}
			offset += chunk.length;
		}

		const outputSamples = Math.ceil(
			totalSamples * (targetSampleRate / nativeSampleRate),
		);
		const offlineContext = new OfflineAudioContext(
			numChannels,
			Math.max(1, outputSamples),
			targetSampleRate,
		);
		const nativeBuffer = audioContext.createBuffer(
			numChannels,
			totalSamples,
			nativeSampleRate,
		);
		for (let ch = 0; ch < numChannels; ch++) {
			nativeBuffer.copyToChannel(nativeChannels[ch], ch);
		}
		const sourceNode = offlineContext.createBufferSource();
		sourceNode.buffer = nativeBuffer;
		sourceNode.connect(offlineContext.destination);
		sourceNode.start(0);
		return await offlineContext.startRendering();
	} catch (error) {
		console.warn("[vfxpack] decode video audio failed", path, error);
		return null;
	} finally {
		input.dispose();
	}
}

type PackVideoSource = {
	path: string;
	loop: boolean;
	muted: boolean;
	volume: number;
};

function collectEffectElements(tracks: SceneTracks): EffectElement[] {
	const elements: EffectElement[] = [];
	for (const track of [...tracks.overlay, tracks.main, ...tracks.audio]) {
		for (const element of track.elements) {
			if (element.type === "effect") elements.push(element);
		}
	}
	return elements;
}

function collectTextTemplateElements(tracks: SceneTracks): TextElement[] {
	const elements: TextElement[] = [];
	for (const track of tracks.overlay) {
		if (track.type !== "text") continue;
		for (const element of track.elements) {
			if (element.type === "text") elements.push(element);
		}
	}
	return elements;
}

function readTextTemplatePackId(element: TextElement): string | null {
	const fromEl = element.textTemplatePackId;
	if (typeof fromEl === "string" && fromEl.trim()) return fromEl.trim();
	const params = element.params as { textTemplatePackId?: unknown } | undefined;
	const fromParams = params?.textTemplatePackId;
	if (typeof fromParams === "string" && fromParams.trim()) return fromParams.trim();
	return null;
}

function readTextTemplateMediaPlayers(
	element: TextElement,
): Array<Record<string, unknown>> {
	const fromEl = element.textTemplateMediaPlayers;
	if (Array.isArray(fromEl) && fromEl.length) {
		return fromEl.filter(
			(p): p is Record<string, unknown> => !!p && typeof p === "object",
		);
	}
	const params = element.params as {
		textTemplateMediaPlayers?: unknown;
	} | undefined;
	const fromParams = params?.textTemplateMediaPlayers;
	if (Array.isArray(fromParams) && fromParams.length) {
		return fromParams.filter(
			(p): p is Record<string, unknown> => !!p && typeof p === "object",
		);
	}
	return [];
}

/** Prefer clip mediaPlayers (remapped paths); fall back to pack scene nodes. */
function listSourcesForTextTemplate(
	pack: LoadedVfxPack,
	element: TextElement,
): PackVideoSource[] {
	const players = readTextTemplateMediaPlayers(element);
	if (players.length) {
		const out: PackVideoSource[] = [];
		for (const raw of players) {
			const kind = String(raw.kind || "").toLowerCase();
			if (kind && kind !== "video") continue;
			let path = String(raw.path || raw.packPath || "");
			if (!path || !pack.files.has(path)) {
				const needle =
					String(raw.fileName || "")
						.split(/[/\\]/)
						.pop()
						?.toLowerCase() || "";
				for (const key of pack.files.keys()) {
					const lower = key.toLowerCase();
					if (!/\.(mp4|webm|mov|ogv|ogg)$/.test(lower)) continue;
					if (needle && lower.endsWith(needle)) {
						path = key;
						break;
					}
					if (!needle && lower.startsWith("videos/")) {
						path = key;
						break;
					}
				}
			}
			if (!path || !pack.files.has(path)) continue;
			if (!/\.(mp4|webm|mov|ogv|ogg)$/i.test(path)) continue;
			out.push({
				path,
				loop: raw.loop !== false,
				muted: raw.muted === true,
				volume: Number.isFinite(Number(raw.volume))
					? Math.min(1, Math.max(0, Number(raw.volume)))
					: 1,
			});
		}
		if (out.length) return out;
	}
	return listPackVideoSources(pack);
}

type PackAudioPlacement = {
	pack: LoadedVfxPack;
	startTime: number;
	duration: number;
	sources: PackVideoSource[];
};

function collectPackAudioPlacements({
	tracks,
	byId,
}: {
	tracks: SceneTracks;
	byId: Map<string, LoadedVfxPack>;
}): PackAudioPlacement[] {
	const placements: PackAudioPlacement[] = [];

	for (const element of collectEffectElements(tracks)) {
		if (!isVfxPackEffectType({ effectType: element.effectType })) continue;
		const packId = parseVfxPackIdFromEffectType({
			effectType: element.effectType,
		});
		if (!packId) continue;
		const pack = byId.get(packId);
		if (!pack) continue;
		const startTime = element.startTime / TICKS_PER_SECOND;
		const duration = element.duration / TICKS_PER_SECOND;
		if (!(duration > 0)) continue;
		placements.push({
			pack,
			startTime,
			duration,
			sources: listPackVideoSources(pack),
		});
	}

	// fcc-tl-flower-59: text-template flower clips (not effectType vfxpack:…)
	for (const element of collectTextTemplateElements(tracks)) {
		if (element.hidden) continue;
		const packId = readTextTemplatePackId(element);
		if (!packId) continue;
		const pack = byId.get(packId);
		if (!pack) continue;
		const startTime = element.startTime / TICKS_PER_SECOND;
		const duration = element.duration / TICKS_PER_SECOND;
		if (!(duration > 0)) continue;
		placements.push({
			pack,
			startTime,
			duration,
			sources: listSourcesForTextTemplate(pack, element),
		});
	}

	return placements;
}

/** True when any timeline effect / text-template pack carries a video with sound. */
export function timelineHasPackVideoAudio({
	tracks,
}: {
	tracks: SceneTracks;
}): boolean {
	const { packs } = getPackRegistrySnapshot();
	const byId = new Map(packs.map((p) => [p.id, p]));
	for (const placement of collectPackAudioPlacements({ tracks, byId })) {
		if (placement.sources.some((s) => !s.muted && s.volume > 0)) return true;
	}
	return false;
}

export async function collectPackVideoAudioClips({
	tracks,
	audioContext,
}: {
	tracks: SceneTracks;
	audioContext: AudioContext;
}): Promise<PackVideoAudioClip[]> {
	const { packs } = getPackRegistrySnapshot();
	const byId = new Map(packs.map((p) => [p.id, p]));
	const bufferCache = new Map<string, Promise<AudioBuffer | null>>();
	const clips: PackVideoAudioClip[] = [];

	const decodeCached = (pack: LoadedVfxPack, path: string) => {
		const key = `${pack.id}::${path}`;
		let pending = bufferCache.get(key);
		if (!pending) {
			const bytes = pack.files.get(path);
			pending = bytes
				? decodeVideoFileAudio({ bytes, path, audioContext })
				: Promise.resolve(null);
			bufferCache.set(key, pending);
		}
		return pending;
	};

	for (const placement of collectPackAudioPlacements({ tracks, byId })) {
		for (const source of placement.sources) {
			if (source.muted || source.volume <= 0) continue;
			const buffer = await decodeCached(placement.pack, source.path);
			if (!buffer) continue;
			clips.push({
				buffer,
				startTime: placement.startTime,
				duration: placement.duration,
				volume: source.volume,
				loop: source.loop,
			});
		}
	}

	return clips;
}

/** Mix pack-video audio into an already-sized stereo export buffer. */
export function mixPackVideoAudioClips({
	clips,
	outputBuffer,
	sampleRate,
}: {
	clips: PackVideoAudioClip[];
	outputBuffer: AudioBuffer;
	sampleRate: number;
}): void {
	const outputLength = outputBuffer.length;
	const outputChannels = Math.min(2, outputBuffer.numberOfChannels);

	for (const clip of clips) {
		const outputStartSample = Math.floor(clip.startTime * sampleRate);
		const renderedLength = Math.ceil(clip.duration * sampleRate);
		const sourceLength = clip.buffer.length;
		if (sourceLength <= 0) continue;

		for (let channel = 0; channel < outputChannels; channel++) {
			const outputData = outputBuffer.getChannelData(channel);
			const sourceChannel = Math.min(channel, clip.buffer.numberOfChannels - 1);
			const sourceData = clip.buffer.getChannelData(sourceChannel);
			const sourceRate = clip.buffer.sampleRate;

			for (let i = 0; i < renderedLength; i++) {
				const outputIndex = outputStartSample + i;
				if (outputIndex >= outputLength) break;

				let sourceIndex = (i / sampleRate) * sourceRate;
				if (clip.loop) {
					sourceIndex = sourceIndex % sourceLength;
					if (sourceIndex < 0) sourceIndex += sourceLength;
				} else if (sourceIndex >= sourceLength) {
					break;
				}

				const lowerIndex = Math.floor(sourceIndex);
				const upperIndex = Math.min(sourceLength - 1, lowerIndex + 1);
				const fraction = sourceIndex - lowerIndex;
				outputData[outputIndex] +=
					(sourceData[lowerIndex] * (1 - fraction) +
						sourceData[upperIndex] * fraction) *
					clip.volume;
			}
		}
	}
}
