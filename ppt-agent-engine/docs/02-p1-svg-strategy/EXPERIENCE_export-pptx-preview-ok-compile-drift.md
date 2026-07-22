# 经验：预览正常 ≠ 导出正确（SVG 编译漂移）

## 场景

浏览器 SVG 预览与 `svgCompile` → pptxgenjs → OOXML 是两套渲染器。用户报「乱码/图形错乱」时，优先对比**继承、字体、autofit、transform 子集**，不要先怀疑下载链路。

## 高频漂移点

1. **`<g>` 表现属性**：浏览器继承 `fill`/`font-*`/`text-anchor`；若编译器只传 `translate`，对齐和颜色会 silently 错。
2. **字号换算**：1280×720 → 13.333×7.5in 时，`pt ≈ px * 0.75`。经验系数再打折 + `fit:shrink`（`normAutofit`）会把中文压成「乱码感」。
3. **字体栈**：预览吃 PingFang/Noto，PPT 客户端可能没有 → 方块。导出应解析为 **Microsoft YaHei** 等安全族，并设 `lang: zh-CN`。
4. **白名单未实现**：prompt 允许 `polygon` 但 `walk` 未处理 = 预览有、导出无。
5. **transform 子集**：只支持 `translate` 时，`matrix/scale/rotate` 应失败降级，而不是错位交付。
6. **CJK 换行 / 徽章框高**：见 [EXPERIENCE_export-text-fidelity-cjk-badge.md](./EXPERIENCE_export-text-fidelity-cjk-badge.md)——`data-w` 需余量、勿封顶 `data-h`。

## 做法

- 编译器对齐浏览器级联：继承 + 安全字体 + 正确字号 + 关闭危险 autofit。
- 契约 / prompt / `getBannedSvgFeatures` 三件套同步（见 `COMPILABLE_SVG.md`）。
- 回归同时覆盖：伪线防御、g 继承、polygon、unsupported transform。
- 产品上保留按页 IR 降级：视觉页走 SVG，内容页走 IR。

## 可复用

凡「Web 预览一种引擎、交付物另一种引擎」的链路（SVG→PPT、Canvas→PDF、HTML→邮件），都要单独测**继承、字体嵌入/回退、坐标系、不支持特性的失败策略**，不能只看预览截图。
