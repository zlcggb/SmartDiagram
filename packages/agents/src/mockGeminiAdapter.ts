import type {
  ExtractedFactDraft,
  ExtractFactsResult,
  FactCategory,
  FactDto,
  OutlineSlideDraft,
  PptExportTheme,
  ProjectDto,
  SlideDto,
  SlidePlanDto,
  SpeechWritingStyleId
} from "@ppt-agent/shared";
import { factCategories, getThemePack, normalizePptExportTheme, themeFamily } from "@ppt-agent/shared";
import { selectDesignRecipe } from "./designKnowledge/index.js";
import { buildMockPlanFromSearch } from "./studioHelpers.js";
import type { GeminiAdapter, SvgGenerationOptions } from "./types.js";

const categories = {
  background: factCategories[0] as FactCategory,
  customer: factCategories[1] as FactCategory,
  progress: factCategories[2] as FactCategory,
  risk: factCategories[3] as FactCategory,
  uncertainty: factCategories[4] as FactCategory,
  next: factCategories[5] as FactCategory,
  suggestion: factCategories[6] as FactCategory
};

function cleanLine(line: string) {
  return line.replace(/^\s*[-*\d.、，)\]]+\s*/, "").trim();
}

function sourceLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ text: cleanLine(line), location: `第 ${index + 1} 行` }))
    .filter((line) => line.text.length > 0);
}

function makeDraft(content: string, category: FactCategory, status: ExtractedFactDraft["status"], sourceLocation: string, confidence = 0.82): ExtractedFactDraft {
  return {
    category,
    content,
    status,
    confidence,
    sourceText: content,
    sourceLocation,
    canUseInPpt: true
  };
}

