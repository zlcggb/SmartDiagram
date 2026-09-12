import type { FactDto } from "@ppt-agent/shared";

export interface ConsultantTakeaway {
  id: string;
  title: string;
  content: string;
  category: "核心立论" | "突破方法" | "落地策略" | "实战场景" | string;
  selected: boolean;
}

export interface ConsultantChapter {
  id: string;
  title: string;
  keyGoal: string;
  pageCount: string;
  points: string[];
}

export interface ConsultantChatMessage {
  id: string;
  role: "consultant" | "user";
  text: string;
  time: string;
}

export interface ConsultantProposal {
  takeaways: ConsultantTakeaway[];
  chapters: ConsultantChapter[];
  dialogue: ConsultantChatMessage[];
  quickActions: string[];
}

/**
 * 将用户确认的核心立论与篇章架构，转为可落盘并供大纲生成消费的高质量 FactDto 数组
 */
export function convertProposalToQualityFacts(
  proposal: ConsultantProposal,
  projectId: string
): Array<Omit<FactDto, "id" | "createdAt">> {
  const result: Array<Omit<FactDto, "id" | "createdAt">> = [];

  // 1. 核心立论
  for (const takeaway of proposal.takeaways.filter((t) => t.selected)) {
    result.push({
      projectId,
      category: "建议与判断",
      content: `【${takeaway.title}】${takeaway.content}`,
      status: "confirmed",
      confidence: 0.98,
      sourceText: takeaway.content,
      sourceLocation: "顾问核心立论",
      canUseInPpt: true
    });
  }

  // 2. 篇章故事线架构
  for (const chapter of proposal.chapters) {
    result.push({
      projectId,
      category: "项目进展",
      content: `【章节架构：${chapter.title}】核心目标：${chapter.keyGoal}；要点：${chapter.points.join("；")}`,
      status: "confirmed",
      confidence: 0.95,
      sourceText: chapter.points.join("，"),
      sourceLocation: "顾问篇章架构",
      canUseInPpt: true
    });
  }

  return result;
}
