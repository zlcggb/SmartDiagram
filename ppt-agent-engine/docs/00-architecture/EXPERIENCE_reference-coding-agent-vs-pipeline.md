# EXPERIENCE · 编码智能体编排 vs 产品流水线

## 场景

看到强编排参考仓（如 grok-build、LangGraph），容易想「整仓搬进来」。

## 判断题

1. 任务是**开放工具循环**（写代码）还是**固定阶段图**（检索→初稿→设计）？  
2. 运行时语言是否一致？跨语言嵌依赖成本通常高于「学模式」  
3. 需要的是 **Subagent 语义**（独立上下文、限权、并行）还是完整 TUI/ACP？  

## 推荐

- 参考仓 → `references/` 浅克隆 + gitignore  
- 学：分层、子代理、fan-out/wait_all、模型按角色  
- 做：在自研栈里用 `parallelMap` + `stageGraph` 同构  
- 不做：把编码 Agent Harness 当业务中间件  

## 一句话

**编排思想可迁移；运行时壳不要硬嵌。**

延伸：「当后端」的端口与 sidecar 边界见 [EXPERIENCE_grok-as-backend-boundary.md](./EXPERIENCE_grok-as-backend-boundary.md)。
