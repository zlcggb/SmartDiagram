# 执行文档：P0 API + Renderer 混合导出降级（2026-07-17）

## 需求

落实 IR + SVG 相辅相成策略中的导出侧 P0：

1. 导出模式 `draft | standard | visual`（兼容旧 `draft: boolean`）
2. 每页策略 `ir | svg | hybrid`（`inferRenderStrategy`）
3. `renderProjectPptx`：按策略编译；SVG 失败降级 IR/主题，不整份 throw
4. `export-pptx`：draft/standard 不强制全页 SVG；visual 尽量补 SVG，单页失败降级

## 方案与权重

| 方案 | 权重 | 说明 |
|------|------|------|
| A shared 契约复用 + renderer/API 最小侵入 | **92** | 与 sibling 的 shared/prompts 对齐，避免双份门禁逻辑 |
| B 仅在 api/renderer 内联 mode/门禁 | 55 | 短期快，易与 shared 合入冲突、行为漂移 |

**选用 A。** shared 侧已有 `exportModes` / `renderStrategies` / `exportPptxSchema` / `inferRenderStrategy` / `getBannedSvgFeatures` 时直接复用；仅补「显式 `renderStrategy` 优先」。

## 已执行

### `packages/shared`

- 确认并沿用 sibling 已合入的 mode/strategy/门禁 API
- `inferRenderStrategy`：若 slide 已带 `renderStrategy` 则直接返回

### `packages/ppt-renderer`

- `RenderProjectPptxInput` 增加 `mode?`
- 返回值改为 `{ outputPath, warnings }`（`RenderProjectPptxResult`）
- `renderProjectPptx` 行为：
  - `draft` 或策略 `ir` → 直接 IR/主题模板，跳过 SVG 优先
  - `svg` / `hybrid` → `getBannedSvgFeatures` + 预检 token 数 → `renderSvgPreviewSlide`；失败记 warning 并降级
  - **废除** standard 下「有 svgPreview 但编译失败就 throw」

### `apps/api`

- `validateSvgPreview` 接入硬门禁 `getBannedSvgFeatures`
- `generateEditableSvgDesign`：生成 SVG 时尽量补写 `irJson`（失败不阻断）
- 新增 `ensureSlideIr` / `prepareSlidesForExport`
- `export-pptx`：
  - 解析 `mode`（兼容 `draft`）
  - draft/standard **不再**因缺 SVG 返回 400
  - visual：缺失/违规 SVG 时尝试生成；单页失败降级；仅当「补 SVG 全失败且页均无 IR」才 502
  - 渲染 warnings 写入服务日志；响应文案附带降级条数提示

## 未执行（有意不做）

- 不改 `apps/web`（由 sibling 完成 mode UI；本任务范围仅 api + ppt-renderer）
- 不落库 `renderStrategy` 字段（运行时 `inferRenderStrategy` / 可选 DTO 字段即可）
- 不做 SVG 编译器大重构（XML DOM / 渐变等属 P1，见 `OPTIMIZATION_PLAN.md`）

## 契约复用

- `exportModes` / `renderStrategies` / `exportPptxSchema` / `inferRenderStrategy` / `getBannedSvgFeatures`
- 硬门禁语义对齐 `docs/00-architecture/COMPILABLE_SVG.md`

## Typecheck

```text
corepack pnpm --filter @ppt-agent/ppt-renderer typecheck → pass
corepack pnpm --filter @ppt-agent/api typecheck          → pass
```

## 已知风险

1. **半渲染残留**：若预检通过但实际 `rendered < 4`，极少数 slide 可能已有部分 SVG 再叠加模板（rough token 预检已降概率）。
2. **visual 成本**：缺/违规 SVG 时现场调设计模型；IR 补齐 best-effort，有额外 token。
3. **门禁单一来源**：禁止特性列表以 shared `getBannedSvgFeatures` + `COMPILABLE_SVG.md` 为准，勿在 api/renderer 再发明一套。
4. **visual 整份 502 条件很窄**：仅「补 SVG 全失败且页均无 IR」；有主题模板时多数仍可交差。

## 验收对照

- [x] standard 可不强制全页 SVG 导出
- [x] SVG 编译失败不导致整份 throw（standard）
- [x] ir 策略跳过 SVG 优先
- [x] 硬门禁接入生成校验与渲染前检查
- [x] typecheck 通过
- [x] 执行文档落地
