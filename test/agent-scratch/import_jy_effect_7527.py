"""Scaffold FreeFilmCut editor project from CapCut AmazingFeature pack 7527348874965519678.

Always embeds a static preview plane (visible even without folder bind).
Sequence MediaFramePlayers animate after 绑定工程文件夹.
"""
from __future__ import annotations

import base64
import json
import shutil
import uuid
from pathlib import Path

SRC = Path(
	r"C:\Users\pc\AppData\Local\JianyingPro\User Data\Cache\effect"
	r"\7527348874965519678\509bffdd80b86d977ee83707116c229d"
)
AF = SRC / "AmazingFeature"
OUT = Path(r"D:\GrokbotWork\FreeCapCutEffect\特效\7527348874965519678")
FPS = 30.0
DURATION = 3.0
RES = 540
PLANE_SCALE = 1.7

LAYERS = [
	("zhipai1", "zhipai1", 0, 37, False),
	("zhipai2", "zhipai2", 37, 22, False),
	("zhipaiback", "zhipaiback", 59, 31, False),
	("guang", "guang", 37, 53, True),
]


def uid() -> str:
	return str(uuid.uuid4())


def data_url_png(path: Path) -> str:
	return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


# ObjectLoader treats url "{}" as a relative fetch → /editor/%7B%7D 404 and fromJSON fails.
_TINY_PNG = bytes.fromhex(
	"89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
	"0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)
TINY_PNG_DATA_URL = "data:image/png;base64," + base64.b64encode(_TINY_PNG).decode("ascii")


def main() -> None:
	if OUT.exists():
		for sub in ("assets", "docs"):
			p = OUT / sub
			if p.exists():
				shutil.rmtree(p)
	else:
		OUT.mkdir(parents=True)

	seq_root = OUT / "assets" / "sequences"
	seq_root.mkdir(parents=True)
	for _name, folder, *_rest in LAYERS:
		src = AF / "resource" / "seq" / folder
		dst = seq_root / folder
		shutil.copytree(src, dst)
		for f in dst.glob("*.seq"):
			f.unlink()
		print(f"copied {folder}: {len(list(dst.glob('*.png')))} pngs")

	img_dst = OUT / "assets" / "images"
	img_dst.mkdir(parents=True)
	still = AF / "resource" / "images" / "zhipai3_00089.png"
	if still.exists():
		shutil.copy2(still, img_dst / still.name)

	poster_src = AF / "resource" / "seq" / "zhipai1" / "zhipai1_00018.png"
	(OUT / "assets" / "preview").mkdir(parents=True)
	poster_rel = "assets/preview/poster.png"
	shutil.copy2(poster_src, OUT / poster_rel)
	poster_data = data_url_png(poster_src)

	# --- scene ids ---
	editor_cam_uuid = uid()
	scene_cam_uuid = uid()
	scene_uuid = uid()
	tl_uuid = uid()
	geo_uuid = uid()
	preview_mesh_uuid = uid()
	preview_mat_uuid = uid()
	preview_tex_uuid = uid()
	preview_img_uuid = uid()

	children: list[dict] = []
	geometries = [
		{
			"uuid": geo_uuid,
			"type": "PlaneGeometry",
			"width": 1,
			"height": 1,
			"widthSegments": 1,
			"heightSegments": 1,
		}
	]
	materials: list[dict] = []
	textures: list[dict] = []
	images: list[dict] = []
	timeline_tracks: list[dict] = []
	layer_meta: list[dict] = []

	# Static preview — always visible without projectFolder / RT
	images.append({"uuid": preview_img_uuid, "url": poster_data})
	textures.append(
		{
			"uuid": preview_tex_uuid,
			"name": "preview_still",
			"image": preview_img_uuid,
			"mapping": 300,
			"channel": 0,
			"repeat": [1, 1],
			"offset": [0, 0],
			"center": [0, 0],
			"rotation": 0,
			"wrap": [1001, 1001],
				"format": 1023,
				"type": 1009,
				"colorSpace": "srgb",
				"minFilter": 1006,
				"magFilter": 1006,
				"anisotropy": 1,
				"flipY": True,
			"generateMipmaps": False,
			"premultiplyAlpha": False,
			"unpackAlignment": 4,
		}
	)
	materials.append(
		{
			"uuid": preview_mat_uuid,
			"type": "MeshBasicMaterial",
			"name": "Mat_preview",
			"color": 16777215,
			"opacity": 1,
			"transparent": True,
			"depthTest": True,
			"depthWrite": False,
			"side": 2,
			"blending": 1,
			"map": preview_tex_uuid,
		}
	)
	children.append(
		{
			"uuid": preview_mesh_uuid,
			"type": "Mesh",
			"name": "PreviewStill",
			"layers": 1,
			"matrix": [
				PLANE_SCALE,
				0,
				0,
				0,
				0,
				PLANE_SCALE,
				0,
				0,
				0,
				0,
				1,
				0,
				0,
				0,
				-0.01,
				1,
			],
			"up": [0, 1, 0],
			"geometry": geo_uuid,
			"material": preview_mat_uuid,
			"userData": {
				"fccEffectLayer": "preview-still",
				"fccNote": "Always-on still so the project is not empty before sequences hydrate",
			},
		}
	)

	for i, (name, folder, start_f, nframes, additive) in enumerate(LAYERS):
		start = start_f / FPS
		dur = nframes / FPS
		player_uuid = uid()
		rt_uuid = uid()
		mesh_uuid = uid()
		mat_uuid = uid()
		tex_uuid = uid()
		img_uuid = uid()
		dir_rel = f"assets/sequences/{folder}"

		children.append(
			{
				"uuid": player_uuid,
				"type": "Object3D",
				"name": f"Seq_{name}",
				"layers": 1,
				"matrix": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
				"up": [0, 1, 0],
				"userData": {
					"fccVideoPlayer": {
						"kind": "imageSequence",
						"loop": False,
						"muted": True,
						"volume": 0,
						# playing true → viewport blits frames without Timeline ownership
						"playing": True,
						"playbackRate": 1,
						"autoplay": True,
						"targetUuid": rt_uuid,
						"fileName": f"{folder} ({nframes} frames)",
						"projectPath": dir_rel,
						"sequenceDir": dir_rel,
						"sequenceFps": 30,
						"sequenceStart": 0,
						"sequenceEnd": -1,
					}
				},
			}
		)
		children.append(
			{
				"uuid": rt_uuid,
				"type": "Object3D",
				"name": f"RT_{name}",
				"layers": 1,
				"matrix": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
				"up": [0, 1, 0],
				"userData": {
					"fccRenderTexture": {
						"width": 512,
						"height": 512,
						"wrapMode": "clamp",
					}
				},
			}
		)
		z = 0.001 * (i + 1)
		children.append(
			{
				"uuid": mesh_uuid,
				"type": "Mesh",
				"name": f"Plane_{name}",
				"layers": 1,
				"matrix": [
					PLANE_SCALE,
					0,
					0,
					0,
					0,
					PLANE_SCALE,
					0,
					0,
					0,
					0,
					1,
					0,
					0,
					0,
					z,
					1,
				],
				"up": [0, 1, 0],
				"geometry": geo_uuid,
				"material": mat_uuid,
				"userData": {
					"fccEffectLayer": name,
					"fccEffectPackId": "7527348874965519678",
				},
			}
		)
		materials.append(
			{
				"uuid": mat_uuid,
				"type": "MeshBasicMaterial",
				"name": f"Mat_{name}",
				"color": 16777215,
				"opacity": 1,
				"transparent": True,
				"depthTest": False,
				"depthWrite": False,
				"side": 2,
				"blending": 2 if additive else 1,
				"map": tex_uuid,
			}
		)
		textures.append(
			{
				"uuid": tex_uuid,
				"name": f"RT_{name}",
				"image": img_uuid,
				"mapping": 300,
				"channel": 0,
				"repeat": [1, 1],
				"offset": [0, 0],
				"center": [0, 0],
				"rotation": 0,
				"wrap": [1001, 1001],
				"format": 1023,
				"type": 1009,
				"colorSpace": "srgb",
				"minFilter": 1006,
				"magFilter": 1006,
				"anisotropy": 1,
				"flipY": False,
				"generateMipmaps": False,
				"premultiplyAlpha": False,
				"unpackAlignment": 4,
				"userData": {
					"fccRenderTextureUuid": rt_uuid,
					"fccHasAlpha": True,
				},
			}
		)
		images.append({"uuid": img_uuid, "url": TINY_PNG_DATA_URL})

		timeline_tracks.append(
			{
				"id": uid(),
				"type": "video",
				"name": f"Video_{name}",
				"muted": False,
				"bindingUuid": player_uuid,
				"videoPlayerUuid": player_uuid,
				"clips": [
					{
						"id": uid(),
						"start": start,
						"duration": dur,
						"mediaOffset": 0,
						"loop": False,
					}
				],
			}
		)
		layer_meta.append(
			{
				"name": name,
				"sequenceDir": dir_rel,
				"frames": nframes,
				"startSec": start,
				"durationSec": dur,
				"additive": additive,
				"playerUuid": player_uuid,
				"meshUuid": mesh_uuid,
			}
		)

	children.append(
		{
			"uuid": tl_uuid,
			"type": "Object3D",
			"name": "Timeline",
			"layers": 1,
			"matrix": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
			"up": [0, 1, 0],
			"userData": {
				"fccTimeline": {
					"projectPath": "assets/timelines/timeline.timeline.json",
					"active": True,
					"fps": 30,
					"duration": DURATION,
					"loop": "clamp",
				}
			},
		}
	)
	children.append(
		{
			"uuid": scene_cam_uuid,
			"type": "PerspectiveCamera",
			"name": "Camera",
			"layers": 1,
			"matrix": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 2, 1],
			"up": [0, 1, 0],
			"fov": 50,
			"zoom": 1,
			"near": 0.01,
			"far": 100,
			"focus": 10,
			"aspect": 1,
			"filmGauge": 35,
			"filmOffset": 0,
		}
	)

	scene = {
		"metadata": {
			"version": 4.7,
			"type": "Object",
			"generator": "FreeFilmCut.import_jy_effect",
		},
		"geometries": geometries,
		"materials": materials,
		"textures": textures,
		"images": images,
		"object": {
			"uuid": scene_uuid,
			"type": "Scene",
			"name": "Scene",
			"layers": 1,
			"matrix": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
			"up": [0, 1, 0],
			# Do NOT set fog/environment to null — ObjectLoader treats null as present
			# and crashes on fog.type / getTexture(null).
			"background": 0x1A1A1A,
			"children": children,
		},
	}

	camera_doc = {
		"metadata": {
			"version": 4.7,
			"type": "Object",
			"generator": "Object3D.toJSON",
		},
		"object": {
			"uuid": editor_cam_uuid,
			"type": "PerspectiveCamera",
			"name": "Camera",
			"layers": 1,
			"matrix": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 2, 1],
			"up": [0, 1, 0],
			"fov": 50,
			"zoom": 1,
			"near": 0.01,
			"far": 100,
			"focus": 10,
			"aspect": 1,
			"filmGauge": 35,
			"filmOffset": 0,
		},
	}

	project = {
		"metadata": {"title": "7527348874965519678"},
		"project": {
			"title": "7527348874965519678",
			"name": "AE2Effect_TarotFan",
			"editable": True,
			"vr": False,
			"camera": "perspective",
			"renderer": "WebGLRenderer",
			"antialias": True,
			"shadows": False,
			"shadowType": 1,
			"toneMapping": 0,
			"toneMappingExposure": 1,
			"resolution": {"width": RES, "height": RES, "showFrame": True},
			"vfxpack": {
				"type": "effect",
				"stickerAnimPhase": "in",
				"previewPoster": poster_data,
				"previewPosterName": "poster.png",
				"previewHover": "",
				"previewHoverName": "",
			},
			"previewExport": {
				"width": 256,
				"height": 256,
				"fps": 10,
				"maxKB": 800,
				"speed": 1,
				"pingpong": False,
			},
			"animPreviewTime": 0,
		},
		"camera": camera_doc,
		"controls": {"target": [0, 0, 0]},
		"scene": scene,
		"scripts": {},
		"freecapcut": {
			"format": "freecapcut.project-anims/1",
			"activeAnimName": "",
			"animations": [],
			"index": [],
		},
		"history": {"undos": [], "redos": []},
		"backgroundType": "Color",
		"environmentType": "Default",
	}

	(OUT / "assets" / "timelines").mkdir(parents=True)
	timeline = {
		"format": "freecapcut-timeline/1",
		"name": "Timeline",
		"fps": 30,
		"duration": DURATION,
		"loop": "clamp",
		"tracks": timeline_tracks,
	}
	(OUT / "assets" / "timelines" / "timeline.timeline.json").write_text(
		json.dumps(timeline, ensure_ascii=False, indent=2),
		encoding="utf-8",
	)
	(OUT / "project.json").write_text(
		json.dumps(project, ensure_ascii=False, indent="\t"),
		encoding="utf-8",
	)

	readme = """# 7527348874965519678 — 塔罗牌扇开特效（方案 A）

## 怎么打开（重要）

请用编辑器菜单：**文件 → 绑定工程文件夹**，选本目录：

`D:\\GrokbotWork\\FreeCapCutEffect\\特效\\7527348874965519678`

不要只拖单个 `project.json`。序列帧在 `assets/sequences/`，必须绑定文件夹后才能灌进画面。

## 打开后应看到

1. 立刻：`PreviewStill` 一张牌面静帧（深灰背景）
2. 绑定成功后：4 个 `Seq_*` 自动播放序列（约 3 秒）
3. 可选：打开 Timeline 面板按时间轴精确定位

## 图层

| 层 | 时间 | 说明 |
|----|------|------|
| zhipai1 | 0–1.23s | 牌扇开 |
| zhipai2 | 1.23–1.97s | 牌继续 |
| zhipaiback | 1.97–3s | 牌背/定格 |
| guang | 1.23–3s | 光效（Additive） |
"""
	(OUT / "README.md").write_text(readme, encoding="utf-8")

	report = {
		"sourcePackId": "7527348874965519678",
		"sourceHash": "509bffdd80b86d977ee83707116c229d",
		"sourceName": "AE2Effect_20250716122454309",
		"approach": "A-imageSequence+previewStill",
		"durationSec": DURATION,
		"resolution": [RES, RES],
		"layers": layer_meta,
		"openHint": "文件 → 绑定工程文件夹 → 选本目录",
		"openPath": str(OUT),
	}
	(OUT / "docs").mkdir(parents=True)
	(OUT / "docs" / "import-report.json").write_text(
		json.dumps(report, ensure_ascii=False, indent=2),
		encoding="utf-8",
	)
	print("OUT", OUT)
	print("project.json bytes", (OUT / "project.json").stat().st_size)


if __name__ == "__main__":
	main()
