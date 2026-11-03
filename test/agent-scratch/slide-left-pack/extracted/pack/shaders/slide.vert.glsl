varying vec2 vUv;

void main() {
	vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	gl_Position = clip;
	vUv = clip.xy / clip.w * 0.5 + 0.5;
}
