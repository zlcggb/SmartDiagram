# 执行文档：P1 集成收口（2026-07-17）

## 需求

三路 P1 交付后做契约与类型收口：核对 web 消费的 export 字段与 API 返回一致；全仓 typecheck；记录对照 `OPTIMIZATION_PLAN` 的 P2 遗留。

## 方案与权重

| 方案 | 权重 | 说明 |
|------|------|------|
| A：保留 web 本地 `PageRenderResultDto`（`used`）+ 宽松可选字段 | 58 | 兼容旧草稿，但与 shared `path` 漂移，后续易 silently 错字段 |
| **B：web 直接对齐 `@ppt-agent/shared` ExportDto / PageRenderResult** | **92** | 单一真相源；warnings 收集逻辑不变；小 diff |

**选用 B。**

## 三路交付清单

| 路 | 文档 | 交付要点 | 状态 |
|----|------|----------|------|
| API | `docs/02-p1-svg-strategy/EXECUTION_p1-api.md` | `Slide.renderStrategy` 入库回传；mode 分流；export `warnings` + `pageResults` | 已完成 |
| Web | `docs/02-p1-svg-strategy/EXECUTION_p1-web.md` | 策略中文标签；导出 warnings UI；draft 禁批量设计 | 已完成 |
| Renderer | `docs/02-p1-svg-strategy/EXECUTION_p1-renderer.md` | `svgCompile.ts`：XML / tspan / 渐变近似 / 箭头 | 已完成 |
| 集成收口 | 本文档 | 字段核对 + typecheck + 小冲突修复 | 已完成 |

## 前后端字段核对

### `POST .../export-pptx` 响应 `data`

| 字段 | shared / API (`formatExport`) | Web 消费 | 结论 |
|------|-------------------------------|----------|------|
| `mode` | `ExportMode?` | 可选；不驱动 UI 列表 | 一致 |
| `warnings` | `string[]?` | `collectExportWarnings` 合并展示 | 一致 |
| `pageResults` | `PageRenderResult[]?` | 取每页 `warning` 并入列表 | 一致 |
| `pageResults[].slideId` | `string` | 未单独展示 | 一致 |
| `pageResults[].strategy` | `RenderStrategy` | 未单独展示（页列表用 slide 策略） | 一致 |
| `pageResults[].path` | `"svg" \| "ir" \| "theme"` | 曾误写本地 `used`；已改对齐 shared | **已修** |
| `pageResults[].warning` | `string?` | 去重后进 `exportWarnings` | 一致 |

### `SlideDto.renderStrategy`

| 来源 | 行为 | 结论 |
|------|------|------|
| API `formatSlide` | 库值或 `inferRenderStrategy`，始终回传 | 权威 |
| Web `renderStrategyHint` | 优先 `slide.renderStrategy`，否则前端推断 | 一致；无「自动」 |

### 本轮小冲突修复

1. `apps/web/src/lib/api.ts`
   - `PageRenderResultDto` → 别名 `PageRenderResult`（字段为 `path`，不再是 `used`）
   - `ExportFeedbackDto` → 别名 `ExportDto`（已含 `mode` / `warnings` / `pageResults`）
   - `collectExportWarnings` 入参改为 `ExportDto`

## Typecheck

```text
corepack pnpm typecheck
# Scope: 5 of 6 workspace projects
# packages/shared / agents / ppt-renderer / apps/web / apps/api — Done
# exit 0
```

## 对照 OPTIMIZATION_PLAN：P1 / P2

### P1 项

| 项 | 计划验收 | 本轮结论 |
|----|----------|----------|
| P1-1 XML DOM + tspan | svg-compile | **完成**（同包 `svgCompile.ts`，非独立 npm 包） |
| P1-2 linearGradient / marker / g | 基础能力 | **完成**（渐变为 solid 近似） |
| P1-3 包拆分 themes / ir-render | 可分别单测 | **未做**（有意边界，见 renderer 执行文档） |
| P1-4 examples 对照回归 | 对象数/可编辑性报告 | **未做** |

### P2 遗留（下一阶段）

| 项 | 说明 | 与现状关系 |
|----|------|------------|
| P2-1 按页策略切换 UI | 用户强制「只要稳 / 要好看」并 PATCH 持久化 | API 已支持 `updateSlideSchema.renderStrategy`；Web 仅展示未切换 |
| P2-2 按策略跳过设计模型 | `ir` 页默认不调设计模型 | **部分完成**：P1 API 已按 mode/`shouldGenerateSvgForMode` 分流；产品文案与「全部生成」语义可再打磨 |
| P2-3 可编辑等级标注 | A/B/C 写入导出摘要 | 未做 |
| P2-4 质检与成本看板 | 溢出/元素数；token/耗时 | 未做 |
| P1 尾巴 | 包拆分 + fixture 对照回归 | 可挂 P2 前半或独立小迭代 |

## 验收对照

- [x] warnings / pageResults / renderStrategy 前后端字段名与语义对齐
- [x] 全仓 `corepack pnpm typecheck` 通过
- [x] 小冲突（`used` vs `path`）已修
- [x] 执行文档落地
- [ ] 未 commit（按任务要求）

## 风险

1. 历史导出列表 `GET project` 里的 `exports` 无 `warnings`/`pageResults`（仅当次 export-pptx 响应带）；UI 依赖「最近一次导出」状态，符合预期。
2. `pageResults[].path` 目前未在 UI 展示；P2 若要做「本页走了 svg/ir」明细，直接读该字段即可。
