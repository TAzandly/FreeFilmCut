import { describe, expect, test, beforeEach } from "bun:test";
import type { TimelineElement } from "@/timeline";
import {
	createSceneNodeCache,
	patchElementNodes,
} from "@/services/renderer/scene-builder";
import { EffectLayerNode } from "@/services/renderer/nodes/effect-layer-node";
import {
	applyLiveParamPreview,
	bindLiveParamPreviewScene,
	clearLiveParamPreview,
	getLiveParamPreviewEpoch,
	hasLiveParamPreview,
	hasLiveParamPreviewElement,
} from "../live-param-preview";

function effectElement(id: string, intensity: number): TimelineElement {
	return {
		id,
		type: "effect",
		effectType: "blur",
		params: { intensity },
		startTime: 0,
		duration: 100,
		trimStart: 0,
		trimEnd: 0,
	} as unknown as TimelineElement;
}

describe("live-param-preview", () => {
	beforeEach(() => {
		clearLiveParamPreview({ silent: true });
	});

	test("applyLiveParamPreview patches cached nodes and bumps epoch", () => {
		const cache = createSceneNodeCache();
		const element = effectElement("e1", 0.2);
		const node = new EffectLayerNode({
			elementId: element.id,
			effectType: "blur",
			effectParams: { intensity: 0.2 },
			timeOffset: 0,
			duration: 100,
		});
		cache.elements.set(element.id, {
			deps: [],
			nodes: [node],
			element,
		});

		const unbind = bindLiveParamPreviewScene({
			cache,
			getCanvasSize: () => ({ width: 1920, height: 1080 }),
		});

		expect(hasLiveParamPreviewElement({ elementId: "e1" })).toBe(true);
		const before = getLiveParamPreviewEpoch();
		const next = effectElement("e1", 0.8);
		expect(applyLiveParamPreview({ element: next })).toBe(true);
		expect(getLiveParamPreviewEpoch()).toBe(before + 1);
		expect(hasLiveParamPreview()).toBe(true);
		expect(node.params.effectParams).toEqual({ intensity: 0.8 });

		clearLiveParamPreview({ silent: true });
		expect(hasLiveParamPreview()).toBe(false);
		unbind();
	});

	test("applyLiveParamPreview returns false without a bound cache entry", () => {
		expect(applyLiveParamPreview({ element: effectElement("missing", 1) })).toBe(
			false,
		);
	});

	test("patchElementNodes is exported for live scrub", () => {
		const element = effectElement("e2", 0.5);
		const node = new EffectLayerNode({
			elementId: element.id,
			effectType: "blur",
			effectParams: { intensity: 0.1 },
			timeOffset: 0,
			duration: 100,
		});
		patchElementNodes({
			nodes: [node],
			element,
			canvasSize: { width: 100, height: 100 },
		});
		expect(node.params.effectParams).toEqual({ intensity: 0.5 });
	});
});
