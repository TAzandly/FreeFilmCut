/**
 * Copy onnxruntime-web + @mediapipe/tasks-vision runtime files into
 * `public/vendor/` so beauty analysis can lazy-load them from the same origin
 * (no jsDelivr). Keeps them out of the Turbopack graph.
 *
 * Run automatically from `dev` / `build`, or: `bun run sync:beauty-vendor`
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");
// Resolve packages as if from apps/web (workspace / bun hoisting).
const require = createRequire(path.join(webRoot, "package.json"));

function pkgRoot(name) {
	let dir = path.dirname(require.resolve(name));
	for (;;) {
		const candidate = path.join(dir, "package.json");
		if (fs.existsSync(candidate)) {
			const pkg = JSON.parse(fs.readFileSync(candidate, "utf8"));
			if (pkg.name === name) return dir;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			throw new Error(`Could not locate package root for ${name}`);
		}
		dir = parent;
	}
}

function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
	ensureDir(path.dirname(dest));
	fs.copyFileSync(src, dest);
	const mb = (fs.statSync(dest).size / (1024 * 1024)).toFixed(2);
	console.log(`  ${path.relative(webRoot, dest)} (${mb} MB)`);
}

function copyDirFiles(srcDir, destDir) {
	ensureDir(destDir);
	for (const name of fs.readdirSync(srcDir)) {
		const src = path.join(srcDir, name);
		if (!fs.statSync(src).isFile()) continue;
		copyFile(src, path.join(destDir, name));
	}
}

function readVersion(pkgName) {
	return JSON.parse(fs.readFileSync(path.join(pkgRoot(pkgName), "package.json"), "utf8"))
		.version;
}

const ortRoot = pkgRoot("onnxruntime-web");
const mpRoot = pkgRoot("@mediapipe/tasks-vision");
const ortDist = path.join(ortRoot, "dist");
const outOrt = path.join(webRoot, "public", "vendor", "onnxruntime-web");
const outMp = path.join(webRoot, "public", "vendor", "mediapipe-tasks-vision");

const ortFiles = [
	"ort.wasm.min.mjs",
	"ort-wasm-simd-threaded.mjs",
	"ort-wasm-simd-threaded.wasm",
];

console.log(
	`[sync-beauty-vendor] onnxruntime-web@${readVersion("onnxruntime-web")} → public/vendor/onnxruntime-web`,
);
for (const name of ortFiles) {
	const src = path.join(ortDist, name);
	if (!fs.existsSync(src)) {
		throw new Error(`Missing ${src}`);
	}
	copyFile(src, path.join(outOrt, name));
}

console.log(
	`[sync-beauty-vendor] @mediapipe/tasks-vision@${readVersion("@mediapipe/tasks-vision")} → public/vendor/mediapipe-tasks-vision`,
);
copyFile(
	path.join(mpRoot, "vision_bundle.mjs"),
	path.join(outMp, "vision_bundle.mjs"),
);
copyDirFiles(path.join(mpRoot, "wasm"), path.join(outMp, "wasm"));

const stamp = {
	syncedAt: new Date().toISOString(),
	onnxruntimeWeb: readVersion("onnxruntime-web"),
	mediapipeTasksVision: readVersion("@mediapipe/tasks-vision"),
};
fs.writeFileSync(
	path.join(webRoot, "public", "vendor", "beauty-vendor.json"),
	`${JSON.stringify(stamp, null, 2)}\n`,
);
console.log("[sync-beauty-vendor] done");
