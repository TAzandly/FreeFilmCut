# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")

# ========== TextFx sidebar color ==========
tf = (ROOT / "Sidebar.Object.TextFx.js").read_text(encoding="utf-8")
mimp = re.search(r"import \{([^}]+)\} from '\./libs/ui\.js';", tf)
if mimp and "UIColor" not in mimp.group(1):
    tf = tf[:mimp.start(1)] + mimp.group(1).rstrip() + ", UIColor " + tf[mimp.end(1):]

if "schema.type === 'color'" not in tf:
    m = re.search(
        r"if \( schema\.type === 'boolean' \) \{.*?row\.add\( cb \);\n\n\t\t\t\t\t\} else \{\n",
        tf,
        re.S,
    )
    if not m:
        m = re.search(
            r"if \( schema\.type === 'boolean' \) \{.*?row\.add\( cb \);\n\t\t\t\t\t\} else \{\n",
            tf,
            re.S,
        )
    if not m:
        raise SystemExit('TextFx boolean branch not found')
    tf = tf[:m.start()] + """if ( schema.type === 'boolean' ) {

						const cb = new UICheckbox( !! entry.params[ schema.key ] ).onChange( () => {

							entry.params[ schema.key ] = cb.getValue();
							dirty();

						} );
						row.add( cb );

					} else if ( schema.type === 'color' ) {

						const col = new UIColor().setValue( entry.params[ schema.key ] || '#ffffff' ).onInput( () => {

							entry.params[ schema.key ] = col.getValue();
							dirty();

						} );
						row.add( col );

					} else {
""" + tf[m.end():]

tf = tf.replace("BuiltinEffects.js?v=fcc-ui-11", "BuiltinEffects.js?v=fcc-ui-12")
(ROOT / "Sidebar.Object.TextFx.js").write_text(tf, encoding="utf-8")
print("TextFx OK", "schema.type === 'color'" in tf)

# ========== OC registry ==========
oc = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\postprocess\registry.ts")
ocs = oc.read_text(encoding="utf-8")
if "color: \"#ffffff\"" not in ocs and "color: '#ffffff'" not in ocs:
    ocs = ocs.replace(
        """		createDefaultParams: () => ({
			intensity: 1.2,
			threshold: 0.0,
			radius: 1.0,
		}),
		createPasses: ({ width, height }) => {
			const pass = new DeepGlowPass(
				new THREE.Vector2(Math.max(1, width), Math.max(1, height)),
				1.2,
				0.0,
				1.0,
			);
			return [pass as unknown as Pass];
		},
		applyParams: (passes, params) => {
			const pass = passes[0] as DeepGlowPass;
			if (!pass) return;
			if (params.intensity !== undefined) pass.intensity = Number(params.intensity);
			if (params.threshold !== undefined) pass.threshold = Number(params.threshold);
			if (params.radius !== undefined) pass.radius = Number(params.radius);
		},
	});""",
        """		createDefaultParams: () => ({
			intensity: 1.2,
			threshold: 0.0,
			radius: 1.0,
			color: "#ffffff",
		}),
		createPasses: ({ width, height }) => {
			const pass = new DeepGlowPass(
				new THREE.Vector2(Math.max(1, width), Math.max(1, height)),
				1.2,
				0.0,
				1.0,
			);
			return [pass as unknown as Pass];
		},
		applyParams: (passes, params) => {
			const pass = passes[0] as DeepGlowPass;
			if (!pass) return;
			if (params.intensity !== undefined) pass.intensity = Number(params.intensity);
			if (params.threshold !== undefined) pass.threshold = Number(params.threshold);
			if (params.radius !== undefined) pass.radius = Number(params.radius);
			if (params.color !== undefined && pass.glowColor) {
				const v = params.color as string | number[] | { r?: number; g?: number; b?: number };
				if (typeof v === "string") {
					let hex = v.trim();
					if (hex.startsWith("#")) hex = hex.slice(1);
					if (hex.length === 3) {
						hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
					}
					const n = parseInt(hex, 16);
					if (Number.isFinite(n)) {
						pass.glowColor.set(
							((n >> 16) & 255) / 255,
							((n >> 8) & 255) / 255,
							(n & 255) / 255,
						);
					}
				} else if (Array.isArray(v) && v.length >= 3) {
					pass.glowColor.set(Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0);
				} else if (v && typeof v === "object") {
					const r = v.r != null ? v.r : (v as { x?: number }).x;
					const g = v.g != null ? v.g : (v as { y?: number }).y;
					const b = v.b != null ? v.b : (v as { z?: number }).z;
					if (r != null && g != null && b != null) {
						pass.glowColor.set(Number(r), Number(g), Number(b));
					}
				}
			}
		},
	});""",
    )
    oc.write_text(ocs, encoding="utf-8")
    print("OC registry OK", "color: \"#ffffff\"" in ocs)
else:
    print("OC already has color")

# ========== Cache bumps elsewhere ==========
bumps = {
    "TextLayerRT.js?v=fcc-ui-11": "TextLayerRT.js?v=fcc-ui-12",
    "BuiltinEffects.js?v=fcc-ui-11": "BuiltinEffects.js?v=fcc-ui-12",
    "DeepGlowPass.js?v=fcc-ui-11": "DeepGlowPass.js?v=fcc-ui-12",
    "TextAnim.js?v=fcc-ui-6": "TextAnim.js?v=fcc-ui-7",
    "TextAnimRuntime.js?v=fcc-ui-6": "TextAnimRuntime.js?v=fcc-ui-7",
    "Sidebar.Object.TextAnim.js?v=fcc-ui-7": "Sidebar.Object.TextAnim.js?v=fcc-ui-8",
    "PostProcessStack.js?v=fcc-ui-11": "PostProcessStack.js?v=fcc-ui-12",
}

# TextLayerRT imports BuiltinEffects
tl = (ROOT / "ui/TextLayerRT.js").read_text(encoding="utf-8")
tl2 = tl
for a, b in bumps.items():
    tl2 = tl2.replace(a, b)
if tl2 != tl:
    (ROOT / "ui/TextLayerRT.js").write_text(tl2, encoding="utf-8")
    print("TextLayerRT import bumps")

# UI.js Sidebar TextAnim import
ui = (ROOT / "Sidebar.Object.UI.js").read_text(encoding="utf-8")
ui2 = ui.replace("Sidebar.Object.TextAnim.js?v=fcc-ui-7", "Sidebar.Object.TextAnim.js?v=fcc-ui-8")
if ui2 != ui:
    (ROOT / "Sidebar.Object.UI.js").write_text(ui2, encoding="utf-8")
    print("UI.js TextAnim bump")

# VfxPackExporter, PostProcessStack
for rel in ["VfxPackExporter.js", "postprocessing/PostProcessStack.js"]:
    fp = ROOT / rel
    if not fp.exists():
        continue
    t = fp.read_text(encoding="utf-8")
    t2 = t
    for a, b in bumps.items():
        t2 = t2.replace(a, b)
    if t2 != t:
        fp.write_text(t2, encoding="utf-8")
        print("bumped", rel)

# Viewport already at 12/7 — verify
vp = (ROOT / "Viewport.js").read_text(encoding="utf-8")
print("VP TextLayerRT", "TextLayerRT.js?v=fcc-ui-12" in vp)
print("VP TextAnim", "TextAnim.js?v=fcc-ui-7" in vp)
print("VP Runtime", "TextAnimRuntime.js?v=fcc-ui-7" in vp)
print("unused textLayerCompositeSource?", "textLayerCompositeSource" in vp)
