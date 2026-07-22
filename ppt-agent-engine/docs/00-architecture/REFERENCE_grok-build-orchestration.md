# REFERENCE · grok-build 智能体编排对照

来源：[xai-org/grok-build](https://github.com/xai-org/grok-build)（Apache-2.0）  
本地：`references/grok-build/`（浅克隆，已 gitignore）  
官方说明：[x.ai/cli](https://x.ai/cli) · 文档入口见仓库 README

## 1. 它是什么 / 不是什么

| | grok-build | PPT-Agent（本仓） |
|--|------------|-------------------|
| 形态 | 终端 TUI + ACP 编码智能体 | Web 工作室 + PPT 生成流水线 |
| 语言 | Rust | TypeScript |
| 任务 | 读改代码、Shell、MCP、长任务 | 检索→初稿→设计→导出 |
| 编排 | Primary + Subagent + Tools | 阶段图 + 按页 worker |

**结论：不要把 grok 当运行时依赖嵌进来**；学分层与子代理模型，用 TS 同构落地。  
若要坚持「当后端」：只允许 **进程外 sidecar**（headless / ACP stdio），见 [EXECUTION_grok-orchestration-backend-2026-07-18.md](./EXECUTION_grok-orchestration-backend-2026-07-18.md)。

## 2. 关键分层（可学）

| Crate / 模块 | 职责 | 本仓对应 |
|--------------|------|----------|
| `xai-grok-agent` | Agent = tools + prompt + model + compaction | `packages/agents` adapter + prompts |
| `xai-grok-shell` | 会话运行时 / leader / headless | `apps/api` routes + `run-pipeline` |
| `xai-grok-tools` / `tools-api` | 工具实现与契约 | renderer / prisma / researchAdapter |
| `xai-grok-workspace` | 工作区、checkpoint | Project / Slide 持久化 |
| `xai-grok-subagent-resolution` | 子代理 type/persona/capability 解析 | `stageGraph.ts` 角色 + 页级策略 |
| `xai-grok-hooks` / MCP | 扩展点 | 远期；现用 SSE progress |
| pager TUI | 交互壳 | `apps/web` Studio |

## 3. 子代理模型（核心可迁移）

摘自 user-guide `16-subagents.md`：

1. **Primary** 主会话：编排、委派  
2. **Subagent** 子会话：独立上下文；按 `subagent_type`（explore / plan / general-purpose）限工具  
3. **Persona**：行为叠加，不改工具集  
4. **并行**：多子代理 + `wait_all` / `wait_any`；后台任务可轮询  

映射到 PPT：

| grok | PPT-Agent |
|------|-----------|
| Primary | Orchestrator（Studio / pipeline） |
| explore 子代理 | Researcher（按页检索 worker） |
| plan 子代理 | Planner（按页初稿 worker） |
| 实现型子代理 | Designer（SVG/IR，可用 DESIGN_MODEL） |
| wait_all + 并发上限 | `parallelMap` + `SEARCH_CONCURRENCY` / `PLAN_CONCURRENCY` |
| capability 限权 | `renderStrategy` ir/svg/hybrid |

## 4. 「当成后端直接拿过来」边界

| 路径 | 可行性 | 说明 |
|------|--------|------|
| 进程内嵌 Rust crate | **否** | Node 无法直接嵌 workspace；构建/ABI/安全面全错 |
| 进程外 headless（`grok -p`） | 有限 | 适合脚本/探索；输出非 Slide schema；要 xAI 认证与本地二进制 |
| 进程外 ACP stdio | 有限 | 编辑器嵌入协议，不是 PPT HTTP 流水线；适配成本高 |
| HTTP 旁路自建包装 | 理论可 | 需自写薄代理；仍解决不了结构化契约 |
| TS 同构 + `OrchestrationBackend` 端口 | **推荐** | native 默认；`grok-sidecar` 仅骨架/实验 |

**可复用（文件/思想，非源码整搬）：**

- user-guide 中的 subagent type / persona / capability_mode 语义  
- hooks 事件名：`SubagentStart` / `SubagentStop`（及 SessionStart/End）  
- wait_all 并行语义（本仓 `parallelMap` / `mapPages`）  
- Primary 编排 vs 子会话独立上下文  

**不能直接 copy：**

- `xai-grok-shell` / tools / sandbox / TUI  
- 开放 chat tool-loop 替换 `run-pipeline`  
- 把 `references/grok-build` 提交进主仓（已 gitignore）

## 5. 明确不迁入

- Rust TUI / 把 ACP 当产品主 API  
- 通用 chat tool-loop（本产品是固定阶段图，不是开放编码代理）  
- 完整 hooks/plugins 市场（过重）  
- 把整个仓库当 npm 依赖  

## 6. 已融入 / 建议下一步

**已做**

- `parallelMap`：检索 / 初稿批量 fan-out  
- `stageGraph.ts`：阶段角色与 grok 类比写清  
- 双模型角色：`MODEL` vs `DESIGN_MODEL`  
- `OrchestrationBackend` 端口（native + grok-sidecar stub）  

**可后续（P1/P2）**

1. 设计批量同样走 `mapPages`（注意 SVG 成本与限流）  
2. `onHook` → SSE（类 SubagentStart/Stop）  
3. 「跳过已完成页」= 子代理 resume 身份校验的简化版  
4. 可选：外围任务真 spawn headless（勿替代 SVG/IR）

## 7. 合规

- 许可证：Apache-2.0（相对 dashi AGPL 更友好）  
- 外部贡献：上游不接受 PR（见 CONTRIBUTING）；本地对照学习 OK  
- `references/` 不入库（根 `.gitignore`）  
