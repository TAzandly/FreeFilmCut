from pathlib import Path

ROOT = Path(r'D:\GrokbotWork\FreeFilmCut')

def read(p):
    return Path(p).read_text(encoding='utf-8')

def write(p, s):
    Path(p).write_bytes(s.encode('utf-8'))
    print('wrote', p)

# ---------- 3. Clip text-stickers.js ----------
p = ROOT / 'freefilmcut/apps/web/src/vfxpack/text-stickers.js'
s = read(p)

s = s.replace(
    ' * Clip port of editor TextStickers.js (fcc-ui-204 / fcc-tl-flower-43).',
    ' * Clip port of editor TextStickers.js (fcc-ui-205 / fcc-tl-flower-44).',
)

# Update header
s = s.replace(
    ' *   texturePath, textureFileName, opacity, color',
    ' *   texturePath, textureFileName, opacity, color\n'
    ' *                 texturePath may be pack-relative OR rt:<RenderTextureUuid>\n'
    ' *   rtTargetUuid  live MediaPlayer→RT bind (preferred for rt: paths)',
)

old_load = """function loadStickerTexture( path ) {

	if ( ! path || typeof path !== 'string' ) return whiteTexture();
	if ( _texCache.has( path ) ) return _texCache.get( path );
	const tex = _texLoader.load(
		path,
		() => { tex.needsUpdate = true; },
		undefined,
		() => { console.warn( '[FreeFilmCut] text sticker texture failed', path ); },
	);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.generateMipmaps = true;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.magFilter = THREE.LinearFilter;
	_texCache.set( path, tex );
	return tex;

}"""

new_load = """function isStickerRtPath( path ) {

	return typeof path === 'string' && path.startsWith( 'rt:' );

}

function loadStickerTexture( path ) {

	if ( ! path || typeof path !== 'string' ) return whiteTexture();
	// Live RT — bindLiveMediaToStickers fills map; never TextureLoader on rt:.
	if ( isStickerRtPath( path ) ) return whiteTexture();
	if ( _texCache.has( path ) ) return _texCache.get( path );
	const tex = _texLoader.load(
		path,
		() => { tex.needsUpdate = true; },
		undefined,
		() => { console.warn( '[FreeFilmCut] text sticker texture failed', path ); },
	);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.generateMipmaps = true;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.magFilter = THREE.LinearFilter;
	_texCache.set( path, tex );
	return tex;

}"""

if old_load not in s:
    raise SystemExit('clip loadStickerTexture not found')
s = s.replace(old_load, new_load)

# Improve normalize to derive rtTargetUuid from texturePath when missing
old_rt = """		// Live media (fcc-tl-flower-22): keep RT / pack path for bindLiveMediaToStickers.
		...( typeof raw.texturePackPath === 'string' && raw.texturePackPath
			? { texturePackPath: raw.texturePackPath } : {} ),
		...( typeof raw.rtTargetUuid === 'string' && raw.rtTargetUuid
			? { rtTargetUuid: raw.rtTargetUuid } : {} ),
	};"""

new_rt = """		// Live media (fcc-tl-flower-22/44): keep RT / pack path for bindLiveMediaToStickers.
		...( typeof raw.texturePackPath === 'string' && raw.texturePackPath
			? { texturePackPath: raw.texturePackPath } : {} ),
		...( ( () => {
			const tp = raw.texturePath != null ? String( raw.texturePath ) : '';
			const fromPath = tp.startsWith( 'rt:' ) ? tp.slice( 3 ) : '';
			const uuid = ( typeof raw.rtTargetUuid === 'string' && raw.rtTargetUuid )
				? raw.rtTargetUuid
				: fromPath;
			return uuid ? { rtTargetUuid: uuid } : {};
		} )() ),
	};"""

if old_rt not in s:
    raise SystemExit('clip normalize rt block not found')
s = s.replace(old_rt, new_rt)

# serialize clip-side too
old_ser = """			texturePath: n.texturePath,
			textureFileName: n.textureFileName,
			opacity: n.opacity,
			color: n.color,
		};
		return out;

	} );

}"""

# Might already differ - check
if old_ser in s:
    new_ser = """			texturePath: n.texturePath,
			textureFileName: n.textureFileName,
			opacity: n.opacity,
			color: n.color,
		};
		if ( n.rtTargetUuid ) out.rtTargetUuid = n.rtTargetUuid;
		else if ( isStickerRtPath( n.texturePath ) ) out.rtTargetUuid = n.texturePath.slice( 3 );
		if ( n.texturePackPath ) out.texturePackPath = n.texturePackPath;
		return out;

	} );

}"""
    s = s.replace(old_ser, new_ser)
else:
    print('WARN: clip serialize block skipped')

write(p, s)
print('clip text-stickers.js OK')

# ---------- 4. apply-text-template.ts remapStickerTextures ----------
p = ROOT / 'freefilmcut/apps/web/src/vfxpack/apply-text-template.ts'
s = read(p)

old_remap = """	return stickers.map((raw) => {
		const s = { ...raw };
		const path =
			(typeof s.texturePackPath === "string" && s.texturePackPath) ||
			(typeof s.texturePath === "string" ? s.texturePath : "");
		if (path && !path.startsWith("blob:") && !path.startsWith("rt:")) {
			const url = packUrl(pack, path);
			if (url) {
				s.texturePath = url;
				s.texturePackPath =
					typeof s.texturePackPath === "string" && s.texturePackPath
						? s.texturePackPath
						: path;
			} else if (typeof s.texturePackPath !== "string" || !s.texturePackPath) {
				s.texturePackPath = path;
			}
		} else if (
			typeof s.texturePath === "string" &&
			s.texturePath.startsWith("blob:")
		) {
			s.texturePath = "";
		}
		return s;
	});
}"""

