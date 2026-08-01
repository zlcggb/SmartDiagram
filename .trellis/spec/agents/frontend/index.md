# @ppt-agent/agents — Frontend Guidelines

> 此包为纯 TypeScript 逻辑包，无 UI 组件。"Frontend" 层指其对外导出的 API 接口。

---

## Overview

`packages/agents/` 不含 React 组件。其 "frontend" 是指导出给 `service-ppt-renderer` 消费的 TypeScript API。

## Export Pattern

```typescript
// src/index.ts — barrel exports
export * from "./prompts.js";
export * from "./stageGraph.js";
export * from "./types.js";
```

## Key Exports

| Module | Purpose |
|--------|---------|
| `prompts.ts` | Prompt 模板（系统提示、设计提示） |
| `stageGraph.ts` | LangGraph 阶段定义 |
| `slideIrGeneration.ts` | SmartSlide IR 生成管线 |
| `openaiCompatibleAdapter.ts` | OpenAI 兼容 LLM 适配器 |
| `designKnowledge/` | 设计知识检索 + 契约编译 |

## Conventions

- All exports go through `src/index.ts`
- Tests colocated: `*.test.ts`
- Adapters follow `*Adapter.ts` naming
