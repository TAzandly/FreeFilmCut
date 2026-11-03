import fs from 'fs';
import path from 'path';

const ROOT = 'D:/GrokbotWork/FreeCapCutEffect/片段动画/DynamicZoomOut';
fs.mkdirSync(path.join(ROOT, 'assets/shaders'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'assets/animations'), { recursive: true });

const SCENE_UUID = 'd8bc66dc-492a-4fda-a142-9b4b7a67189b';
const CAM_UUID = 'a1b2c3d4-e5f6-4789-a012-3456789abcde';
const CANVAS_UUID = 'b2c3d4e5-f6a7-4890-b123-456789abcdef';
const IMAGE_UUID = 'c3d4e5f6-a7b8-4901-c234-56789abcdef0';
const MESH_UUID = 'd4e5f6a7-b8c9-4012-d345-6789abcdef01';
const GEO_UUID = 'e5f6a7b8-c9d0-4123-e456-789abcdef012';
const MAT_UUID = 'f6a7b8c9-d0e1-4234-f567-89abcdef0123';
const EDITOR_CAM_UUID = '01234567-89ab-4cde-8f01-23456789abcd';

const W = 1920;
const H = 1080;
const DUR = 0.5;

const VERT = `varying vec2 vUv;

void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const FRAG = `// Dynamic Zoom Out — CapCut 动感缩小 port
// Zoom (uZoom 2→1) + radial zoom-blur toward center (uBlurStep).
uniform sampler2D uInput;
uniform sampler2D map;
uniform vec3 color;
uniform vec3 color2;
uniform float opacity;
uniform float uTime;
uniform float useMap;
uniform float uZoom;
uniform float uBlurStep;
uniform vec2 uResolution;
uniform vec2 uScreenTexelSize;
uniform vec4 uScreenParams;
uniform vec4 _ScreenParams;

varying vec2 vUv;

#define NUM 25

float random( in vec3 scale, in float seed ) {
	return fract( sin( dot( gl_FragCoord.xyz + seed, scale ) ) * 43758.5453 + seed );
}

vec2 mirrorUV( vec2 uv ) {
	return vec2( 1.0 - abs( abs( uv.x ) - 1.0 ), 1.0 - abs( abs( uv.y ) - 1.0 ) );
}

