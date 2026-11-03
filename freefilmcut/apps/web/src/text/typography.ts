export const MIN_FONT_SIZE = 5;
export const MAX_FONT_SIZE = 300;
export const DEFAULT_TEXT_COLOR = "#000000";

/**
 * Default glyph size for every new / unset text, in world units 1:1 with
 * `params.fontSize` (see `text/primitives.ts`).
 */
export const DEFAULT_FONT_SIZE = 100;

/**
 * Reference size the default text background padding (30 / 42) was authored
 * at. Padding scales by `fontSize / FONT_SIZE_RATIO_REFERENCE`, so this is a
 * layout anchor — NOT the default size. Changing it resizes the background box
 * of every existing text element.
 */
export const FONT_SIZE_RATIO_REFERENCE = 15;

/**
 * Legacy constant (old plain-text formula param*(canvasH/90)).
 * Glyph size is now params.fontSize 1:1 for plain + flower; kept for deprecated helpers / docs.
 */
export const FONT_SIZE_SCALE_REFERENCE = 90;
