# 执行文档：P1 API（renderStrategy 入库 + mode 分流 + 导出结构化）（2026-07-17）

## 需求

落实 P0 集成遗留与 Hybrid 策略的 API 侧 P1：

1. **持久化/回传 `renderStrategy`**：大纲/更新/策划/导出准备时计算并写入 DB；`formatSlide` / SlideDto 始终带策略
2. **design 路径按 `mode` 分流**：draft 跳过 SVG；standard 按策略跳过 ir；visual 尽量为视觉页生成 SVG
3. **导出 warnings 结构化**：`export-pptx` 响应带 `warnings` + `pageResults`（与 renderer 对齐）

## 方案与权重

| 方案 | 权重 | 说明 |
|------|------|------|
| A 仅内存推断不入库 | 55 | 少迁移，前端仍常显示「自动」，无法按页覆盖持久化 |
| **B 入库 + API 回传** | **90** | Prisma 字段 + DTO 始终回传；与 Web 可选字段消费对齐 |

**选用 B。**

## 已执行

### Prisma / DB

- `Slide.renderStrategy String?`（`ir` \| `svg` \| `hybrid`）
- 迁移：`prisma/migrations/20260717000000_slide_render_strategy/migration.sql`
- `pnpm db:generate` + `pnpm db:migrate`（apply-migrations 兼容）

### `packages/shared`

- `updateSlideSchema.renderStrategy?`
- `PageRenderResult` + `ExportDto.mode?` / `warnings?` / `pageResults?`
- `effectiveRenderStrategy(slide, mode)`：draft→ir；visual 非 ir→svg；standard 尊重基策略
- `shouldGenerateSvgForMode(slide, mode)`：仅 svg/hybrid 生效策略调设计模型

### `apps/api`

- `formatSlide`：DB 有值用库值，否则 `inferRenderStrategy` 后返回（始终有 `renderStrategy`）
- `formatExport(record, extras?)`：导出可附带 mode / warnings / pageResults
- 写入策略的路径：
  - `generate-outline` / 新建空白页
  - `PATCH slide`（显式覆盖或 layout 变更时重算）
  - `generate-plan` / `generate-all-plans`
  - `generate-ir` / `ensureSlideIr` / SVG 设计生成
  - `prepareSlidesForExport` 导出前补写
- **mode 分流**
  - `generate-design`：`!shouldGenerateSvgForMode` → 只 ensure plan/IR，`skippedSvg: true`
  - `generate-all-designs`：ir/draft 跳过 SVG 并补 IR；visual 对违规 SVG 可重生成
  - `prepareSlidesForExport`：draft/ir 不调设计模型；visual 缺/违规 SVG 时补生成
- **export-pptx**：`data` 含 `mode`、`warnings: string[]`、`pageResults: PageRenderResult[]`

### `packages/ppt-renderer`（轻量，非编译内核）

- `RenderProjectPptxResult` 增加 `pageResults`
- 使用 `effectiveRenderStrategy`；单页记录 `path: svg|ir|theme` 与可选 `warning`

## mode 分流规则（摘要）

| mode | 设计生成 | 导出准备 |
|------|----------|----------|
| `draft` | 不调设计模型；ensure IR/plan | 全页按 ir；跳过 SVG |
| `standard` | ir 跳过 SVG；svg/hybrid 生成 | 尊重策略；缺 SVG 降级 IR，不强制补生成 |
| `visual` | 非 ir 提升为 svg 并尽量生成；ir 仍跳过 | 缺/违规 SVG 时尝试补生成，失败降级 |

## Typecheck

```text
corepack pnpm db:generate                          → pass
corepack pnpm --filter @ppt-agent/shared typecheck → pass
corepack pnpm --filter @ppt-agent/ppt-renderer typecheck → pass
corepack pnpm --filter @ppt-agent/api typecheck    → pass
```

## 未改（有意边界）

- 未大改 Web UI（Web 侧已可消费可选字段）
- 未改 SVG 编译内核（DOM/渐变等仍属 renderer P1 其他任务）
- 未 commit

## 验收对照

- [x] SlideDto 始终带回 `renderStrategy`（库值或推断）
- [x] Prisma 字段 + 迁移可 apply
- [x] draft / standard / visual 设计路径分流
- [x] export 响应含 warnings + pageResults
- [x] shared / api typecheck 通过
- [x] 执行文档落地

## 风险

1. 旧 slide 无列值时依赖 format 推断 + 导出/更新时补写；首次 GET 已能显示策略。
2. `formatExport` 第二参数不可直接传给 `Array.map`（index 冲突），列表处需箭头包装。
3. visual 导出仍可能现场调设计模型，成本与延迟高于 standard。
