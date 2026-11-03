/**
 * Clip-side Troika/flower sync for textanim char groups.
 * Main timeline text groups already have __fccSyncText from scene-builder.
 * Char clones copy each flower Troika layer from the parent and re-sync one glyph.
 * Do NOT copy `material` — Troika expects a base Material; assigning another
 * Text's DerivedMaterial makes later .material access call addEventListener on a
 * non-EventDispatcher (TypeError in applyOpacityToCharGroup / renderOneFlowerText).
 */
import * as THREE from "three";
import { Text as TroikaText } from "troika-three-text";
import { getFccUI, UI_LAYER } from "@/vfxpack/ui-overlay";

export const FCC_FLOWER_PREFIX = "__fccFlower_";
export const FCC_FLOWER_FACE = "__fccFlower_face";
export const FCC_TEXT_MESH = "__fccText";
export const FCC_TEXT_SHADOW = "__fccTextShadow";
export const FCC_TEXTANIM_ROOT = "__fccTextAnimRoot";
export const FCC_TEXTANIM_PARK = "__fccTextAnimPark";

function isTroika(o: THREE.Object3D | null | undefined): o is InstanceType<typeof TroikaText> {
	return !!o && typeof (o as { sync?: unknown }).sync === "function";
}

function findParentUIText(group: THREE.Object3D): THREE.Object3D | null {
	let p: THREE.Object3D | null = group.parent;
	while (p) {
		const ui = getFccUI(p);
		if (ui && ui.type === "text" && !(p.userData as { __fccTextAnimChar?: boolean }).__fccTextAnimChar) {
			return p;
		}
		p = p.parent;
	}
	return null;
}

/** Match scene-builder DEFAULT_FONT when ui.font is empty (timeline flower text). */
export const FCC_DEFAULT_TEXT_FONT = "/fonts/msyh.ttf";

/**
 * Prefer the parent's already-synced face/fill Troika for caret metrics.
 * Searches direct children and the textanim park bucket.
 */
export function findLayoutSourceTroika(
	group: THREE.Object3D,
): InstanceType<typeof TroikaText> | null {
	const prefer = [FCC_FLOWER_FACE, FCC_TEXT_MESH];
	const pools: THREE.Object3D[] = [];
	for (let i = 0; i < group.children.length; i++) {
		const c = group.children[i];
		if (!c) continue;
		if (c.name === FCC_TEXTANIM_ROOT) continue;
		if (c.name === FCC_TEXTANIM_PARK) {
			for (let j = 0; j < c.children.length; j++) pools.push(c.children[j]);
		} else {
			pools.push(c);
		}
	}
	for (const name of prefer) {
		for (const o of pools) {
			if (o && o.name === name && isTroika(o)) return o;
		}
	}
	for (const o of pools) {
		if (
			isTroika(o) &&
			(o.name === FCC_TEXT_SHADOW || o.name.startsWith(FCC_FLOWER_PREFIX))
		) {
			return o;
		}
	}
	return null;
}

/** Copy typeset metrics so layout Troika matches the static parent string. */
export function copyTroikaTypesetMetrics(
	dst: InstanceType<typeof TroikaText>,
	src: InstanceType<typeof TroikaText>,
): void {
	const anySrc = src as InstanceType<typeof TroikaText> & Record<string, unknown>;
	const anyDst = dst as InstanceType<typeof TroikaText> & Record<string, unknown>;
	const keys = [
		"font",
		"fontSize",
		"letterSpacing",
		"lineHeight",
		"maxWidth",
		"textAlign",
		"anchorX",
		"anchorY",
		"overflowWrap",
		"sdfGlyphSize",
		"lang",
	] as const;
	for (const k of keys) {
		if (anySrc[k] !== undefined && anySrc[k] !== null) {
			try {
				anyDst[k] = anySrc[k];
			} catch {
				/* ignore */
			}
		}
	}
	dst.text = String((src as { text?: string }).text ?? "");
}

/**
 * Read caretPositions from a synced parent Troika (full string).
 * Returns null if not ready.
 */
export function readCaretPositions(
	src: InstanceType<typeof TroikaText> | null | undefined,
): Float32Array | null {
	if (!src) return null;
	const info = (src as { textRenderInfo?: { caretPositions?: Float32Array } }).textRenderInfo;
	const carets = info && info.caretPositions;
	if (carets && carets.length >= 4) return carets;
	return null;
}

