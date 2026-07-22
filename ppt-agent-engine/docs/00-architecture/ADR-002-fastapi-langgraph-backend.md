# ADR-002：以 FastAPI + LangGraph 替换路由内流水线

## 状态

Accepted（渐进迁移）

## 背景

原 Fastify 后端同时承担 CRUD、AI Provider、检索、页面编排、SSE、SVG 质量检查和 PPTX 渲染。`run-pipeline` 把需求确认、大纲、逐页检索、初稿和设计写在同一条路由函数中，导致步骤不可恢复、不可独立测试，前端也无法可靠知道当前执行节点。

## 方案比较

| 方案 | 优点 | 代价 |
| --- | --- | --- |
| 继续扩展 Fastify | 改动最少 | 编排、状态和路由继续耦合 |
| 一次性全部改写 Python | 最终技术栈统一 | 30+ API、Prisma 和 PPTX 渲染同时中断，风险不可控 |
| FastAPI 主入口 + LangGraph 核心链路 + Node 侧车 | 前端零改动；核心编排立即迁移；可逐个替换 CRUD/渲染 | 迁移期需要运行两个后端进程 |

## 决策

采用第三种“绞杀者迁移”方案：

1. FastAPI 监听 4000，成为浏览器唯一后端入口。
2. LangGraph 负责 `run-pipeline`，项目级节点之后使用 `Send` 将每一页动态分发给 `search_page`、`draft_page` 和 `design_page`，再分别 fan-in 到质量汇总节点。
3. `draft` 模式或 `skipDesign` 通过条件边跳过 `design_page` fan-out；全量检索失败时直接进入 `finalize`。
4. 未迁移 API 由 FastAPI 转发给仅监听 127.0.0.1:4010 的 Node 侧车。
5. FastAPI SSE 合并 LangGraph 自定义事件和侧车的模型 token，前端继续使用原 `/progress` 契约。
6. 页面结果通过 reducer 汇总；单页失败被隔离为结构化错误，不会让其他页面的成功结果丢失。
7. 同一项目只允许一个完整图运行，防止并发修改同一批页面。

## 为什么不是“每一步都做一个自由 Agent”

PPT 生产是长时、状态化但目标明确的工作流。LangGraph 官方建议将流程拆成职责单一的节点、让状态保存原始数据、将错误作为路由的一部分，并通过 streaming/persistence 暴露执行过程。这里采用确定性图作为骨架，在各节点内部调用 Researcher、Draft Writer、Designer，而不是让多个 Agent 随机互相聊天。

## 状态与恢复

当前图使用 `thread_id` 和官方 `AsyncSqliteSaver`，checkpoint 写入 `storage/langgraph/checkpoints.sqlite`，可在进程重启后检查并恢复节点状态；业务产物继续写入现有项目 SQLite。生产环境改为多实例时应把 Checkpointer 换为 Postgres saver。

## 后续替换顺序

1. Python 直接读取/写入现有 SQLite，迁移 Project/Slide CRUD。
2. 把 OpenAI-compatible、Gemini、Tavily adapter 移到 Python 节点。
3. Node 只保留 PPTX renderer RPC。
4. Python renderer 达到同等可编辑性后删除 Node 侧车。

## 参考

- LangGraph Graph API：StateGraph、节点、条件边和 compile。
- LangGraph Streaming：`updates` + `custom`，用于节点状态和自定义模型输出。
- LangGraph Persistence：用 `thread_id` 组织 checkpoint，实现恢复、人机介入与故障容错。
