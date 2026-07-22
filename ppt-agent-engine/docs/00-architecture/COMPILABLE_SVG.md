# 可编译 SVG 契约（本项目精简版）

从 `references/svg2pptx-skill/references/shared-standards.md` 抽取，仅保留本项目当前导出链路适用的硬规则。  
目标：SVG 能稳定拆成 PowerPoint **原生可编辑** 文本框 / 形状 / 线条。

完整上游契约与渐变/箭头/滤镜等增强能力见参考仓库；本文件是 **P0 硬门禁 + 生成约束**。

---

## 1. 画布

| 项 | 要求 |
|----|------|
| viewBox | 必须为 `0 0 1280 720` |
| width / height | 建议与 viewBox 一致（1280×720） |
| 单位 | 像素（px），不要用 pt |
| 背景 | 用全页 `<rect>` 铺底 |

---

## 2. 允许元素（白名单）

优先使用：

- `<svg>`、`<defs>`（仅放本页引用到的资源，慎用）
- `<g>`（分组；**不要**给 `<g>` 写 `opacity`）
- `<rect>`（卡片/背景；可用 `rx` / `ry`）
- `<text>`、`<tspan>`（正文与标题）
- `<line>`、`<circle>`、`<ellipse>`、`<path>`、`<polygon>`、`<polyline>`

颜色与透明度：

- 颜色用 **HEX**（如 `#0066CC`）
- 透明度用 `fill-opacity` / `stroke-opacity`（或元素级 `opacity`）
- **禁止** `rgba(...)` 作为 fill/stroke

文本硬规则：

- 每一个 `<text>` 必须带 `data-w` 与 `data-h`（贴合真实文字区域）
- 一行逻辑文本优先一个 `<text>`；样式 run 可用内联 `<tspan>`（tspan 不要带 `x`/`y`/`dy`）
- 多行正文：优先多个带 `dy` 的 `<tspan>` **显式换行**；`data-w` 对中文宜略宽（约 +8–12%），因 OOXML 字宽度量与浏览器不一致
- 徽章/胶囊：`data-h` = 整颗徽章高度（含 padding），`font-size` ≈ `data-h` 的 0.4–0.55，`text-anchor="middle"`
- `font-family` 栈须以 **Microsoft YaHei** 开头（其后可跟 PingFang SC / Arial）；导出时会把 PingFang/Noto 等映射为雅黑，避免预览有字、PPT 方块
- `<g>` 上的 `fill` / `font-*` / `text-anchor` 会被编译器继承到子元素（与浏览器一致）；仍建议关键属性写在具体 `text`/`rect` 上更稳妥
- `transform` **只允许** `translate(x,y)`；`matrix` / `scale` / `rotate` / `skew` 会导致导出错位或整页降级 IR
- XML 保留字符必须实体化：`&` → `&amp;`，`<` → `&lt;` 等；正文用原始 Unicode，不用 HTML 命名实体
- 曲线装饰填充 path（卡片底图 blob）导出时可能被近似为淡色椭圆，或跳过；主信息勿画进 path

---

## 3. 禁止项（硬门禁）

出现任一即视为不可编译（应重生成或降级 IR）：

| 禁止 | 原因 |
|------|------|
| `<style>` / `class=` / 外部 CSS | DrawingML 无样式表模型，须内联属性 |
| `<mask>` / `mask=` | 无逐像素 alpha |
| `<foreignObject>` | 嵌入 HTML/异种内容 |
| `<symbol>`（及依赖 symbol 的 `<use>`） | 符号复用不稳定 |
| `<textPath>` | 无等价 DrawingML |
| `@font-face` | 禁止自定义字体嵌入 |
| `<animate*>` / `<set>` | 动画不进原生形状 |
| `<script>` / 事件属性 / `<iframe>` | 安全与兼容 |

补充禁写（生成侧也应避免）：

- 把正文画进 `path` / `image` / 滤镜
- 依赖复杂 `filter` 表达主信息（装饰可极少量）

---

## 4. 与 IR 的关系（混合策略）

- **业务正文权威在 Plan / IR / 事实库**，不在 SVG。
- SVG 负责布局与视觉层次；数字、日期、结论不得虚构。
- 编译失败时降级到同页 IR / 主题模板，而不是整份 PPT 失败。

详见 [HYBRID_IR_SVG_STRATEGY.md](./HYBRID_IR_SVG_STRATEGY.md)。
