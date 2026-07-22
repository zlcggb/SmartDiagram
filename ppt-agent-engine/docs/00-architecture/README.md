# 00 · 架构底座

## 阶段目标

在改产品 IA 之前，先定清：**用途、技术栈、与 PRD 的漂移、IR+SVG 相辅相成策略、可编译 SVG 契约、可执行优化路线**。本阶段以分析与契约文档为主（后续 P0–P2 按计划改代码）。

## 文档清单

| 文档 | 类型 | 说明 |
|------|------|------|
| [ARCHITECTURE_REVIEW_2026-07-17.md](./ARCHITECTURE_REVIEW_2026-07-17.md) | 评审 | 栈、用途、漂移、路线图 |
| [EXPERIENCE_architecture-review.md](./EXPERIENCE_architecture-review.md) | 经验 | 评审类任务复用要点 |
| [HYBRID_IR_SVG_STRATEGY.md](./HYBRID_IR_SVG_STRATEGY.md) | 策略 | IR 保底 + SVG 视觉 + 按页编译 |
| [COMPILABLE_SVG.md](./COMPILABLE_SVG.md) | 契约 | 可编译 SVG 硬/软规则 |
| [EXPERIENCE_compilable-svg-contract.md](./EXPERIENCE_compilable-svg-contract.md) | 经验 | 契约抽取经验 |
| [EXPERIENCE_export-degrade.md](./EXPERIENCE_export-degrade.md) | 经验 | 导出降级原则 |
| [OPTIMIZATION_PLAN.md](./OPTIMIZATION_PLAN.md) | 计划 | P0–P2 可执行优化总计划 |
| [EXPERIENCE_optimization-plan.md](./EXPERIENCE_optimization-plan.md) | 经验 | 写优化计划时的注意点 |
| [REFERENCE_svg2pptx_analysis.md](./REFERENCE_svg2pptx_analysis.md) | 对照 | 参考仓 svg2pptx / ppt-master |
| [EXECUTION_reference-clone-2026-07-17.md](./EXECUTION_reference-clone-2026-07-17.md) | 执行 | 参考仓克隆与对照产出 |
| [REFERENCE_dashi-ppt-skill.md](./REFERENCE_dashi-ppt-skill.md) | 对照 | 参考仓 dashi-ppt-skill（主题/HTML Deck/导出） |
| [EXECUTION_reference-dashi-clone-2026-07-17.md](./EXECUTION_reference-dashi-clone-2026-07-17.md) | 执行 | dashi 浅克隆与对照产出 |
| [EXPERIENCE_reference-dashi-ppt.md](./EXPERIENCE_reference-dashi-ppt.md) | 经验 | AGPL HTML-Deck 对照注意点 |
| [REFERENCE_grok-build-orchestration.md](./REFERENCE_grok-build-orchestration.md) | 对照 | grok-build Primary/Subagent 编排 |
| [EXECUTION_reference-grok-build-2026-07-18.md](./EXECUTION_reference-grok-build-2026-07-18.md) | 执行 | grok-build 浅克隆 + stageGraph 同构 |
| [EXECUTION_grok-orchestration-backend-2026-07-18.md](./EXECUTION_grok-orchestration-backend-2026-07-18.md) | 执行 | 「grok 当后端」评估 + OrchestrationBackend 骨架 |
| [EXPERIENCE_reference-coding-agent-vs-pipeline.md](./EXPERIENCE_reference-coding-agent-vs-pipeline.md) | 经验 | 编码 Agent 与产品流水线勿硬嵌 |
| [EXPERIENCE_grok-as-backend-boundary.md](./EXPERIENCE_grok-as-backend-boundary.md) | 经验 | 编码 Agent 当后端的端口/sidecar 边界 |
| （落地）[../04-article-studio-redesign/EXECUTION_dashi-inspired-integration.md](../04-article-studio-redesign/EXECUTION_dashi-inspired-integration.md) | 执行 | 对照后的自研主题包/版式角色第一期 |

## 完成事项时间线（2026-07-17）

| 事项 | 产出 |
|------|------|
| 架构评审（不改业务代码） | ARCHITECTURE_REVIEW + EXPERIENCE |
| 选定 Hybrid（非 SVG-only / 非纯 IR-only） | HYBRID_IR_SVG_STRATEGY |
| 抽出可编译 SVG 契约 | COMPILABLE_SVG |
| 对照参考仓能力边界 | REFERENCE + EXECUTION_reference-clone |
| 对照 dashi-ppt-skill（主题/HTML→PPTX） | REFERENCE_dashi + EXECUTION_reference-dashi-clone |
| 写下 P0–P2 并行落地计划 | OPTIMIZATION_PLAN |

← [文档中心](../README.md) · 下一阶段 → [01 P0](../01-p0-export-mode/README.md)
