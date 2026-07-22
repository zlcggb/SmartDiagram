# 执行文档：导出自动下载 + SVG/WPS 伪线 + IR 空内容（2026-07-17）

## 问题清单

1. **导出页职责不清**：主按钮「导出…」只更新历史列表，不下载；次按钮「下载最近导出」才拉文件。
2. **主按钮不触发下载（Bug）**：`exportPptx` store 成功后仅 `set({ exports })`，未用 `absoluteDownloadUrl` 触发浏览器下载。
3. **SVG→PPTX 在 WPS 出现从角上拉出的杂乱蓝线**：网页预览正常，WPS 中大量对角线伪影。
4. **IR 优先无内容**：Studio 只改 `renderStrategy`；设计稿 Tab 只看 `svgPreview`；draft 导出跳过 `ensureSlideIr`；有 `irJson` 时主题模板仍盖住 IR。

## 方案对比

| 方案 | 内容 | 权重 | 取舍 |
|------|------|------|------|
| **A（选用）** | 前端导出成功自动下载 + 按钮文案澄清；SVG 编译加固（危险 path/伪线过滤）；draft/ir 强制 `ensureSlideIr`；IR 优先时 Studio 线框预览与生成按钮；渲染路径 `preferIr` | **90** | 保留可编辑性；针对根因修复；可加回归 |
| B | 高视觉失败时整页 raster 成图塞进 PPT；导出页仅改文案 | 45 | 实现快但损失可编辑；不解决 IR 空预览与下载 Bug 的根因 |

**结论：执行方案 A。**

## 根因

| # | 根因 |
|---|------|
| 下载 | `workbenchStore.exportPptx` 未调用下载；次按钮 `<a href>` 才走 `absoluteDownloadUrl` |
| WPS 伪线 | `renderPath` 把 path `d` 中所有数字当折线顶点（含 C/Q/A 控制点）；无描边填充 path 仍默认 stroke；从 (0,0) 拉出的长段未过滤 |
| IR 空 | `prepareSlidesForExport` 在 `mode==="draft"` 时跳过 `ensureSlideIr`；`renderThemeOrIrSlide` 主题模板恒成功导致从不渲染 `irJson`；Studio 设计稿 Tab 无 IR 生成/预览 |

## 改动摘要

### Web

- `lib/api.ts`：新增 `triggerBrowserDownload`
- `store/workbenchStore.ts`：导出成功后自动下载；顺手修正 `createBlankSlide` Partial 入参以通过 typecheck
- `ExportPage.tsx`：主按钮「生成并下载…」；次按钮「下载历史版本」
- `StudioPage.tsx`：IR 优先 / 草稿 → IR 线框预览 +「生成本页 IR / 全部生成 IR」

### API

- `prepareSlidesForExport`：draft / strategy=ir **一律** `await ensureSlideIr`；缺 irJson 写 notes

### Renderer

- `svgCompile.ts`：安全折线解析（M/L/H/V/Z）；跳过曲线与 fill-only path；伪线段过滤；stroke 宽度上限
- `index.ts`：`renderThemeOrIrSlide({ preferIr: true })` 供 ir 策略优先画 IR
- `scripts/svg-compile-regression.ts`：内置 4 个伪线防御用例（无 references 也可跑）

## 验证

```bash
corepack pnpm --filter @ppt-agent/web typecheck
corepack pnpm --filter @ppt-agent/api typecheck
corepack pnpm --filter @ppt-agent/ppt-renderer typecheck
corepack pnpm --filter @ppt-agent/ppt-renderer test:svg-regression
```

手工：

1. 导出页点主按钮 → 应自动开始下载 PPTX；次按钮仅重下历史文件。
2. Studio 切「IR 优先」→ 设计稿 Tab 显示 IR 线框或「生成本页 IR」，不再空白。
3. 快速草稿 / IR 优先导出 → `pageResults.path` 多为 `ir`；幻灯片有文本/卡片。
4. 高视觉导出后用 WPS 打开 → 不应再出现从左上角贯穿的蓝线（复杂装饰 path 可能缺失，属预期降级）。

## 残留限制

- 复杂曲线 / 图标 path 会被跳过，视觉页在 WPS 中可能比浏览器少装饰，但不画垃圾线。
- `matrix` / `scale` / `rotate` transform 仍未完整支持；极端装饰仍可能坐标偏差。
- `ensureSlideIr` 失败时仍降级主题模板（有内容，但不是 IR 元素树）。
- 未做整页 raster 兜底（方案 B）；若未来某页必须像素级一致，可再加 visual 专用 fallback。