void main() {
	float z = max( uZoom, 0.001 );
	vec2 uv = 0.5 + ( vUv - 0.5 ) / z;

	vec4 col = vec4( 0.0 );
	float total = 0.0;
	vec2 toCenter = vec2( 0.5 ) - uv;
	float offset = random( vec3( 12.9898, 78.233, 151.7182 ), 0.0 );

	for ( int t = 0; t <= NUM; t ++ ) {
		float percent = ( float( t ) + offset ) / float( NUM );
		float weight = 4.0 * ( percent - percent * percent );
		vec2 curUV = uv + toCenter * percent * uBlurStep;
		col += texture2D( uInput, mirrorUV( curUV ) ) * weight;
		total += weight;
	}

	vec4 texel = col / max( total, 1e-5 );
	if ( useMap > 0.5 ) {
		texel *= texture2D( map, vUv );
	}
	texel.rgb *= mix( color, color2, vUv.x );
	texel.a *= opacity;

	float inside = step( -0.02, uv.x ) * step( uv.x, 1.02 ) * step( -0.02, uv.y ) * step( uv.y, 1.02 );
	gl_FragColor = texel * inside;
}
`;

fs.writeFileSync(path.join(ROOT, 'assets/shaders/DynamicZoomOut.vert.glsl'), VERT);
fs.writeFileSync(path.join(ROOT, 'assets/shaders/DynamicZoomOut.frag.glsl'), FRAG);

function quarticOut(u) {
	u = Math.min(1, Math.max(0, u));
	return 1 - Math.pow(1 - u, 4);
}
/** CapCut Transform.lua funcEaseBlurAction */
function blurAt(tNorm) {
	return 0.4 * (Math.max(1 - tNorm, 0.4) - 0.4);
}

const zoomKeys = [];
const blurKeys = [];
for (let i = 0; i <= 15; i++) {
	const t = (i / 15) * DUR;
	const u = i / 15;
	zoomKeys.push({ t: +t.toFixed(4), v: +(2 + (1 - 2) * quarticOut(u)).toFixed(5) });
	blurKeys.push({ t: +t.toFixed(4), v: +blurAt(u).toFixed(5) });
}
zoomKeys[zoomKeys.length - 1].v = 1;
blurKeys[blurKeys.length - 1].v = 0;

const anim = {
	format: 'freecapcut.anim/2',
	name: '__fccImageMesh',
	fps: 30,
	duration: DUR,
	loop: 'clamp',
	targets: [
		{
			objectUuid: MESH_UUID,
			tracks: [
				{
					path: `material.${MAT_UUID}.uniforms.uZoom`,
					interp: 'linear',
					keys: zoomKeys,
				},
				{
					path: `material.${MAT_UUID}.uniforms.uBlurStep`,
					interp: 'linear',
					keys: blurKeys,
				},
			],
		},
	],
};
fs.writeFileSync(
	path.join(ROOT, 'assets/animations/__fccImageMesh.anim'),
	JSON.stringify(anim, null, 2),
);

const material = {
	uuid: MAT_UUID,
	type: 'ShaderMaterial',
	name: 'DynamicZoomOut',
	blending: 1,
	side: 0,
	shadowSide: null,
	vertexColors: false,
	opacity: 1,
	transparent: true,
	blendSrc: 204,
	blendDst: 205,
	blendEquation: 100,
	blendSrcAlpha: null,
	blendDstAlpha: null,
	blendEquationAlpha: null,
	blendColor: 0,
	blendAlpha: 0,
	depthFunc: 3,
	depthTest: true,
	depthWrite: false,
	colorWrite: true,
	clipIntersection: false,
	clipShadows: false,
	stencilWriteMask: 255,
	stencilFunc: 519,
	stencilRef: 0,
	stencilFuncMask: 255,
	stencilFail: 7680,
	stencilZFail: 7680,
	stencilZPass: 7680,
	stencilWrite: false,
	polygonOffset: false,
	polygonOffsetFactor: 0,
	polygonOffsetUnits: 0,
	dithering: false,
	alphaTest: 0,
	alphaHash: false,
	alphaToCoverage: false,
	premultipliedAlpha: false,
	forceSinglePass: false,
	allowOverride: true,
	visible: true,
	toneMapped: true,
	linewidth: 1,
	wireframe: false,
	wireframeLinewidth: 1,
	fog: false,
	userData: {
		freecapcutGlobalScreen: true,
		freecapcutShaderFiles: {
			vertex: 'assets/shaders/DynamicZoomOut.vert.glsl',
			fragment: 'assets/shaders/DynamicZoomOut.frag.glsl',
		},
	},
	glslVersion: null,
	uniforms: {
		uInput: { type: 't', value: null },
		map: { value: null },
		color: { type: 'c', value: 16777215 },
		color2: { type: 'c', value: 16777215 },
		opacity: { value: 1 },
		uTime: { value: 0 },
		useMap: { value: false },
		uZoom: { value: 2 },
		uBlurStep: { value: 0.24 },
		uResolution: { type: 'v2', value: [W, H] },
		uScreenTexelSize: { type: 'v2', value: [1 / W, 1 / H] },
		uScreenParams: { type: 'v4', value: [W, H, 1 + 1 / W, 1 + 1 / H] },
		_ScreenParams: { type: 'v4', value: [W, H, 1 + 1 / W, 1 + 1 / H] },
	},
	vertexShader: VERT,
	fragmentShader: FRAG,
	lights: false,
	clipping: false,
};

const geometry = {
	uuid: GEO_UUID,
	type: 'PlaneGeometry',
	width: W,
	height: H,
	widthSegments: 1,
	heightSegments: 1,
};

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const fov = 50;
const planeDist = 1;
const visibleH = 2 * Math.tan(((fov * Math.PI) / 180) / 2) * planeDist;
const uiScale = visibleH / H;
const canvasMatrix = [
	uiScale, 0, 0, 0,
	0, uiScale, 0, 0,
	0, 0, uiScale, 0,
	0, 0, -planeDist, 1,
];
const imageMatrix = [
	1, 0, 0, 0,
	0, 1, 0, 0,
	0, 0, 1, 0,
	W / 2, H / 2, 0, 1,
];

const project = {
	metadata: {
		title: 'DynamicZoomOut',
		type: 'App',
		version: 4.7,
		generator: 'FreeFilmCut.DynamicZoomOut',
	},
	project: {
		title: 'DynamicZoomOut',
		name: 'DynamicZoomOut',
		editable: false,
		vr: false,
		camera: 'perspective',
		renderer: 'WebGLRenderer',
		antialias: true,
		shadows: false,
		shadowType: 1,
		toneMapping: 0,
		toneMappingExposure: 1,
		resolution: { width: W, height: H, showFrame: true },
		vfxpack: {
			type: 'clip-anim',
			stickerAnimPhase: 'in',
			previewPoster: '',
			previewPosterName: '',
			previewHover: '',
			previewHoverName: '',
		},
		previewExport: {
			width: 256,
			height: 256,
			fps: 10,
			maxKB: 800,
			speed: 1,
			pingpong: false,
		},
		animPreviewTime: 0,
	},
	camera: {
		metadata: { version: 4.7, type: 'Object', generator: 'Object3D.toJSON' },
		object: {
			uuid: EDITOR_CAM_UUID,
			type: 'PerspectiveCamera',
			name: 'Camera',
			layers: 1,
			matrix: identity,
			fov: 50,
			zoom: 1,
			near: 0.1,
			far: 2000,
			focus: 10,
			aspect: W / H,
			filmGauge: 35,
			filmOffset: 0,
			up: [0, 1, 0],
		},
	},
	controls: { center: [0, 0, 0] },
	scene: {
		metadata: { version: 4.7, type: 'Object', generator: 'Object3D.toJSON' },
		geometries: [geometry],
		materials: [material],
		object: {
			uuid: SCENE_UUID,
			type: 'Scene',
			name: 'Scene',
			layers: 1,
			matrix: identity,
			up: [0, 1, 0],
			background: null,
			environment: null,
			userData: { fccAudioListener: { volume: 1, muted: false } },
			children: [
				{
					uuid: CAM_UUID,
					type: 'PerspectiveCamera',
					name: 'PerspectiveCamera',
					layers: 1,
					matrix: identity,
					up: [0, 1, 0],
					fov: 50,
					zoom: 1,
					near: 0.1,
					far: 2000,
					focus: 10,
					aspect: W / H,
					filmGauge: 35,
					filmOffset: 0,
					userData: {
						postProcessStack: {
							enabled: true,
							effects: [],
							_bloomThresholdMigrated: true,
						},
					},
				},
				{
					uuid: CANVAS_UUID,
					type: 'Group',
					name: 'Canvas',
					layers: 4,
					matrix: canvasMatrix,
					frustumCulled: false,
					userData: {
						fccUI: {
							type: 'canvas',
							renderMode: 'camera',
							cameraUuid: CAM_UUID,
							planeDistance: planeDist,
							anchorMin: [0, 0],
							anchorMax: [1, 1],
							pivot: [0.5, 0.5],
							anchoredPosition: [0, 0],
							sizeDelta: [0, 0],
							localEulerAngles: [0, 0, 0],
							localScale: [1, 1, 1],
							_resolved: { w: W, h: H },
						},
					},
					children: [
						{
							uuid: IMAGE_UUID,
							type: 'Group',
							name: 'Image',
							layers: 4,
							matrix: imageMatrix,
							frustumCulled: false,
							userData: {
								fccUI: {
									type: 'image',
									anchorMin: [0, 0],
									anchorMax: [1, 1],
									pivot: [0.5, 0.5],
									anchoredPosition: [0, 0],
									sizeDelta: [0, 0],
									localEulerAngles: [0, 0, 0],
									localScale: [1, 1, 1],
								},
							},
							children: [
								{
									uuid: MESH_UUID,
									type: 'Mesh',
									name: '__fccImageMesh',
									layers: 4,
									matrix: identity,
									geometry: GEO_UUID,
									material: MAT_UUID,
									frustumCulled: false,
									userData: {
										freecapcutAnimController: {
											enabled: true,
											clipId: '__fccImageMesh',
										},
									},
								},
							],
						},
					],
				},
			],
		},
	},
	scripts: {},
	freecapcut: {
		format: 'freecapcut.project-anims/1',
		activeAnimName: '__fccImageMesh',
		animations: [anim],
		index: [
			{
				name: '__fccImageMesh',
				path: 'assets/animations/__fccImageMesh.anim',
				fps: 30,
				duration: DUR,
			},
		],
	},
	history: { undos: [], redos: [] },
	backgroundType: 'None',
	environmentType: 'None',
};

fs.writeFileSync(path.join(ROOT, 'project.json'), JSON.stringify(project));
console.log('wrote', path.join(ROOT, 'project.json'), 'bytes', fs.statSync(path.join(ROOT, 'project.json')).size);
console.log('zoom', zoomKeys.filter((_, i) => i % 5 === 0));
console.log('blur', blurKeys.filter((_, i) => i % 5 === 0));
