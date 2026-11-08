import { afterEach, describe, expect, mock, test } from "bun:test";
import type { EditorCore } from "@/core";
import { SaveManager } from "@/core/managers/save-manager";

type TimelineReason = "preview" | "commit" | string;

function createMockEditor({
	saveCurrentProject,
}: {
	saveCurrentProject: () => Promise<void>;
}) {
	const sceneListeners = new Set<() => void>();
	const timelineListeners = new Set<(reason: TimelineReason) => void>();

	const editor = {
		scenes: {
			subscribe: (fn: () => void) => {
				sceneListeners.add(fn);
				return () => sceneListeners.delete(fn);
			},
			notify: () => {
				for (const fn of sceneListeners) fn();
			},
		},
		timeline: {
			subscribe: (fn: (reason: TimelineReason) => void) => {
				timelineListeners.add(fn);
				return () => timelineListeners.delete(fn);
			},
			notify: (reason: TimelineReason) => {
				for (const fn of timelineListeners) fn(reason);
			},
		},
		project: {
			getActiveOrNull: () => ({ metadata: { id: "proj-1" } }),
			getIsLoading: () => false,
			getMigrationState: () => ({ isMigrating: false }),
			saveCurrentProject,
		},
	} as unknown as EditorCore;

	return { editor, sceneListeners, timelineListeners };
}

describe("SaveManager autosave interval", () => {
	afterEach(() => {
		// Drain any leftover timers from failed assertions.
	});

	test("does not save before the interval elapses", async () => {
		const saveCurrentProject = mock(() => Promise.resolve());
		const { editor, timelineListeners } = createMockEditor({
			saveCurrentProject,
		});
		const save = new SaveManager({
			editor,
			autosaveIntervalMs: 50,
		});
		save.start();

		for (const fn of timelineListeners) fn("commit");
		expect(save.getIsDirty()).toBe(true);
		expect(saveCurrentProject).toHaveBeenCalledTimes(0);

		await Bun.sleep(20);
		expect(saveCurrentProject).toHaveBeenCalledTimes(0);

		save.stop();
	});

	test("saves once when the interval elapses", async () => {
		const saveCurrentProject = mock(() => Promise.resolve());
		const { editor, timelineListeners } = createMockEditor({
			saveCurrentProject,
		});
		const save = new SaveManager({
			editor,
			autosaveIntervalMs: 30,
		});
		save.start();

		for (const fn of timelineListeners) fn("commit");
		await Bun.sleep(50);
		expect(saveCurrentProject).toHaveBeenCalledTimes(1);
		expect(save.getIsDirty()).toBe(false);

		save.stop();
	});

	test("multiple markDirty calls do not reset the timer", async () => {
		const saveCurrentProject = mock(() => Promise.resolve());
		const { editor, timelineListeners } = createMockEditor({
			saveCurrentProject,
		});
		const save = new SaveManager({
			editor,
			autosaveIntervalMs: 40,
		});
		save.start();

		for (const fn of timelineListeners) fn("commit");
		await Bun.sleep(15);
		for (const fn of timelineListeners) fn("commit");
		await Bun.sleep(15);
		for (const fn of timelineListeners) fn("commit");
		// From first dirty: ~45ms total — one save, not three staggered.
		await Bun.sleep(20);
		expect(saveCurrentProject).toHaveBeenCalledTimes(1);

		save.stop();
	});

	test("flush saves immediately", async () => {
		const saveCurrentProject = mock(() => Promise.resolve());
		const { editor, timelineListeners } = createMockEditor({
			saveCurrentProject,
		});
		const save = new SaveManager({
			editor,
			autosaveIntervalMs: 60_000,
		});
		save.start();

		for (const fn of timelineListeners) fn("commit");
		await save.flush();
		expect(saveCurrentProject).toHaveBeenCalledTimes(1);
		expect(save.getIsDirty()).toBe(false);

		save.stop();
	});

	test("preview timeline reason does not mark dirty", () => {
		const saveCurrentProject = mock(() => Promise.resolve());
		const { editor, timelineListeners } = createMockEditor({
			saveCurrentProject,
		});
		const save = new SaveManager({
			editor,
			autosaveIntervalMs: 30,
		});
		save.start();

		for (const fn of timelineListeners) fn("preview");
		expect(save.getIsDirty()).toBe(false);
		expect(saveCurrentProject).toHaveBeenCalledTimes(0);

		save.stop();
	});
});
