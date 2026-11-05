import type { TimelineElement } from "@/timeline";

const MIRROR_ROTATE_TYPES = new Set(["video", "image", "sticker"]);

export function canShowFreeze({
	elements,
}: {
	elements: Array<{ type: string }>;
}): boolean {
	return elements.length === 1 && elements[0]?.type === "video";
}

export function canShowReverse({
	elements,
}: {
	elements: Array<{ type: string }>;
}): boolean {
	return canShowFreeze({ elements });
}

export function canShowMirrorOrRotate({
	elements,
}: {
	elements: Array<{ type: string }>;
}): boolean {
	return elements.some((el) => MIRROR_ROTATE_TYPES.has(el.type));
}

export function normalizeDegrees({ degrees }: { degrees: number }): number {
	const wrapped = ((degrees % 360) + 360) % 360;
	return wrapped === 0 ? 0 : wrapped;
}

function readNumberParam({
	params,
	key,
	fallback,
}: {
	params: Record<string, unknown>;
	key: string;
	fallback: number;
}): number {
	const value = params[key];
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function buildMirrorPatches({
	items,
}: {
	items: Array<{
		trackId: string;
		elementId: string;
		element: TimelineElement;
	}>;
}): Array<{
	trackId: string;
	elementId: string;
	patch: { params: { "transform.scaleX": number } };
}> {
	return items.flatMap(({ trackId, elementId, element }) => {
		if (!MIRROR_ROTATE_TYPES.has(element.type)) return [];
		const scaleX = readNumberParam({
			params: element.params,
			key: "transform.scaleX",
			fallback: 1,
		});
		return [
			{
				trackId,
				elementId,
				patch: { params: { "transform.scaleX": scaleX * -1 } },
			},
		];
	});
}

export function buildRotate90Patches({
	items,
}: {
	items: Array<{
		trackId: string;
		elementId: string;
		element: TimelineElement;
	}>;
}): Array<{
	trackId: string;
	elementId: string;
	patch: { params: { "transform.rotate": number } };
}> {
	return items.flatMap(({ trackId, elementId, element }) => {
		if (!MIRROR_ROTATE_TYPES.has(element.type)) return [];
		const rotate = readNumberParam({
			params: element.params,
			key: "transform.rotate",
			fallback: 0,
		});
		return [
			{
				trackId,
				elementId,
				patch: {
					params: {
						"transform.rotate": normalizeDegrees({ degrees: rotate + 90 }),
					},
				},
			},
		];
	});
}
