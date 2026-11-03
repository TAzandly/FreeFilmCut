uniform sampler2D map;
uniform sampler2D uInput;
uniform vec3 color;
uniform vec3 color2;
uniform float opacity;
uniform float uTime;
uniform bool useMap;

varying vec2 vUv;

void main() {
	vec4 texel = vec4( 1.0 );
	
	texel = texture2D( uInput, vUv );
	
	vec3 finalcol = mix( color, color2, vUv.x );
	gl_FragColor = vec4( texel.rgb * finalcol, texel.a * opacity );
}
