# SmartDiagram — Gemini CLI 入口

> 本文是 Gemini CLI / Antigravity 的快速上下文注入文件。详细架构见 `AGENTS.md`。

---

## 阅读顺序

1. [`AGENTS.md`](./AGENTS.md) — 工具流程、文档分工、代码查找
2. [`smartdiagram_architecture.md`](./smartdiagram_architecture.md) — 架构真相源（§8 改动定位表）
3. [`.trellis/workflow.md`](./.trellis/workflow.md) — Trellis 工程工作流（Plan → Execute → Finish）
4. [`README.md`](./README.md) — 启动、部署命令

## Trellis 工作流

本项目通过 Trellis 管理 AI 会话的规范、任务和跨会话记忆。

- **规范**：`.trellis/spec/<package>/<layer>/index.md`
- **任务**：`.trellis/tasks/` — PRD、设计、实施计划
- **记忆**：`.trellis/workspace/` — 开发者日志
- **工作流**：简单任务直接做；复杂任务走 Plan → Execute → Finish

```bash
python3 ./.trellis/scripts/get_context.py --mode packages   # 列出所有包和规范
python3 ./.trellis/scripts/task.py current --source          # 查看当前任务
```

## 改代码约定

- 最小 diff，匹配现有风格
- 结构 / 路径变更 → 只更新 `smartdiagram_architecture.md`
- 勿泄露 `.env` 密钥；勿未经要求 `git commit`

<!-- CODEGRAPH_START -->
## CodeGraph

存在 `.codegraph/` 时，**先于 grep/Read** 使用 MCP（`codegraph_explore`、`codegraph_node`）或 Shell（`codegraph explore`、`codegraph node`）。

若无索引：查代码前先 `codegraph init`（CLI 已装时）并提示用户；否则降级 `Grep` + `Read`。安装见 `AGENTS.md` §3.1 或[官方文档](https://colbymchenry.github.io/codegraph/getting-started/installation/)。
<!-- CODEGRAPH_END -->
