// FreeCapCut vfxpack shader placeholder (MVP)
// No ShaderMaterial in this pack. Add one in the Editor (Material type →ShaderMaterial)
// then Export VfxPack to embed real GLSL under shaders/.
precision mediump float;
uniform sampler2D uInput;
uniform vec2 uResolution;
varying vec2 vUv;
void main() {
  vec4 c = texture2D( uInput, vUv );
  gl_FragColor = c;
}
