import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mock } from "bun:test";
import * as bg from "opencut-wasm/opencut_wasm_bg.js";

const wasmPath = join(
	import.meta.dir,
	"node_modules/opencut-wasm/opencut_wasm_bg.wasm",
);
const bytes = readFileSync(wasmPath);
const { instance } = await WebAssembly.instantiate(bytes, {
	"./opencut_wasm_bg.js": bg,
});
bg.__wbg_set_wasm(instance.exports);
const start = instance.exports.__wbindgen_start;
if (typeof start === "function") {
	start();
}

mock.module("opencut-wasm/opencut_wasm.js", () => bg);
mock.module("opencut-wasm", () => bg);

if (typeof globalThis.ImageData === "undefined") {
	class ImageDataPolyfill {
		data: Uint8ClampedArray;
		width: number;
		height: number;
		constructor(
			data: Uint8ClampedArray,
			width: number,
			height?: number,
		) {
			this.data = data;
			this.width = width;
			this.height = height ?? Math.floor(data.length / (4 * width));
		}
	}
	globalThis.ImageData = ImageDataPolyfill as typeof ImageData;
}
