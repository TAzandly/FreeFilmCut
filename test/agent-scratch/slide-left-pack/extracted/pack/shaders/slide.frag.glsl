precision mediump float;
uniform sampler2D uInput;
uniform float uSlideX;
uniform float uSlideY;
varying vec2 vUv;

void main() {
	vec2 uv = vUv - vec2(uSlideX, uSlideY);
	if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
		gl_FragColor = vec4(0.0);
		return;
	}
	gl_FragColor = texture2D(uInput, uv);
}
