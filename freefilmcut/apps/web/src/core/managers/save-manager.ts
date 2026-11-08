import type { EditorCore } from "@/core";

export const DEFAULT_AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000;

type SaveManagerOptions = {
	/** Max wait from first dirty mark until disk save. Edits do not reset the timer. */
	autosaveIntervalMs?: number;
	/** @deprecated Use autosaveIntervalMs */
	debounceMs?: number;
};

export class SaveManager {
	private autosaveIntervalMs: number;
	private isPaused = false;
	private isSaving = false;
	private hasPendingSave = false;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private unsubscribeHandlers: Array<() => void> = [];

	constructor({
		editor,
		autosaveIntervalMs,
		debounceMs,
	}: {
		editor: EditorCore;
	} & SaveManagerOptions) {
		this.editor = editor;
		this.autosaveIntervalMs =
			autosaveIntervalMs ?? debounceMs ?? DEFAULT_AUTOSAVE_INTERVAL_MS;
	}

	private editor: EditorCore;

	start(): void {
		if (this.unsubscribeHandlers.length > 0) return;

		this.unsubscribeHandlers = [
			this.editor.scenes.subscribe(() => {
				this.markDirty();
			}),
			this.editor.timeline.subscribe((reason) => {
				if (reason === "preview") return;
				this.markDirty();
			}),
		];
	}

	stop(): void {
		for (const unsubscribe of this.unsubscribeHandlers) {
			unsubscribe();
		}
		this.unsubscribeHandlers = [];
		this.clearTimer();
	}

	pause(): void {
		this.isPaused = true;
	}

	resume(): void {
		this.isPaused = false;
		if (this.hasPendingSave) {
			this.ensureAutosaveScheduled();
		}
	}

	markDirty({ force = false }: { force?: boolean } = {}): void {
		if (this.isPaused && !force) return;
		this.hasPendingSave = true;
		this.ensureAutosaveScheduled();
	}

	async flush(): Promise<void> {
		this.hasPendingSave = true;
		await this.saveNow();
	}

	getIsDirty(): boolean {
		return this.hasPendingSave || this.isSaving;
	}

	/**
	 * Schedule one autosave from the first dirty mark. Later edits keep the
	 * pending flag but do not reset the countdown (throttle-from-first-dirty).
	 */
	private ensureAutosaveScheduled(): void {
		if (this.isSaving) return;
		if (this.saveTimer) return;
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			void this.saveNow();
		}, this.autosaveIntervalMs);
	}

	private async saveNow(): Promise<void> {
		if (this.isSaving) return;
		if (!this.hasPendingSave) return;

		// Projects home shares EditorCore with no active project; getActive() throws.
		const activeProject = this.editor.project.getActiveOrNull();
		if (!activeProject) {
			this.hasPendingSave = false;
			this.clearTimer();
			return;
		}
		if (this.editor.project.getIsLoading()) return;
		if (this.editor.project.getMigrationState().isMigrating) return;

		this.isSaving = true;
		this.hasPendingSave = false;
		this.clearTimer();

		try {
			await this.editor.project.saveCurrentProject();
		} finally {
			this.isSaving = false;
			if (this.hasPendingSave) {
				this.ensureAutosaveScheduled();
			}
		}
	}

	private clearTimer(): void {
		if (!this.saveTimer) return;
		clearTimeout(this.saveTimer);
		this.saveTimer = null;
	}
}
