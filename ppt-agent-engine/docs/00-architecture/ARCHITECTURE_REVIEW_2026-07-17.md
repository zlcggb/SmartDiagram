# PPT-Agent 架构分析与执行记录（2026-07-17）

## 1. 任务目标

分析当前项目的技术栈、设计思路、用途、不足之处，以及未来需要完善的点。

## 2. 方案对比与选型

| 维度 | 方案 A：继续 SVG-first | 方案 B：回归 IR-first（选用） |
|------|------------------------|-------------------------------|
| 视觉上限 | 高 | 中高（主题模板 + IR） |
| 可控 / 可校验 | 低 | 高 |
| 可测试性 | 低 | 高 |
| 与 PRD 一致性 | 低（漂移） | 高 |
| 短期改动量 | 小 | 中 |
| **综合权重** | **58** | **84** |

**选型结论：** 分析阶段采用方案 B 作为后续演进方向——正式导出以 Slide IR 为契约，SVG 回归预览/装饰角色。本次不改代码，只输出分析结论与路线图。

权重口径：可控 30% + 可测 25% + PRD 一致 25% + 视觉 10% + 工期 10%。

## 3. 用途

本地优先的「可编辑 PPT Agent 引擎」原型，服务几乎没有 AI 使用经验的业务用户：

- 粘贴项目资料
- 确认事实
- 生成便利贴大纲与单页策划
- 导出可在 PowerPoint 中继续编辑的 PPTX（文本框 / 形状 / 表格，而非整页图片）

首期场景聚焦：项目周报、售前方案、产品介绍（实现上目前更偏周报工作台）。

## 4. 技术栈

| 层级 | 选型 |
|------|------|
| Monorepo | pnpm workspace |
| 语言 | TypeScript 5.x |
| Web | React 18、Vite 6、Tailwind、Zustand、react-router、lucide-react |
| API | Fastify 5、@fastify/cors、@fastify/static、Zod |
| 数据 | Prisma 6、SQLite |
| AI | Gemini（`GEMINI_MODEL` + `GEMINI_DESIGN_MODEL`）、Mock Adapter、undici |
| PPT | pptxgenjs（`@ppt-agent/ppt-renderer`） |
| 共享 | `@ppt-agent/shared`（Zod schema + DTO + Slide IR） |

包结构：

- `apps/api`：项目编排、AI 调用、导出
- `apps/web`：5 步工作台
- `packages/agents`：提示词与 Gemini/Mock 适配器
- `packages/ppt-renderer`：SVG/IR → PPTX
- `packages/shared`：契约与类型
- `prisma`：本地库表
- `docs`：PRD / 维护手册

## 5. 设计思路

### 5.1 产品设计

「模型策划 + 结构协议 + 原生 PPTX 渲染」：

1. 场景化输入，少填表
2. 事实提取后人机确认（防幻觉）
3. 大纲 → 单页策划 →（理想）Slide IR → 原生 PPTX
4. SVG 作为视觉预览，不承载最终正文主源
5. Adapter 抽象，便于换模型；Key 仅存后端

### 5.2 实现现实（与 PRD 的漂移）

当前正式导出链路更接近：

`资料 → 事实 → 大纲 → SVG/Bento 设计 → sanitize → SVG 转原生对象 → PPTX`

依据：

- 正式导出要求每页有 `svgPreview`
- `renderProjectPptx` 优先 `renderSvgPreviewSlide`，成功则直接 return
- IR / 主题模板 / fallback 主要服务草稿或无 SVG 路径

这是当前最大的架构债。

## 6. 不足

1. **架构漂移**：PRD 护城河是可校验 Slide IR；实现主路径是 SVG→PPTX。
2. **渲染器单体过大**：`ppt-renderer` 约 2100 行，主题模板、IR 渲染、SVG 解析耦合。
3. **无自动化测试**：无 unit/e2e；导出质量靠人工打开 PPTX。
4. **质检未落地**：溢出、元素数量、布局合法性、自动修复仍停在 PRD。
5. **场景未产品化**：M5 三场景规则包未完成；前端文案偏「企业内部项目汇报」。
6. **生产未就绪**：无鉴权、SQLite、CORS `origin: true`、无 CI/可观测性/成本看板。
7. **视觉保真有上限**：滤镜、渐变、复杂 path 无法完整映射到 PPT 原生对象。
8. **前端可维护性**：`App.tsx` 近 800 行，步骤未拆组件。

## 7. 未来完善点（建议优先级）

### P0

- 纠正导出契约：正式版 IR-first，SVG 仅预览/装饰
- 拆分 `ppt-renderer`（parse / ir-render / themes）

### P1

- 页面质检 + 自动修复
- 按页重试上限、中间结果缓存、成本指标
- vitest：IR→PPTX、SVG sanitize、API contract

### P2

- 售前 / 产品介绍场景包
- Postgres + 基础鉴权 + API/静态站拆分部署

### P3（明确 Non-Goals 后再开）

- 文档/PDF/网页导入、模板商城、多人协作、完整在线编辑器

## 8. 本次执行内容

- 阅读 README、PRD、MAINTENANCE、核心包与导出链路源码
- 产出可视化分析 Canvas（旁路打开）
- 落本执行文档与经验笔记

未改业务代码。

## 9. 经验沉淀

见同目录 `EXPERIENCE_architecture-review.md`。
