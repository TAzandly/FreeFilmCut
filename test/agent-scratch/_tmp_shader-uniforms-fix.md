# FreeFilmCut Shader uniforms fix (color / color2)

## Problem

Editing **Material → Program → Info** used to show colors as hex integers (`16711680`) because `THREE.Color.toJSON()` returns a hex number. Re-applying that JSON set `uniforms.color.value` to a plain `number`. GLSL `uniform vec3 color` then got bad data, so the mesh looked black / empty.

If `color` and `color2` were the same hex, `mix()` also looked like "nothing changed".

## Fix (Editor)

| File | Change |
|------|--------|
| `three.js/editor/js/FreeCapCutShaders.js` | Default `color=[1,0,0]`, `color2=[0,0,1]`; fragment `mix(color,color2,vUv.x)` × optional `map`; `normalizeShaderUniforms` / `serializeProgramInfo` |
| `three.js/editor/js/Script.js` | Info open → arrays `[r,g,b]`; Info save → coerce ints/arrays to `THREE.Color` |
| `three.js/editor/js/commands/SetMaterialValueCommand.js` | When setting `uniforms`, always normalize |

Accepted Info JSON values for color uniforms:

```json
"color":  { "value": [1, 0, 0] },
"color2": { "value": [0, 0, 1] }
```

Also accepted (auto-converted): hex int `16711680`, `{ "r":1,"g":0,"b":0 }`, 0–255 arrays.

## Fix an already-broken material

1. Hard-refresh Editor (`http://localhost:5174/editor/`).
2. Select the mesh → Material type still `ShaderMaterial`.
3. Open **Info**. Prefer values like:

```json
{
  "defines": {},
  "uniforms": {
    "map": { "value": null },
    "color": { "value": [1, 0, 0] },
    "color2": { "value": [0, 0, 1] },
    "opacity": { "value": 1 },
    "uTime": { "value": 0 },
    "useMap": { "value": false }
  }
}
```

4. Open **Frag** and use (or keep default):

```glsl
uniform sampler2D map;
uniform vec3 color;
uniform vec3 color2;
uniform float opacity;
uniform float uTime;
uniform bool useMap;
varying vec2 vUv;

void main() {
  vec4 texel = vec4(1.0);
  if (useMap) texel = texture2D(map, vUv);
  vec3 finalcol = mix(color, color2, vUv.x);
  gl_FragColor = vec4(texel.rgb * finalcol, texel.a * opacity);
}
```

5. Or switch Type away from ShaderMaterial and back — creates a fresh FreeFilmCut template with red→blue gradient.

New ShaderMaterials get the correct defaults automatically.
