import pathlib, re, sys

def patch(path, pairs):
    p = pathlib.Path(path)
    s = p.read_text(encoding="utf-8")
    orig = s
    for pattern, repl, label in pairs:
        news, n = re.subn(pattern, repl, s, count=1, flags=re.M)
        if n != 1:
            print("FAIL", path, label, "n=", n)
            sys.exit(1)
        s = news
        print("OK", label)
    p.write_text(s, encoding="utf-8")
    print("wrote", path, "delta", len(s)-len(orig))

# text-template-media.ts: drive seek on whole root; bind by rtTargetUuid; bump header
patch(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/text-template-media.ts", [
(
r'\* Text-template MediaFramePlayer \(fcc-tl-flower-17\)',
r'* Text-template MediaFramePlayer (fcc-tl-flower-18)',
"header rev",
),
(
r'''export function driveTextTemplateMedia\(\{
	renderer,
	root,
	mediaTimeSec,
	playing,
	clipKey,
\}: \{
	renderer: THREE\.WebGLRenderer;
	root: THREE\.Object3D;
	mediaTimeSec: number;
	playing\?: boolean;
	clipKey\?: string;
\}\): void \{
	const host = root\.getObjectByName\(MEDIA_HOST\);
	if \(!host\) return;

	host\.traverse\(\(obj\) => \{
		const ud = obj\.userData as \{
			__fccVideo\?: HTMLVideoElement;
			__fccMediaCache\?: unknown;
			fccVideoPlayer\?: \{ loop\?: boolean \};
		\};
		if \(!ud\.__fccVideo && !ud\.__fccMediaCache\) return;
		seekPackTimelineVideo\(obj, mediaTimeSec, \{
			loop: ud\.fccVideoPlayer\?\.loop !== false,
			playing: playing === true,
			clipKey: clipKey \|\| "",
		\}\);
	\}\);''',
r'''export function driveTextTemplateMedia({
	renderer,
	root,
	mediaTimeSec,
	playing,
	clipKey,
}: {
	renderer: THREE.WebGLRenderer;
	root: THREE.Object3D;
	mediaTimeSec: number;
	playing?: boolean;
	clipKey?: string;
}): void {
	const host = root.getObjectByName(MEDIA_HOST);
	if (!host) return;

	// Seek every attached gif/seq/video on the flower root (not only host children).
	// Ensures __fccMediaTime advances even if a player was parented outside MEDIA_HOST.
	root.traverse((obj) => {
		const ud = obj.userData as {
			__fccVideo?: HTMLVideoElement;
			__fccMediaCache?: unknown;
			fccVideoPlayer?: { loop?: boolean };
		};
		if (!ud.__fccVideo && !ud.__fccMediaCache) return;
		seekPackTimelineVideo(obj, mediaTimeSec, {
			loop: ud.fccVideoPlayer?.loop !== false,
			playing: playing === true,
			clipKey: clipKey || "",
		});
	});''',
"drive seek whole root",
),
(
r'''export function bindLiveMediaToStickers\(\{
	root,
\}: \{
	root: THREE\.Object3D;
\}\): void \{
	const host = root\.getObjectByName\(MEDIA_HOST\);
	if \(!host\) return;
	const liveByPath = new Map<string, THREE\.Texture>\(\);
	host\.traverse\(\(obj\) => \{
		const ud = obj\.userData as \{
			__fccMediaCache\?: \{ texture\?: THREE\.Texture \};
			__fccVideoTexture\?: THREE\.VideoTexture;
			fccVideoPlayer\?: \{ path\?: string; projectPath\?: string; kind\?: string \};
		\};
		const pathRaw = String\(
			ud\.fccVideoPlayer\?\.path \|\| ud\.fccVideoPlayer\?\.projectPath \|\| "",
		\);
		if \(!pathRaw\) return;
		const path = pathRaw\.replace\(/\\\\/g, "/"\)\.replace\(/\\/\$/, ""\);
		const tex =
			ud\.__fccMediaCache\?\.texture \|\|
			ud\.__fccVideoTexture \|\|
			null;
		if \(tex\) \{
			liveByPath\.set\(path\.replace\(/\^pack\\//, ""\), tex\);
			liveByPath\.set\(path, tex\);
			// Also accept trailing-slash keys from authored texturePackPath\.
			liveByPath\.set\(path \+ "/", tex\);
			liveByPath\.set\(path\.replace\(/\^pack\\//, ""\) \+ "/", tex\);
		\}
	\}\);
	if \(!liveByPath\.size\) return;

	root\.traverse\(\(obj\) => \{
		const ud = obj\.userData as \{
			__fccTextSticker\?: boolean;
			__fccStickerData\?: \{ texturePackPath\?: string; texturePath\?: string \};
		\};
		if \(!ud\.__fccTextSticker \|\| !ud\.__fccStickerData\) return;
		const packPathRaw = String\(
			ud\.__fccStickerData\.texturePackPath \|\| "",
		\);
		const packPath = packPathRaw\.replace\(/\\\\/g, "/"\)\.replace\(/\\/\$/, ""\);
		const tex =
			\(packPath && liveByPath\.get\(packPath\.replace\(/\^pack\\//, ""\)\)\) \|\|
			\(packPath && liveByPath\.get\(packPath\)\) \|\|
			\(packPath && liveByPath\.get\(packPath \+ "/"\)\) \|\|
			\(packPathRaw && liveByPath\.get\(packPathRaw\)\) \|\|
			null;
		if \(!tex\) return;''',
r'''export function bindLiveMediaToStickers({
	root,
}: {
	root: THREE.Object3D;
}): void {
	const host = root.getObjectByName(MEDIA_HOST);
	if (!host) return;
	const liveByPath = new Map<string, THREE.Texture>();
	const liveByRt = new Map<string, THREE.Texture>();
	// Live RT textures (seq/gif blit target) — stickers with rtTargetUuid bind here.
	root.traverse((obj) => {
		const rt = (obj.userData as { __fccRT?: THREE.WebGLRenderTarget }).__fccRT;
		if (rt) liveByRt.set(obj.uuid, rt.texture);
	});
	host.traverse((obj) => {
		const ud = obj.userData as {
			__fccMediaCache?: { texture?: THREE.Texture };
			__fccVideoTexture?: THREE.VideoTexture;
			fccVideoPlayer?: {
				path?: string;
				projectPath?: string;
				kind?: string;
				targetUuid?: string;
			};
		};
		const pathRaw = String(
			ud.fccVideoPlayer?.path || ud.fccVideoPlayer?.projectPath || "",
		);
		const tex =
			ud.__fccMediaCache?.texture ||
			ud.__fccVideoTexture ||
			(ud.fccVideoPlayer?.targetUuid
				? liveByRt.get(String(ud.fccVideoPlayer.targetUuid))
				: null) ||
			null;
		if (!tex) return;
		if (pathRaw) {
			const path = pathRaw.replace(/\\/g, "/").replace(/\/$/, "");
			liveByPath.set(path.replace(/^pack\//, ""), tex);
			liveByPath.set(path, tex);
			liveByPath.set(path + "/", tex);
			liveByPath.set(path.replace(/^pack\//, "") + "/", tex);
		}
		const tu = ud.fccVideoPlayer?.targetUuid;
		if (tu) liveByPath.set("rt:" + tu, tex);
	});
	if (!liveByPath.size && !liveByRt.size) return;

	root.traverse((obj) => {
		const ud = obj.userData as {
			__fccTextSticker?: boolean;
			__fccStickerData?: {
				texturePackPath?: string;
				texturePath?: string;
				rtTargetUuid?: string;
			};
		};
		if (!ud.__fccTextSticker || !ud.__fccStickerData) return;
		const packPathRaw = String(
			ud.__fccStickerData.texturePackPath || "",
		);
		const packPath = packPathRaw.replace(/\\/g, "/").replace(/\/$/, "");
		const rtUuid = String(ud.__fccStickerData.rtTargetUuid || "");
		const tex =
			(rtUuid && liveByRt.get(rtUuid)) ||
			(rtUuid && liveByPath.get("rt:" + rtUuid)) ||
			(packPath && liveByPath.get(packPath.replace(/^pack\//, ""))) ||
			(packPath && liveByPath.get(packPath)) ||
			(packPath && liveByPath.get(packPath + "/")) ||
			(packPathRaw && liveByPath.get(packPathRaw)) ||
			null;
		if (!tex) return;''',
"bindLiveMedia rtTargetUuid",
),
])

print("text-template-media done")