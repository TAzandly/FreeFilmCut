uniform sampler2D uTransitionTo ;
uniform sampler2D uTransitionFrom;
uniform float uMix;
uniform float opacity;
uniform float uTime;
uniform bool useMap;
// Global screen (Editor/OpenCut fill these each frame — project/safe-frame size):
uniform vec2 uResolution;       // (width, height)
uniform vec4 uScreenParams;     // (w, h, 1+1/w, 1+1/h) Unity-like
uniform vec2 uScreenTexelSize;  // (1/w, 1/h)
// uniform vec4 _ScreenParams;  // optional alias of uScreenParams

varying vec2 vUv;

void main() {
	vec2 screenUV = gl_FragCoord.xy / uResolution.xy;
	vec4 texel1 = texture2D( uTransitionFrom, vUv );
	vec4 texel2 = texture2D( uTransitionTo, vUv );
	vec4 finalcol = mix( texel1, texel2, clamp( uMix, 0.0, 1.0 ) );
	gl_FragColor = vec4( finalcol.rgb, finalcol.a );
}
