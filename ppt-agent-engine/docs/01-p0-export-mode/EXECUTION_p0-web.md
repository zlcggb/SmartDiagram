# 执行文档：P0 Web 导出模式 UI（2026-07-17）

## 需求

在第 5 步「策划与导出」接入 IR+SVG 混合策略的导出模式选择，并在页面列表展示渲染策略提示；仅改 `apps/web`。

## 方案与权重

| 方案 | 权重 | 说明 |
|------|------|------|
| A 仅 UI 文案切换，仍走旧 `draft` 布尔 | 48 | 改动小，但无法表达 standard/visual，后端无法按模式分流 |
| **B store + api 贯通 `mode`，UI 三选一（默认 standard）** | **92** | 与混合策略契约一致；draft 仍兼容 `draft:true` |

选用 **B**。

## 已执行

1. 新增 `apps/web/src/lib/exportMode.ts`（本地临时类型，注释标明待对齐 shared）
   - `PptExportMode`: `draft | standard | visual`
   - `SlideRenderStrategy`: `ir | svg | hybrid`
   - `renderStrategyHint()`：有 `slide.renderStrategy` 显示中文标签，否则显示「自动」
2. `lib/api.ts`
   - `exportPptx(..., mode)` → body `{ theme, mode, draft }`（draft 模式额外 `draft:true`）
   - `generateAllDesigns` / `generateSlideDesign` 附带 `mode`
3. `store/workbenchStore.ts`
   - 状态 `exportMode`（默认 `standard`）+ `setExportMode`
   - 导出/批量设计读取当前 mode；快速草稿下拦截「生成全部页面设计」
4. `App.tsx` 第 5 步
   - 保留白蓝/蓝黑主题
   - 增加导出模式三选一
   - 单一「导出{模式} PPTX」按钮
   - 页面列表与当前页展示「策略 · …」

## API 调用字段

| 接口 | 新增/变更字段 |
|------|----------------|
| `POST .../export-pptx` | `mode: "draft"\|"standard"\|"visual"`；`mode:"draft"` 时同时 `draft:true` |
| `POST .../generate-all-designs` | `mode`（另保留 `theme`、`force:true`） |
| `POST .../slides/:id/generate-design` | `mode`（另保留 `theme`） |

## 验收

- [x] 第 5 步可选快速草稿 / 标准版 / 高视觉版
- [x] 默认标准版
- [x] 主题选择保留
- [x] 页面列表有策略提示（无服务端字段时显示「自动」）
- [x] `corepack pnpm --filter @ppt-agent/web typecheck` 通过（exit 0）

## 待对齐

- shared 正式导出 `PptExportMode`、`ExportPptxInput.mode`、`SlideDto.renderStrategy` 后，删除 web 本地临时类型并改为从 `@ppt-agent/shared` 引入。
