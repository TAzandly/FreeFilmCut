import { afterEach, describe, expect, it } from "bun:test";
import {
	applyLiveDragToTransform,
	clearLiveDragTransforms,
	getLiveDragEpoch,
	getLiveDragTransform,
	hasLiveDragTransforms,
	onLiveDragEpoch,
	setLiveDragTransforms,
} from "../live-drag-transform";

afterEach(() => {
	clearLiveDragTransforms();
});

describe("live-drag-transform", () => {
	it("stores absolute positions and bumps epoch", () => {
		const before = getLiveDragEpoch();
		let wakes = 0;
		const unsub = onLiveDragEpoch(() => {
			wakes += 1;
		});

		setLiveDragTransforms({
			positions: new Map([["el-1", { x: 12, y: -4 }]]),
		});

		expect(getLiveDragTransform("el-1")).toEqual({ x: 12, y: -4 });
		expect(hasLiveDragTransforms()).toBe(true);
		expect(getLiveDragEpoch()).toBe(before + 1);
		expect(wakes).toBe(1);

		clearLiveDragTransforms();
		expect(hasLiveDragTransforms()).toBe(false);
		expect(getLiveDragEpoch()).toBe(before + 2);
		expect(wakes).toBe(2);

		unsub();
	});

	it("silent clear does not bump epoch", () => {
		setLiveDragTransforms({
			positions: new Map([["el-1", { x: 1, y: 2 }]]),
		});
		const epoch = getLiveDragEpoch();
		clearLiveDragTransforms({ silent: true });
		expect(hasLiveDragTransforms()).toBe(false);
		expect(getLiveDragEpoch()).toBe(epoch);
	});

	it("applyLiveDragToTransform overrides position when live", () => {
		const base = {
			position: { x: 0, y: 0 },
			scaleX: 1,
			scaleY: 1,
			rotate: 0,
		};

		expect(
			applyLiveDragToTransform({ elementId: "missing", transform: base }),
		).toBe(base);

		setLiveDragTransforms({
			positions: new Map([["el-1", { x: 40, y: 10 }]]),
		});

		expect(
			applyLiveDragToTransform({ elementId: "el-1", transform: base }),
		).toEqual({
			...base,
			position: { x: 40, y: 10 },
		});
	});
});
