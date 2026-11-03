import { describe, expect, test } from "bun:test";
import { mediaTime } from "@/wasm";
import {
	findAdjacentCut,
	listAdjacentCuts,
	type TransitionClipElement,
} from "@/timeline/transitions/adjacency";

function el(
	id: string,
	start: number,
	duration: number,
): TransitionClipElement {
	return {
		id,
		startTime: mediaTime({ ticks: start }),
		duration: mediaTime({ ticks: duration }),
	};
}

describe("findAdjacentCut", () => {
	test("returns cut when A.end equals B.start", () => {
		const elements = [el("a", 0, 100), el("b", 100, 50)];
		const cut = findAdjacentCut({
			elements,
			fromId: "a",
			toId: "b",
		});
		expect(cut).toEqual({
			fromId: "a",
			toId: "b",
			cutTime: mediaTime({ ticks: 100 }),
		});
	});

	test("returns null when ids missing", () => {
		const elements = [el("a", 0, 100)];
		expect(
			findAdjacentCut({ elements, fromId: "a", toId: "missing" }),
		).toBeNull();
	});

	test("returns null when gap between clips", () => {
		const elements = [el("a", 0, 100), el("b", 101, 50)];
		expect(
			findAdjacentCut({ elements, fromId: "a", toId: "b" }),
		).toBeNull();
	});
});

describe("listAdjacentCuts", () => {
	test("empty for fewer than two elements", () => {
		expect(listAdjacentCuts({ elements: [] })).toEqual([]);
		expect(listAdjacentCuts({ elements: [el("a", 0, 100)] })).toEqual([]);
	});

	test("lists tight cuts in timeline order", () => {
		const elements = [
			el("a", 0, 100),
			el("b", 100, 80),
			el("c", 200, 40),
		];
		expect(listAdjacentCuts({ elements })).toEqual([
			{
				fromId: "a",
				toId: "b",
				cutTime: mediaTime({ ticks: 100 }),
			},
		]);
	});

	test("lists multiple adjacent pairs", () => {
		const elements = [
			el("a", 0, 100),
			el("b", 100, 50),
			el("c", 150, 50),
		];
		expect(listAdjacentCuts({ elements })).toEqual([
			{
				fromId: "a",
				toId: "b",
				cutTime: mediaTime({ ticks: 100 }),
			},
			{
				fromId: "b",
				toId: "c",
				cutTime: mediaTime({ ticks: 150 }),
			},
		]);
	});

	test("ignores unsorted input order", () => {
		const elements = [el("b", 100, 50), el("a", 0, 100)];
		expect(listAdjacentCuts({ elements })).toEqual([
			{
				fromId: "a",
				toId: "b",
				cutTime: mediaTime({ ticks: 100 }),
			},
		]);
	});
});
