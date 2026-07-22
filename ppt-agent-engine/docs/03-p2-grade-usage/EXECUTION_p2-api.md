# 执行文档：P2 API（策略覆盖 + editableGrade + AI 用量）（2026-07-17）

## 需求

对照 `OPTIMIZATION_PLAN.md` P2、`EXECUTION_p1-integration.md` P2 遗留、`HYBRID_IR_SVG_STRATEGY.md`：

1. **按页策略可覆盖**：`PATCH` 单页 `renderStrategy`（校验 `ir|svg|hybrid`）；`strategyLocked` 防止大纲重生成覆盖
2. **可编辑等级 `editableGrade`**：导出后每页标注 `A|B|C`，规则在 shared 纯函数
3. **成本/调用粗指标**：进程内内存计数；暴露 `GET /api/ai/usage`，并挂到 `/api/ai/status`
4. **design 继续尊重 mode**；`ir`（含锁定）页跳过设计模型

范围：**API + shared + 必要 prisma**；不扩 P3；不改 web 大文件；不 commit。

## 方案与权重

| 方案 | 权重 | 说明 |
|------|------|------|
| A 仅文档不改代码 | 30 | 契约已有，但无锁定/等级/用量，P2 验收空转 |
| **B 落地策略覆盖 + 等级 + 用量 API** | **88** | 小迁移 + 纯函数 + 内存计数；可测、可并行给 Web |

**选用 B。**

## 已执行

### Prisma / DB

- `Slide.strategyLocked Boolean @default(false)`
- 迁移：`prisma/migrations/20260717010000_slide_strategy_locked/migration.sql`
- 已跑：`pnpm db:generate` + `pnpm db:migrate`（Applied）

### `packages/shared`

| 项 | 说明 |
|----|------|
| `editableGrades` / `EditableGrade` / `EditableGradeSchema` | `A\|B\|C` |
| `inferEditableGrade(input)` | 纯函数规则（见下） |
| `withEditableGrades(results)` | 批量为 `pageResults` 填等级 |
| `updateSlideSchema.strategyLocked?` | 可选布尔 |
| `SlideDto.strategyLocked?` | 回传锁定态 |
| `PageRenderResult.editableGrade?` | 导出摘要字段 |
| `AiUsageCounts` / `AiExportUsageSummary` / `AiUsageDto` | 粗用量类型 |

#### `inferEditableGrade` 规则

| 等级 | 条件 | 语义 |
|------|------|------|
| **A** | `path === "svg"` 且无 `warning` | 全文可改 / SVG 成功 |
| **B** | SVG 带 warning；或策略为 `svg/hybrid` 但 `path === "ir"` | 主体可改 / 部分降级 |
| **C** | 其余（纯 IR 策略、theme 模板等） | 装饰降级或纯 IR 模板 |

### `apps/api`

#### 策略覆盖与锁定

- `PATCH /api/projects/:id/slides/:slideId`
  - `renderStrategy` 经 Zod 校验 `ir|svg|hybrid`
  - 手动设置 `renderStrategy` → 默认 `strategyLocked=true`（可显式传 `strategyLocked` 覆盖）
  - 锁定页：layout/plan 重算走 `resolveNextStrategy`，不覆盖库值
- `POST .../generate-outline`
  - body `force?: boolean`
  - `force !== true` 时按 **sortOrder 下标** 保留上一轮 `strategyLocked` 页的策略
  - `force=true` 全部按 layout 重推断
- 策划 / IR / 设计写回路径统一 `resolveNextStrategy`（锁定优先）

#### design 跳过强化（P1 延续）

- `generate-design` / `generate-all-designs` / `prepareSlidesForExport`：`!shouldGenerateSvgForMode` → 不调设计模型
- 跳过文案带「已锁定 / 未锁定」提示

#### editableGrade 导出

- `export-pptx`：`pageResults = withEditableGrades(rendered.pageResults)`
- 响应 `ExportDto.pageResults[].editableGrade` 始终有值

#### AI 用量粗指标

- 新文件 `apps/api/src/lib/aiUsage.ts`
  - 包装适配器计数：`extractFacts` / `outline` / `plan` / `ir` / `svg`
  - `lastExportSummary`：最近一次导出的 mode / 页数 / gradeCounts / warningCount
- `GET /api/ai/usage` → `ok(AiUsageDto)`
- `GET /api/ai/status` → 扩展字段 `usage`（同结构）

### 未改（有意边界）

- 未做完整 token/计费 DB（P2 明确不做）
- 未做 Web 按页策略切换 UI（属 P2-web；API 已就绪）
- 未改 SVG 编译内核 / renderer 大拆分
- 未 commit

## Typecheck

```text
corepack pnpm db:generate                          → pass
corepack pnpm db:migrate                           → Applied 20260717010000_slide_strategy_locked
corepack pnpm --filter @ppt-agent/shared typecheck → pass
corepack pnpm --filter @ppt-agent/api typecheck    → pass
```

## 验收对照

- [x] PATCH 可写 `renderStrategy`（ir|svg|hybrid）并持久化
- [x] `strategyLocked` 字段 + 手动 patch 默认锁定
- [x] 大纲重生成非 force 保留锁定页策略
- [x] export `pageResults[].editableGrade` = A|B|C
- [x] shared `inferEditableGrade` 纯函数
- [x] `GET /api/ai/usage` + status 扩展 `usage`
- [x] ir / draft 跳过设计模型（强化）
- [x] shared / api typecheck 通过
- [x] 执行文档落地
- [ ] 未 commit（按任务要求）

## 风险

1. 大纲保留按 **页序下标** 对齐；页数变化时超出部分无法保留，属预期。
2. 用量为 **本进程内存**，重启清零；多实例不共享——仅粗指标。
3. 未锁定页在 plan/IR 重算时会按 layout **重推断**策略（避免永远钉死首次自动值）；仅锁定页钉死。

## 对照 OPTIMIZATION_PLAN P2

| 项 | 本轮 | 说明 |
|----|------|------|
| P2-1 按页策略切换 | API 完成 | Web UI 仍待 |
| P2-2 按策略跳过设计模型 | 强化完成 | mode + ir + locked |
| P2-3 可编辑等级标注 | 完成 | export pageResults |
| P2-4 质检与成本看板 | 粗指标完成 | 无 token/溢出看板 |
