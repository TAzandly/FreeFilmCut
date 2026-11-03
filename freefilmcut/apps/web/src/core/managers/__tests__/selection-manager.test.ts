import { describe, expect, test } from "bun:test";
import type { EditorCore } from "@/core";
import { SelectionManager } from "@/core/managers/selection-manager";

function createSelectionManager(): SelectionManager {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- constructor does not use the editor
	return new SelectionManager({} as unknown as EditorCore);
}

describe("SelectionManager transition selection", () => {
	test("selecting a transition clears clips and becomes the active kind", () => {
		const selection = createSelectionManager();
		selection.setSelectedElements({
			elements: [{ trackId: "track-a", elementId: "clip-a" }],
		});

		selection.setSelectedTransition({
			selection: { trackId: "track-a", transitionId: "edge-1" },
		});

		expect(selection.getSelectedElements()).toEqual([]);
		expect(selection.getSelectedTransition()).toEqual({
			trackId: "track-a",
			transitionId: "edge-1",
		});
		expect(selection.getActiveSelectionKind()).toBe("transition");
	});

	test("selecting a clip clears the transition", () => {
		const selection = createSelectionManager();
		selection.setSelectedTransition({
			selection: { trackId: "track-a", transitionId: "edge-1" },
		});

		selection.setSelectedElements({
			elements: [{ trackId: "track-a", elementId: "clip-b" }],
		});

		expect(selection.getSelectedTransition()).toBeNull();
		expect(selection.getActiveSelectionKind()).toBe("elements");
	});

	test("escape clears only the transition", () => {
		const selection = createSelectionManager();
		selection.setSelectedTransition({
			selection: { trackId: "track-a", transitionId: "edge-1" },
		});

		expect(selection.clearMostSpecificSelection()).toBe(true);
		expect(selection.getSelectedTransition()).toBeNull();
		expect(selection.getActiveSelectionKind()).toBeNull();
	});

	test("element selection patches clear a transition", () => {
		const selection = createSelectionManager();
		selection.setSelectedTransition({
			selection: { trackId: "track-a", transitionId: "edge-1" },
		});

		selection.applySelectionPatch({
			patch: {
				selectedElements: [{ trackId: "track-a", elementId: "clip-b" }],
			},
		});

		expect(selection.getSelectedTransition()).toBeNull();
		expect(selection.getSelectedElements()).toEqual([
			{ trackId: "track-a", elementId: "clip-b" },
		]);
	});

	test("removing the selected transition clears it and undo can restore it", () => {
		const selection = createSelectionManager();
		selection.setSelectedTransition({
			selection: { trackId: "track-a", transitionId: "edge-1" },
		});
		const before = selection.getSnapshot();

		const after = selection.applySelectionPatch({
			patch: { selectedTransition: null },
		});

		expect(after.selectedTransition).toBeNull();
		selection.restoreSnapshot({ snapshot: before });
		expect(selection.getSelectedTransition()).toEqual({
			trackId: "track-a",
			transitionId: "edge-1",
		});
		expect(selection.getSelectedElements()).toEqual([]);
	});
});
