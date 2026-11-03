const fs = require("fs");
const p = "freefilmcut/apps/web/src/vfxpack/flower-pack-catalog.ts";
let s = fs.readFileSync(p, "utf8");
const old = `function blobUrlFromBytes(bytes: Uint8Array, pathHint: string): string {
	const ab = bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	);
	return URL.createObjectURL(new Blob([ab], { type: mimeForPath(pathHint) }));
}`;
const neu = `function blobUrlFromBytes(bytes: Uint8Array, pathHint: string): string {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return URL.createObjectURL(
		new Blob([copy], { type: mimeForPath(pathHint) }),
	);
}`;
if (!s.includes(old)) {
  console.log("old blob fn not found exactly");
  const i = s.indexOf("function blobUrlFromBytes");
  console.log(JSON.stringify(s.slice(i, i + 280)));
} else {
  s = s.split(old).join(neu);
  fs.writeFileSync(p, s);
  console.log("blob fn patched");
}
