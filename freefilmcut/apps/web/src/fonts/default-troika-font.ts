/**
 * Troika timeline / pack text needs a real TTF URL.
 *
 * Microsoft YaHei (`msyh.ttf`) matches CapCut / Editor looks but cannot be
 * redistributed on GitHub. Ship Noto Sans SC (OFL) as the clone-safe default;
 * if a local `public/fonts/msyh.ttf` exists, prefer it after init.
 */

export const FCC_BUNDLED_CJK_FONT = "/fonts/NotoSansSC-Regular.ttf";
export const FCC_MSYH_FONT = "/fonts/msyh.ttf";

let activeDefault = FCC_BUNDLED_CJK_FONT;
let initPromise: Promise<string> | null = null;

/** Current default Troika font URL (Noto, or YaHei after successful probe). */
export function getDefaultTroikaFont(): string {
	return activeDefault;
}

/**
 * @deprecated Prefer getDefaultTroikaFont() — this alias tracks the active default.
 * Kept for older imports that read the constant once at module load.
 */
export let FCC_DEFAULT_TROIKA_FONT = FCC_BUNDLED_CJK_FONT;

export async function initDefaultTroikaFont(): Promise<string> {
	if (initPromise) return initPromise;
	initPromise = (async () => {
		try {
			const res = await fetch(FCC_MSYH_FONT, { method: "HEAD" });
			if (res.ok) {
				activeDefault = FCC_MSYH_FONT;
				FCC_DEFAULT_TROIKA_FONT = FCC_MSYH_FONT;
			}
		} catch {
			/* keep Noto */
		}
		return activeDefault;
	})();
	return initPromise;
}
