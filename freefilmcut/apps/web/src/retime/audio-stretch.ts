import { PitchShifter } from "soundtouchjs";
import { clampRetimeRate, shouldMaintainPitch } from "@/retime/rate";
import type { RetimeConfig } from "@/timeline";
import { getMappedSourceTime } from "./source-time";

const RATE_EPSILON = 1e-6;

function sampleLinear({
	channelData,
	position,
}: {
	channelData: Float32Array;
	position: number;
}): number {
	if (position <= 0) {
		return channelData[0] ?? 0;
	}
	const lower = Math.floor(position);
	const upper = Math.min(channelData.length - 1, lower + 1);
	if (lower >= channelData.length) {
		return channelData[channelData.length - 1] ?? 0;
	}
	const fraction = position - lower;
	return channelData[lower] * (1 - fraction) + channelData[upper] * fraction;
}

function buildResampledBuffer({
	audioContext,
	sourceBuffer,
	trimStart,
	clipDuration,
	targetSampleRate,
	retime,
	reversed = false,
}: {
	audioContext: BaseAudioContext;
	sourceBuffer: AudioBuffer;
	trimStart: number;
	clipDuration: number;
	targetSampleRate: number;
	retime?: RetimeConfig;
	reversed?: boolean;
}): AudioBuffer {
	const outputLength = Math.max(1, Math.ceil(clipDuration * targetSampleRate));
	const numChannels = Math.max(1, Math.min(2, sourceBuffer.numberOfChannels));
	const outputBuffer = audioContext.createBuffer(
		numChannels,
		outputLength,
		targetSampleRate,
	);

	for (let channel = 0; channel < numChannels; channel++) {
		const sourceData = sourceBuffer.getChannelData(
			Math.min(channel, sourceBuffer.numberOfChannels - 1),
		);
		const outputData = outputBuffer.getChannelData(channel);

		for (let i = 0; i < outputLength; i++) {
			const clipTime = i / targetSampleRate;
			const sourceTime = getMappedSourceTime({
				clipTime,
				clipDuration,
				trimStart,
				retime,
				reversed,
			});
			outputData[i] = sampleLinear({
				channelData: sourceData,
				position: sourceTime * sourceBuffer.sampleRate,
			});
		}
	}

	return outputBuffer;
}

async function buildPitchPreservedBuffer({
	sourceBuffer,
	trimStart,
	clipDuration,
	rate,
	targetSampleRate,
	reversed = false,
}: {
	sourceBuffer: AudioBuffer;
	trimStart: number;
	clipDuration: number;
	rate: number;
	targetSampleRate: number;
	reversed?: boolean;
}): Promise<AudioBuffer> {
	const nativeSampleRate = sourceBuffer.sampleRate;
	const sourceDuration = clipDuration * rate;
	const startSample = Math.max(0, Math.floor(trimStart * nativeSampleRate));
	const numSourceSamples = Math.max(
		1,
		Math.ceil(sourceDuration * nativeSampleRate),
	);
	const available = Math.max(0, sourceBuffer.length - startSample);
	const actualSamples = Math.max(1, Math.min(numSourceSamples, available));
	const numChannels = Math.max(1, Math.min(2, sourceBuffer.numberOfChannels));

	// Resample to targetSampleRate first — soundtouchjs reads raw channel data
	// and does not respect the source buffer's native sample rate.
	const resampledLength = Math.max(
		1,
		Math.ceil(sourceDuration * targetSampleRate),
	);
	const resampleCtx = new OfflineAudioContext(
		numChannels,
		resampledLength,
		targetSampleRate,
	);
	const nativeBuffer = resampleCtx.createBuffer(
		numChannels,
		actualSamples,
		nativeSampleRate,
	);

	for (let ch = 0; ch < numChannels; ch++) {
		const src = sourceBuffer.getChannelData(
			Math.min(ch, sourceBuffer.numberOfChannels - 1),
		);
		const slice = src.subarray(startSample, startSample + actualSamples);
		const channelData = new Float32Array(slice);
		// Constant-rate reverse matches getMappedSourceTime: flip the trimmed
		// span, then stretch forward. playbackRate cannot be negative.
		if (reversed) channelData.reverse();
		nativeBuffer.copyToChannel(channelData, ch);
	}

	const resampleSourceNode = resampleCtx.createBufferSource();
	resampleSourceNode.buffer = nativeBuffer;
	resampleSourceNode.connect(resampleCtx.destination);
	resampleSourceNode.start(0);
	const resampledBuffer = await resampleCtx.startRendering();

	const outputSamples = Math.max(
		1,
		Math.ceil(clipDuration * targetSampleRate),
	);
	const stretchCtx = new OfflineAudioContext(
		numChannels,
		outputSamples,
		targetSampleRate,
	);
	const shifter = new PitchShifter(stretchCtx, resampledBuffer, 4096);
	shifter.tempo = rate;
	shifter.pitch = 1;
	shifter.connect(stretchCtx.destination);
	return stretchCtx.startRendering();
}

export async function renderRetimedBuffer({
	audioContext,
	sourceBuffer,
	trimStart,
	clipDuration,
	retime,
	maintainPitch = false,
	reversed = false,
}: {
	audioContext: BaseAudioContext;
	sourceBuffer: AudioBuffer;
	trimStart: number;
	clipDuration: number;
	retime?: RetimeConfig;
	maintainPitch?: boolean;
	/**
	 * Bake end→start into the output. Callers play the buffer forward;
	 * do not apply reverse mapping again.
	 */
	reversed?: boolean;
}): Promise<AudioBuffer> {
	const targetSampleRate = audioContext.sampleRate;
	const rate = clampRetimeRate({ rate: retime?.rate ?? 1 });
	const usePitchPreservation =
		shouldMaintainPitch({ rate, maintainPitch }) &&
		Math.abs(rate - 1) > RATE_EPSILON;

	if (usePitchPreservation) {
		return buildPitchPreservedBuffer({
			sourceBuffer,
			trimStart,
			clipDuration,
			rate,
			targetSampleRate,
			reversed,
		});
	}

	return buildResampledBuffer({
		audioContext,
		sourceBuffer,
		trimStart,
		clipDuration,
		targetSampleRate,
		retime,
		reversed,
	});
}
