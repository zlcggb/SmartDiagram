# 执行文档：P1 Web 策略展示与导出提示（2026-07-17）

## 需求

只改 `apps/web`：页面策略展示优先服务端 `renderStrategy`；导出成功后结构化展示 `warnings` / `pageResults`；draft 下禁用批量设计；可选字段兼容不报错。

## 方案与权重

| 方案 | 权重 | 说明 |
|------|------|------|
| A 仅前端推断策略标签 | 50 | 无服务端权威；无法承接导出降级反馈 |
| **B 展示服务端策略 + 导出警告** | **88** | 与 Hybrid 契约一致；字段缺失时 fallback / 空列表 |

选用 **B**。

## 已执行

1. `apps/web/src/lib/exportMode.ts`
   - `renderStrategyHint`：始终展示「IR 优先 / SVG 优先 / 混合」
   - 有 `slide.renderStrategy` 用服务端；否则 `inferRenderStrategy`
   - 不再显示「自动」
   - `standard` / `visual` 模式说明微调为「按页/按策略」
2. `apps/web/src/lib/api.ts`
   - `ExportFeedbackDto` / `PageRenderResultDto`（本地扩展，兼容 shared 未含可选字段）
   - `collectExportWarnings()`：合并 `warnings` + `pageResults[].warning` 并去重
   - `exportPptx` 返回类型改为 `ExportFeedbackDto`
3. `apps/web/src/store/workbenchStore.ts`
   - 状态 `exportWarnings: string[]` + `clearExportWarnings`
   - `exportPptx` 成功后解析并保存；开始导出 / 建项 / 加载项目时清空
4. `apps/web/src/App.tsx` 第 5 步
   - 页面列表/详情继续显示「策略 · …」（现为具体中文策略）
   - 导出提示列表：`border-line` / `text-muted`，可清除
   - 批量设计：draft 禁用；standard「按策略生成/刷新页面设计」；visual「按策略尽量生成页面设计」

## 兼容说明

| 字段 | API 尚未回传时 | UI 行为 |
|------|----------------|---------|
| `SlideDto.renderStrategy` | 缺失 | `inferRenderStrategy` → 中文标签 |
| `ExportDto.warnings` | 缺失 | `exportWarnings = []`，不展示块 |
| `ExportDto.pageResults` | 缺失 | 忽略；不报错 |

## Typecheck

```text
corepack pnpm --filter @ppt-agent/web typecheck
# exit 0
```

## 验收

- [x] 策略标签为 ir/svg/hybrid 中文，不再总是「自动」
- [x] 导出响应含 warnings/pageResults 时可在第 5 步列表展示并清除
- [x] 无新字段时不报错
- [x] draft 下「按策略生成…」禁用；standard/visual 文案已区分
- [x] web typecheck 通过

## 遗留

- API `formatExport` 尚未把 `warnings` / `pageResults` / `mode` 写入响应体时，UI 提示块不会出现（待 API 联调）。
- API `formatSlide` 尚未计算回传 `renderStrategy` 时，标签来自前端推断（语义正确，权威仍以后端为准）。
