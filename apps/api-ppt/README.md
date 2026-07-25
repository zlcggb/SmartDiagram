# PPT Agent FastAPI Backend

FastAPI 是浏览器唯一访问的后端入口（默认 `127.0.0.1:4000`），LangGraph 负责 PPT 生成编排。迁移期 Node 服务仅在 `127.0.0.1:4010` 提供现有数据访问、AI adapter 和 PPTX 渲染能力，未迁移 API 由 FastAPI 透明转发。

## 启动

推荐继续使用项目原脚本：

```bash
./start-dev.sh
```

脚本会自动执行 `uv sync --project apps/api-python`，随后启动：

- FastAPI + LangGraph：`http://127.0.0.1:4000`
- Node 兼容/渲染侧车：`http://127.0.0.1:4010`
- Web：`http://127.0.0.1:5173`

单独运行 Python 测试：

```bash
uv run --project apps/api-python pytest
```

查看当前编排图：

```text
GET /api/orchestration/graph
```

## 工作流

```text
load_project
  → prepare_context
  → ensure_outline
  → Send(search_page × N) → aggregate_search
  → Send(draft_page × N)  → aggregate_draft
  → Send(design_page × N) → aggregate_design
  → finalize
```

- 三个按页阶段均使用 LangGraph `Send` 动态 fan-out。
- `page_results`、`errors` 和 `logs` 使用 reducer 在 fan-in 阶段合并。
- `draft` 或 `skipDesign` 通过条件边跳过设计。
- 单页错误被隔离，其他页面继续运行。
- SSE 同时合并 LangGraph 节点事件和侧车模型 token。
- checkpoint 持久化到 `storage/langgraph/checkpoints.sqlite`。

详细决策见 [ADR-002](../../docs/00-architecture/ADR-002-fastapi-langgraph-backend.md)。
