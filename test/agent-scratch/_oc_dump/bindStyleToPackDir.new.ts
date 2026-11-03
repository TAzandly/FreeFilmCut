/** Ensure texture paths under a pack dir resolve to /flower/<dir>/<file>.
 * MUST walk `stack` (canonical) — rewriting only buckets is wiped by normalizeFlowerStyle.
 */
function bindStyleToPackDir(style: unknown, dir: string): FlowerStyle {
	const rewrite = (content: unknown) => {
		const c = normalizeFillContent(content);
		if (c.renderType !== "texture" || !c.texture?.path) return c;
		let path = c.texture.path;
		if (
			path.startsWith("http") ||
			path.startsWith("blob:") ||
			path.startsWith("data:") ||
			path.startsWith("/")
		) {
			return c;
		}
		const m = path
			.replace(/\\/g, "/")
			.match(/(?:assets\/)?flower\/([^/]+)\/(.+)$/i);
		if (m) {
			path = flowerPublicUrl(m[1], m[2]);
			return { ...c, texture: { ...c.texture, path } };
		}
		// bare filename or relative → public URL for this pack
		const file = path.split("/").pop() || path;
		path = flowerPublicUrl(dir, file);
		return { ...c, texture: { ...c.texture, path } };
	};
	const walkLayer = <T extends { content: unknown; strokes?: Array<{ content: unknown }> }>(
		layer: T,
	): T => {
		const next = { ...layer, content: rewrite(layer.content) };
		if (Array.isArray(layer.strokes)) {
			next.strokes = layer.strokes.map((st) => ({
				...st,
				content: rewrite(st.content),
			}));
		}
		return next;
	};
	const s = normalizeFlowerStyle(style);
	s.fill = { ...s.fill, content: rewrite(s.fill.content) };
	s.strokes = (s.strokes || []).map((st) => ({ ...st, content: rewrite(st.content) }));
	s.shadows = (s.shadows || []).map(walkLayer);
	s.innerShadows = (s.innerShadows || []).map(walkLayer);
	if (Array.isArray(s.stack)) {
		s.stack = s.stack.map((e) => {
			if (!e || e.kind === "face") return e;
			if (e.kind === "stroke") {
				return { ...e, content: rewrite((e as { content: unknown }).content) } as typeof e;
			}
			return walkLayer(e as typeof e & { content: unknown });
		}) as FlowerStyle["stack"];
	}
	// Remap assets/flower → /flower, then re-normalize so buckets match stack.
	return normalizeFlowerStyle(remapFlowerStyleTexturePathsForOpenCut(s));
}