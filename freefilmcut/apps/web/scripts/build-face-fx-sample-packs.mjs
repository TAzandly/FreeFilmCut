/**
 * Build builtin face-fx sample packs under public/vfxpacks/face-fx/.
 * Runtime is GPU (warp / eyeRay / procedural ears) — packs only need manifest.faceFx.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");
const outDir = path.join(webRoot, "public", "vfxpacks", "face-fx");

const PACKS = [
	{
		id: "freecapcut.face-fx.funhouse-bulge",
		displayName: "Funhouse Bulge",
		displayNameZh: "哈哈镜鼓腮",
		faceFx: {
			driver: { landmarks: true, transformationMatrix: true, maxFaces: 4 },
			layers: [
				{
					id: "bulge",
					kind: "warp2d",
					preset: "bulge",
					strength: 0.85,
					region: "face",
				},
			],
		},
	},
	{
		id: "freecapcut.face-fx.eye-laser",
		displayName: "Eye Laser",
		displayNameZh: "双眼镭射",
		faceFx: {
			driver: { landmarks: true, transformationMatrix: true, maxFaces: 4 },
			layers: [
				{
					id: "laser",
					kind: "eyeRay",
					color: "#ff2244",
					length: 2.2,
					width: 0.012,
				},
			],
		},
	},
	{
		id: "freecapcut.face-fx.rabbit-ears",
		displayName: "Rabbit Ears",
		displayNameZh: "兔耳朵",
		embedGlb: true,
		faceFx: {
			driver: { landmarks: true, transformationMatrix: true, maxFaces: 4 },
			layers: [
				{
					id: "ears",
					kind: "anchor3d",
					asset: "models/rabbit_ears.glb",
					bind: "forehead",
					offset: [0, 0.02, 0],
					scale: 1,
				},
			],
		},
	},
	{
		id: "freecapcut.face-fx.party-combo",
		displayName: "Party Combo",
		displayNameZh: "派对组合",
		embedGlb: true,
		faceFx: {
			driver: { landmarks: true, transformationMatrix: true, maxFaces: 4 },
			layers: [
				{
					id: "ears",
					kind: "anchor3d",
					asset: "models/rabbit_ears.glb",
					bind: "forehead",
					offset: [0, 0.02, 0],
					scale: 1,
				},
				{
					id: "laser",
					kind: "eyeRay",
					color: "#00e5ff",
					length: 1.8,
					width: 0.01,
				},
				{
					id: "wave",
					kind: "warp2d",
					preset: "wave",
					strength: 0.55,
					region: "face",
				},
			],
		},
	},
];

function buildManifest(pack) {
	return {
		schema: "vfxpack/1.4",
		id: pack.id,
		version: "1.0.0",
		displayName: pack.displayName,
		engine: { api: "webgl2", renderer: "three" },
		type: "face-fx",
		scope: "below",
		resolution: { width: 1920, height: 1080 },
		faceFx: pack.faceFx,
		entry: {},
		params: [
			{
				key: "intensity",
				label: "Intensity",
				type: "float",
				default: 1,
				min: 0,
				max: 1,
			},
		],
		exposedParams: [
			{
				key: "intensity",
				label: "Intensity",
				type: "float",
				default: 1,
				min: 0,
				max: 1,
			},
		],
		assets: {},
		i18n: { "zh-CN": { displayName: pack.displayNameZh } },
		meta: {
			generator: "build-face-fx-sample-packs.mjs",
			proceduralAnchors: true,
		},
	};
}

function main() {
	fs.mkdirSync(outDir, { recursive: true });
	const glbPath = path.join(outDir, "models", "rabbit_ears.glb");
	const glbBytes = fs.existsSync(glbPath) ? fs.readFileSync(glbPath) : null;
	const names = [];
	for (const pack of PACKS) {
		const manifest = buildManifest(pack);
		const files = {
			"pack/manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
			"INSTALL.txt": strToU8(
				[
					"FreeFilmCut face-fx pack",
					"",
					`id: ${pack.id}`,
					"Drag onto the timeline effect track (scope: below).",
					"Needs a face in the layers underneath.",
					"",
				].join("\n"),
			),
		};
		if (pack.embedGlb && glbBytes) {
			files["pack/models/rabbit_ears.glb"] = new Uint8Array(glbBytes);
		}
		const zipped = zipSync(files, { level: 6 });
		const fileName = `${pack.id}.vfxpack`;
		fs.writeFileSync(path.join(outDir, fileName), zipped);
		names.push(fileName);
		console.log("wrote", fileName, `(${zipped.length} bytes)`);
	}
	fs.writeFileSync(
		path.join(outDir, "index.json"),
		`${JSON.stringify(names, null, 2)}\n`,
	);
	console.log("index", names);
}

main();
