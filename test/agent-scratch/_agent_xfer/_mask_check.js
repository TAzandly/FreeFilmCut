const resolveTroikaFaceMaterial=()=>null;const tuneMaterial=()=>{};const createDerivedMaterial=()=>({userData:{}});const RENDER_MODE_CAMERA=1;
function applyInnerShadowFaceMask( troika, ox, oy, mode ) {

	const oxN = Number( ox ) || 0;
	const oyN = Number( oy ) || 0;
	troika.userData = troika.userData || {};
	troika.userData.fccHadInnerMask = true;
	troika.userData.fccInnerShadow = { ox: oxN, oy: oyN };

	// Inner shadow uses outlineBlur -> Troika returns [outline, face]. Never assign arrays.
	const faceMat = resolveTroikaFaceMaterial( troika );
	if ( ! faceMat || ! faceMat.isTroikaTextMaterial ) {

		tuneMaterial( troika, mode );
		return;

	}

	if ( faceMat.userData && faceMat.userData.fccInnerMask && faceMat.userData.fccInnerMaskUniforms ) {

		faceMat.userData.fccInnerMaskUniforms.uFccInnerOx.value = oxN;
		faceMat.userData.fccInnerMaskUniforms.uFccInnerOy.value = oyN;
		faceMat.userData.fccInnerMaskUniforms.uFccInnerMask.value = 1;
		tuneMaterial( troika, mode );
		return;

	}

	const uniforms = {
		uFccInnerOx: { value: oxN },
		uFccInnerOy: { value: oyN },
		uFccInnerMask: { value: 1 },
	};

	let derived;
	try {

		derived = createDerivedMaterial( faceMat, {
			chained: true,
			uniforms,
			fragmentDefs: `
uniform float uFccInnerOx;
uniform float uFccInnerOy;
uniform float uFccInnerMask;
`,
			fragmentColorTransform: `
if (uFccInnerMask > 0.5) {
  vec2 dim = max(vTroikaGlyphDimensions, vec2(1e-5));
  vec2 faceUV = vTroikaGlyphUV + vec2(uFccInnerOx, uFccInnerOy) / dim;
  vec2 clampedFaceUV = clamp(faceUV, 0.5 / uTroikaSDFGlyphSize, 1.0 - 0.5 / uTroikaSDFGlyphSize);
  float faceDist = troikaGlyphUvToDistance(clampedFaceUV);
  faceDist += clampedFaceUV == faceUV ? 0.0 :
    length((faceUV - clampedFaceUV) * vTroikaGlyphDimensions);
  float faceA = troikaGetEdgeAlpha(faceDist, 0.0, troikaGetAADist());
  gl_FragColor.a *= faceA;
  if (gl_FragColor.a < 0.001) discard;
}
`,
		} );

	} catch ( e ) {

		console.warn( '[FreeFilmCut] inner-shadow face mask failed', e );
		tuneMaterial( troika, mode );
		return;

	}

	derived.userData = derived.userData || {};
	derived.userData.fccInnerMask = true;
	derived.userData.fccInnerMaskUniforms = uniforms;
	if ( faceMat.userData ) {

		if ( faceMat.userData.fccGradientMat ) derived.userData.fccGradientMat = true;
		if ( faceMat.userData.fccGradUv ) derived.userData.fccGradUv = true;
		if ( faceMat.userData.fccGradientUniforms ) derived.userData.fccGradientUniforms = faceMat.userData.fccGradientUniforms;
		if ( faceMat.userData.fccTextureMat ) derived.userData.fccTextureMat = true;
		if ( faceMat.userData.fccTextureUniforms ) derived.userData.fccTextureUniforms = faceMat.userData.fccTextureUniforms;

	}
	derived.transparent = true;
	derived.depthWrite = false;
	derived.toneMapped = false;
	derived.depthTest = mode === RENDER_MODE_CAMERA;
	Object.defineProperty( derived, 'isTroikaTextMaterial', { value: true } );
	troika.material = derived;
	tuneMaterial( troika, mode );

}


console.log(1);
