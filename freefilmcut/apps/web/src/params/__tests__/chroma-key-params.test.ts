import { describe, expect, test } from "bun:test";
import {
	getBuiltInElementParams,
	readElementParamValue,
	writeElementParamValue,
} from "@/params/registry";
import { CHROMA_KEY_PANEL_KEYS } from "@/chroma-key";
import type { TimelineElement } from "@/timeline";

interface ParamsBag {
	params: Record<string, unknown>;
}

/**
 * The keyer params only ever read and write `element.params`, so this test has
 * no reason to build a full timeline element (and every factory there needs a
 * real media asset).
 */
function elementWithParams({
	type,
	params,
}: {
	type: "video" | "image";
	params: Record<string, unknown>;
}): TimelineElement {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test stub, only `params` is touched
	return { id: "e1", type, params } as unknown as TimelineElement;
}

function paramsOf({ element }: { element: TimelineElement }): ParamsBag {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- every timeline element has params
	return element as unknown as ParamsBag;
}

function keyerParams({
	type,
}: {
	type: "video" | "image";
}): ReturnType<typeof getBuiltInElementParams> {
	return getBuiltInElementParams({ type }).filter((param) =>
		param.key.startsWith("chromaKey."),
	);
}

const EDITABLE_KEYS = [...CHROMA_KEY_PANEL_KEYS];

describe("chroma key params are always visible", () => {
	test("video and image both carry the six editable keys", () => {
		for (const type of ["video", "image"] as const) {
			const keys = keyerParams({ type }).map((param) => param.key);
			expect(keys).toContain("chromaKey.enabled");
			for (const key of EDITABLE_KEYS) expect(keys).toContain(key);
		}
	});

	/**
	 * The regression: every one of these used to declare
	 * `dependencies: [{ param: "chromaKey.enabled", equals: true }]`, and the
	 * properties panel filters gated params out entirely — so with the keyer
	 * switched off (the default) the tab rendered as a single lonely Switch and
	 * looked like it had no parameters at all.
	 */
	test("no keyer control is gated behind the enable switch", () => {
		const gated = keyerParams({ type: "video" }).filter(
			(param) => (param.dependencies ?? []).length > 0,
		);
		expect(gated.map((param) => param.key)).toEqual([]);
	});

	test("the panel renders exactly the six keys, none hidden", () => {
		const registryKeys = keyerParams({ type: "image" })
			.map((param) => param.key)
			.filter((key) => key !== "chromaKey.enabled");
		const expected: string[] = [...EDITABLE_KEYS];
		expect(expected.sort()).toEqual(registryKeys.sort());
	});

	test("values read back as defaults while the keyer is off", () => {
		const element = elementWithParams({ type: "video", params: {} });
		for (const param of keyerParams({ type: "video" })) {
			if (param.key === "chromaKey.enabled") continue;
			expect(readElementParamValue({ element, param })).not.toBeNull();
		}
	});
});

describe("touching any keyer control switches the keyer on", () => {
	for (const key of EDITABLE_KEYS) {
		test(`${key} writes itself plus enabled=true`, () => {
			const param = keyerParams({ type: "video" }).find(
				(entry) => entry.key === key,
			);
			expect(param).toBeDefined();

			const value = key === "chromaKey.color" ? "#00FF00" : 42;
			const next = writeElementParamValue({
				element: elementWithParams({
					type: "video",
					params: { "chromaKey.enabled": false },
				}),
				param: param!,
				value,
			});

			expect(paramsOf({ element: next }).params[key]).toBe(value);
			expect(paramsOf({ element: next }).params["chromaKey.enabled"]).toBe(
				true,
			);
		});
	}

	test("an already-keyed element keeps its other params", () => {
		const param = keyerParams({ type: "video" }).find(
			(entry) => entry.key === "chromaKey.feather",
		);
		const next = writeElementParamValue({
			element: elementWithParams({
				type: "video",
				params: { "chromaKey.enabled": true, "chromaKey.color": "#00FF00" },
			}),
			param: param!,
			value: 80,
		});

		expect(paramsOf({ element: next }).params["chromaKey.feather"]).toBe(80);
		expect(paramsOf({ element: next }).params["chromaKey.color"]).toBe(
			"#00FF00",
		);
		expect(paramsOf({ element: next }).params["chromaKey.enabled"]).toBe(true);
	});
});