new_remap = """	return stickers.map((raw) => {
		const s = { ...raw };
		const path =
			(typeof s.texturePackPath === "string" && s.texturePackPath) ||
			(typeof s.texturePath === "string" ? s.texturePath : "");
		if (typeof path === "string" && path.startsWith("rt:")) {
			// Sprite sticker authored against a live RenderTexture.
			s.texturePath = path;
			s.rtTargetUuid =
				(typeof s.rtTargetUuid === "string" && s.rtTargetUuid) ||
				path.slice(3);
		} else if (path && !path.startsWith("blob:") && !path.startsWith("rt:")) {
			const url = packUrl(pack, path);
			if (url) {
				s.texturePath = url;
				s.texturePackPath =
					typeof s.texturePackPath === "string" && s.texturePackPath
						? s.texturePackPath
						: path;
			} else if (typeof s.texturePackPath !== "string" || !s.texturePackPath) {
				s.texturePackPath = path;
			}
		} else if (
			typeof s.texturePath === "string" &&
			s.texturePath.startsWith("blob:")
		) {
			s.texturePath = "";
		}
		return s;
	});
}"""

if old_remap not in s:
    raise SystemExit('remapStickerTextures not found')
s = s.replace(old_remap, new_remap)

# Also when building stickers from scene textUi — check sprite texturePath for rt:
old_scene = """		if (mapPath.startsWith("rt:")) {
			const rt = mapPath.slice(3);
			const mediaPath = rtToMediaPath.get(rt);
			if (mediaPath) {
				s.texturePackPath = mediaPath;
				// Sprite fallback path only when no linked material uuid.
				if (s.material !== "material") {
					s.material = "sprite";
					s.texturePath = mediaPath.startsWith("media/") ? mediaPath : "";
				} else {
					// Shader materials sample RT via fccRtSlots; avoid TextureLoader on video/seq.
					s.texturePath = "";
				}
				s.rtTargetUuid = rt;
			}
		} else if (mapPath && !mapPath.startsWith("blob:")) {
			s.texturePackPath = mapPath;
			if (s.material !== "material") {
				s.texturePath = mapPath;
			}
		}
		return s;
	});"""

new_scene = """		if (mapPath.startsWith("rt:")) {
			const rt = mapPath.slice(3);
			const mediaPath = rtToMediaPath.get(rt);
			if (mediaPath) {
				s.texturePackPath = mediaPath;
				// Sprite fallback path only when no linked material uuid.
				if (s.material !== "material") {
					s.material = "sprite";
					s.texturePath = mediaPath.startsWith("media/") ? mediaPath : "";
				} else {
					// Shader materials sample RT via fccRtSlots; avoid TextureLoader on video/seq.
					s.texturePath = "";
				}
				s.rtTargetUuid = rt;
			}
		} else if (mapPath && !mapPath.startsWith("blob:")) {
			s.texturePackPath = mapPath;
			if (s.material !== "material") {
				s.texturePath = mapPath;
			}
		}
		// Sprite stickers may author texturePath=rt:<uuid> directly (no material map).
		const spriteTex =
			typeof s.texturePath === "string" ? s.texturePath : "";
		if (spriteTex.startsWith("rt:") && !s.rtTargetUuid) {
			const rt = spriteTex.slice(3);
			s.rtTargetUuid = rt;
			const mediaPath = rtToMediaPath.get(rt);
			if (mediaPath) s.texturePackPath = mediaPath;
		}
		return s;
	});"""

if old_scene not in s:
    raise SystemExit('scene stickers rt block not found')
s = s.replace(old_scene, new_scene)

write(p, s)
print('apply-text-template.ts OK')

# ---------- 5. text-template-media.ts collect owned RTs from texturePath ----------
p = ROOT / 'freefilmcut/apps/web/src/vfxpack/text-template-media.ts'
s = read(p)

old_collect = """		const list = ui?.textStickers;
		if (Array.isArray(list)) {
			for (const s of list) {
				if (!s || s.enabled === false) continue;
				add(typeof s.rtTargetUuid === "string" ? s.rtTargetUuid : "");
			}
		}"""

new_collect = """		const list = ui?.textStickers;
		if (Array.isArray(list)) {
			for (const s of list) {
				if (!s || s.enabled === false) continue;
				add(typeof s.rtTargetUuid === "string" ? s.rtTargetUuid : "");
				const tp = (s as { texturePath?: string }).texturePath;
				addRtPath(tp);
			}
		}"""

if old_collect not in s:
    raise SystemExit('collectStickerOwnedRtUuids list block not found')
s = s.replace(old_collect, new_collect)

# Also type the list items to include texturePath - optional, cast is enough

# bindLiveMedia: also match texturePath rt: when rtTargetUuid missing
old_bind = """		const packPathRaw = String(
			ud.__fccStickerData.texturePackPath || "",
		);
		const packPath = packPathRaw.replace(/\\\\/g, "/").replace(/\\/$/, "");
		const rtUuid = String(ud.__fccStickerData.rtTargetUuid || "");"""

# Need to check exact escaping in file
idx = s.find('ud.__fccStickerData.texturePackPath')
print('bind idx', idx)
print(repr(s[idx-80:idx+200]) if idx>=0 else 'missing')

write(p, s)
print('text-template-media.ts collect OK')
