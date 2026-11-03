// =============================================================================
// FreeCapCut Shader 约定（编辑器 / 剪辑端自动绑定的名字）
// 只声明你实际用到的 uniform；系统按「GLSL 里写了什么」来绑定，不会猜。
// =============================================================================
//
// 【颜色空间】
// - gl_FragColor 写线性颜色。贴图采样已是 sRGB 解码后的线性值。
// - 不要写 linearToOutputTexel / #include <colorspace_fragment>。
//   色调映射 + sRGB 输出由编辑器 / 剪辑端统一做。
//
// 【滤镜 / 特效 · 下层输入】（pack type = filter | effect，scope = below）
// - 推荐：uniform sampler2D uInput;
// - 别名：belowInput、iChannel0（三选一即可，也可同时声明，内容相同）
// - 剪辑端每帧绑定「本轨道下方合成」画面。
// - 编辑器材质面板可本地选图预览，不会打进 .vfxpack。
//
// 【转场】（pack type = transition，挂在时间线切点上）
// - 推荐：
//     uniform sampler2D uTransitionFrom;  // 切点左侧 / 离开的画面 A
//     uniform sampler2D uTransitionTo;    // 切点右侧 / 进入的画面 B
// - FROM 别名：uFrom、transitionFrom
// - TO   别名：uTo、transitionTo
// - 可选尺寸（每帧写入像素宽高）：
//     uniform vec2 uTransitionFromSize;  // 别名 uFromSize
//     uniform vec2 uTransitionToSize;    // 别名 uToSize
// - 进度：没有自动绑定的「进度」uniform。
//   常见做法是自己声明 uniform float uMix;（0=全 A，1=全 B），
//   用工程里的 .anim / timeline 把 uMix 从 0 关键到 1。
//   参考 dissolve-cut：mix(A, B, clamp(uMix, 0.0, 1.0))
// - 编辑器同样可用本地图预览 From/To，不会打进包。
//
// 【屏幕尺寸】（声明了就会每帧填工程/安全框分辨率，不是 CSS 窗口）
//     uniform vec2 uResolution;      // (width, height)
//     uniform vec2 uScreenTexelSize;  // (1/w, 1/h)
//     uniform vec4 uScreenParams;     // (w, h, 1+1/w, 1+1/h) 类似 Unity
//     uniform vec4 _ScreenParams;     // 可选，与 uScreenParams 相同
//   屏幕 UV 示例：vec2 screenUV = gl_FragCoord.xy / uResolution.xy;
//
// 【花字 / 字贴纸 · 横条 atlas（可选，与 FlowerStyle texture.range 同约定）】
// - 声明后编辑器/贴纸同步会写入：
//     uniform float uFccTexRange;   // 分区数，默认 1=不切
//     uniform float uFccCharIndex;  // 字序号（贴纸已按字拆 mesh；共享材质球请用下面 UV 重映射）
// - 采样前把局部 UV 映到第 (charIndex % range) 条横带：
//     float n = max(uFccTexRange, 1.0);
//     float slot = mod(uFccCharIndex, n);
//     uv.x = (clamp(uv.x, 0.0, 1.0) + slot) / n;
// - 共享材质球：贴纸同步也会按 range 改 mesh UV，无需每字一份材质。
//
// 【本模板自带（侧栏可调 / 可 K 帧）】
// - map + useMap：可选贴图相乘
// - color / color2 / opacity：着色与透明度
// - uTime：占位 float，需自己用动画驱动；剪辑端不会自动写时钟
//
// =============================================================================

uniform sampler2D uInput;
uniform sampler2D map;
uniform vec3 color;
uniform vec3 color2;
uniform float opacity;
uniform float uTime;
uniform bool useMap;
uniform vec2 uResolution;
uniform vec4 uScreenParams;
uniform vec2 uScreenTexelSize;
// uniform vec4 _ScreenParams;

varying vec2 vUv;

void main() {
	vec4 texel = texture2D( uInput, vUv );
	
	gl_FragColor = vec4( texel.rgb, texel.a * opacity );
}
