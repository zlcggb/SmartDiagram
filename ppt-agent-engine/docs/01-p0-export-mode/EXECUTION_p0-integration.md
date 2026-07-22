# 执行文档：P0 集成收口（2026-07-17）

## 需求

四路 Agent 交付后做类型与契约收口：web 对齐 `@ppt-agent/shared`；核对 export / design 前后端字段；全仓 typecheck；记录遗留。

## 方案与权重

| 方案 | 权重 | 说明 |
|------|------|------|
| A：类型从 shared 导入，本地只留 UI 文案 / busy 文案 | **92** | 与 ExportMode / RenderStrategy 单一真相源一致；UI 行为不变 |
| B：把 exportModeOptions 等 UI 文案也下沉 shared | 55 | shared 不应背展示文案，改动面更大且无收益 |

选用 **A**。

## 四路交付清单

| 路 | 文档 / 范围 | 状态 |
|----|-------------|------|
| 计划 | `docs/00-architecture/OPTIMIZATION_PLAN.md` | 已完成 |
| shared + agents | `ExportMode` / `RenderStrategy` / `inferRenderStrategy` / `getBannedSvgFeatures`、`docs/00-architecture/COMPILABLE_SVG.md` | 已完成 |
| api + ppt-renderer | 按页降级、`mode`、硬门禁 | 已完成 |
| web | 三模式 UI、`exportMode.ts`（现已对齐 shared） | 已完成 |
| 集成收口 | 本文档 | 已完成 |

## 本轮改动

1. `apps/web/src/lib/exportMode.ts`
   - 删除本地重复 `PptExportMode` / `SlideRenderStrategy` 定义
   - 从 `@ppt-agent/shared` 使用 `ExportMode`、`RenderStrategy`、`inferRenderStrategy`、`renderStrategies`
   - 保留 UI：`exportModeOptions`、`exportModeBusyLabel`、`renderStrategyHint`
2. `apps/web/src/lib/api.ts`、`store/workbenchStore.ts`：`ExportMode` 直接从 shared 导入

## 前后端字段核对

| 接口 | Web → Body | API Schema / 使用 | 结论 |
|------|------------|-------------------|------|
| `POST .../export-pptx` | `{ theme, mode, draft }` | `exportPptxSchema` → `{ theme, mode, draft }`；渲染与准备按 `mode` | 一致 |
| `POST .../generate-design` | `{ theme, mode }` | `exportPptxSchema` 解析；**仅用 `theme`**（`mode` 透传可解析） | 契约兼容；mode 暂未影响设计生成 |
| `POST .../generate-all-designs` | `{ theme, force: true, mode }` | schema 解析 theme/mode；`force` 另读 body | 一致（mode 同上） |

兼容：`draft:true` 仍等价 `mode:"draft"`（schema transform）。

## Typecheck

```text
corepack pnpm typecheck
# Scope: 5 of 6 workspace projects
# packages/shared / agents / ppt-renderer / apps/web / apps/api — Done
# exit 0
```

## 遗留项（P1）

1. **SlideDto.renderStrategy 未由 API 持久化/回传**：前端多数仍显示「自动」；需在 prepare/format 写入策略字段。
2. **generate-design 的 mode**：当前忽略；可按 draft 跳过 / visual 加强重试等分流（可选）。
3. **按页降级警告回传 UI**：export 成功消息含降级提示，但 web 未结构化展示 prepareNotes / renderWarnings。
4. **经验沉淀**：混合策略与可编译 SVG 门禁在导出链路上会反复碰到，见 `EXPERIENCE_p0-integration.md`。