function copyTroikaLayout(
	dst: InstanceType<typeof TroikaText>,
	src: InstanceType<typeof TroikaText>,
	charText: string,
) {
	const anySrc = src as InstanceType<typeof TroikaText> & Record<string, unknown>;
	const anyDst = dst as InstanceType<typeof TroikaText> & Record<string, unknown>;
	const keys = [
		"font",
		"fontSize",
		"lineHeight",
		"color",
		"fillOpacity",
		"outlineWidth",
		"outlineOpacity",
		"outlineBlur",
		"outlineColor",
		"outlineOffsetX",
		"outlineOffsetY",
		"strokeWidth",
		"strokeColor",
		"strokeOpacity",
		"curveRadius",
		"depthOffset",
		"clipRect",
		"sdfGlyphSize",
		"gpuAccelerateSDF",
		// Never copy "material": Troika derives from fill/outline/stroke props.
		// Never copy letterSpacing onto single-char clones: spacing is baked into
		// caret midpoints from the full-string layout. Trailing LS on a 1-glyph
		// Troika widens its advance and shifts ink under center anchor.
	] as const;
	for (const k of keys) {
		if (anySrc[k] !== undefined) {
			try {
				anyDst[k] = anySrc[k];
			} catch {
				/* ignore read-only */
			}
		}
	}
	dst.text = charText;
	dst.letterSpacing = 0;
	dst.anchorX = "center";
	dst.anchorY = "middle";
	dst.position.set(0, 0, src.position.z);
	dst.frustumCulled = false;
	dst.castShadow = false;
	dst.receiveShadow = false;
	dst.layers.mask = src.layers.mask;
}

/**
 * Sync flower/plain Troika content onto a group.
 * - Main text: delegates to __fccSyncText when present.
 * - Char group: clones each flower Troika from the parent UI text.
 */
export function syncUITextContent(
	group: THREE.Object3D,
	rect?: { w: number; h: number } | null,
): void {
	const ui =
		getFccUI(group) ||
		((group.userData as { __fccCharFlowerUI?: { type?: string; text?: string } }).__fccCharFlowerUI as
			| { type?: string; text?: string }
			| undefined) ||
		null;
	if (!ui || ui.type !== "text") return;

	const sync = (group.userData as { __fccSyncText?: (r?: { w: number; h: number }) => void }).__fccSyncText;
	if (typeof sync === "function" && !(group.userData as { __fccTextAnimChar?: boolean }).__fccTextAnimChar) {
		sync(rect && rect.w > 0 ? { w: rect.w, h: rect.h ?? rect.w } : undefined);
		return;
	}

	const parent = findParentUIText(group);
	const charText = String(ui.text ?? "");
	if (!parent || !charText) {
		ensurePlainTroika(group, ui, rect);
		return;
	}

	// Prefer full Effect-stack rebuild from flowerStyle (same path as main text).
	// Shallow Troika prop copy cannot reproduce floral materials.
	const syncChar = (
		parent.userData as {
			__fccSyncCharFlower?: (
				charGroup: THREE.Object3D,
				charUI: Record<string, unknown>,
				rect?: { w: number; h: number },
			) => void;
		}
	).__fccSyncCharFlower;
	if (typeof syncChar === "function") {
		syncChar(group, ui as Record<string, unknown>, rect && rect.w > 0 ? { w: rect.w, h: rect.h ?? rect.w } : undefined);
		// Char clones must stay visible while parent originals are hidden.
		for (const child of group.children) {
			if (isTroika(child)) child.visible = true;
		}
		if ((parent.userData as { __fccTextAnimHideOriginals?: boolean }).__fccTextAnimHideOriginals) {
			for (const child of parent.children) {
				if (!isTroika(child)) continue;
				if (
					child.name === FCC_TEXT_MESH ||
					child.name === FCC_TEXT_SHADOW ||
					child.name.startsWith(FCC_FLOWER_PREFIX)
				) {
					child.visible = false;
				}
			}
		}
		return;
	}

	const wanted = new Set<string>();
	for (const child of [...parent.children]) {
		if (!isTroika(child)) continue;
		if (child.name === FCC_TEXTANIM_ROOT) continue;
		if (
			child.name === FCC_TEXT_MESH ||
			child.name === FCC_TEXT_SHADOW ||
			child.name.startsWith(FCC_FLOWER_PREFIX)
		) {
			wanted.add(child.name);
			let mesh = group.getObjectByName(child.name);
			if (!isTroika(mesh)) {
				if (mesh) group.remove(mesh);
				mesh = new TroikaText();
				mesh.name = child.name;
				group.add(mesh);
			}
			copyTroikaLayout(mesh, child, charText);
			// Parent originals are hidden during char preview — clones must draw.
			mesh.visible = true;
			const m = mesh;
			m.sync(() => {
				/* glyph ready */
			});
		}
	}
	// Remove stale layers
	for (const child of [...group.children]) {
		if (
			child.name === FCC_TEXT_MESH ||
			child.name === FCC_TEXT_SHADOW ||
			child.name.startsWith(FCC_FLOWER_PREFIX)
		) {
			if (!wanted.has(child.name)) {
				group.remove(child);
				try {
					(child as { dispose?: () => void }).dispose?.();
				} catch {
					/* ignore */
				}
			}
		}
	}
}

