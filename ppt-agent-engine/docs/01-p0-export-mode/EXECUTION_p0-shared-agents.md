# 执行说明：P0 shared + agents 可编译 SVG 契约（2026-07-17）

## 方案选型与权重

| 方案 | 权重 | 结论 |
|------|------|------|
| A SVG-only，弱化 IR | 52 | 不选：质检/降级弱 |
| **B IR 骨架 + SVG 视觉增强** | **90** | **已选并执行** |

本任务只落地契约层（shared / agents / 文档），不改 api / web / renderer。

## 改动文件

| 文件 | 说明 |
|------|------|
| `docs/00-architecture/COMPILABLE_SVG.md` | 新建：本项目适用的可编译 SVG 精简契约 |
| `docs/01-p0-export-mode/EXECUTION_p0-shared-agents.md` | 本执行说明 |
| `packages/shared/src/index.ts` | `renderStrategies` / `exportModes`、导出 schema、`SlideDto.renderStrategy`、`inferRenderStrategy`、`getBannedSvgFeatures` |
| `packages/agents/src/prompts.ts` | `svgPreviewSystemPrompt` 同步硬规则（精简，非全文粘贴） |

未改：`apps/api`、`apps/web`、`packages/ppt-renderer`；agents mock/real adapter 仍只接 `theme`，无需为大改 Gemini 调用。

## 关键 API / 行为摘要

### `exportPptxSchema`

- 保留 `theme`、`draft`
- 新增可选 `mode?: "draft" | "standard" | "visual"`
- 归一化：`mode` 优先；否则 `draft:true` → `mode=draft`；默认 `mode=standard`
- 输出始终带 `draft: mode === "draft"`，兼容旧调用方

### `inferRenderStrategy(slide)`

基于 `title` + `recommendedLayout` + `planJson.layoutType` 拼接启发式：

1. 命中表格/行动/风险等 → `ir`
2. 命中封面/流程/对比/bento 等 → `svg`
3. 其余 → `hybrid`

### `getBannedSvgFeatures(svg)`

检测：`style`、`class`、`mask`、`foreignObject`、`symbol`、`textPath`、`@font-face`、`animate`/`set`、`script`、`iframe`。

## 验证

```text
corepack pnpm --filter @ppt-agent/shared typecheck  → 通过
corepack pnpm --filter @ppt-agent/agents typecheck  → 通过
```

## 后续（非本任务）

- API 导出按 `mode` + 每页 `renderStrategy` 分支
- renderer 接入 `getBannedSvgFeatures` 硬门禁
- Web 暴露标准版 / 高视觉版按钮
