import { toast } from "sonner";
import { loadVfxPackFromFile } from "@/vfxpack/load-pack";
import { usePackRegistry } from "@/vfxpack/pack-registry";
import { persistUserVfxPackFile } from "@/vfxpack/persisted-user-packs";
import {
	getVfxPackPlacement,
	normalizeVfxPackType,
	VFX_PACK_TYPE_LABELS,
} from "@/vfxpack/pack-placement";
import type { LoadedVfxPack, PrimaryVfxPackType } from "@/vfxpack/types";

function isVfxPackFile(file: File): boolean {
	const name = file.name.toLowerCase();
	return (
		name.endsWith(".vfxpack") ||
		name.endsWith(".zip") ||
		file.type === "application/zip" ||
		file.type === "application/x-zip-compressed"
	);
}

/**
 * Load .vfxpack files into the session registry and persist them locally
 * (OPFS / IndexedDB) so they survive refresh. Same pack id / same filename
 * replaces the previous entry (no duplicates).
 */
export async function importVfxPackFiles({
	files,
	expectTypes,
}: {
	files: File[];
	/** When set, warn if imported type is outside this set (still registers). */
	expectTypes?: PrimaryVfxPackType[] | null;
}): Promise<LoadedVfxPack[]> {
	const packFiles = files.filter(isVfxPackFile);
	if (packFiles.length === 0) {
		toast.error("Please choose a .vfxpack file");
		return [];
	}

	const imported: LoadedVfxPack[] = [];
	const registerPack = usePackRegistry.getState().registerPack;

	for (const file of packFiles) {
		try {
			const existingByName = usePackRegistry
				.getState()
				.packs.find(
					(p) =>
						p.sourceFileName &&
						p.sourceFileName.toLowerCase() === file.name.toLowerCase(),
				);
			const pack = await loadVfxPackFromFile({ file });
			const existingById = usePackRegistry.getState().getPack(pack.id);
			await persistUserVfxPackFile({ file, pack });
			registerPack(pack);
			imported.push(pack);

			const type = normalizeVfxPackType(pack.type);
			const placement = getVfxPackPlacement({ type: pack.type });
			const replaced = Boolean(existingById || existingByName);
			const typeMismatch =
				expectTypes != null &&
				expectTypes.length > 0 &&
				!expectTypes.includes(type);

			toast.success(
				replaced
					? `Replaced ${pack.displayName}`
					: `Imported ${pack.displayName}`,
				{
					description: typeMismatch
						? `Type is ${VFX_PACK_TYPE_LABELS[type]} — open that panel to use it. ${placement.dragHint}`
						: `${placement.label} · saved for next launch`,
				},
			);
		} catch (error) {
			console.error(error);
			toast.error(`Failed to import ${file.name}`, {
				description:
					error instanceof Error ? error.message : String(error),
			});
		}
	}

	return imported;
}
