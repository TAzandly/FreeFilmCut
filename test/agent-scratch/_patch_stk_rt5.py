from pathlib import Path
ROOT = Path(r'D:\GrokbotWork\FreeFilmCut')

def patch_normalize(path, marker_old, marker_new):
    s = Path(path).read_text(encoding='utf-8')
    if marker_old not in s:
        if 'rtTargetUuid:' in s and 'fromPath' in s and '...( ( () =>' not in s:
            print(path, 'already fixed?')
            return
        raise SystemExit(f'old marker missing in {path}')
    Path(path).write_bytes(s.replace(marker_old, marker_new).encode('utf-8'))
    print('fixed', path)

old = """		...( ( () => {
			const tp = raw.texturePath != null ? String( raw.texturePath ) : '';
			const fromPath = tp.startsWith( 'rt:' ) ? tp.slice( 3 ) : '';
			const uuid = ( typeof raw.rtTargetUuid === 'string' && raw.rtTargetUuid )
				? raw.rtTargetUuid
				: fromPath;
			return uuid ? { rtTargetUuid: uuid } : {};
		} )() ),"""

new = """		rtTargetUuid: ( () => {
			const tp = raw.texturePath != null ? String( raw.texturePath ) : '';
			const fromPath = tp.startsWith( 'rt:' ) ? tp.slice( 3 ) : '';
			if ( typeof raw.rtTargetUuid === 'string' && raw.rtTargetUuid ) return raw.rtTargetUuid;
			return fromPath;
		} )(),"""

# Editor uses same indent with tabs
patch_normalize(ROOT/'three.js/editor/js/ui/TextStickers.js', old, new)

# Clip may have slightly different comment context - same block
patch_normalize(ROOT/'freefilmcut/apps/web/src/vfxpack/text-stickers.js', old, new)

# Also ensure clear deletes when path empty - sidebar already does.
# serialize: only emit when non-empty (already gated)
print('normalize rtTargetUuid always set')
