import { readFileSync } from "fs";
import { unzipSync } from "fflate";
import { fileURLToPath } from "url";
import path from "path";

const packPath =
	"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/public/flower/freecapcut.flower_7528279603777998133.vfxpack";
const bytes = new Uint8Array(readFileSync(packPath));
const unzipped = unzipSync(bytes);

function stripPackPrefix(p) {
	const n = String(p || "").replace(/\\/g, "/");
	if (n.startsWith("pack/")) return n.slice(5);
	return n;
}

const files = new Map();
for (const [raw, data] of Object.entries(unzipped)) {
	const rel = stripPackPrefix(raw);
	if (!rel || rel.endsWith("/")) continue;
	files.set(rel, data);
	files.set(raw.replace(/\\/g, "/"), data);
}

const scene = JSON.parse(
	new TextDecoder().decode(files.get("scene.json") || files.get("pack/scene.json")),
);

function findFlower(node, hits) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const x of node) findFlower(x, hits);
		return;
	}
	const ud = node.userData?.fccUI;
	if (ud?.type === "text" && ud.flowerStyle) hits.push(ud);
	else if (node.ui?.type === "text" && node.ui.flowerStyle) hits.push(node.ui);
	for (const v of Object.values(node)) findFlower(v, hits);
}

const hits = [];
findFlower(scene, hits);
const rawStyle = hits[0]?.flowerStyle;
console.log("hits", hits.length);

const textureUrlByBasename = new Map();
for (const [zipPath, data] of files) {
	const norm = zipPath.replace(/\\/g, "/");
	if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(norm)) continue;
	const leaf = norm.split("/").pop() || norm;
	if (!textureUrlByBasename.has(leaf)) {
		textureUrlByBasename.set(leaf, `BLOB(${leaf}) size=${data.byteLength}`);
	}
	const m = leaf.match(/^flower_\d+_(.+)$/i);
	if (m?.[1] && !textureUrlByBasename.has(m[1])) {
		textureUrlByBasename.set(m[1], textureUrlByBasename.get(leaf));
	}
}
console.log("indexed leaves", [...textureUrlByBasename.keys()]);

const stemOf = (s) =>
	String(s || "")
		.replace(/\\/g, "/")
		.split("/")
		.pop()
		.replace(/\.(png|jpe?g|webp|gif|bmp)$/i, "");

function resolveTexUrl(path, fileName) {
	const candidates = [fileName, path.replace(/\\/g, "/").split("/").pop() || ""].filter(
		Boolean,
	);
	for (const base of candidates) {
		const hit = textureUrlByBasename.get(base);
		if (hit) return hit;
		const stem = stemOf(base);
		for (const [k, url] of textureUrlByBasename) {
			const ks = stemOf(k);
			if (
				k === base ||
				ks === stem ||
				k.endsWith("_" + base) ||
				k.endsWith("_" + stem) ||
				ks.endsWith("_" + stem)
			) {
				return url;
			}
		}
	}
	return null;
}

function walk(o, label) {
	if (!o || typeof o !== "object") return;
	if (Array.isArray(o)) {
		o.forEach((x, i) => walk(x, `${label}[${i}]`));
		return;
	}
	if (o.renderType === "texture" || o.texture) {
		const t = o.texture || o;
		if (t.path) {
			const resolved = resolveTexUrl(t.path, t.fileName);
			console.log(label, {
				path: t.path,
				fileName: t.fileName,
				resolved: resolved || "NULL",
			});
		}
	}
	for (const [k, v] of Object.entries(o)) walk(v, `${label}.${k}`);
}
walk(rawStyle, "style");
