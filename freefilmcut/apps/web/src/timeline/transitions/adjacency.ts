import type { MediaTime } from "@/wasm";
import { addMediaTime } from "@/wasm";

export type TransitionClipElement = {
	id: string;
	startTime: MediaTime;
	duration: MediaTime;
};

export type AdjacentCut = {
	fromId: string;
	toId: string;
	cutTime: MediaTime;
};

export function elementEnd({
	element,
}: {
	element: Pick<TransitionClipElement, "startTime" | "duration">;
}): MediaTime {
	return addMediaTime({ a: element.startTime, b: element.duration });
}

function areElementsAdjacent({
	from,
	to,
}: {
	from: Pick<TransitionClipElement, "startTime" | "duration">;
	to: Pick<TransitionClipElement, "startTime">;
}): boolean {
	return elementEnd({ element: from }) === to.startTime;
}

export function findAdjacentCut({
	elements,
	fromId,
	toId,
}: {
	elements: TransitionClipElement[];
	fromId: string;
	toId: string;
}): AdjacentCut | null {
	const from = elements.find((element) => element.id === fromId);
	const to = elements.find((element) => element.id === toId);
	if (!from || !to) {
		return null;
	}
	if (!areElementsAdjacent({ from, to })) {
		return null;
	}
	return {
		fromId,
		toId,
		cutTime: elementEnd({ element: from }),
	};
}

export function listAdjacentCuts({
	elements,
}: {
	elements: TransitionClipElement[];
}): AdjacentCut[] {
	const sorted = [...elements].sort((a, b) => a.startTime - b.startTime);
	const cuts: AdjacentCut[] = [];
	for (let i = 0; i < sorted.length - 1; i++) {
		const from = sorted[i];
		const to = sorted[i + 1];
		if (!areElementsAdjacent({ from, to })) {
			continue;
		}
		cuts.push({
			fromId: from.id,
			toId: to.id,
			cutTime: elementEnd({ element: from }),
		});
	}
	return cuts;
}
