import type { TranscriptionSegment, CaptionChunk } from "@/transcription/types";
import {
	DEFAULT_WORDS_PER_CAPTION,
	DEFAULT_CHARS_PER_CAPTION,
	MIN_CAPTION_DURATION_SECONDS,
} from "@/transcription/caption-defaults";

const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;
/** CJK: split after sentence / clause punctuation (kept on the preceding unit). */
const CJK_PHRASE_SPLIT_RE = /(?<=[。！？；!?])|(?<=[，,、])/;
/** Latin abbrevs that end with a period — avoid treating as sentence end. */
const LATIN_ABBREV_RE =
	/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|approx|dept|univ|U\.S|U\.K|e\.g|i\.e)\.$/i;

function isCjkHeavy(text: string): boolean {
	const cjk = text.match(new RegExp(CJK_RE.source, "g"))?.length ?? 0;
	return cjk >= Math.max(1, text.replace(/\s/g, "").length * 0.3);
}

function splitCjkPhrases(text: string): string[] {
	return text
		.split(CJK_PHRASE_SPLIT_RE)
		.map((part) => part.trim())
		.filter(Boolean);
}

/** Split English / spaced languages on . ! ? ; while keeping punctuation. */
function splitLatinSentences(text: string): string[] {
	const raw = text.match(/[^.!?;]+[.!?;]+|[^.!?;]+$/g) ?? [text];
	const merged: string[] = [];
	for (const part of raw) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const prev = merged[merged.length - 1];
		if (prev && LATIN_ABBREV_RE.test(prev.trim())) {
			merged[merged.length - 1] = `${prev} ${trimmed}`;
		} else {
			merged.push(trimmed);
		}
	}
	return merged.length > 0 ? merged : [text.trim()];
}

/** Break a Whisper segment into phrase units (punctuation), then pack for display. */
export function splitCaptionUnits({
	text,
	wordsPerChunk = DEFAULT_WORDS_PER_CAPTION,
	charsPerChunk = DEFAULT_CHARS_PER_CAPTION,
}: {
	text: string;
	wordsPerChunk?: number;
	charsPerChunk?: number;
}): string[] {
	const trimmed = text.trim();
	if (!trimmed) return [];

	if (isCjkHeavy(trimmed)) {
		const phrases = splitCjkPhrases(trimmed);
		return packByChars(phrases.length > 0 ? phrases : [trimmed], charsPerChunk);
	}

	const sentences = splitLatinSentences(trimmed);
	return packByWords(
		sentences.length > 0 ? sentences : [trimmed],
		wordsPerChunk,
	);
}

const CJK_UNIT_END_PUNCT_RE = /[。！？；，、!?]$/;
/** Strip trailing commas/periods from display text; keep ！？ / !? */
const TRAILING_CAPTION_PUNCT_RE = /[。；，、,.;:…〜~]+$/u;

function stripTrailingCaptionPunct(text: string): string {
	return text.replace(TRAILING_CAPTION_PUNCT_RE, "").trim();
}

function packByChars(units: string[], charsPerChunk: number): string[] {
	// Phrase units from punctuation stay separate — do not re-merge across ，。
	const sliced: string[] = [];
	for (const part of units) {
		if (
			part.length <= charsPerChunk * 1.5 ||
			CJK_UNIT_END_PUNCT_RE.test(part)
		) {
			sliced.push(part);
			continue;
		}
		// Long run with no punctuation: hard-slice by character count.
		for (let i = 0; i < part.length; i += charsPerChunk) {
			sliced.push(part.slice(i, i + charsPerChunk));
		}
	}
	return sliced;
}

function packByWords(units: string[], wordsPerChunk: number): string[] {
	const out: string[] = [];
	// Keep sentence boundaries — never re-join all units then re-split.
	const maxKeepWhole = wordsPerChunk * 3;
	for (const unit of units) {
		const words = unit.split(/\s+/).filter(Boolean);
		if (words.length === 0) continue;
		if (words.length <= maxKeepWhole) {
			out.push(words.join(" "));
			continue;
		}
		for (let i = 0; i < words.length; i += wordsPerChunk) {
			out.push(words.slice(i, i + wordsPerChunk).join(" "));
		}
	}
	return out;
}

function charWeight(text: string): number {
	// Prefer non-space length so CJK timing isn't dominated by punctuation-only gaps.
	return Math.max(1, text.replace(/\s/g, "").length);
}

export function buildCaptionChunks({
	segments,
	wordsPerChunk = DEFAULT_WORDS_PER_CAPTION,
	charsPerChunk = DEFAULT_CHARS_PER_CAPTION,
	minDuration = MIN_CAPTION_DURATION_SECONDS,
}: {
	segments: TranscriptionSegment[];
	wordsPerChunk?: number;
	charsPerChunk?: number;
	minDuration?: number;
}): CaptionChunk[] {
	const captions: CaptionChunk[] = [];
	let globalEndTime = 0;

	for (const segment of segments) {
		const units = splitCaptionUnits({
			text: segment.text,
			wordsPerChunk,
			charsPerChunk,
		});
		if (units.length === 0) continue;

		const segmentDuration = Math.max(0.01, segment.end - segment.start);
		const totalWeight = units.reduce((sum, u) => sum + charWeight(u), 0);

		let cursor = segment.start;
		for (const unit of units) {
			const displayText = stripTrailingCaptionPunct(unit);
			if (!displayText) {
				cursor += segmentDuration * (charWeight(unit) / totalWeight);
				continue;
			}

			const share = charWeight(unit) / totalWeight;
			const rawDuration = segmentDuration * share;
			const duration = Math.max(minDuration * 0.5, rawDuration);
			const startTime = Math.max(cursor, globalEndTime);

			captions.push({
				text: displayText,
				startTime,
				duration,
			});

			globalEndTime = startTime + duration;
			cursor += rawDuration;
		}
	}

	return captions;
}
