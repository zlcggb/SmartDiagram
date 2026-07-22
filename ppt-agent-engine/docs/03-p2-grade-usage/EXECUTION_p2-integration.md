# 执行文档：P2 集成收口（2026-07-17）

## 需求

三路 P2 交付后做契约与验证收口：核对 web PATCH / 导出 / usage 字段与 api/shared 一致；全仓 typecheck + svg 回归；记录对照 `OPTIMIZATION_PLAN` 的剩余与 P3。

## 方案与权重

| 方案 | 权重 | 说明 |
|------|------|------|
| A：只写对照表，usage 仍靠平铺 callCount「失败隐藏」 | 52 | 文档看似对齐，但 UI 永远读不到 `AiUsageDto.counts`，P2-4 粗指标白做 |
| **B：对照表 + 修 web 解析对齐 shared AiUsageDto** | **90** | 单一真相源；小 diff；strategyLocked 可见即可 |

**选用 B。**

## 三路交付清单

| 路 | 文档 | 交付要点 | 状态 |
|----|------|----------|------|
| API | `docs/03-p2-grade-usage/EXECUTION_p2-api.md` | PATCH 策略覆盖 + `strategyLocked`；`editableGrade`；`/api/ai/usage` | 已完成 |
| Web | `docs/03-p2-grade-usage/EXECUTION_p2-web.md` | 按页策略切换；等级与用量展示 | 已完成 |
| 工程化 | `docs/03-p2-grade-usage/EXECUTION_p2-engineering.md` | svg 回归脚本 + `exportTypes` 拆分 | 已完成 |
| 集成收口 | 本文档 | 字段核对 + typecheck + 回归 + 小冲突修复 | 已完成 |

## 前后端字段核对

### `PATCH .../slides/:id`

| 字段 | shared / API | Web | 结论 |
|------|--------------|-----|------|
| `renderStrategy` | `updateSlideSchema`：`ir\|svg\|hybrid` | `updateSlideRenderStrategy` body 只传该字段 | 一致 |
| `strategyLocked` | 手动设策略默认 `true`；可显式覆盖 | 不传 body（依赖默认锁定）；读 `SlideDto.strategyLocked` 展示「已锁定」 | 一致 |

### `POST .../export-pptx` → `ExportDto`

| 字段 | shared / API | Web | 结论 |
|------|--------------|-----|------|
| `mode` / `warnings` | 可选 | 收集 warnings 展示 | 一致 |
| `pageResults[].slideId` | `string` | 等级列表按 id 对齐页序 | 一致 |
| `pageResults[].strategy` | `RenderStrategy` | 页列表用 slide 策略；结果内字段保留 | 一致 |
| `pageResults[].path` | `"svg" \| "ir" \| "theme"` | 类型对齐 shared；**禁止**本地 `used` | 一致 |
| `pageResults[].warning` | `string?` | 并入 `exportWarnings` | 一致 |
| `pageResults[].editableGrade` | `A\|B\|C`（`withEditableGrades`） | `resolveEditableGrade`；兼容易 `grade` | 一致 |

### `GET /api/ai/usage` / `GET /api/ai/status`

| 字段 | shared / API | Web（修前） | Web（修后） | 结论 |
|------|--------------|-------------|-------------|------|
| `counts` | `AiUsageCounts`（分项） | 只找平铺 `callCount` → 恒 null | 对 `data`/`usage`/`root` 求和 `counts` | **已修** |
| `lastExportSummary` | 最近导出摘要 | 未消费（有意） | 仍未展示明细 | 可接受 |
| status.`usage` | 同 `AiUsageDto` | 未识别嵌套 counts | 同上求和 | **已修** |

### `SlideDto`

| 字段 | API `formatSlide` | Web | 结论 |
|------|-------------------|-----|------|
| `renderStrategy` | 库值或推断，始终回传 | 切换器 + 中文标签 | 一致 |
| `strategyLocked` | `Boolean` | 详情徽章「已锁定」 | 一致 |

## 本轮小冲突修复

1. `apps/web/src/lib/api.ts` — `parseAiUsageSummary` 对齐 `AiUsageDto.counts` 求和；保留平铺 callCount 回落
2. `apps/web/src/App.tsx` — 展示 `strategyLocked`
3. `apps/web/src/lib/exportMode.ts` — 注释明确 `path` 权威、勿再引入 `used`

## 验证

```text
corepack pnpm typecheck
# Scope: 5 of 6 workspace projects
# shared / agents / ppt-renderer / web / api — Done
# exit 0

corepack pnpm test:svg-regression
# ✓ filtration_demo.svg: rendered=35 (>= 8)
# ✓ support_structure_demo.svg: rendered=82 (>= 8)
# [svg-compile-regression] OK: 2/2 cases
# exit 0
```

## 对照 OPTIMIZATION_PLAN：P2 完成度与剩余 / P3

### P2 项

| 项 | 计划验收 | 本轮结论 |
|----|----------|----------|
| P2-1 按页策略切换 UI | PATCH 持久化 | **完成**（API 锁定 + Web 切换器） |
| P2-2 按策略跳过设计模型 | `ir` 页不调设计模型 | **完成**（API 侧强化；Web 文案按策略） |
| P2-3 可编辑等级标注 | A/B/C 写入导出摘要 | **完成**（shared 推断 + export + Web 展示） |
| P2-4 质检与成本看板 | 溢出/元素数；token/耗时 | **部分**：进程内粗调用计数 + lastExportSummary；无 token/溢出看板 |

### P2 尾巴 / 工程债（可挂下一小迭代）

| 项 | 说明 |
|----|------|
| 用量明细 UI | `lastExportSummary.gradeCounts` / 分项 `counts` 未进看板 |
| P1-3 深拆包 | 仅 `svgCompile` + `exportTypes`；`ir-render` / themes 仍在 `index.ts` |
| hybrid 后校验 | OPTIMIZATION_PLAN：标题/关键 metric 强制来自 IR（P0–P2 未做） |
| 历史 exports 列表 | `GET project.exports` 仍无当次 `warnings`/`pageResults`（仅 export-pptx 响应有） |

### P3（OPTIMIZATION_PLAN / 架构评审 Non-Goals，本仓不在 P2 做）

| 项 | 来源 |
|----|------|
| 完整在线 PPT 编辑器、模板商城、多人协作 | OPTIMIZATION_PLAN §1.2 / PRD |
| 生产鉴权、Postgres、CI 全套运维线 | OPTIMIZATION_PLAN §1.2；架构评审 P3 |
| 文档 / PDF / 网页导入 | PRD Non-Goals |
| 整仓迁入 Python svg2pptx / 全面 DrawingML | 明确不做 |

## 验收对照

- [x] PATCH / export / usage / strategyLocked / editableGrade / pageResults.path 前后端对齐
- [x] usage 解析能读到 `AiUsageDto.counts`
- [x] `corepack pnpm typecheck` 通过
- [x] `corepack pnpm test:svg-regression` 通过
- [x] 执行文档落地
- [ ] 未 commit（按任务要求）

## 风险

1. 用量为**本进程内存**，重启清零；多实例不共享。
2. Web 用量只展示总次数，不展示分项；产品若要「成本看板」需另开迭代。
3. `pageResults[].path` 类型已对齐但 UI 未逐页展示渲染路径；需要时可直接读该字段。
