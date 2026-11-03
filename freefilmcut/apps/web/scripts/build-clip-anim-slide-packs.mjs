/**
 * Build builtin clip-anim slide packs under public/vfxpacks/clip-anims/.
 * Reuses sticker-anim swipe-left poster + hover GIF for library thumbs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, unzipSync, strToU8 } from "fflate";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");
const publicRoot = path.join(webRoot, "public", "vfxpacks");
const previewSrc = path.join(
	publicRoot,
	"sticker-anims",
	"freecapcut.sticker-anim.swipe-left.vfxpack",
);

const CAM_UUID = "c2222222-2222-4222-8222-222222222222";
const MESH_UUID = "c3333333-3333-4333-8333-333333333333";
const MAT_UUID = "c4444444-4444-4444-8444-444444444444";
const GEO_UUID = "c5555555-5555-4555-8555-555555555555";

const VERT = `varying vec2 vUv;

void main() {
	vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	gl_Position = clip;
	vUv = clip.xy / clip.w * 0.5 + 0.5;
}
`;

const FRAG = `precision mediump float;
uniform sampler2D uInput;
uniform float uSlideX;
uniform float uSlideY;
varying vec2 vUv;

void main() {
	vec2 uv = vUv - vec2(uSlideX, uSlideY);
	if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
		gl_FragColor = vec4(0.0);
		return;
	}
	gl_FragColor = texture2D(uInput, uv);
}
`;

function slideTracks({ keysX, keysY }) {
	return [
		{
			path: `material.${MAT_UUID}.uniforms.uSlideX`,
			interp: "linear",
			keys: keysX,
		},
		{
			path: `material.${MAT_UUID}.uniforms.uSlideY`,
			interp: "linear",
			keys: keysY,
		},
	];
}

const PACKS = [
	{
		phase: "in",
		id: "freecapcut.clip-anim.slide-left",
		displayName: "Slide Left",
		displayNameZh: "向左滑动",
		duration: 0.5,
		tracks: slideTracks({
			keysX: [
				{ t: 0, v: -1, ease: "easeOut" },
				{ t: 0.5, v: 0 },
			],
			keysY: [
				{ t: 0, v: 0 },
				{ t: 0.5, v: 0 },
			],
		}),
	},
	{
		phase: "out",
		id: "freecapcut.clip-anim.slide-left-out",
		displayName: "Slide Left",
		displayNameZh: "向左滑动",
		duration: 0.5,
		tracks: slideTracks({
			keysX: [
				{ t: 0, v: 0, ease: "easeIn" },
				{ t: 0.5, v: -1 },
			],
			keysY: [
				{ t: 0, v: 0 },
				{ t: 0.5, v: 0 },
			],
		}),
	},
	{
		phase: "combo",
		id: "freecapcut.clip-anim.left-then-down",
		displayName: "Left then Down",
		displayNameZh: "先左后下",
		duration: 1,
		tracks: slideTracks({
			keysX: [
				{ t: 0, v: 0, ease: "easeInOut" },
				{ t: 0.5, v: -1 },
				{ t: 1, v: -1 },
			],
			keysY: [
				{ t: 0, v: 0 },
				{ t: 0.5, v: 0, ease: "easeInOut" },
				{ t: 1, v: -1 },
			],
		}),
	},
];

function buildSceneJson({ displayName, duration }) {
	return {
		schema: "vfxpack-scene/1.2",
		name: displayName,
		// Transparent — fill is a sibling under the pack; opaque bg would wipe it.
		background: {
			type: "None",
			value: null,
		},
		environment: { type: "None" },
		fog: null,
		render: {
			rendererType: "WebGLRenderer",
			cameraType: "perspective",
			antialias: false,
			shadows: false,
			shadowType: 0,
			toneMapping: 0,
			toneMappingName: "NoToneMapping",
			toneMappingExposure: 1,
		},
		activeCamera: CAM_UUID,
		resolution: { width: 1920, height: 1080 },
		assets: {
			shaders: [
				{
					name: "ClipSlide",
					vertex: "shaders/slide.vert.glsl",
					fragment: "shaders/slide.frag.glsl",
					raw: false,
				},
			],
			animations: ["animations/slide.anim"],
		},
		nodes: [
			{
				uuid: "c1111111-1111-4111-8111-111111111111",
				name: "Scene",
				kind: "scene",
				type: "Scene",
				visible: true,
				parent: null,
				transform: {
					position: [0, 0, 0],
					rotation: [0, 0, 0],
					quaternion: [0, 0, 0, 1],
					scale: [1, 1, 1],
				},
			},
			{
				uuid: CAM_UUID,
				name: "Camera",
				kind: "camera",
				type: "PerspectiveCamera",
				visible: true,
				parent: null,
				fov: 50,
				aspect: 16 / 9,
				near: 0.1,
				far: 100,
				zoom: 1,
				transform: {
					position: [0, 0, 2],
					rotation: [0, 0, 0],
					quaternion: [0, 0, 0, 1],
					scale: [1, 1, 1],
				},
			},
			{
				uuid: MESH_UUID,
				name: "SlideQuad",
				kind: "mesh",
				type: "Mesh",
				visible: true,
				parent: null,
				transform: {
					position: [0, 0, 0],
					rotation: [0, 0, 0],
					quaternion: [0, 0, 0, 1],
					scale: [1, 1, 1],
				},
				geometry: {
					uuid: GEO_UUID,
					name: "SlideQuad",
					type: "PlaneGeometry",
					parameters: {
						width: 32,
						height: 32,
						widthSegments: 1,
						heightSegments: 1,
					},
				},
				materials: [
					{
						uuid: MAT_UUID,
						name: "ClipSlide",
						type: "ShaderMaterial",
						transparent: true,
						opacity: 1,
						side: 2,
						depthWrite: false,
						depthTest: false,
						color: "#ffffff",
						textures: {},
						uniforms: {
							uInput: { type: "t", value: null, binding: "accumBelow" },
							uSlideX: 0,
							uSlideY: 0,
						},
						shader: {
							vertex: "shaders/slide.vert.glsl",
							fragment: "shaders/slide.frag.glsl",
							raw: false,
						},
					},
				],
			},
		],
		exposedParams: [],
		meta: { duration },
	};
}

function buildManifest(pack) {
	return {
		schema: "vfxpack/1.3",
		id: pack.id,
		version: "1.0.0",
		displayName: pack.displayName,
		engine: { api: "webgl2", renderer: "three" },
		type: "clip-anim",
		phase: pack.phase,
		scope: "below",
		duration: pack.duration,
		resolution: { width: 1920, height: 1080 },
		render: {
			rendererType: "WebGLRenderer",
			cameraType: "perspective",
			antialias: false,
			shadows: false,
			shadowType: 0,
			toneMapping: 0,
			toneMappingName: "NoToneMapping",
			toneMappingExposure: 1,
		},
		entry: { scene: "scene.json" },
		params: [],
		exposedParams: [],
		passes: [
			{
				id: "main",
				shader: {
					vertex: "shaders/slide.vert.glsl",
					fragment: "shaders/slide.frag.glsl",
				},
				inputs: { uInput: "accumBelow" },
			},
		],
		assets: {
			scene: "scene.json",
			textures: [],
			shaders: ["shaders/slide.vert.glsl", "shaders/slide.frag.glsl"],
			animations: ["animations/slide.anim"],
			timelines: [],
			background: null,
			environment: null,
		},
		animations: [
			{
				name: "Slide",
				path: "animations/slide.anim",
				fps: 30,
				duration: pack.duration,
				loop: "clamp",
				objectUuids: [MESH_UUID],
			},
		],
		preview: {
			poster: "preview/poster.png",
			hover: "preview/hover.gif",
		},
		i18n: { "zh-CN": { displayName: pack.displayNameZh } },
		meta: {
			generator: "build-clip-anim-slide-packs.mjs",
			hasCustomShaders: true,
			shaderCount: 1,
			animationCount: 1,
			timelineCount: 0,
		},
	};
}

function main() {
	const bytes = fs.readFileSync(previewSrc);
	const files = unzipSync(bytes);
	const posterKey = Object.keys(files).find((k) =>
		k.replace(/\\/g, "/").endsWith("preview/poster.png"),
	);
	const hoverKey = Object.keys(files).find((k) =>
		k.replace(/\\/g, "/").endsWith("preview/hover.gif"),
	);
	if (!posterKey || !hoverKey) {
		throw new Error("swipe-left pack missing preview/poster.png or hover.gif");
	}
	const poster = files[posterKey];
	const hover = files[hoverKey];

	const byPhase = { in: [], out: [], combo: [] };

	for (const pack of PACKS) {
		const anim = {
			format: "freecapcut.anim/1",
			name: "Slide",
			fps: 30,
			duration: pack.duration,
			loop: "clamp",
			targets: [{ objectUuid: MESH_UUID, tracks: pack.tracks }],
		};
		const zipFiles = {
			"pack/manifest.json": strToU8(JSON.stringify(buildManifest(pack), null, 2)),
			"pack/scene.json": strToU8(JSON.stringify(buildSceneJson(pack), null, 2)),
			"pack/shaders/slide.vert.glsl": strToU8(VERT),
			"pack/shaders/slide.frag.glsl": strToU8(FRAG),
			"pack/animations/slide.anim": strToU8(JSON.stringify(anim, null, 2)),
			"pack/preview/poster.png": poster,
			"pack/preview/hover.gif": hover,
			"INSTALL.txt": strToU8(
				[
					"FreeFilmCut clip-anim pack",
					"",
					`1. Place under freefilmcut/apps/web/public/vfxpacks/clip-anims/${pack.phase}/`,
					"2. Add filename to that folder index.json",
					`3. Hard-refresh → image/video → Animation → ${pack.phase}`,
					"",
				].join("\n"),
			),
		};
		const zipped = zipSync(zipFiles, { level: 6 });
		const outName = `${pack.id}.vfxpack`;
		const outDir = path.join(publicRoot, "clip-anims", pack.phase);
		fs.mkdirSync(outDir, { recursive: true });
		const outPath = path.join(outDir, outName);
		fs.writeFileSync(outPath, zipped);
		byPhase[pack.phase].push(outName);
		console.log("wrote", path.relative(webRoot, outPath), `(${zipped.length} bytes)`);
	}

	for (const phase of ["in", "out", "combo"]) {
		const indexPath = path.join(publicRoot, "clip-anims", phase, "index.json");
		fs.writeFileSync(indexPath, `${JSON.stringify(byPhase[phase], null, 2)}\n`);
		console.log("index", phase, byPhase[phase]);
	}
}

main();
