const fs = require("fs");
const path = "D:/GrokbotWork/FreeFilmCut/three.js/editor/js/ui/UIText.js";
let code = fs.readFileSync(path, "utf8");

const broken = `vertexDefs: \r\nvarying vec2 vFccGradUv;\r\n,\r\n\t\t\t// Outer vertexTransform runs before Troika's; position.xy is still the unit quad.\r\n\t\t\t// Replicate Troika totalBounds UV so the fragment does not need Three's vUv.\r\n\t\t\tvertexTransform: \r\n{\r\n  vec4 fccB = aTroikaGlyphBounds;\r\n  fccB.xz += uTroikaPositionOffset.x;\r\n  fccB.yw -= uTroikaPositionOffset.y;\r\n  vec2 fccLocal = mix( fccB.xy, fccB.zw, position.xy );\r\n  vec2 fccSpan = max( uTroikaTotalBounds.zw - uTroikaTotalBounds.xy, vec2( 1e-5 ) );\r\n  vFccGradUv = ( fccLocal - uTroikaTotalBounds.xy ) / fccSpan;\r\n}\r\n,\r\n\t\t\tfragmentDefs: \r\nvarying vec2 vFccGradUv;\r\nuniform vec3 uFccGA;\r\nuniform vec3 uFccGB;\r\nuniform float uFccGAngle;\r\nuniform float uFccGStop0;\r\nuniform float uFccGStop1;\r\nuniform float uFccGUse;\r\n,\r\n\t\t\tfragmentColorTransform: \r\nif (uFccGUse > 0.5) {\r\n  float rad = radians(uFccGAngle);\r\n  vec2 dir = vec2(cos(rad), sin(rad));\r\n  float t = dot(vFccGradUv - vec2(0.5), dir) + 0.5;\r\n  t = (t - uFccGStop0) / max(uFccGStop1 - uFccGStop0, 1e-5);\r\n  t = clamp(t, 0.0, 1.0);\r\n  gl_FragColor.rgb = mix(uFccGA, uFccGB, t);\r\n}\r\n,`;

const fixed = `vertexDefs: \`\r\nvarying vec2 vFccGradUv;\r\n\`,\r\n\t\t\t// Outer vertexTransform runs before Troika's; position.xy is still the unit quad.\r\n\t\t\t// Replicate Troika totalBounds UV so the fragment does not need Three's vUv.\r\n\t\t\tvertexTransform: \`\r\n{\r\n  vec4 fccB = aTroikaGlyphBounds;\r\n  fccB.xz += uTroikaPositionOffset.x;\r\n  fccB.yw -= uTroikaPositionOffset.y;\r\n  vec2 fccLocal = mix( fccB.xy, fccB.zw, position.xy );\r\n  vec2 fccSpan = max( uTroikaTotalBounds.zw - uTroikaTotalBounds.xy, vec2( 1e-5 ) );\r\n  vFccGradUv = ( fccLocal - uTroikaTotalBounds.xy ) / fccSpan;\r\n}\r\n\`,\r\n\t\t\tfragmentDefs: \`\r\nvarying vec2 vFccGradUv;\r\nuniform vec3 uFccGA;\r\nuniform vec3 uFccGB;\r\nuniform float uFccGAngle;\r\nuniform float uFccGStop0;\r\nuniform float uFccGStop1;\r\nuniform float uFccGUse;\r\n\`,\r\n\t\t\tfragmentColorTransform: \`\r\nif (uFccGUse > 0.5) {\r\n  float rad = radians(uFccGAngle);\r\n  vec2 dir = vec2(cos(rad), sin(rad));\r\n  float t = dot(vFccGradUv - vec2(0.5), dir) + 0.5;\r\n  t = (t - uFccGStop0) / max(uFccGStop1 - uFccGStop0, 1e-5);\r\n  t = clamp(t, 0.0, 1.0);\r\n  gl_FragColor.rgb = mix(uFccGA, uFccGB, t);\r\n}\r\n\`,`;

// Also try LF-only variant
const brokenLF = broken.replace(/\r\n/g, "\n");
const fixedLF = fixed.replace(/\r\n/g, "\n");

let n = 0;
if (code.includes(broken)) {
  code = code.split(broken).join(fixed);
  n++;
  console.log("replaced CRLF broken block");
} else if (code.includes(brokenLF)) {
  code = code.split(brokenLF).join(fixedLF);
  n++;
  console.log("replaced LF broken block");
} else {
  // Fallback: regex replace each field
  const fields = ["vertexDefs", "vertexTransform", "fragmentDefs", "fragmentColorTransform"];
  for (const f of fields) {
    const re = new RegExp(f + ":\\s*\\r?\\n([\\s\\S]*?)\\r?\\n,", "m");
    const m = code.match(re);
    if (m && !m[0].includes("`")) {
      const body = m[1];
      const nl = m[0].includes("\r\n") ? "\r\n" : "\n";
      code = code.replace(m[0], f + ": `" + nl + body + nl + "`," );
      n++;
      console.log("regex-fixed", f);
    } else if (m && m[0].includes("`")) {
      console.log("already ok", f);
    } else {
      console.log("NOT FOUND", f);
    }
  }
}

if (n === 0) {
  console.log("NO CHANGES - dump around vertexDefs:");
  const i = code.indexOf("vertexDefs:");
  console.log(JSON.stringify(code.slice(i, i + 200)));
  process.exit(1);
}

fs.writeFileSync(path, code, "utf8");
const after = fs.readFileSync(path, "utf8");
const i = after.indexOf("vertexDefs:");
console.log("AFTER:", JSON.stringify(after.slice(i, i + 60)));
console.log("DONE changes=", n);