function uniqueDrafts(items: ExtractedFactDraft[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.category}:${item.content}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function pickLines(text: string, keywords: string[]) {
  return sourceLines(text).filter((line) => keywords.some((keyword) => line.text.includes(keyword)));
}

function pickFacts(facts: FactDto[], categoryList: FactCategory[], fallbackCount = 3) {
  const selected = facts.filter((fact) => categoryList.includes(fact.category) && fact.canUseInPpt);
  return (selected.length > 0 ? selected : facts.filter((fact) => fact.canUseInPpt)).slice(0, fallbackCount);
}

function factSummary(facts: FactDto[], fallback: string) {
  return facts.length > 0 ? facts.slice(0, 4).map((fact) => fact.content) : [fallback];
}

function slideItems(slide: SlideDto, facts: FactDto[], max = 4) {
  const planItems = slide.planJson?.contentBlocks.flatMap((block) => block.items) ?? [];
  const factItems = facts.filter((fact) => slide.sourceFactIds.includes(fact.id)).map((fact) => fact.content);
  const draftItems = planItems.length > 0 ? planItems : slide.contentPoints;
  return [...draftItems, ...factItems].filter(Boolean).slice(0, max);
}

function escapeSvgText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export class MockGeminiAdapter implements GeminiAdapter {
  async extractFacts(text: string): Promise<ExtractFactsResult> {
    const progressLines = pickLines(text, ["完成", "通过", "提交", "进展", "联调", "安装", "测试", "认可"]);
    const riskLines = pickLines(text, ["风险", "延期", "影响", "问题", "阻塞", "未确认", "待确认", "需要答复"]);
    const nextLines = pickLines(text, ["下周", "下一步", "计划", "推动", "评审", "复测"]);
    const customerLines = pickLines(text, ["客户", "需求", "汇报", "目的"]);

    return {
      facts: uniqueDrafts([
        ...(customerLines.length > 0 ? customerLines : [{ text: "客户关注交付风险、资源需求和下一步计划。", location: "Mock AI 推断" }]).slice(0, 3).map((line) =>
          makeDraft(line.text, categories.customer, "confirmed", line.location, 0.86)
        ),
        ...(progressLines.length > 0 ? progressLines : [{ text: "本周关键交付项已按计划推进。", location: "Mock AI 推断" }]).slice(0, 4).map((line) =>
          makeDraft(line.text, categories.progress, "confirmed", line.location, 0.88)
        ),
        makeDraft("本次汇报应聚焦事实、进度、风险、待确认事项和下周行动。", categories.suggestion, "suggestion", "Mock AI 汇总", 0.76)
      ]),
      risks: uniqueDrafts((riskLines.length > 0 ? riskLines : [{ text: "存在外部依赖或客户确认项，可能影响后续交付窗口。", location: "Mock AI 推断" }]).slice(0, 4).map((line) =>
        makeDraft(line.text, categories.risk, line.text.includes("待确认") || line.text.includes("未确认") ? "uncertain" : "confirmed", line.location, 0.8)
      )),
      uncertainties: uniqueDrafts(
        riskLines
          .filter((line) => line.text.includes("待确认") || line.text.includes("未确认") || line.text.includes("需要") || line.text.includes("是否"))
          .slice(0, 3)
          .map((line) => makeDraft(line.text, categories.uncertainty, "uncertain", line.location, 0.78))
      ),
      nextSteps: uniqueDrafts((nextLines.length > 0 ? nextLines : [{ text: "下周完成排期评审、关键复测和风险闭环。", location: "Mock AI 推断" }]).slice(0, 4).map((line) =>
        makeDraft(line.text, categories.next, "confirmed", line.location, 0.84)
      ))
    };
  }

  async generateOutline(
    project: Pick<ProjectDto, "name" | "audience" | "purpose" | "pageCount" | "theme">,
    confirmedFacts: FactDto[]
  ): Promise<OutlineSlideDraft[]> {
    const usableFacts = confirmedFacts.filter((fact) => fact.canUseInPpt);
    const progressFacts = pickFacts(usableFacts, [categories.progress], 4);
    const riskFacts = pickFacts(usableFacts, [categories.risk, categories.uncertainty], 4);
    const nextFacts = pickFacts(usableFacts, [categories.next], 4);
    const customerFacts = pickFacts(usableFacts, [categories.customer, categories.background], 3);

    const slides: OutlineSlideDraft[] = [
      {
        title: `${project.name} 项目汇报`,
        slideGoal: "建立汇报上下文，明确对象、目的和核心议题。",
        keyMessage: `本次汇报面向 ${project.audience}，聚焦 ${project.purpose}。`,
        contentPoints: [`汇报对象：${project.audience}`, `汇报目的：${project.purpose}`, `建议页数：${project.pageCount} 页`],
        sourceFactIds: customerFacts.map((fact) => fact.id),
        recommendedLayout: "cover"
      },
      {
        title: "项目概况与当前状态",
        slideGoal: "用一页说明项目背景、客户关注点和当前总体状态。",
        keyMessage: customerFacts[0]?.content ?? "项目整体按周报节奏推进，客户关注交付确定性。",
        contentPoints: factSummary(customerFacts, "客户关注交付风险、资源需求和关键节点。"),
        sourceFactIds: customerFacts.map((fact) => fact.id),
        recommendedLayout: "status-cards"
      },
      {
        title: "本周关键进展",
        slideGoal: "突出本周已经完成或取得阶段结果的事项。",
        keyMessage: progressFacts[0]?.content ?? "本周核心交付项已有明确进展。",
        contentPoints: factSummary(progressFacts, "本周关键任务按计划推进。"),
        sourceFactIds: progressFacts.map((fact) => fact.id),
        recommendedLayout: "progress-cards"
      },
      {
        title: "风险与待确认事项",
        slideGoal: "集中呈现影响交付确定性的风险和客户侧支持诉求。",
        keyMessage: riskFacts[0]?.content ?? "外部依赖和客户确认项是当前主要风险来源。",
        contentPoints: factSummary(riskFacts, "客户侧确认事项需要尽快闭环。"),
        sourceFactIds: riskFacts.map((fact) => fact.id),
        recommendedLayout: "risk-table"
      },
      {
        title: "下周计划与下一步行动",
        slideGoal: "明确下周行动、责任协同和需要确认的节点。",
        keyMessage: nextFacts[0]?.content ?? "下周重点是评审、复测和风险闭环。",
        contentPoints: factSummary(nextFacts, "下周完成排期评审、复测和风险闭环。"),
        sourceFactIds: nextFacts.map((fact) => fact.id),
        recommendedLayout: "action-list"
      }
    ];

    return slides.slice(0, Math.max(1, Math.min(8, project.pageCount || 6)));
  }

  async generateSlidePlan(slide: SlideDto, facts: FactDto[], _theme?: string, _onToken?: (token: string) => void): Promise<SlidePlanDto> {
    // 与真实模型一致：优先综合已选检索资料卡，而不是复述 contentPoints
    return buildMockPlanFromSearch(slide, facts);
  }


  async generateSvgPreview(slide: SlideDto, facts: FactDto[], theme: PptExportTheme = "white-blue", _onToken?: (token: string) => void, _options?: SvgGenerationOptions): Promise<string> {
    const tokens = getThemePack(theme).tokens;
    const draftTitle = slide.planJson?.title || slide.title;
    const draftKeyMessage = slide.planJson?.keyMessage || slide.keyMessage;
    const planBlocks = slide.planJson?.contentBlocks.filter((block) => block.type !== "summary") ?? [];
    const fallbackItems = slideItems(slide, facts, 4);
    const selection = selectDesignRecipe(slide);
    const recipe = selection.recipe;
    const zoneById = new Map(recipe.zones.map((zone) => [zone.id, zone]));
    const titleZone = zoneById.get("title-zone") ?? { x: 72, y: 54, w: 720, h: 108 };
    const anchor = zoneById.get("visual-anchor") ?? { x: 520, y: 230, w: 240, h: 240 };
    const keyZone = zoneById.get("key-message-zone") ?? { x: 72, y: 170, w: 520, h: 90 };
    const keyword = (draftKeyMessage.match(/[A-Za-z][A-Za-z\s-]{2,}|[\u4e00-\u9fff]{2,6}/)?.[0] ?? "核心").slice(0, 8);

    const contentGroups = recipe.requiredGroupIds
      .filter((id) => id.startsWith("content-zone-"))
      .map((id, index) => {
        const zone = zoneById.get(id) ?? { x: 72 + index * 360, y: 350, w: 320, h: 210 };
        const block = planBlocks[index];
        const blockTitle = block?.title || `要点 ${index + 1}`;
        const body = block?.items[0] || fallbackItems[index] || draftKeyMessage;
        const accent = tokens.series[index % tokens.series.length] ?? tokens.primary;
        return `<g id="${id}"><polygon points="${zone.x},${zone.y + 18} ${zone.x + 18},${zone.y} ${zone.x + zone.w},${zone.y} ${zone.x + zone.w},${zone.y + zone.h} ${zone.x},${zone.y + zone.h}" fill="${tokens.card}" stroke="${tokens.border}"/><rect x="${zone.x}" y="${zone.y + 18}" width="7" height="${Math.max(54, zone.h - 36)}" fill="${accent}"/><circle cx="${zone.x + 36}" cy="${zone.y + 48}" r="14" fill="${accent}" fill-opacity="0.16" stroke="${accent}"/><text x="${zone.x + 62}" y="${zone.y + 56}" data-w="${Math.max(100, zone.w - 88)}" data-h="32" font-size="22" font-weight="700" fill="${tokens.title}">${escapeSvgText(blockTitle.slice(0, 18))}</text><text x="${zone.x + 28}" y="${zone.y + 100}" data-w="${Math.max(100, zone.w - 56)}" data-h="${Math.max(36, zone.h - 118)}" font-size="17" fill="${tokens.body}">${escapeSvgText(body.slice(0, 34))}</text></g>`;
      })
      .join("");

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><g id="background-layer"><rect width="1280" height="720" fill="${tokens.bg}"/><circle cx="1040" cy="90" r="260" fill="${tokens.accent}" fill-opacity="0.07"/><ellipse cx="180" cy="650" rx="310" ry="150" fill="${tokens.primary}" fill-opacity="0.05"/><path d="M72 650 C360 570 830 680 1208 550" fill="none" stroke="${tokens.primary}" stroke-opacity="0.14" stroke-width="2"/><line x1="72" y1="176" x2="1208" y2="176" stroke="${tokens.border}"/><polyline points="84,662 300,630 520,644 760,596 1010,612 1190,560" fill="none" stroke="${tokens.accentAlt}" stroke-opacity="0.18"/><polygon points="1130,36 1210,36 1210,116" fill="${tokens.primary}" fill-opacity="0.12"/></g><g id="title-zone"><text x="${titleZone.x}" y="${titleZone.y + 52}" data-w="${titleZone.w}" data-h="68" font-size="44" font-weight="800" fill="${tokens.title}">${escapeSvgText(draftTitle)}</text><rect x="${titleZone.x}" y="${titleZone.y + 78}" width="112" height="6" fill="${tokens.primary}"/></g><g id="key-message-zone"><path d="M${keyZone.x} ${keyZone.y + 12} L${keyZone.x + keyZone.w - 24} ${keyZone.y + 12} L${keyZone.x + keyZone.w} ${keyZone.y + keyZone.h / 2} L${keyZone.x + keyZone.w - 24} ${keyZone.y + keyZone.h - 12} L${keyZone.x} ${keyZone.y + keyZone.h - 12} Z" fill="${tokens.primary}"/><text x="${keyZone.x + 24}" y="${keyZone.y + keyZone.h / 2 + 8}" data-w="${Math.max(120, keyZone.w - 58)}" data-h="36" font-size="20" font-weight="700" fill="#FFFFFF">${escapeSvgText(draftKeyMessage.slice(0, 42))}</text></g><g id="visual-anchor"><circle cx="${anchor.x + anchor.w / 2}" cy="${anchor.y + anchor.h / 2}" r="${Math.min(anchor.w, anchor.h) / 2 - 16}" fill="${tokens.primary}" fill-opacity="0.12" stroke="${tokens.primary}" stroke-width="3"/><circle cx="${anchor.x + anchor.w / 2}" cy="${anchor.y + anchor.h / 2}" r="${Math.min(anchor.w, anchor.h) / 2 - 42}" fill="${tokens.card}" stroke="${tokens.accent}" stroke-width="8"/><path d="M${anchor.x + 24} ${anchor.y + anchor.h / 2} L${anchor.x + anchor.w - 24} ${anchor.y + anchor.h / 2}" stroke="${tokens.primary}" stroke-width="4"/><text x="${anchor.x + anchor.w / 2}" y="${anchor.y + anchor.h / 2 + 8}" data-w="${Math.max(90, anchor.w - 70)}" data-h="44" text-anchor="middle" font-size="28" font-weight="800" fill="${tokens.title}">${escapeSvgText(keyword)}</text></g><g id="connector-layer"><path d="M${anchor.x - 90} ${anchor.y + anchor.h / 2} C${anchor.x - 36} ${anchor.y + 20} ${anchor.x - 20} ${anchor.y + anchor.h - 20} ${anchor.x + 12} ${anchor.y + anchor.h / 2}" fill="none" stroke="${tokens.primary}" stroke-width="3"/><path d="M${anchor.x + anchor.w - 12} ${anchor.y + anchor.h / 2} C${anchor.x + anchor.w + 30} ${anchor.y + 20} ${anchor.x + anchor.w + 52} ${anchor.y + anchor.h - 20} ${anchor.x + anchor.w + 90} ${anchor.y + anchor.h / 2}" fill="none" stroke="${tokens.accent}" stroke-width="3"/></g>${contentGroups}</svg>`;
  }

  async startBrief(topic: string) {
    const { mockBriefQuestions } = await import("./studioHelpers.js");
    return { questions: mockBriefQuestions(topic), source: "fallback" as const };
  }

  async generateSpeechScript(
    slide: SlideDto,
    context: { index: number; total: number; prevTitle?: string; nextTitle?: string; style: SpeechWritingStyleId },
    _onToken?: (token: string) => void
  ): Promise<string> {
    // Mock：不依赖真实模型，按风格前缀 + 模板生成可预测的稿子，保证 dev/test 可用
    const title = slide.planJson?.title || slide.title;
    const message = slide.planJson?.keyMessage || slide.keyMessage || "";
    const items = (slide.planJson?.contentBlocks?.flatMap((block) => block.items) || slide.contentPoints).filter(Boolean).slice(0, 3);
    const stylePrefix: Record<SpeechWritingStyleId, string> = {
      "formal-report": "各位好，",
      "clear-explainer": "我们来看，",
      storytelling: "先从一个切入点说起，",
      "casual-vlog": "哈喽，"
    };
    const opening = context.index === 0 ? `${stylePrefix[context.style]}今天我们围绕“${title}”展开。` : `接着看“${title}”。`;
    const body = `${message ? `核心观点是：${message}。` : ""}${items.length ? `重点包括：${items.join("；")}。` : ""}`;
    const closing = context.nextTitle ? `接下来我们看“${context.nextTitle}”。` : "以上就是本次分享，谢谢大家。";
    return `${opening}${body}${closing}`.replace(/。+/g, "。").slice(0, 480);
  }

  async finalizeBrief(topic: string, answers: Record<string, string>, _onToken?: (token: string) => void) {
    const { mockFinalizeBrief } = await import("./studioHelpers.js");
    return mockFinalizeBrief(topic, answers);
  }

  async generateResearch(topic: string, briefSummary: string, _onToken?: (token: string) => void) {
    const { mockResearch } = await import("./studioHelpers.js");
    return mockResearch(topic, briefSummary);
  }

  async generatePageSearch(slide: SlideDto, _context: { topic?: string; researchSummary?: string }, _onToken?: (token: string) => void) {
    const { mockPageSearch } = await import("./studioHelpers.js");
    return mockPageSearch(slide);
  }
}
