#!/usr/bin/env node
/**
 * Sync flower packs into OpenCut Effects:
 * 1) Copy folders from three.js/editor/assets/flower → public/flower
 * 2) Unpack any public/flower/*.vfxpack (Editor VfxPackExporter art-text)
 *    into a sibling folder with flowerStyle.json + textures + pack.json
 * 3) Regenerate public/flower/index.json
 *
 * Usage (repo root):
 *   node scripts/sync-flower-packs.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(repoRoot, "three.js", "editor", "assets", "flower");
const dstRoot = path.join(
	repoRoot,
	"freefilmcut",
	"apps",
	"web",
	"public",
	"flower",
);

const require = createRequire(import.meta.url);
let unzipSync = null;
try {
	({ unzipSync } = require(
		path.join(
			repoRoot,
			"freefilmcut",
			"apps",
			"web",
			"node_modules",
			"fflate",
		),
	));
} catch {
	try {
		({ unzipSync } = require("fflate"));
	} catch {
		unzipSync = null;
	}
}

function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dst) {
	ensureDir(dst);
	for (const name of fs.readdirSync(src)) {
		const s = path.join(src, name);
		const d = path.join(dst, name);
		const st = fs.statSync(s);
		if (st.isDirectory()) copyDir(s, d);
		else fs.copyFileSync(s, d);
	}
}

function readJson(file) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return null;
	}
}

function writeJson(file, data) {
	fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function slugify(name) {
	return (
		String(name || "flower")
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 64) || "flower"
	);
}

function listPackDirs() {
	if (!fs.existsSync(dstRoot)) return [];
	return fs
		.readdirSync(dstRoot, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name)
		.sort();
}

function listVfxpacks() {
	if (!fs.existsSync(dstRoot)) return [];
	return fs
		.readdirSync(dstRoot)
		.filter((n) => /\.vfxpack$/i.test(n))
		.sort();
}

function packEntryFromDir(dir) {
	const folder = path.join(dstRoot, dir);
	const packMeta =
		readJson(path.join(folder, "pack.json")) ||
		readJson(path.join(folder, "preset.json")) ||
		{};
	const id =
		String(packMeta.id || "").trim() ||
		(dir === "7645" ? "7645318555541638462" : dir);
	const name =
		String(packMeta.name || "").trim() ||
		(dir === "7645" ? "Sample" : dir);
	const cover = fs.existsSync(path.join(folder, "cover_icon.png"))
		? "cover_icon.png"
		: fs.existsSync(path.join(folder, "cover.png"))
			? "cover.png"
			: null;
	const preview = fs.existsSync(path.join(folder, "preview.gif"))
		? "preview.gif"
		: fs.existsSync(path.join(folder, "hover.gif"))
			? "hover.gif"
			: fs.existsSync(path.join(folder, "preview.webp"))
				? "preview.webp"
				: null;
	const style = fs.existsSync(path.join(folder, "flowerStyle.json"))
		? "flowerStyle.json"
		: null;
	const designFontSize =
		Number(packMeta.designFontSize) > 0 ? Number(packMeta.designFontSize) : 48;
	let vfxpack = packMeta.sourceVfxpack || null;
	if (!vfxpack) {
		const candidates = [
			"freecapcut." + dir + ".vfxpack",
			dir + ".vfxpack",
			id + ".vfxpack",
		];
		for (const c of candidates) {
			if (fs.existsSync(path.join(dstRoot, c))) {
				vfxpack = c;
				break;
			}
		}
	}
	const entry = {
		id,
		name,
		dir,
		cover,
		preview,
		style,
		vfxpack,
		designFontSize,
	};
	if (dir === "7645" || id === "7645318555541638462") {
		entry.builtin = "jianying7645";
	} else if (packMeta.builtin) {
		entry.builtin = packMeta.builtin;
	}
	return entry;
}

function normalizeZipPath(p) {
	return String(p || "")
		.replace(/\\/g, "/")
		.replace(/^\.\//, "");
}

function stripPackPrefix(p) {
	const n = normalizeZipPath(p);
	if (n === "pack" || n.startsWith("pack/")) return n.slice("pack/".length);
	return n;
}

function findFlowerUi(node, hits) {
	if (!node || typeof node !== "object") return;
	const fcc = node.userData && node.userData.fccUI;
	if (fcc && fcc.type === "text" && fcc.flowerStyle) hits.push(fcc);
	else if (node.ui && node.ui.type === "text" && node.ui.flowerStyle) {
		hits.push(node.ui);
	} else if (node.flowerStyle && typeof node.flowerStyle === "object") {
		hits.push({
			flowerStyle: node.flowerStyle,
			fontSize: node.fontSize,
			flowerBaseFontSize: node.flowerBaseFontSize,
			text: node.text,
		});
	}
	if (Array.isArray(node)) {
		for (const child of node) findFlowerUi(child, hits);
		return;
	}
	for (const key of Object.keys(node)) {
		if (key === "flowerStyle") continue;
		findFlowerUi(node[key], hits);
	}
}

function collectTexturePaths(style, out) {
	if (!style || typeof style !== "object") return;
	if (typeof style.path === "string" && style.path) out.add(style.path);
	if (Array.isArray(style)) {
		for (const x of style) collectTexturePaths(x, out);
		return;
	}
	for (const v of Object.values(style)) collectTexturePaths(v, out);
}

function rewriteStyleTexturePaths(style, remap) {
	const s = JSON.parse(JSON.stringify(style));
	function fix(obj) {
		if (!obj || typeof obj !== "object") return;
		if (typeof obj.path === "string" && remap.has(obj.path)) {
			obj.path = remap.get(obj.path);
		}
		if (Array.isArray(obj)) {
			for (const x of obj) fix(x);
			return;
		}
		for (const v of Object.values(obj)) fix(v);
	}
	fix(s);
	return s;
}

function resolveTextureSource(texPath, zipFiles) {
	const norm = normalizeZipPath(texPath);
	const base = path.basename(norm);

	const zipCandidates = [norm, `textures/${base}`, `pack/textures/${base}`, base];
	for (const c of zipCandidates) {
		const key = normalizeZipPath(c);
		if (zipFiles.has(key)) return { kind: "zip", key };
	}
	for (const [k] of zipFiles) {
		if (k.endsWith("/" + base) || k === base) return { kind: "zip", key: k };
	}

	const m = norm.match(/(?:^|\/)(?:assets\/)?flower\/([^/]+)\/([^/]+)$/i);
	if (m) {
		const [, dir, file] = m;
		const candidates = [
			path.join(dstRoot, dir, file),
			path.join(srcRoot, dir, file),
		];
		for (const c of candidates) {
			if (fs.existsSync(c)) return { kind: "file", path: c };
		}
	}

	if (base && !norm.includes("/")) {
		for (const dir of listPackDirs()) {
			const c = path.join(dstRoot, dir, base);
			if (fs.existsSync(c)) return { kind: "file", path: c };
		}
		const src = path.join(srcRoot, "7645", base);
		if (fs.existsSync(src)) return { kind: "file", path: src };
	}

	return null;
}

function unpackOneVfxpack(fileName) {
	if (!unzipSync) {
		console.error(
			"[sync-flower-packs] fflate not found; cannot unpack",
			fileName,
			"(install freefilmcut/apps/web deps first)",
		);
		return null;
	}
	const zipPath = path.join(dstRoot, fileName);
	const buffer = fs.readFileSync(zipPath);
	let unzipped;
	try {
		unzipped = unzipSync(new Uint8Array(buffer));
	} catch (e) {
		console.error("[sync-flower-packs] unzip failed", fileName, e.message || e);
		return null;
	}

	const zipFiles = new Map();
	for (const [raw, bytes] of Object.entries(unzipped)) {
		const rel = stripPackPrefix(raw);
		if (!rel || rel.endsWith("/")) continue;
		zipFiles.set(normalizeZipPath(rel), bytes);
		zipFiles.set(normalizeZipPath(raw), bytes);
	}

	const manifestKey =
		[...zipFiles.keys()].find(
			(k) => k === "manifest.json" || k.endsWith("/manifest.json"),
		) || null;
	if (!manifestKey) {
		console.error("[sync-flower-packs] no manifest.json in", fileName);
		return null;
	}
	const manifest = JSON.parse(
		Buffer.from(zipFiles.get(manifestKey)).toString("utf8"),
	);
	const packType = String(manifest.type || "").toLowerCase();
	if (packType && packType !== "art-text" && packType !== "flower") {
		console.warn(
			"[sync-flower-packs] skip non-flower vfxpack",
			fileName,
			"type=",
			packType,
		);
		return null;
	}

	const sceneRel =
		(manifest.entry && manifest.entry.scene) ||
		(manifest.assets && manifest.assets.scene) ||
		"scene.json";
	const sceneKey =
		[...zipFiles.keys()].find(
			(k) =>
				k === normalizeZipPath(sceneRel) ||
				k.endsWith("/" + path.basename(sceneRel)),
		) || null;
	if (!sceneKey) {
		console.error("[sync-flower-packs] no scene.json in", fileName);
		return null;
	}
	const scene = JSON.parse(
		Buffer.from(zipFiles.get(sceneKey)).toString("utf8"),
	);
	const hits = [];
	findFlowerUi(scene, hits);
	if (hits.length === 0) {
		console.error(
			"[sync-flower-packs] no flowerStyle in scene for",
			fileName,
		);
		return null;
	}
	const ui = hits[0];
	let style = ui.flowerStyle;
	const designFontSize =
		Number(ui.flowerBaseFontSize) > 0
			? Number(ui.flowerBaseFontSize)
			: Number(ui.fontSize) > 0
				? Number(ui.fontSize)
				: 48;

	const id =
		String(manifest.id || "").trim() ||
		slugify(path.basename(fileName, ".vfxpack"));
	const displayName =
		(manifest.i18n &&
			manifest.i18n["zh-CN"] &&
			manifest.i18n["zh-CN"].displayName) ||
		manifest.displayName ||
		id;
	let dir = slugify(String(id).replace(/^freecapcut\./i, ""));
	if (!dir || dir === "7645") dir = slugify(displayName);
	if (dir === "7645") dir = slugify(id);

	const outDir = path.join(dstRoot, dir);
	ensureDir(outDir);

	const texPaths = new Set();
	collectTexturePaths(style, texPaths);
	const remap = new Map();
	for (const texPath of texPaths) {
		const resolved = resolveTextureSource(texPath, zipFiles);
		const fileNameOut = path.basename(normalizeZipPath(texPath));
		if (!resolved) {
			console.warn(
				"[sync-flower-packs] missing texture",
				texPath,
				"in",
				fileName,
			);
			remap.set(texPath, fileNameOut);
			continue;
		}
		const dest = path.join(outDir, fileNameOut);
		if (resolved.kind === "zip") {
			fs.writeFileSync(dest, Buffer.from(zipFiles.get(resolved.key)));
		} else {
			fs.copyFileSync(resolved.path, dest);
		}
		remap.set(texPath, fileNameOut);
	}
	style = rewriteStyleTexturePaths(style, remap);

	const coverCandidates = [
		"preview/cover_icon.png",
		"preview/cover.png",
		"preview/thumb.png",
		"preview/thumb.webp",
		"cover_icon.png",
		"cover.png",
	];
	let hasCover = false;
	for (const c of coverCandidates) {
		const key = [...zipFiles.keys()].find(
			(k) => k === c || k.endsWith("/" + path.basename(c)),
		);
		if (!key) continue;
		fs.writeFileSync(
			path.join(outDir, "cover_icon.png"),
			Buffer.from(zipFiles.get(key)),
		);
		hasCover = true;
		break;
	}
	if (!hasCover) {
		const sampleCover = path.join(dstRoot, "7645", "cover_icon.png");
		const srcCover = path.join(srcRoot, "7645", "cover_icon.png");
		const coverSrc = fs.existsSync(sampleCover)
			? sampleCover
			: fs.existsSync(srcCover)
				? srcCover
				: null;
		if (coverSrc) {
			fs.copyFileSync(coverSrc, path.join(outDir, "cover_icon.png"));
			hasCover = true;
		}
	}

	for (const gifName of [
		"preview/preview.gif",
		"preview/hover.gif",
		"preview.gif",
	]) {
		const key = [...zipFiles.keys()].find(
			(k) => k === gifName || k.endsWith("/" + path.basename(gifName)),
		);
		if (!key) continue;
		fs.writeFileSync(
			path.join(outDir, "preview.gif"),
			Buffer.from(zipFiles.get(key)),
		);
		break;
	}

	const packMeta = {
		id,
		name: String(displayName),
		designFontSize,
		dir,
		sourceVfxpack: fileName,
	};
	writeJson(path.join(outDir, "pack.json"), packMeta);
	writeJson(path.join(outDir, "flowerStyle.json"), style);

	console.log(
		"[sync-flower-packs] unpacked",
		fileName,
		"→",
		dir + "/",
		"id=",
		id,
		"textures=",
		remap.size,
		"cover=",
		hasCover,
	);
	return { id, dir, name: displayName };
}

ensureDir(dstRoot);
if (fs.existsSync(srcRoot)) {
	for (const name of fs.readdirSync(srcRoot)) {
		const s = path.join(srcRoot, name);
		if (!fs.statSync(s).isDirectory()) continue;
		copyDir(s, path.join(dstRoot, name));
		console.log("[sync-flower-packs] copied", name);
	}
} else {
	console.warn("[sync-flower-packs] editor assets missing:", srcRoot);
}

for (const vp of listVfxpacks()) {
	unpackOneVfxpack(vp);
}

const packs = listPackDirs().map(packEntryFromDir);
const index = { version: 1, packs };
writeJson(path.join(dstRoot, "index.json"), index);
console.log(
	"[sync-flower-packs] wrote",
	path.join(dstRoot, "index.json"),
	"packs=",
	packs.length,
);
for (const p of packs) {
	console.log(
		"  -",
		p.id,
		`(${p.name})`,
		`dir=${p.dir}`,
		`style=${p.style}`,
		`cover=${p.cover}`,
	);
}
console.log("[sync-flower-packs] OpenCut folder:", dstRoot);
