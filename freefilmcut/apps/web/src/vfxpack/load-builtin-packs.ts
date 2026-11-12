import { loadVfxPackFromFile } from "@/vfxpack/load-pack";
import { usePackRegistry } from "@/vfxpack/pack-registry";
import { normalizeVfxPackType } from "@/vfxpack/pack-placement";
import type { PrimaryVfxPackType } from "@/vfxpack/types";

/**
 * Built-in library packs under public/vfxpacks/.
 * Each folder has an index.json string array of filenames (include .vfxpack);
 * put the files next to that index. Startup fetch + register — no manual Import.
 *
 *   stickers/index.json           → type sticker
 *   effects/index.json            → type effect
 *   adjustments/filters/          → type filter (Adjustment → Filters)
 *   transitions/index.json        → type transition
 *   sticker-anims/index.json      → type sticker-anim
 *   text-anims/in|out|loop/       → type text-anim
 *   clip-anims/in|out|combo/      → type clip-anim
 *   face-fx/ — temporarily not loaded (NLE UI hidden until Face FX is stable)
 */
const BUILTIN_FOLDERS: Array<{
	folder: string;
	allowed: PrimaryVfxPackType[] | null;
}> = [
	{ folder: "stickers", allowed: ["sticker"] },
	{ folder: "effects", allowed: ["effect"] },
	{ folder: "adjustments/filters", allowed: ["filter"] },
	{ folder: "transitions", allowed: ["transition"] },
	{ folder: "sticker-anims", allowed: ["sticker-anim"] },
	{ folder: "text-anims/in", allowed: ["text-anim"] },
	{ folder: "text-anims/out", allowed: ["text-anim"] },
	{ folder: "text-anims/loop", allowed: ["text-anim"] },
	{ folder: "text-templates", allowed: ["text-template"] },
	{ folder: "clip-anims/in", allowed: ["clip-anim"] },
	{ folder: "clip-anims/out", allowed: ["clip-anim"] },
	{ folder: "clip-anims/combo", allowed: ["clip-anim"] },
];

let started = false;

async function loadFolder(
	folder: string,
	allowed: PrimaryVfxPackType[] | null,
): Promise<void> {
	let names: string[] = [];
	try {
		const response = await fetch(`/vfxpacks/${folder}/index.json`);
		if (!response.ok) return;
		const json = await response.json();
		if (!Array.isArray(json)) return;
		names = json.filter((name) => typeof name === "string" && name.length > 0);
	} catch {
		return;
	}

	for (const name of names) {
		try {
			const fileName = name.endsWith(".vfxpack") ? name : `${name}.vfxpack`;
			const response = await fetch(
				`/vfxpacks/${folder}/${encodeURIComponent(fileName)}`,
			);
			if (!response.ok) {
				console.warn(
					`[FreeFilmCut] builtin missing ${folder}/${fileName} (index entry: ${name})`,
				);
				continue;
			}
			const blob = await response.blob();
			const file = new File([blob], fileName, { type: "application/zip" });
			const pack = await loadVfxPackFromFile({ file });
			const type = normalizeVfxPackType(pack.type);
			if (allowed && !allowed.includes(type)) {
				console.warn(
					`[FreeFilmCut] builtin ${folder}/${fileName} type=${pack.type}, expected ${allowed.join("|")} — not registered`,
				);
				continue;
			}
			usePackRegistry.getState().registerPack(pack);
		} catch (error) {
			console.warn("[FreeFilmCut] builtin pack skipped", folder, name, error);
		}
	}
}

/** Load all built-in .vfxpack libraries once per session. */
export function loadBuiltinVfxPacks(): void {
	if (started || typeof window === "undefined") return;
	started = true;
	void (async () => {
		for (const entry of BUILTIN_FOLDERS) {
			await loadFolder(entry.folder, entry.allowed);
		}
	})();
}
