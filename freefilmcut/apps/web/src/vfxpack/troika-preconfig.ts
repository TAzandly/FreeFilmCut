/**
 * MUST import before any Troika Text.sync() / getTextRenderInfo().
 * Match Editor UIText: sdfMargin 0.25 (match editor; thicker shadow strokes) + 256 SDF (sharper stems).
 * Thick CapCut strokes use shader expand; do not inflate margin back to 0.5.
 */
import { configureTextBuilder } from "troika-three-text";

configureTextBuilder({
	sdfMargin: 0.25, // match editor fcc-ui-197
	sdfGlyphSize: 256,
});

export const FCC_TROIKA_SDF_GLYPH_SIZE = 256;
export const FCC_TROIKA_SDF_MARGIN = 0.25;
