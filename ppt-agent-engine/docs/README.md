# PPT-agent-engine 文档中心

按**阶段**查阅「每天 / 每阶段做了什么」。完整产品与技术总览见设计文稿。

## 从这里开始

| 文档 | 说明 |
|------|------|
| [**DESIGN_文章式PPT_Agent工作室.md**](./DESIGN_文章式PPT_Agent工作室.md) | 完整设计说明：IA、Studio、API、Prisma、提示词、Hybrid 导出、成功标准 |
| [prd/editable-ppt-agent-engine-prd.md](./prd/editable-ppt-agent-engine-prd.md) | 原始 PRD |
| [MAINTENANCE.md](./MAINTENANCE.md) | 日常维护清单 |
| [GIT_SETUP.md](./GIT_SETUP.md) | Git 初始化备忘 |
| [EXECUTION_docs-reorg-2026-07-17.md](./EXECUTION_docs-reorg-2026-07-17.md) | 本次文档分阶段整理的执行记录 |
| [EXPERIENCE_docs-phased-organization.md](./EXPERIENCE_docs-phased-organization.md) | 文档按阶段分目录的经验 |

## 阶段目录

| 目录 | 阶段目标 | 入口 |
|------|----------|------|
| [00-architecture/](./00-architecture/) | 架构评审、Hybrid 策略、可编译 SVG、优化总计划 | [README](./00-architecture/README.md) |
| [01-p0-export-mode/](./01-p0-export-mode/) | 导出三模式 + SVG 硬门禁 + 按页降级 | [README](./01-p0-export-mode/README.md) |
| [02-p1-svg-strategy/](./02-p1-svg-strategy/) | `renderStrategy`、编译增强、导出 warnings | [README](./02-p1-svg-strategy/README.md) |
| [03-p2-grade-usage/](./03-p2-grade-usage/) | 策略锁定、可编辑等级、用量、回归脚本 | [README](./03-p2-grade-usage/README.md) |
| [04-article-studio-redesign/](./04-article-studio-redesign/) | 文章式工作室 IA、Brief/Board/Studio、搜索适配器 | [README](./04-article-studio-redesign/README.md) |
| [prd/](./prd/) | 产品需求原文 | — |
| [archive/](./archive/) | 过时碎片（尽量少用） | [README](./archive/README.md) |

## 按日 / 按阶段时间线（2026-07-17）

同一日内完成底座 → Hybrid P0–P2 → 工作室重设计。细项见各阶段 README。

| 时段（约） | 阶段 | 干了什么 |
|------------|------|----------|
| 当日早 | **00 架构底座** | 架构评审；IR+SVG Hybrid 策略；svg2pptx 对照；可编译 SVG 契约；可执行优化总计划 |
| 当日后续 | **00 架构底座** | dashi-ppt-skill 浅克隆对照（主题/HTML Deck/导出与 AGPL 边界） |
| 当日中 | **01 P0** | `draft/standard/visual` 契约；硬门禁；renderer 按页降级；Web 三模式 UI；集成收口 |
| 当日中后 | **02 P1** | `Slide.renderStrategy` 入库；`svgCompile`（XML/tspan/渐变/箭头）；导出 warnings + pageResults |
| 当日晚前 | **03 P2** | `strategyLocked`、editableGrade、`/api/ai/usage`、按页策略切换 UI、SVG 回归脚本 |
| 当日晚 | **04 工作室** | 路由拆页；Brief/Paste/Board/Studio/Export；run-pipeline；ResearchAdapter |
| 当日晚后 | **04 工作室** | Dashi 启发第一期：自研 ThemePack / 版式角色 / 提示词（合规，见 EXECUTION_dashi-inspired） |

## 建议阅读路径

1. [完整设计文稿](./DESIGN_文章式PPT_Agent工作室.md)  
2. [Hybrid 策略](./00-architecture/HYBRID_IR_SVG_STRATEGY.md) + [优化总计划](./00-architecture/OPTIMIZATION_PLAN.md)  
3. 各阶段 `EXECUTION_*-integration.md`（P0→P2）  
4. [文章式重设计执行](./04-article-studio-redesign/EXECUTION_article-studio-redesign.md)  

工程启动说明见仓库根 [`../README.md`](../README.md) 与上层 [`../../README.md`](../../README.md)。
