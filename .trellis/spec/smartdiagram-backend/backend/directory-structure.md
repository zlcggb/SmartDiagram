# smartdiagram-backend — Directory Structure

## Layout

```
apps/api-diagram/
├── app/
│   ├── main.py                  # FastAPI app 入口，挂载所有 router
│   ├── core/
│   │   ├── config.py            # Settings 类（env 读取）
│   │   ├── db.py                # AsyncEngine + async_session + init_db
│   │   ├── llm.py               # LLM client 封装
│   │   └── logger.py            # logging.getLogger("smartdiagram")
│   ├── api/
│   │   ├── routes.py            # SSE /api/chat/stream 主入口
│   │   ├── routes_auth.py       # 认证
│   │   ├── routes_admin.py      # 租户管理
│   │   ├── routes_platform_admin.py  # 平台级管理
│   │   ├── routes_conversations.py   # 会话 CRUD
│   │   ├── routes_diagrams.py   # 图表 CRUD
│   │   ├── routes_exports.py    # 导出
│   │   ├── routes_knowledge.py  # 知识库
│   │   ├── routes_billing.py    # 计费
│   │   └── routes_pricing.py    # 定价
│   ├── agents/
│   │   ├── orchestrator.py      # LangGraph 主编排图
│   │   ├── router.py            # @tag / LLM 分类路由
│   │   ├── catalog.py           # Task↔Engine 映射
│   │   └── *_agent.py           # 各引擎 agent
│   ├── models/                  # SQLAlchemy/SQLModel 表模型
│   │   ├── conversation.py
│   │   ├── diagram.py
│   │   ├── export.py
│   │   └── ...
│   ├── services/                # 业务逻辑层
│   │   ├── identity_service.py
│   │   ├── diagram_persistence_service.py
│   │   ├── conversation_memory_service.py
│   │   ├── budget_service.py
│   │   ├── user_quota_service.py
│   │   └── ...
│   └── artifacts/               # 输出产物处理
│       └── catalog.py
├── scripts/
│   └── run_enterprise_workers.py
└── requirements.txt / pyproject.toml
```

## Conventions

- **Route files**: `routes_*.py`，每个域一个文件，全部在 `main.py` 中注册
- **Service files**: `*_service.py`，纯业务逻辑，不含 HTTP 相关
- **Model files**: 一个表模型一个文件，统一 `import_model_modules()` 确保 metadata 完整
- **Config**: 根 `.env` → `core/config.py` 的 `Settings` 类，不在代码中 `os.getenv`
- **Agent files**: `*_agent.py`，新引擎在 `catalog.py` 注册 Task↔Engine 映射
