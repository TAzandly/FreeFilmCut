import { describe, expect, it } from "bun:test";
import { BaseNode } from "@/services/renderer/nodes/base-node";
import { bindLiveDragNodes } from "../live-drag-scene-bind";

class FakeVisualNode extends BaseNode<{
	transform: {
		position: { x: number; y: number };
		scaleX: number;
		scaleY: number;
		rotate: number;
	};
	timeOffset: number;
	duration: number;
	mediaId?: string;
	elementId?: string;
}> {}

class FakeEffectNode extends BaseNode<{
	effectType: string;
	effectParams: Record<string, number>;
	timeOffset: number;
	duration: number;
	elementId?: string;
}> {}

describe("live-drag-scene-bind", () => {
	it("binds visual nodes by mediaId+window and stamps elementId", () => {
		const root = new BaseNode();
		const clip = new FakeVisualNode({
			timeOffset: 100,
			duration: 50,
			mediaId: "m1",
			transform: {
				position: { x: 0, y: 0 },
				scaleX: 1,
				scaleY: 1,
				rotate: 0,
			},
		});
		root.add(clip);

		const bound = bindLiveDragNodes({
			root,
			keys: [
				{
					elementId: "el-1",
					timeOffset: 100,
					duration: 50,
					mediaId: "m1",
				},
			],
		});

		expect(bound).toHaveLength(1);
		expect(clip.params.elementId).toBe("el-1");
	});

	it("binds sticker-pack effect nodes by effectType+window", () => {
		const root = new BaseNode();
		const effect = new FakeEffectNode({
			timeOffset: 10,
			duration: 20,
			effectType: "vfxpack:sticker-hearts",
			effectParams: {
				"transform.positionX": 0,
				"transform.positionY": 0,
			},
		});
		root.add(effect);

		const bound = bindLiveDragNodes({
			root,
			keys: [
				{
					elementId: "fx-1",
					timeOffset: 10,
					duration: 20,
					effectType: "vfxpack:sticker-hearts",
				},
			],
		});

		expect(bound).toHaveLength(1);
		expect(effect.params.elementId).toBe("fx-1");
	});
});
