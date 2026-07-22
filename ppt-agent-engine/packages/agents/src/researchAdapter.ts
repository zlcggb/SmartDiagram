import type { ResearchJson, SlideDto, SlideSearchJson } from "@ppt-agent/shared";

/**
 * 可插拔检索 / 调研适配器。
 * 未配置真实检索时由 LLM 做“未联网知识整理”；可注入 Tavily / 内网知识库等真实来源。
 */
export interface ResearchAdapter {
  id: string;
  generateResearch(topic: string, briefSummary: string): Promise<ResearchJson>;
  searchPage(
    slide: SlideDto,
    context: { topic?: string; researchSummary?: string }
  ): Promise<SlideSearchJson>;
}

export type ResearchAdapterKind = "ai-knowledge" | "tavily" | "real";

let activeAdapter: ResearchAdapter | null = null;

/** 运行时切换点：真搜索上线时在此注入，无需改 Studio API 形状 */
export function setResearchAdapter(adapter: ResearchAdapter | null) {
  activeAdapter = adapter;
}

export function getResearchAdapter(): ResearchAdapter | null {
  return activeAdapter;
}
