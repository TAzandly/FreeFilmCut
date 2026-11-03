const fs = require('fs');
const ROOT = 'D:/GrokbotWork/FreeFilmCut';
function read(p){ return fs.readFileSync(p,'utf8'); }
function write(p,s){ fs.writeFileSync(p,s,'utf8'); console.log('wrote', p); }

const p = ROOT + '/three.js/editor/js/Sidebar.Object.UI.js';
let s = read(p);

if (!s.includes("from './media/FccVideo.js")) {
  s = s.replace(
    "import { SidebarObjectTextStickers } from './Sidebar.Object.TextStickers.js?v=fcc-ui-198';",
    "import { SidebarObjectTextStickers } from './Sidebar.Object.TextStickers.js?v=fcc-ui-199';\nimport { listRenderTextureOptions } from './media/FccVideo.js?v=fcc-ui-190';"
  );
}
s = s.replace(/syncUITextContent \} from '\.\/ui\/UIText\.js\?v=fcc-ui-\d+'/g, "syncUITextContent } from './ui/UIText.js?v=fcc-ui-199'");
s = s.replace(/from '\.\/ui\/FlowerStyle\.js\?v=fcc-ui-\d+'/g, "from './ui/FlowerStyle.js?v=fcc-ui-199'");
s = s.replace(/Sidebar\.Object\.TextStickers\.js\?v=fcc-ui-\d+/g, 'Sidebar.Object.TextStickers.js?v=fcc-ui-199');

const oldMarker = "\tfunction textureControls( content, onChange ) {";
const idx = s.indexOf(oldMarker);
if (idx < 0) throw new Error('textureControls not found');
const endMarker = "\tfunction contentPrimaryOrSolid( content ) {";
const end = s.indexOf(endMarker, idx);
if (end < 0) throw new Error('contentPrimaryOrSolid not found');

const newFn = `	function textureControls( content, onChange ) {

		const c = normalizeFillContent( content );
		const tex = c.texture || {};
		let curPath = tex.path || '';
		let curName = tex.fileName || '';
		const wrap = new UIDiv();

		function pathLabel() {

			if ( curPath && String( curPath ).startsWith( 'rt:' ) ) {

				return ( curName || 'RT' ) + ' (RT)';

			}

			return curName || ( curPath ? '已选' : '未选' );

		}

		const row = new UIRow();
		row.add( new UIText( '贴图' ).setClass( 'Label' ).setWidth( '90px' ) );
		const nameLbl = new UIText( pathLabel() ).setWidth( '90px' );
		row.add( nameLbl );
		const fileBtn = new UIButton( '文件' ).setMarginLeft( '4px' );
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
					curPath = url;
					curName = file.name;
					nameLbl.setTextContent( file.name );
					rtSelect.setValue( '' );
					onChange( createTextureContent( {
						fallbackColor: c.solid.color,
						path: curPath,
						fileName: curName,
						alpha: alphaTex.getValue(),
						angle: angTex.getValue(),
						scale: scaleTex.getValue(),
						range: rangeTex.getValue(),
						uvMode: c.uvMode,
					} ) );

				} catch ( e ) {

					window.alert( '读取贴图失败：' + ( e && e.message ? e.message : e ) );

				}

			} );
			input.click();

		} );
		row.add( fileBtn );

		const rtSelect = new UISelect().setWidth( '110px' ).setMarginLeft( '4px' );
		function refreshRtOptions() {

			rtSelect.setOptions( listRenderTextureOptions( editor.scene ) );
			if ( curPath && String( curPath ).startsWith( 'rt:' ) ) {

				rtSelect.setValue( String( curPath ).slice( 3 ) );

			} else {

				rtSelect.setValue( '' );

			}

		}
		refreshRtOptions();
		rtSelect.onChange( function () {

			const uuid = rtSelect.getValue();
			if ( ! uuid ) return;
			const opts = listRenderTextureOptions( editor.scene );
			curPath = 'rt:' + uuid;
			curName = opts[ uuid ] || 'RenderTexture';
			nameLbl.setTextContent( pathLabel() );
			onChange( createTextureContent( {
				fallbackColor: c.solid.color,
				path: curPath,
				fileName: curName,
				alpha: alphaTex.getValue(),
				angle: angTex.getValue(),
				scale: scaleTex.getValue(),
				range: rangeTex.getValue(),
				uvMode: c.uvMode,
			} ) );

		} );
		row.add( rtSelect );
		row.add( new UIText( 'RT' ).setWidth( '22px' ).setMarginLeft( '4px' ).setColor( '#8af' ).setFontSize( '10px' ) );

		const clearBtn = new UIButton( '清除' ).setMarginLeft( '4px' );
		clearBtn.onClick( function () {

			curPath = '';
			curName = '';
			nameLbl.setTextContent( '未选' );
			rtSelect.setValue( '' );
			onChange( createTextureContent( {
				fallbackColor: c.solid.color,
				path: '',
				fileName: '',
				alpha: alphaTex.getValue(),
				angle: angTex.getValue(),
				scale: scaleTex.getValue(),
				range: rangeTex.getValue(),
				uvMode: c.uvMode,
			} ) );

		} );
		row.add( clearBtn );
		wrap.add( row );

		const row2 = new UIRow();
		row2.add( new UIText( '角度' ).setClass( 'Label' ).setWidth( '90px' ) );
		const angTex = new UINumber( tex.angle != null ? tex.angle : 0 ).setRange( - 360, 360 ).setWidth( '48px' );
		const scaleTex = new UINumber( tex.scale != null ? tex.scale : 1 ).setRange( 0.05, 16 ).setPrecision( 2 ).setWidth( '48px' );
		const alphaTex = new UINumber( tex.alpha != null ? tex.alpha : 1 ).setRange( 0, 1 ).setPrecision( 2 ).setWidth( '48px' );
		const rangeTex = new UINumber( tex.range != null ? tex.range : 1 ).setRange( 1, 64 ).setPrecision( 0 ).setStep( 1 ).setWidth( '48px' );
		function emitTex() {

			onChange( createTextureContent( {
				fallbackColor: c.solid.color,
				path: curPath,
				fileName: curName,
				alpha: alphaTex.getValue(),
				angle: angTex.getValue(),
				scale: scaleTex.getValue(),
				range: rangeTex.getValue(),
				uvMode: c.uvMode,
			} ) );

		}
		angTex.onChange( emitTex );
		scaleTex.onChange( emitTex );
		alphaTex.onChange( emitTex );
		rangeTex.onChange( emitTex );
		row2.add( angTex );
		row2.add( new UIText( '缩放' ).setWidth( '28px' ).setMarginLeft( '4px' ) );
		row2.add( scaleTex );
		row2.add( new UIText( 'α' ).setWidth( '16px' ).setMarginLeft( '4px' ) );
		row2.add( alphaTex );
		wrap.add( row2 );

		const rowRange = new UIRow();
		rowRange.add( new UIText( '分区' ).setClass( 'Label' ).setWidth( '90px' ) );
		rowRange.add( rangeTex );
		rowRange.add( new UIText( 'range (横条 atlas)' ).setWidth( '120px' ).setMarginLeft( '6px' ).setColor( '#888' ) );
		wrap.add( rowRange );

		const tip = new UIDiv();
		tip.setTextContent( 'RT: MediaFrame(GIF/序列/视频)→RenderTexture；range>1 需 Per-char UV' );
		tip.setFontSize( '10px' );
		tip.setColor( '#888' );
		wrap.add( tip );
		return wrap;

	}

`;
s = s.slice(0, idx) + newFn + s.slice(end);
write(p, s);
console.log('sidebar ok');
