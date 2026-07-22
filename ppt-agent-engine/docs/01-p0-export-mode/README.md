# 01 · P0 导出模式与硬门禁

## 阶段目标

纠正「正式导出几乎强制 SVG、失败整份挂掉」：落地 **`draft` / `standard` / `visual`**，硬化可编译 SVG 检查，导出按页可降级。

## 文档清单

| 文档 | 类型 | 说明 |
|------|------|------|
| [EXECUTION_p0-shared-agents.md](./EXECUTION_p0-shared-agents.md) | 执行 | shared 类型 + agents 门禁提示词 + COMPILABLE_SVG |
| [EXECUTION_p0-api-renderer.md](./EXECUTION_p0-api-renderer.md) | 执行 | API mode、renderer 按页降级 |
| [EXECUTION_p0-web.md](./EXECUTION_p0-web.md) | 执行 | 前端三模式 UI |
| [EXECUTION_p0-integration.md](./EXECUTION_p0-integration.md) | 执行 | 四路集成收口与 typecheck |
| [EXPERIENCE_p0-web-export-mode.md](./EXPERIENCE_p0-web-export-mode.md) | 经验 | 导出模式 UI |
| [EXPERIENCE_p0-integration.md](./EXPERIENCE_p0-integration.md) | 经验 | 并行 Agent 收口 |

## 完成事项时间线（2026-07-17）

| 事项 | 结果 |
|------|------|
| shared：`ExportMode` / `RenderStrategy` / `inferRenderStrategy` | 单一真相源 |
| agents：SVG 硬门禁对齐契约文档 | 提示词 + `getBannedSvgFeatures` |
| api + ppt-renderer：按 mode 准备与按页降级 | 单页失败不再拖死整份 |
| web：三模式选择与 busy 文案 | `exportMode.ts` |
| 集成：字段核对 + typecheck | EXECUTION_p0-integration |

← [00 架构](../00-architecture/README.md) · [文档中心](../README.md) · 下一阶段 → [02 P1](../02-p1-svg-strategy/README.md)
