# SmartDiagram 文档中心

> 人类与 AI 协作时的文档入口。架构真相源仍以 [`smartdiagram_architecture.md`](../smartdiagram_architecture.md) 为准；本目录存放 **部署、专项设计、执行记录与经验**。

---

## 快速导航

| 我想… | 文档 |
|--------|------|
| 项目结构、改哪个文件 | [smartdiagram_architecture.md](../smartdiagram_architecture.md)（§8 定位表） |
| 本地启动 / 部署 | [README.md](../README.md)、[DEPLOYMENT.md](./DEPLOYMENT.md) |
| 访客认证与配额 | [GUEST_AUTH.md](./GUEST_AUTH.md) |
| SmartSlide 的设计、生成、校验与版本链路 | [SMARTSLIDE_DESIGN_PIPELINE.md](./SMARTSLIDE_DESIGN_PIPELINE.md) |
| **平台用户中心 / 权限 / 用量配额（执行记录）** | [plans/2026-07-26-platform-quota-management-execution.md](./plans/2026-07-26-platform-quota-management-execution.md) |
| Agent 工具约定 | [AGENTS.md](../AGENTS.md) |

---

## 文档分工

| 类型 | 路径 | 何时更新 |
|------|------|----------|
| 架构与边界 | 根目录 `smartdiagram_architecture.md` | 模块/API/目录变更 |
| 操作命令 | 根目录 `README.md` | 启动、npm 脚本变更 |
| 产品/链路说明 | `docs/*.md`（如 `GUEST_AUTH.md`） | 行为、env、API 契约 |
| **执行过程 + 经验 + 流程规范** | `docs/plans/YYYY-MM-DD-*.md` | 完成一阶段功能后补充 |
| 部署细节 | `docs/DEPLOYMENT.md`、`SERVER_DEPLOYMENT.md` | 运维流程变更 |

---

## 执行记录索引（plans/）

| 日期 | 主题 |
|------|------|
| 2026-07-26 | [平台配额与权限分级 — 执行记录](./plans/2026-07-26-platform-quota-management-execution.md) |
| 2026-07-25 | [统一 env 经验](./plans/2026-07-25-unify-env-experience.md) |
| 2026-07-25 | [FSD import 修复经验](./plans/2026-07-25-fsd-import-fix-experience.md) |
| 2026-05-26 | [Enterprise ops guardrails](./plans/2026-05-26-enterprise-ops-guardrails.md) |

新增执行记录时：在本表追加一行，并在对应功能的产品 doc（如 `GUEST_AUTH.md`）末尾加「详见 plans/…」链接。

---

## 写执行文档的最低模板

1. **需求演进** — 表格列阶段与产出  
2. **方案对比** — 2 方案 + 权重 + 选用结论  
3. **架构/拦截顺序** — 图或步骤表  
4. **文件定位表** — 方便 §8 与 CodeGraph 对照  
5. **流程规范** — 分析 → 方案 → 实现 → 文档 → 验证  
6. **经验与坑** — 可复用的误判点  
7. **待办** — 已知缺口  

完整示例见 [2026-07-26-platform-quota-management-execution.md](./plans/2026-07-26-platform-quota-management-execution.md)。
