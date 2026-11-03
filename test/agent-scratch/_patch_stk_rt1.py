from pathlib import Path

ROOT = Path(r'D:\GrokbotWork\FreeFilmCut')

def read(p):
    return Path(p).read_text(encoding='utf-8')

def write(p, s):
    Path(p).write_bytes(s.encode('utf-8'))
    print('wrote', p)

# ---------- 1. Editor TextStickers.js ----------
p = ROOT / 'three.js/editor/js/ui/TextStickers.js'
s = read(p)

if 'textureForRenderTextureUuid' not in s:
    s = s.replace(
        "from './TextAnimRuntime.js?v=fcc-ui-171';",
        "from './TextAnimRuntime.js?v=fcc-ui-171';\n"
        "import { textureForRenderTextureUuid } from '../media/FccVideo.js?v=fcc-ui-203';",
    )

s = s.replace(
    " *   texturePath, textureFileName, opacity, color",
    " *   texturePath, textureFileName, opacity, color\n"
    " *                 texturePath may be blob/http OR rt:<RenderTextureUuid>\n"
    " *   rtTargetUuid  optional mirror of rt: path for clip live-bind",
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

function resolveStickerRtTexture( path ) {

	if ( ! isStickerRtPath( path ) ) return null;
	const uuid = path.slice( 3 );
	if ( ! uuid ) return null;
	const ed = typeof window !== 'undefined' ? window.editor : null;
	if ( ! ed ) return null;
	return textureForRenderTextureUuid( ed, uuid );

}

function stampStickerTexRtSlot( material, path ) {

	if ( ! material ) return;
	material.userData = material.userData || {};
	if ( isStickerRtPath( path ) ) {

		material.userData.fccRtSlots = [ { key: 'map', uuid: path.slice( 3 ) } ];

	} else if ( material.userData.fccRtSlots ) {

		delete material.userData.fccRtSlots;

	}

}

function loadStickerTexture( path ) {

	if ( ! path || typeof path !== 'string' ) return whiteTexture();
	// Live MediaFrame RT — always resolve (do not TextureLoader / static-cache).
	if ( isStickerRtPath( path ) ) {

		const live = resolveStickerRtTexture( path );
		return live || whiteTexture();

	}
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
    raise SystemExit('loadStickerTexture block not found')
s = s.replace(old_load, new_load)

old_norm_end = """		texturePath: raw.texturePath != null ? String( raw.texturePath ) : '',
		textureFileName: raw.textureFileName != null ? String( raw.textureFileName ) : '',
		opacity: Math.max( 0, Math.min( 1, Number( raw.opacity ) != null && ! Number.isNaN( Number( raw.opacity ) )
			? Number( raw.opacity ) : 1 ) ),
		color: typeof raw.color === 'string' && raw.color ? raw.color : d.color,
	};

}"""

new_norm_end = """		texturePath: raw.texturePath != null ? String( raw.texturePath ) : '',
		textureFileName: raw.textureFileName != null ? String( raw.textureFileName ) : '',
		opacity: Math.max( 0, Math.min( 1, Number( raw.opacity ) != null && ! Number.isNaN( Number( raw.opacity ) )
			? Number( raw.opacity ) : 1 ) ),
		color: typeof raw.color === 'string' && raw.color ? raw.color : d.color,
		...( ( () => {
			const tp = raw.texturePath != null ? String( raw.texturePath ) : '';
			const fromPath = tp.startsWith( 'rt:' ) ? tp.slice( 3 ) : '';
			const uuid = ( typeof raw.rtTargetUuid === 'string' && raw.rtTargetUuid )
				? raw.rtTargetUuid
				: fromPath;
			return uuid ? { rtTargetUuid: uuid } : {};
		} )() ),
	};

}"""

if old_norm_end not in s:
    raise SystemExit('normalize end not found')
s = s.replace(old_norm_end, new_norm_end)

old_make = """	const mat = new THREE.MeshBasicMaterial( {
		map: sticker.texturePath ? loadStickerTexture( sticker.texturePath ) : whiteTexture(),
		color: new THREE.Color( sticker.color || '#ff66aa' ),
		transparent: true,
		opacity: sticker.opacity,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
		side: THREE.DoubleSide,
	} );
	const mesh = new THREE.Mesh( geo, mat );"""

new_make = """	const mat = new THREE.MeshBasicMaterial( {
		map: sticker.texturePath ? loadStickerTexture( sticker.texturePath ) : whiteTexture(),
		color: new THREE.Color( sticker.color || '#ff66aa' ),
		transparent: true,
		opacity: sticker.opacity,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
		side: THREE.DoubleSide,
	} );
	stampStickerTexRtSlot( mat, sticker.texturePath || '' );
	const mesh = new THREE.Mesh( geo, mat );"""

if old_make not in s:
    raise SystemExit('makeStickerMesh mat block not found')
s = s.replace(old_make, new_make)

old_bind = """		const wantMap = s.texturePath ? loadStickerTexture( s.texturePath ) : whiteTexture();
		if ( mat.map !== wantMap ) {

			mat.map = wantMap;
			mat.needsUpdate = true;

		}
		mat.opacity = s.opacity;
		if ( mat.color ) mat.color.set( s.color || '#ff66aa' );
		mat.side = THREE.DoubleSide;
		enforceStickerMaterialContract( mat );

	}
	mesh.userData.__fccStickerData = s;"""

new_bind = """		const wantMap = s.texturePath ? loadStickerTexture( s.texturePath ) : whiteTexture();
		if ( mat.map !== wantMap ) {

			mat.map = wantMap;
			mat.needsUpdate = true;

		}
		stampStickerTexRtSlot( mat, s.texturePath || '' );
		mat.opacity = s.opacity;
		if ( mat.color ) mat.color.set( s.color || '#ff66aa' );
		mat.side = THREE.DoubleSide;
		enforceStickerMaterialContract( mat );

	}
	mesh.userData.__fccStickerData = s;"""

if old_bind not in s:
    raise SystemExit('bindStickerMeshAppearance map block not found')
s = s.replace(old_bind, new_bind)

old_ser = """			texturePath: n.texturePath,
			textureFileName: n.textureFileName,
			opacity: n.opacity,
			color: n.color,
		};
		return out;

	} );

}"""

new_ser = """			texturePath: n.texturePath,
			textureFileName: n.textureFileName,
			opacity: n.opacity,
			color: n.color,
		};
		if ( n.rtTargetUuid ) out.rtTargetUuid = n.rtTargetUuid;
		else if ( isStickerRtPath( n.texturePath ) ) out.rtTargetUuid = n.texturePath.slice( 3 );
		return out;

	} );

}"""

if old_ser not in s:
    raise SystemExit('serialize block not found')
s = s.replace(old_ser, new_ser)

write(p, s)
print('TextStickers.js OK')

