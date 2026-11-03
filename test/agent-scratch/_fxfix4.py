from pathlib import Path
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
root = Path(r"D:\GrokbotWork\FreeFilmCut")

# Fix blit in TextLayerRT.js
path = root/"three.js/editor/js/ui/TextLayerRT.js"
t = path.read_text(encoding="utf-8", errors="replace")

old_blit = '''	blitMat = new THREE.ShaderMaterial( {
		name: 'TextLayerRT.blit',
		uniforms: {
			tDiffuse: { value: null },
			uOpacity: { value: 1 },
		},
		vertexShader: /* glsl */`
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = vec4( position.xy, 0.0, 1.0 );
			}
		`,
		fragmentShader: /* glsl */`
			uniform sampler2D tDiffuse;
			uniform float uOpacity;
			varying vec2 vUv;
			void main() {
				vec4 c = texture2D( tDiffuse, vUv );
				gl_FragColor = c * uOpacity;
			}
		`,
		transparent: true,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
	} );'''

new_blit = '''	blitMat = new THREE.ShaderMaterial( {
		name: 'TextLayerRT.blit',
		uniforms: {
			tDiffuse: { value: null },
			uOpacity: { value: 1 },
		},
		vertexShader: /* glsl */`
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = vec4( position.xy, 0.0, 1.0 );
			}
		`,
		fragmentShader: /* glsl */`
			uniform sampler2D tDiffuse;
			uniform float uOpacity;
			varying vec2 vUv;
			void main() {
				vec4 c = texture2D( tDiffuse, vUv );
				// Straight alpha; skip empty padding so 3D/letterbox shows through.
				if ( c.a < 0.001 ) discard;
				gl_FragColor = vec4( c.rgb, c.a * uOpacity );
			}
		`,
		transparent: true,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
		premultipliedAlpha: false,
		blending: THREE.NormalBlending,
	} );'''

if old_blit not in t:
    raise SystemExit('blit mat missing')
t = t.replace(old_blit, new_blit, 1)

# Bump import versions to fcc-ui-7 for stack/effects after rewrite
t = t.replace("PostProcessStack.js?v=fcc-ui-6", "PostProcessStack.js?v=fcc-ui-7")
t = t.replace("BuiltinEffects.js?v=fcc-ui-6", "BuiltinEffects.js?v=fcc-ui-7")
path.write_text(t, encoding='utf-8')
print('TextLayerRT blit fixed')
