import type { AnyBaseNode } from "@/services/renderer/nodes/base-node";

export type LiveDragBindKey = {
	readonly elementId: string;
	readonly timeOffset: number;
	readonly duration: number;
	readonly mediaId?: string;
	readonly stickerId?: string;
	readonly definitionId?: string;
	readonly url?: string;
	readonly effectType?: string;
};

type BindableParams = {
	elementId?: string;
	id?: string;
	timeOffset?: number;
	duration?: number;
	startTime?: number;
	mediaId?: string;
	stickerId?: string;
	definitionId?: string;
	url?: string;
	effectType?: string;
	transform?: unknown;
	effectParams?: unknown;
};

export type BoundLiveDragNode = {
	readonly elementId: string;
	readonly node: AnyBaseNode & { params: BindableParams };
};

function isBindableNode(
	node: AnyBaseNode,
): node is AnyBaseNode & { params: BindableParams } {
	const params = node.params as BindableParams | undefined;
	if (!params || typeof params !== "object") return false;
	// Visual layers (image/video/sticker/text/graphic) expose a transform object.
	if (params.transform && typeof params.transform === "object") return true;
	// Sticker-pack effects store placement in effectParams, not a Transform.
	if (typeof params.effectType === "string" && params.effectParams) return true;
	return false;
}

function walkNodes({
	node,
	visit,
}: {
	node: AnyBaseNode;
	visit: (node: AnyBaseNode) => void;
}): void {
	visit(node);
	for (const child of node.children) {
		walkNodes({ node: child, visit });
	}
}

function nodeTimeOffset(params: BindableParams): number | undefined {
	if (typeof params.timeOffset === "number") return params.timeOffset;
	if (typeof params.startTime === "number") return params.startTime;
	return undefined;
}

function matchesBindKey({
	node,
	key,
}: {
	node: AnyBaseNode & { params: BindableParams };
	key: LiveDragBindKey;
}): boolean {
	const { params } = node;
	if (params.elementId === key.elementId || params.id === key.elementId) {
		return true;
	}

	const timeOffset = nodeTimeOffset(params);
	if (timeOffset !== key.timeOffset || params.duration !== key.duration) {
		return false;
	}

	if (key.mediaId && params.mediaId === key.mediaId) return true;
	if (key.stickerId && params.stickerId === key.stickerId) return true;
	if (key.definitionId && params.definitionId === key.definitionId) return true;
	if (key.url && params.url === key.url) return true;
	if (key.effectType && params.effectType === key.effectType) return true;
	if (params.id === key.elementId) return true;
	return false;
}

/**
 * Find scene nodes for the dragged timeline elements and stamp `elementId`
 * so resolve-time live overlays work without mutating transforms in place.
 */
export function bindLiveDragNodes({
	root,
	keys,
}: {
	root: AnyBaseNode | null;
	keys: readonly LiveDragBindKey[];
}): BoundLiveDragNode[] {
	if (!root || keys.length === 0) return [];

	const candidates: Array<AnyBaseNode & { params: BindableParams }> = [];
	walkNodes({
		node: root,
		visit: (node) => {
			if (isBindableNode(node)) candidates.push(node);
		},
	});

	const used = new Set<AnyBaseNode>();
	const bound: BoundLiveDragNode[] = [];

	for (const key of keys) {
		let match =
			candidates.find(
				(node) =>
					!used.has(node) &&
					(node.params.elementId === key.elementId ||
						node.params.id === key.elementId),
			) ?? null;

		if (!match) {
			match =
				candidates.find(
					(node) => !used.has(node) && matchesBindKey({ node, key }),
				) ?? null;
		}

		if (!match) {
			const windowMatches = candidates.filter((node) => {
				if (used.has(node)) return false;
				const timeOffset = nodeTimeOffset(node.params);
				return (
					timeOffset === key.timeOffset && node.params.duration === key.duration
				);
			});
			if (windowMatches.length === 1) {
				match = windowMatches[0] ?? null;
			}
		}

		if (!match) continue;

		used.add(match);
		match.params.elementId = key.elementId;
		bound.push({
			elementId: key.elementId,
			node: match,
		});
	}

	return bound;
}
