from pathlib import Path

ROOT = Path(r'D:\GrokbotWork\FreeFilmCut')

def read(p):
    return Path(p).read_text(encoding='utf-8')

def write(p, s):
    Path(p).write_bytes(s.encode('utf-8'))
    print('wrote', p)

# ---------- 2. Sidebar.Object.TextStickers.js ----------
p = ROOT / 'three.js/editor/js/Sidebar.Object.TextStickers.js'
s = read(p)

# bump TextStickers import + add listRenderTextureOptions
s = s.replace(
    "from './ui/TextStickers.js?v=fcc-ui-204';",
    "from './ui/TextStickers.js?v=fcc-ui-205';",
)
s = s.replace(
    "from './FreeCapCutShaders.js?v=fcc-ui-204';",
    "from './FreeCapCutShaders.js?v=fcc-ui-205';",
)
if "listRenderTextureOptions" not in s:
    s = s.replace(
        "from './ui/TextStickers.js?v=fcc-ui-205';",
        "from './ui/TextStickers.js?v=fcc-ui-205';\n"
        "import { listRenderTextureOptions } from './media/FccVideo.js?v=fcc-ui-203';",
    )

old_tex = """		} else {

			const texRow = new UIRow();
			texRow.add( new UIText( zh ? '贴图' : 'Texture' ).setClass( 'Label' ).setWidth( '70px' ) );
			const nameLbl = new UIText( s.textureFileName || ( s.texturePath ? '…' : ( zh ? '未选' : 'none' ) ) ).setWidth( '80px' );
			texRow.add( nameLbl );
			const fileBtn = new UIButton( zh ? '文件' : 'File' ).setMarginLeft( '4px' );
			fileBtn.onClick( function () {

				const input = document.createElement( 'input' );
				input.type = 'file';
				input.accept = 'image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp';
				input.addEventListener( 'change', async function () {

					const file = input.files && input.files[ 0 ];
					if ( ! file ) return;
					try {

						const buf = await file.arrayBuffer();
						const blob = new Blob( [ buf ], { type: file.type || 'image/png' } );
						const url = URL.createObjectURL( blob );
						if ( ! editor._fccFlowerTexBytes ) editor._fccFlowerTexBytes = new Map();
						editor._fccFlowerTexBytes.set( url, { name: file.name, buffer: buf, type: file.type || 'image/png' } );
						mutate( stickerId, ( st ) => {

							st.texturePath = url;
							st.textureFileName = file.name;

						} );
						nameLbl.setTextContent( file.name );

					} catch ( e ) {

						window.alert( ( zh ? '读取贴图失败: ' : 'Texture read failed: ' ) + ( e && e.message ? e.message : e ) );

					}

				} );
				input.click();

			} );
			texRow.add( fileBtn );
			const clearBtn = new UIButton( zh ? '清除' : 'Clear' ).setMarginLeft( '2px' );
			clearBtn.onClick( function () {

				mutate( stickerId, ( st ) => {

					st.texturePath = '';
					st.textureFileName = '';

				} );
				nameLbl.setTextContent( zh ? '未选' : 'none' );

			} );
			texRow.add( clearBtn );
			box.add( texRow );

			const opRow = new UIRow();"""

new_tex = """		} else {

			const texRow = new UIRow();
			texRow.add( new UIText( zh ? '贴图' : 'Texture' ).setClass( 'Label' ).setWidth( '70px' ) );
			function pathLabel() {

				const tp = s.texturePath || '';
				if ( tp && String( tp ).startsWith( 'rt:' ) ) {

					return ( s.textureFileName || 'RT' ) + ' (RT)';

				}
				return s.textureFileName || ( tp ? '…' : ( zh ? '未选' : 'none' ) );

			}
			const nameLbl = new UIText( pathLabel() ).setWidth( '80px' );
			texRow.add( nameLbl );
			const fileBtn = new UIButton( zh ? '文件' : 'File' ).setMarginLeft( '4px' );
			fileBtn.onClick( function () {

				const input = document.createElement( 'input' );
				input.type = 'file';
				input.accept = 'image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp';
				input.addEventListener( 'change', async function () {

					const file = input.files && input.files[ 0 ];
					if ( ! file ) return;
					try {

						const buf = await file.arrayBuffer();
						const blob = new Blob( [ buf ], { type: file.type || 'image/png' } );
						const url = URL.createObjectURL( blob );
						if ( ! editor._fccFlowerTexBytes ) editor._fccFlowerTexBytes = new Map();
						editor._fccFlowerTexBytes.set( url, { name: file.name, buffer: buf, type: file.type || 'image/png' } );
						mutate( stickerId, ( st ) => {

							st.texturePath = url;
							st.textureFileName = file.name;
							delete st.rtTargetUuid;

						} );
						s.texturePath = url;
						s.textureFileName = file.name;
						nameLbl.setTextContent( file.name );
						rtSelect.setValue( '' );

					} catch ( e ) {

						window.alert( ( zh ? '读取贴图失败: ' : 'Texture read failed: ' ) + ( e && e.message ? e.message : e ) );

					}

				} );
				input.click();

			} );
			texRow.add( fileBtn );

			const rtSelect = new UISelect().setWidth( '110px' ).setMarginLeft( '4px' );
			function refreshRtOptions() {

				rtSelect.setOptions( listRenderTextureOptions( editor.scene ) );
				const tp = s.texturePath || '';
				if ( tp && String( tp ).startsWith( 'rt:' ) ) {

					rtSelect.setValue( String( tp ).slice( 3 ) );

				} else {

					rtSelect.setValue( '' );

				}

			}
			refreshRtOptions();
			rtSelect.onChange( function () {

				const uuid = rtSelect.getValue();
				if ( ! uuid ) return;
				const opts = listRenderTextureOptions( editor.scene );
				const curPath = 'rt:' + uuid;
				const curName = opts[ uuid ] || 'RenderTexture';
				mutate( stickerId, ( st ) => {

					st.texturePath = curPath;
					st.textureFileName = curName;
					st.rtTargetUuid = uuid;

				} );
				s.texturePath = curPath;
				s.textureFileName = curName;
				nameLbl.setTextContent( ( curName || 'RT' ) + ' (RT)' );

			} );
			texRow.add( rtSelect );
			texRow.add( new UIText( 'RT' ).setWidth( '22px' ).setMarginLeft( '4px' ).setColor( '#8af' ).setFontSize( '10px' ) );

			const clearBtn = new UIButton( zh ? '清除' : 'Clear' ).setMarginLeft( '2px' );
			clearBtn.onClick( function () {

				mutate( stickerId, ( st ) => {

					st.texturePath = '';
					st.textureFileName = '';
					delete st.rtTargetUuid;

				} );
				s.texturePath = '';
				s.textureFileName = '';
				nameLbl.setTextContent( zh ? '未选' : 'none' );
				rtSelect.setValue( '' );

			} );
			texRow.add( clearBtn );
			box.add( texRow );

			const opRow = new UIRow();"""

if old_tex not in s:
    # try to diagnose
    idx = s.find("texRow.add( new UIText( zh ? '贴图'")
    print('marker idx', idx)
    raise SystemExit('sidebar tex block not found')
s = s.replace(old_tex, new_tex)
write(p, s)
print('Sidebar.Object.TextStickers.js OK')
