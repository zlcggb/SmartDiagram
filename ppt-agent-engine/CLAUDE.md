# PPT-Agent Engine — AI 协作上下文

本文件面向后续进入该项目的 AI 助手（包括 Claude Code）。它告诉助手：从哪里开始读、改不同模块前要查什么、提交前做什么、以及项目的关键约定。

---

## 1. 必读文档（按顺序）

1. **[docs/PROJECT_GUIDE.md](./docs/PROJECT_GUIDE.md)** — 项目定位、工作流、特性、API 速查。
2. **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** — 系统架构、包边界、数据模型、数据流、扩展指南。
3. **[docs/DESIGN_文章式PPT_Agent工作室.md](./docs/DESIGN_文章式PPT_Agent工作室.md)** — 产品 / 技术总览。
4. **[docs/00-architecture/HYBRID_IR_SVG_STRATEGY.md](./docs/00-architecture/HYBRID_IR_SVG_STRATEGY.md)** — Hybrid 导出策略。
5. **[docs/00-architecture/COMPILABLE_SVG.md](./docs/00-architecture/COMPILABLE_SVG.md)** — 可编译 SVG 契约。

---

## 2. 修改不同模块前的检查清单

### 改导出 / PPTX 渲染

- 读 `docs/ARCHITECTURE.md` 第 7 章（SVG 编译与可编译契约）。
- 读 `docs/00-architecture/HYBRID_IR_SVG_STRATEGY.md`。
- 检查 `packages/ppt-renderer/src/index.ts` 的 `prepareSlidesForExport` 降级逻辑。
- 检查 `packages/ppt-renderer/src/svgCompile.ts` 硬门禁是否同步。

### 改 AI Prompt / 模型调用

- 读 `packages/agents/src/prompts.ts`。
- 读 `packages/agents/src/openaiCompatibleAdapter.ts` 的请求构造。
- 确认 `.env.example` 的变量说明是否需要更新。

### 改数据模型

- 读 `prisma/schema.prisma`。
- 读 `packages/shared/src/index.ts` 里的 DTO / format 函数。
- 新增字段后，需要：
  1. 新增 Prisma migration
  2. 更新 `formatProject` / `formatSlide` 等 format 函数
  3. 更新 Zod schema
  4. 更新前端 `SlideDto` 消费处

### 改前端路由 / 工作区

- 读 `apps/web/src/main.tsx` 路由表。
- 读 `apps/web/src/store/workbenchStore.ts` 状态与 action。
- 读 `apps/web/src/components/project-shell/` 壳层组件。

### 改主题 / 版式

- 读 `packages/shared/src/themePacks.ts`。
- 读 `packages/shared/src/layoutRoles.ts`。
- 读 `packages/shared/src/skeletons/`。

---

## 3. 提交前必做

```bash
# 全仓类型检查
corepack pnpm typecheck

# 如果改动了 SVG 编译或导出
corepack pnpm --filter @ppt-agent/ppt-renderer test
```

不要提交：
- `.env`
- `prisma/dev.db`
- `storage/exports/**`
- `node_modules`

---

## 4. 项目关键约定

### 渲染策略

- `ir`：结构化 IR 渲染，可编辑性最高。
- `svg`：SVG 编译为 PPT 原生对象。
- `hybrid`：IR + SVG 元素混合。
- 手动切换后 `strategyLocked = true`，非 force 大纲重生成会保留。

### SVG 硬门禁

- 禁止 `<style>`、class、mask、foreignObject、symbol、textPath、动画、脚本等。
- 必须 `viewBox="0 0 1280 720"`。
- 必须通过文字边界检查。
- 未通过则降级到 IR / 主题模板。

### 导出模式

- `draft`：强制 IR，低成本。
- `standard`：按页策略，失败降级（默认推荐）。
- `visual`：尽量 SVG，失败告警降级。

### 可编辑等级

- A：全文可编辑。
- B：主体可编辑。
- C：保真图或主题模板兜底。

---

## 5. 大修改后如何记录

每次有较大改动（涉及多文件、架构决策、流程调整），请在 `docs/ai-sessions/` 下新建一份记录：

```text
docs/ai-sessions/YYYY-MM-DD-简短主题.md
```

内容模板：

```markdown
# YYYY-MM-DD 简短主题

## 目标
## 改动范围
## 关键决策
## 新增/修改文件
## 验证结果
## 后续注意
```

这些记录不是 git 提交的替代品，而是给后续 AI 会话快速了解"最近发生了什么"。

---

## 6. 快速索引

| 想查什么 | 先看哪里 |
|----------|----------|
| 项目是什么 | `docs/PROJECT_GUIDE.md` |
| 架构怎么组织 | `docs/ARCHITECTURE.md` |
| 为什么这样设计 | `docs/DESIGN_文章式PPT_Agent工作室.md` |
| 导出逻辑 | `packages/ppt-renderer/src/index.ts` |
| AI 调用 | `packages/agents/src/openaiCompatibleAdapter.ts` |
| Prompt | `packages/agents/src/prompts.ts` |
| 数据模型 | `prisma/schema.prisma` |
| 主题/版式 | `packages/shared/src/themePacks.ts`、`layoutRoles.ts` |
| 前端状态 | `apps/web/src/store/workbenchStore.ts` |
| 路由 | `apps/web/src/main.tsx` |

---

## 7. 提问前的默认动作

当用户问"这个项目主要做什么"、"架构是什么"、"某段逻辑在哪里"时：

1. 先读 `docs/PROJECT_GUIDE.md` 和 `docs/ARCHITECTURE.md`。
2. 如果还不够，用 CodeGraph 查具体符号，而不是直接 grep。
3. 回答时引用文件路径，格式如 `docs/ARCHITECTURE.md:42`。
