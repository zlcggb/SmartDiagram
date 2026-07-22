# 执行文档：导出 PPT 乱码/图形错乱修复（2026-07-17）

## 问题

- **网页 SVG 预览正常**，导出 PPTX 后出现中文「乱码感」（过小/挤扁/方块）或图形错位、缺块。
- 本地库内真实 `svgPreview`（含 `<g transform="translate(...)">` 卡片布局）可稳定复现字号过小与 autofit 风险；参考 `svg2pptx-skill` 的 `<g>` 样式继承与字体解析与本仓差距明显。

## 方案对比

| 方案 | 内容 | 权重 | 取舍 |
|------|------|------|------|
| **A（选用）** | 编译侧加固：`g` 表现属性继承、PPT 安全字体解析、字号按 0.75 换算、`lang=zh-CN`、关闭 `fit:shrink`、polygon/polyline、unsupported transform 失败降级；prompt/契约同步 | **92** | 保留可编辑矢量；对齐预览语义；可回归 |
| B | 导出强制 IR 或整页 raster 像素页 | 48 | 兼容好但可编辑性差；不修 SVG 主路径根因 |

**结论：执行方案 A。** 若单页仍含 `matrix/scale/rotate`，编译失败后走既有 IR/主题降级（等同轻量 B）。

## 根因（代码路径）

| # | 根因 | 路径 |
|---|------|------|
| 1 | `<g fill/font-*/text-anchor>` 浏览器继承，编译器只叠加 `translate`，子 `text` 丢对齐/颜色 | `packages/ppt-renderer/src/svgCompile.ts` → `walk` / `renderText` |
| 2 | 字号用 0.52–0.68 经验缩放 + `fit:"shrink"` → OOXML `normAutofit`，WPS/PPT 把偏紧文本框压成不可读小字（用户常称「乱码」） | `renderText`；导出样例 `lang="en-US"` + `normAutofit` |
| 3 | `font-family` 取栈首项；PingFang/Noto 预览正常，部分客户端缺字呈方块 | `renderText` `split(",")[0]` |
| 4 | 契约允许 `polygon`/`polyline`，`walk` 未实现 → 图形静默丢失 | `walk` |
| 5 | `matrix`/`scale`/`rotate` 未支持却仍编译 → 坐标整体错位 | `parseTranslate` 仅认 translate |

导出主链路：`apps/api` `POST .../export-pptx` → `renderProjectPptx`（`index.ts`）→ `recolorSvgPreview` → `tryRenderSvgSlide` / `compileSvgPreviewToSlide`。

## 改动摘要

### `svgCompile.ts`

- `<g>` / `<svg>`：`pickInheritable` 继承 fill、font-*、text-anchor 等
- `resolvePptSafeFont`：PingFang/Noto/system → Microsoft YaHei
- 字号：`FONT_PX_TO_PT = 0.75`；去掉过激 long-body 缩放
- 文本：`lang: "zh-CN"`、`fit: "none"`、data-w/h 可读下限
- `polygon`/`polyline`：描边拆线段；fill-only 用包围盒 rect 近似
- 元素级 `translate`；`matrix|scale|rotate|skew` ≥2 次 → `reason: unsupported_transform` 失败

### 其它

- `index.ts`：失败 warning 区分「未支持 transform」
- `prompts.ts`：强化 translate-only、YaHei 开头
- `COMPILABLE_SVG.md`：同步契约
- `svg-compile-regression.ts`：新增继承/字体/polygon/unsupported transform 用例

## 验证

```bash
corepack pnpm --filter @ppt-agent/ppt-renderer test:svg-regression
corepack pnpm --filter @ppt-agent/ppt-renderer typecheck
corepack pnpm --filter @ppt-agent/agents typecheck
corepack pnpm --filter @ppt-agent/api typecheck
corepack pnpm --filter @ppt-agent/web typecheck
```

结果（本机）：defense 7/7 + examples 2/2 通过；上述 typecheck 均通过。

真实页 `/tmp/big.svg`（库内样例）对照：

| 文本 | 修前 fontSize（约） | 修后 |
|------|---------------------|------|
| 标题 32px | ~21.8（且 shrink） | 24，`fit:none`，`lang:zh-CN` |
| 正文 26px | ~17.7 | 19.5 |

## 残留限制与使用建议

| 场景 | 建议 |
|------|------|
| 表格/风险/行动清单、强可编辑正文 | 页策略用 **IR** |
| 封面/对比/流程/指标等视觉编排 | **SVG/hybrid**；生成时遵守可编译契约 |
| 图标曲线、复杂装饰 path | 会被跳过（防 WPS 伪线）；勿用 path 画正文 |
| `matrix`/`scale`/`rotate` | 会编译失败并降级 IR；请改用绝对坐标或 `translate` |
| macOS 无微软雅黑 | 客户端可能替字；Windows + 雅黑最稳；长期可做字体嵌入 |
| 必须像素级一致 | 暂无 raster 兜底；可后续加 visual 专用开关（方案 B） |

## 相关文档

- [COMPILABLE_SVG.md](../00-architecture/COMPILABLE_SVG.md)
- [EXPERIENCE_export-pptx-preview-ok-compile-drift.md](./EXPERIENCE_export-pptx-preview-ok-compile-drift.md)
- [EXECUTION_export-download-svg-wps-ir.md](./EXECUTION_export-download-svg-wps-ir.md)
