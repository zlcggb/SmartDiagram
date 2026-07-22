# EXPERIENCE · 先学 LangGraph 模式，再决定要不要装框架

## 场景

产品要「多智能体并行」，团队提到 LangChain / LangGraph，但主栈是自研 TS adapter。

## 原则

1. **先对齐模式**：fan-out（Send）、限流并发、fan-in、分支失败隔离  
2. **框架是可选实现**：10 行 `parallelMap` 就能覆盖「全部检索」这类固定 map  
3. **多模型按角色，不按「同一任务乱开两个」**：Researcher 用 flash，Designer 用 agent  
4. 需要 checkpoint / 人机环 / 可视化图时，再上真 LangGraph  

## 反模式

- 为一次批量检索引入整包 LangGraph  
- 把「两个模型名」理解成「每个请求打两次」  
- 无限 `Promise.all` 打爆网关 429  
