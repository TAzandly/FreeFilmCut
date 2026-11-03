export type BackgroundFillStyle = {
	id: string;
	name: string;
	/** Path under `/background-fill-styles/` (e.g. `dark.svg`). */
	file: string;
	/** Optional poster for GIF / animated styles. */
	poster?: string;
};

export type BackgroundFillStyleEntry = BackgroundFillStyle & {
	url: string;
	posterUrl: string | null;
};

const BASE_PATH = "/background-fill-styles";

function toEntry(style: BackgroundFillStyle): BackgroundFillStyleEntry {
	const url = `${BASE_PATH}/${style.file.replace(/^\//, "")}`;
	const posterUrl = style.poster
		? `${BASE_PATH}/${style.poster.replace(/^\//, "")}`
		: null;
	return { ...style, url, posterUrl };
}

/** Fallback so render works before / without fetch of index.json. */
const BUILTIN_STYLES: BackgroundFillStyle[] = [
	{ id: "solid-dark", name: "Dark", file: "solid-dark.svg" },
	{ id: "solid-light", name: "Light", file: "solid-light.svg" },
	{ id: "gradient-dusk", name: "Dusk", file: "gradient-dusk.svg" },
];

let catalogPromise: Promise<BackgroundFillStyleEntry[]> | null = null;
let catalogSnapshot: BackgroundFillStyleEntry[] = BUILTIN_STYLES.map(toEntry);

export function getBackgroundFillStylesSnapshot(): BackgroundFillStyleEntry[] {
	return catalogSnapshot;
}

export async function loadBackgroundFillStyles(): Promise<
	BackgroundFillStyleEntry[]
> {
	if (catalogPromise) return catalogPromise;
	catalogPromise = (async () => {
		try {
			const response = await fetch(`${BASE_PATH}/index.json`, {
				cache: "no-cache",
			});
			if (!response.ok) {
				catalogSnapshot = [];
				return catalogSnapshot;
			}
			const raw = (await response.json()) as unknown;
			const list = Array.isArray(raw)
				? raw
				: raw &&
						typeof raw === "object" &&
						Array.isArray((raw as { styles?: unknown }).styles)
					? ((raw as { styles: unknown[] }).styles ?? [])
					: [];
			const entries: BackgroundFillStyleEntry[] = [];
			for (const item of list) {
				if (!item || typeof item !== "object") continue;
				const record = item as Record<string, unknown>;
				if (
					typeof record.id !== "string" ||
					typeof record.name !== "string" ||
					typeof record.file !== "string"
				) {
					continue;
				}
				entries.push(
					toEntry({
						id: record.id,
						name: record.name,
						file: record.file,
						poster:
							typeof record.poster === "string" ? record.poster : undefined,
					}),
				);
			}
			catalogSnapshot = entries;
			return catalogSnapshot;
		} catch {
			catalogSnapshot = [];
			return catalogSnapshot;
		}
	})();
	return catalogPromise;
}

export function resolveBackgroundFillStyleUrl({
	styleId,
}: {
	styleId: string | null;
}): string | null {
	if (!styleId) return null;
	const entry = catalogSnapshot.find((style) => style.id === styleId);
	return entry?.url ?? null;
}
