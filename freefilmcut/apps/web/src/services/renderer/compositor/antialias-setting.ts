/** Live preview/export flag. Project settings write this before each frame. */
let enabled = false;

export function setCompositorAntialias(value: boolean) {
	enabled = value;
}

export function isCompositorAntialiasEnabled() {
	return enabled;
}
