# EXECUTION · 全部检索：LangGraph 风格并行 fan-out

日期：2026-07-18

## 需求

「全部检索」原先串行 `for + await`；用户希望参考 LangChain / LangGraph 多智能体，支持并行，并理解多模型（flash / agent）如何配合。

## 方案对比

| 方案 | 做法 | 权重 | 说明 |
|------|------|------|------|
| A | 引入 `@langchain/langgraph` 建检索子图 | **5.5** | 概念完整，但依赖重、与现有 TS adapter 叠床架屋 |
| **B（选用）** | 自研 `parallelMap`（Send + max_concurrency 同构）+ 双模型角色写清 | **9.0** | 立刻加速；零巨框架；日后可换成真 LangGraph |

## LangGraph 概念映射

| LangGraph | 本仓库 |
|-----------|--------|
| `Send("search_page", {slide})` | `parallelMap` 每个 slide 一个 worker |
| `max_concurrency` | `SEARCH_CONCURRENCY`（默认 3） |
| reducer / fan-in | 汇总 `failures` + 刷新 slides |
| 多 Agent 不同模型 | `MODEL`=检索/初稿；`DESIGN_MODEL`=出图 |

说明：**并行 ≠ 多模型混打同一页**。多模型是角色分工；并行是多页 fan-out。

## 改动

1. `packages/agents/src/parallelMap.ts` + export  
2. `POST /search-all` 改并发检索 + SSE 进度  
3. `.env.example`：双模型示例 + `SEARCH_CONCURRENCY`  
4. `SEARCH_ADAPTER.md` 补充并行说明  

## 推荐本地 `.env`

```bash
OPENAI_COMPATIBLE_MODEL="gemini-3.5-flash"          # 检索/初稿（快）
OPENAI_COMPATIBLE_DESIGN_MODEL="gemini-3-flash-agent" # 设计（强）
SEARCH_CONCURRENCY=3
```

改完后需重启 API。

## 验证

- [ ] 7 页全部检索总耗时明显低于串行（约接近 /concurrency）  
- [ ] 单页失败不影响其他页  
- [ ] Agent 日志出现「并发 N」  
- [ ] agents / api typecheck 通过  
