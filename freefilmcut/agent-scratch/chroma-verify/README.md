# 抠像 shader 无头像素验证

用来量化"边缘硬不硬"，不靠肉眼。流程：把 three 真实的 `meshbasic_frag` 注入抠像后
导出成 `fragment.js`，用一个 256×64 的合成纹理（偏色绿幕 / 纯绿 / 暗绿 / 溢色肤色）
在 Chrome headless + SwiftShader 的 WebGL2 里渲染，再 `readPixels` 逐像素读 alpha。

## 复跑

```bash
# 1. 生成 fragment.js（注入后的 shader）+ cases.js（滑杆 → uniform 的真实映射）
cd apps/web
bun --preload ./test-preload.ts agent-scratch/chroma-build.ts

# 2. three 的两个构建产物需要放在页面旁边（不要提交进仓库）
cp apps/web/node_modules/three/build/three.module.js \
   apps/web/node_modules/three/build/three.core.js \
   agent-scratch/chroma-verify/

# 3. 起静态服务（file:// 下 ES module 会被 CORS 拦）
cd agent-scratch/chroma-verify && python -m http.server 8137

# 4. 另一个终端
chrome --headless=new --user-data-dir=/tmp/chrome-chroma \
  --enable-unsafe-swiftshader --no-sandbox --virtual-time-budget=10000 \
  --dump-dom http://127.0.0.1:8137/page.html
```

输出是一段 JSON：每组的 `edgeRampGreenScreen`（跨越硬边的半透明像素数）、
`backgroundAlpha` / `subjectAlpha`（绿幕和主体是否被正确区分）、`darkGreenAlpha`
（阴影）、`spillProbeSrgb`（去溢色）、以及 `profile`（x=26..46 的 alpha 曲线）。

## 注意

- 纹理分段宽度只有 32–64px，`soften` 大时探针不能贴近分段边界，否则会被相邻段污染
  （踩过一次：`subjectAlpha` 被下一条纯绿带拉低）。
- `diagnostics.logs` 必须为空。非空说明 shader 编译失败——那种情况下整块图层不绘制，
  所有读数都是 0，很容易被误读成"抠像没生效"。
