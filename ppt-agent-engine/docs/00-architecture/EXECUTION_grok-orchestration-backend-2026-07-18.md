# EXECUTION · grok-build 编排「当后端」评估与适配骨架

日期：2026-07-18

## 1. 需求

用户问：若需要**完整 Agent 编排能力**，是否要把 [grok-build](https://github.com/xai-org/grok-build) 直接接到 PPT-Agent；希望「当成一个后端」把编排能力拿过来，并允许改现有架构。

前置对照：

- [REFERENCE_grok-build-orchestration.md](./REFERENCE_grok-build-orchestration.md)
- [EXECUTION_reference-grok-build-2026-07-18.md](./EXECUTION_reference-grok-build-2026-07-18.md)
- 本仓：`run-pipeline`、Studio 三阶段、`GeminiAdapter`、progress SSE、`parallelMap` / `stageGraph`

## 2. 快速对照结论

| 维度 | PPT-Agent 现状 | grok-build | 可否「整仓当后端」 |
|------|----------------|------------|-------------------|
| 任务形态 | 固定阶段图（检索→初稿→设计→导出） | 开放 tool-loop（读改代码/Shell/MCP） | 任务面错配 |
| 运行时 | Node/TS monorepo | Rust crates（shell/agent/tools/ACP） | **不能进程内嵌** |
| 并行 | `parallelMap` wait_all | spawn_subagent + wait_all/any | 语义可学，实现已有 |
| 可观测 | SSE `emitProgress` | Hooks（SubagentStart/Stop 等） | 事件名可对齐 |
| 产出契约 | Slide / planJson / SVG / IR | 文本摘要 + 文件 diff | 结构化契约不在 grok |
| 接入面 | Fastify HTTP | Headless CLI / ACP stdio / TUI | 仅进程外可行 |

**核心答案：**

1. **要完整编排能力，不必推翻现有产品架构。** 需要的是「编排端口 + 子代理语义」，不是替换 Studio/Prisma/导出链。  
2. **「当成后端直接拿过来」的现实边界：** 只能 **sidecar（进程外）**；不能把 Rust crate 嵌进 Node。即便 sidecar，也只适合探索/脚本类外围任务，**不能**直接替代 `generateOutline` / 设计 SVG / IR 编译。  
3. **可复用：** prompts/角色分层思想、subagent type/persona、hooks 事件名、wait_all 并发语义。  
4. **不可直接 copy：** TUI、sandbox、编码 tools、ACP 会话状态机、整仓依赖。

## 3. 两方案 + 权重

| 方案 | 做法 | 产品契合 | 交付速度 | 运维/依赖 | 编排保真 | 扩展性 | **综合** | 决策 |
|------|------|----------|----------|-----------|----------|--------|----------|------|
| **A** | 进程外把 grok headless/ACP 当作流水线主后端：每阶段 spawn `grok -p` 或 ACP | 3 | 2 | 2 | 9 | 5 | **3.8** | 否 |
| **B（执行）** | 引入 `OrchestrationBackend` 端口：默认 `native`（stageGraph+parallelMap）；`grok-sidecar` 仅骨架+env 开关；文档写清 P0–P2 | 9 | 8 | 9 | 7 | 9 | **8.6** | **选用** |

### 方案 A 为何低分

- 认证/账号体系绑 xAI CLI，与现有 OpenAI-compatible 双模型角色冲突。  
- 工具面是 shell/edit，不是 PPT 结构化 adapter。  
- 输出非 schema-stable，难写入 Prisma Slide。  
- 每页 spawn 进程成本高；Windows/本地构建负担大。  
- 产品要的是可控流水线，不是开放编码代理。

### 方案 B 为何选用

- **改架构但不吞栈**：业务依赖端口，运行时可换。  
- 默认路径零 Rust、零额外二进制。  
- 为真 sidecar 留钩子（`GROK_SIDECAR_BIN`），但不半吊子 spawn。  
- 与既有 `parallelMap` / SSE 平滑衔接。

## 4. 目标架构（选定）

```text
apps/web (Studio)
    │ HTTP + SSE
apps/api (Orchestrator = Primary)
    │ getOrchestrationBackend()
    ├─ native ──► parallelMap + stageGraph + GeminiAdapter
    └─ grok-sidecar (stub) ──► 可选日后 headless/ACP
packages/agents
    orchestration/  +  adapters / research
packages/ppt-renderer / prisma
```

### 迁移路径

| 阶段 | 内容 | 状态 |
|------|------|------|
| **P0** | 端口 + native/sidecar 骨架；search-all / generate-all-plans 走 `mapPages`；文档 | **本执行已做** |
| **P1** | 设计批量也走 `mapPages`；`onHook` → SSE；跳过已完成页 ≈ resume 简化 | 未做 |
| **P2** | 可选实验：对「开放调研」单点 `runExternalRole` 真 spawn headless；**永不**用 grok 直接写 SVG/IR | 未做 |

## 5. 已执行

1. 文档：本 EXECUTION + EXPERIENCE + REFERENCE 增补「当后端」边界。  
2. 代码骨架：  
   - `packages/agents/src/orchestration/*`  
   - `apps/api/src/lib/orchestration.ts`  
   - `projects.ts` 检索/初稿批量改用 `orchestration.mapPages`  
3. `.env.example`：`ORCHESTRATION_BACKEND` / `GROK_SIDECAR_BIN`  
4. 索引：`docs/00-architecture/README.md`

## 6. 有意未做

- 不 `cargo build`、不要求安装完整 grok  
- 不 spawn 子进程、不接 ACP stdio  
- 不把 `references/grok-build` 提交进主仓  
- 不替换 `run-pipeline` 为开放 chat agent  

## 7. 验收

- [x] 两方案权重与选型写清  
- [x] 回答「要不要大改 / 当后端边界 / P0–P2」  
- [x] 骨架可 typecheck  
- [x] 默认行为仍为 native wait_all  
