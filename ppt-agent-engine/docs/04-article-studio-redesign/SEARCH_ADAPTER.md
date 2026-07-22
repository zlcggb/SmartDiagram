# 搜索 / 调研适配器接口

第一期默认用 **LLM 模拟检索**（`GeminiAdapter.generatePageSearch` / `generateResearch`），产出可编辑资料卡，不绑定商业搜索供应商。

## 切换点

```ts
import { setResearchAdapter, getResearchAdapter, type ResearchAdapter } from "@ppt-agent/agents";

// 注入真实搜索实现后，Studio 的 search / search-all / pipeline 检索段会优先走适配器
setResearchAdapter(myRealAdapter);

// 清空则回退 LLM 模拟
setResearchAdapter(null);
```

## 接口

```ts
interface ResearchAdapter {
  id: string;
  generateResearch(topic: string, briefSummary: string): Promise<ResearchJson>;
  searchPage(
    slide: SlideDto,
    context: { topic?: string; researchSummary?: string }
  ): Promise<SlideSearchJson>;
}
```

## 当前接线

| API | 行为 |
|-----|------|
| `POST .../research` | 仍走 AI adapter（可后续同样接 ResearchAdapter） |
| `POST .../slides/:id/search` | `getResearchAdapter()?.searchPage` → 否则 `generatePageSearch` |
| `POST .../search-all` | 同上 |
| `POST .../run-pipeline` | 检索段仍用 AI adapter；适配器注入后可与 search 对齐 |

## 全部检索并行（LangGraph 同构）

`POST .../search-all` 使用 `@ppt-agent/agents` 的 `parallelMap`：

- **fan-out**：每页一个检索 worker（等同 LangGraph `Send`）
- **max_concurrency**：`SEARCH_CONCURRENCY` / `AI_CONCURRENCY`（默认 3，最大 8）
- **fan-in**：汇总成功页 + `failures[]`
- **未引入** `@langchain/langgraph` 依赖（TS 栈保持轻量；模式对齐便于日后升级）

## 双模型角色

| 环境变量 | 建议 | 对应智能体角色 |
|----------|------|----------------|
| `OPENAI_COMPATIBLE_MODEL` | `gemini-3.5-flash` | Researcher / Planner（检索、初稿） |
| `OPENAI_COMPATIBLE_DESIGN_MODEL` | `gemini-3-flash-agent` | Designer（SVG 出图） |

并行是「多页同时检索」，不是「同一页同时打两个模型」。跨角色并行（检索+设计同时跑）属后续图编排。

## 升级建议

1. 实现 `TavilyResearchAdapter` / `InternalKbAdapter`
2. 在 API 启动时按 `RESEARCH_ADAPTER=llm|tavily` 调用 `setResearchAdapter`
3. 保持 `SlideSearchJson` 形状不变，前端 Studio 搜索 Tab 无需改动
4. 若需完整 checkpoint / 可视化图：再评估接入 `@langchain/langgraph`