function ensurePlainTroika(
	group: THREE.Object3D,
	ui: { text?: string; fontSize?: number; color?: string; font?: string; fontUrl?: string },
	rect?: { w: number; h: number } | null,
): void {
	void rect;
	let mesh = group.getObjectByName(FCC_TEXT_MESH);
	if (!isTroika(mesh)) {
		if (mesh) group.remove(mesh);
		mesh = new TroikaText();
		mesh.name = FCC_TEXT_MESH;
		group.add(mesh);
		mesh.layers.set(UI_LAYER);
	}
	mesh.text = String(ui.text ?? "");
	mesh.fontSize = Number(ui.fontSize) > 0 ? Number(ui.fontSize) : 48;
	mesh.color = ui.color || "#ffffff";
	mesh.anchorX = "center";
	mesh.anchorY = "middle";
	mesh.font = String(ui.fontUrl || ui.font || FCC_DEFAULT_TEXT_FONT);
	mesh.letterSpacing = 0;
	mesh.sync(() => {
		/* ready */
	});
}

/**
 * Layout-only Troika (caret positions).
 * Must use the same font/letterSpacing/maxWidth contract as scene-builder parent
 * Troika — timeline flower text often has ui.font="" and relies on msyh default.
 * Prefer copyTroikaTypesetMetrics(layout, parentFace) when a synced parent exists.
 */
export function applyTroikaFromUI(
	troika: InstanceType<typeof TroikaText>,
	ui: {
		text?: string;
		fontSize?: number;
		color?: string;
		font?: string;
		fontUrl?: string;
		fontBold?: string;
		bold?: boolean;
		letterSpacing?: number;
		lineHeight?: number;
		align?: string;
		verticalAlign?: string;
		vAlign?: string;
		sizeDelta?: [number, number] | number[];
	},
	rect: { w: number; h: number } | null,
	_role: string,
): void {
	void _role;
	const align = String(ui.align || "center");
	const vAlign = String(ui.verticalAlign || ui.vAlign || "middle");
	troika.text = String(ui.text ?? "");
	troika.fontSize = Number(ui.fontSize) > 0 ? Number(ui.fontSize) : 48;
	troika.color = ui.color || "#ffffff";
	troika.anchorX =
		align === "left" ? "left" : align === "right" ? "right" : "center";
	troika.anchorY =
		vAlign === "top" ? "top" : vAlign === "bottom" ? "bottom" : "middle";
	troika.textAlign =
		align === "left" || align === "right" || align === "justify" ? align : "center";
	troika.letterSpacing = Number(ui.letterSpacing) || 0;
	troika.lineHeight = Number(ui.lineHeight) > 0 ? Number(ui.lineHeight) : 1.2;
	const rectW = rect && rect.w > 0 ? rect.w : Number(ui.sizeDelta?.[0]) || 400;
	troika.maxWidth = rectW > 0 ? rectW : 400;
	troika.overflowWrap = "break-word";
	// Fake bold = SDF expand in scene-builder; layout Troika always uses regular face.
	const font = ui.fontUrl || ui.font || FCC_DEFAULT_TEXT_FONT;
	troika.font = String(font);
	troika.fillOpacity = 0;
	troika.visible = false;
}
