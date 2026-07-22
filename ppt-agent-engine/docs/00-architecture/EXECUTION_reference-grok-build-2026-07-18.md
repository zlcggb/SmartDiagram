# EXECUTION · 拉取 grok-build 并同构融入编排

日期：2026-07-18

## 需求

评估 [xai-org/grok-build](https://github.com/xai-org/grok-build) 是否拉到参考目录，学习智能体编排，并决定如何融入 PPT-Agent。

## 方案对比

| 方案 | 做法 | 权重 | 决策 |
|------|------|------|------|
| A | 完整依赖 / 嵌入 grok 运行时 | **2** | 否：Rust TUI ≠ PPT 流水线 |
| B | 不拉仓，只读网页 | **5** | 弱：难对照 crate 分层 |
| **C（执行）** | `references/` 浅克隆 + REFERENCE 文档 + TS 同构（stageGraph / parallelMap） | **9.0** | 与 svg2pptx/dashi 惯例一致 |

## 已执行

1. `git clone --depth 1` → `references/grok-build`（~73MB，已 ignore）  
2. 对照文档：`REFERENCE_grok-build-orchestration.md`  
3. 代码同构：  
   - `packages/agents/src/stageGraph.ts`（Primary/Subagent 角色映射）  
   - `generate-all-plans` 改为 `parallelMap` 有限并发（类多 plan 子代理）  
4. 更新 `references/README.md`、根 `README.md`、架构 README  

## 未执行（有意）

- 不引入 `@langchain/langgraph` / 不链 Rust crate  
- 不把 grok ACP/TUI 接进 Web  
- 不复制上游工具实现源码进业务包  

## 验收

- [x] 本地可浏览 `references/grok-build`  
- [x] 对照文档说明可学 / 不可迁  
- [x] 初稿批量与检索批量均为有限并发 fan-out  
- [x] agents typecheck 通过  
