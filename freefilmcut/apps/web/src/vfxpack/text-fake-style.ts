/**
 * Fake bold / italic for Troika SDF text (clip + shared semantics).
 * Bold = SDF expand on fill (and added to outer stroke/shadow expand), NOT a bold font file.
 * Italic = baseline-anchored shear: x' = x + k*(y - yBottom); bottom edge stays put.
 */
export const FCC_FAKE_BOLD_EXPAND_EM = 0.028; // ~2.8% of fontSize (was 0.045 — too thick)
export const FCC_FAKE_ITALIC_SHEAR_XY = 0.22; // makeShear(0,0,k) amount; x += k*(y-yBottom)

export function fakeBoldExpandPx(fontSize: number | undefined | null): number {
	const fs = Number(fontSize) > 0 ? Number(fontSize) : 48;
	return fs * FCC_FAKE_BOLD_EXPAND_EM;
}

export function isFccBold(ui: {
	bold?: boolean;
	fontWeight?: string;
} | null | undefined): boolean {
	if (!ui) return false;
	if (ui.bold === true) return true;
	return String(ui.fontWeight || "") === "bold";
}

export function isFccItalic(ui: {
	italic?: boolean;
	fontStyle?: string;
} | null | undefined): boolean {
	if (!ui) return false;
	if (ui.italic === true) return true;
	return String(ui.fontStyle || "") === "italic";
}
