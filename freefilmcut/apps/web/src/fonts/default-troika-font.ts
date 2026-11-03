/**
 * Troika timeline / pack text needs a real TTF URL.
 *
 * Ship Noto Sans SC (OFL) as the redistributable default. Do not probe
 * `/fonts/msyh.ttf` — it is gitignored and a 404 breaks `document.fonts.load`
 * / CSS @font-face on clone machines.
 */

export const FCC_BUNDLED_CJK_FONT = "/fonts/NotoSansSC-Regular.ttf";
/** Optional local-only file; not requested automatically. */
export const FCC_MSYH_FONT = "/fonts/msyh.ttf";

/** CSS / params family names that resolve via Troika bundled TTF (not Google Fonts). */
export const LOCAL_CJK_FONT_FAMILIES = new Set([
	"Noto Sans SC",
	"Microsoft YaHei",
	"微软雅黑",
	"msyh",
]);

/** Current default Troika font URL. */
export function getDefaultTroikaFont(): string {
	return FCC_BUNDLED_CJK_FONT;
}

/**
 * @deprecated Prefer getDefaultTroikaFont()
 */
export const FCC_DEFAULT_TROIKA_FONT = FCC_BUNDLED_CJK_FONT;

/** Kept for call sites; bundled Noto remains the Troika file fallback. */
export async function initDefaultTroikaFont(): Promise<string> {
	return FCC_BUNDLED_CJK_FONT;
}
