import type {
  ConsultantProposal,
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
import { createMockSlideIr } from "./slideIrGeneration.js";
import { buildSafeFocusTargets } from "./speechScriptPlan.js";
import type { GeminiAdapter, SpeechScriptContext, SvgGenerationOptions } from "./types.js";

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
    const selection = selectDesignRecipe(slide, _options?.presentationStyle);
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
        return `<g id="${id}"><rect x="${zone.x}" y="${zone.y}" width="${zone.w}" height="${zone.h}" rx="18" fill="${tokens.card}" stroke="${tokens.border}"/><line x1="${zone.x + 28}" y1="${zone.y + 28}" x2="${zone.x + 92}" y2="${zone.y + 28}" stroke="${accent}" stroke-width="4"/><polygon points="${zone.x + 28},${zone.y + 58} ${zone.x + 38},${zone.y + 48} ${zone.x + 48},${zone.y + 58} ${zone.x + 38},${zone.y + 68}" fill="${accent}" fill-opacity="0.16" stroke="${accent}"/><text x="${zone.x + 62}" y="${zone.y + 66}" data-w="${Math.max(100, zone.w - 90)}" data-h="32" font-size="22" font-weight="700" fill="${tokens.title}">${escapeSvgText(blockTitle.slice(0, 18))}</text><text x="${zone.x + 28}" y="${zone.y + 122}" data-w="${Math.max(100, zone.w - 56)}" data-h="${Math.max(36, Math.min(72, zone.h - 142))}" font-size="17" fill="${tokens.body}">${escapeSvgText(body.slice(0, 34))}</text></g>`;
      });

    const fragments = new Map<string, string>([
      [
        "background-layer",
        `<g id="background-layer"><rect width="1280" height="720" fill="${tokens.bg}"/><line x1="72" y1="176" x2="1208" y2="176" stroke="${tokens.border}"/><path d="M72 650 C360 620 830 660 1208 606" fill="none" stroke="${tokens.primary}" stroke-opacity="0.10" stroke-width="2"/><polyline points="84,662 300,650 520,656 760,632 1010,640 1190,612" fill="none" stroke="${tokens.accentAlt}" stroke-opacity="0.12"/><ellipse cx="1160" cy="82" rx="46" ry="28" fill="${tokens.accent}" fill-opacity="0.08"/><polygon points="1170,46 1210,46 1210,86" fill="${tokens.primary}" fill-opacity="0.10"/></g>`
      ],
      [
        "connector-layer",
        `<g id="connector-layer"><path d="M${anchor.x - 36} ${anchor.y + anchor.h / 2} L${anchor.x} ${anchor.y + anchor.h / 2}" fill="none" stroke="${tokens.primary}" stroke-width="2"/><path d="M${anchor.x + anchor.w} ${anchor.y + anchor.h / 2} L${anchor.x + anchor.w + 36} ${anchor.y + anchor.h / 2}" fill="none" stroke="${tokens.accent}" stroke-width="2"/></g>`
      ],
      [
        "title-zone",
        `<g id="title-zone"><text x="${titleZone.x}" y="${titleZone.y + 52}" data-w="${titleZone.w}" data-h="58" font-size="44" font-weight="700" fill="${tokens.title}">${escapeSvgText(draftTitle)}</text><line x1="${titleZone.x}" y1="${titleZone.y + 78}" x2="${titleZone.x + 96}" y2="${titleZone.y + 78}" stroke="${tokens.primary}" stroke-width="4"/></g>`
      ],
      [
        "key-message-zone",
        `<g id="key-message-zone"><line x1="${keyZone.x}" y1="${keyZone.y + 18}" x2="${keyZone.x + 64}" y2="${keyZone.y + 18}" stroke="${tokens.primary}" stroke-width="3"/><text x="${keyZone.x}" y="${keyZone.y + 58}" data-w="${keyZone.w}" data-h="${Math.max(34, keyZone.h - 34)}" font-size="20" font-weight="600" fill="${tokens.title}">${escapeSvgText(draftKeyMessage.slice(0, 42))}</text></g>`
      ],
      [
        "visual-anchor",
        `<g id="visual-anchor"><circle cx="${anchor.x + anchor.w / 2}" cy="${anchor.y + anchor.h / 2}" r="${Math.min(anchor.w, anchor.h) / 2 - 18}" fill="${tokens.card}" stroke="${tokens.primary}" stroke-width="3"/><circle cx="${anchor.x + anchor.w / 2}" cy="${anchor.y + anchor.h / 2}" r="${Math.max(20, Math.min(anchor.w, anchor.h) / 2 - 48)}" fill="${tokens.bgSoft}" stroke="${tokens.accent}" stroke-width="2"/><path d="M${anchor.x + 28} ${anchor.y + anchor.h / 2} L${anchor.x + anchor.w - 28} ${anchor.y + anchor.h / 2}" stroke="${tokens.primary}" stroke-width="2"/><text x="${anchor.x + anchor.w / 2}" y="${anchor.y + anchor.h / 2 + 8}" data-w="${Math.max(90, anchor.w - 70)}" data-h="40" text-anchor="middle" font-size="24" font-weight="700" fill="${tokens.title}">${escapeSvgText(keyword)}</text></g>`
      ]
    ]);
    for (const group of contentGroups) {
      const id = group.match(/\bid="([^"]+)"/)?.[1];
      if (id) fragments.set(id, group);
    }
    const layerFor = (id: string) =>
      id === "background-layer" ? 0 : zoneById.get(id)?.layer ?? 50;
    const orderedGroups = [...fragments.entries()]
      .sort(([leftId], [rightId]) => layerFor(leftId) - layerFor(rightId))
      .map(([, fragment]) => fragment)
      .join("");

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">${orderedGroups}</svg>`;
  }

  async generateSlideIr(slide: SlideDto, facts: FactDto[], theme: PptExportTheme = "white-blue", _onToken?: (token: string) => void, options?: SvgGenerationOptions) {
    return createMockSlideIr(slide, facts, theme, options);
  }

  async startBrief(topic: string) {
    const { mockBriefQuestions } = await import("./studioHelpers.js");
    return { questions: mockBriefQuestions(topic), source: "fallback" as const };
  }

  async generateSpeechScript(
    slide: SlideDto,
    context: SpeechScriptContext,
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

  async generateSpeechScriptPlan(slide: SlideDto, context: SpeechScriptContext) {
    const scriptText = await this.generateSpeechScript(slide, context);
    return {
      scriptText,
      focusTargets: buildSafeFocusTargets(scriptText, context.visibleTextCandidates ?? [])
    };
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

  async editSlideWithCopilot(
    slide: SlideDto,
    currentPlan: SlidePlanDto | null,
    instruction: string,
    _onToken?: (token: string) => void
  ) {
    const basePlan = currentPlan || {
      title: slide.title,
      pageGoal: slide.slideGoal || "传递核心信息",
      keyMessage: slide.keyMessage || "结论明确，逻辑递进",
      layoutType: slide.recommendedLayout || "cards",
      contentBlocks: [
        {
          type: "bullets" as const,
          title: "核心要点",
          items: slide.contentPoints?.length ? [...slide.contentPoints] : ["要点一", "要点二"]
        }
      ],
      sourceFactIds: []
    };

    const updatedPlan = {
      ...basePlan,
      keyMessage: `${basePlan.keyMessage} (AI Copilot 优化)`
    };

    return {
      plan: updatedPlan,
      replyMessage: `已根据您的指令「${instruction}」更新本页初稿设计。`,
      suggestedAction: "生成设计稿"
    };
  }

  async proposeConsultantStructure(
    context: {
      project: Pick<ProjectDto, "name" | "audience" | "purpose" | "topic" | "reportType" | "pageCount">;
      sourceText: string;
      materialTexts?: string[];
    }
  ): Promise<ConsultantProposal> {
    const topic = context.project.topic || context.project.name || "演示汇报";
    return {
      takeaways: [
        {
          id: "t1",
          title: `直击痛点：重塑关于 ${topic} 的核心认知`,
          content: `结合目标受众与当前背景，提炼出切合实际的关键瓶颈与解决切入点。`,
          category: "核心立论"
        },
        {
          id: "t2",
          title: "路径突破：以差异化策略取代低效尝试",
          content: "聚焦高频场景与关键动作，形成具有复利效应的行动闭环。",
          category: "突破方法"
        },
        {
          id: "t3",
          title: "落地执行：可量化、低阻力的分步行动指南",
          content: "提供清晰的阶梯式时间规划与阶段交付物，确保落地执行。",
          category: "落地策略"
        }
      ],
      chapters: [
        {
          id: "c1",
          title: "第一部分 · 背景透视与现状诊断",
          keyGoal: "分析核心问题与痛点根因",
          pageCount: "1~2 页",
          points: ["现状数据剖析", "为何需要系统性突破"]
        },
        {
          id: "c2",
          title: "第二部分 · 核心方法论与突破路径",
          keyGoal: "提供立竿见影的解决体系",
          pageCount: "2~3 页",
          points: ["核心打法推导", "对比传统路径优势"]
        },
        {
          id: "c3",
          title: "第三部分 · 阶梯式实战落地计划",
          keyGoal: "提供拿来即用的行动路线与自测标准",
          pageCount: "2 页",
          points: ["阶段性关键指标", "避坑指南与工具支持"]
        }
      ],
      consultantGreeting: `AI 顾问分析：已根据您提供的主题“${topic}”与背景资料，深度提炼了 3 个核心观点与 3 大章节故事线。`,
      quickActions: [
        "强化行业与竞品案例",
        "精简理论，加大实操比重",
        "增加分阶段时间规划",
        "补充风险控制与应对预案"
      ]
    };
  }

  async adjustConsultantStructure(
    context: {
      project: Pick<ProjectDto, "name" | "audience" | "purpose" | "topic">;
      currentProposal: ConsultantProposal;
      instruction: string;
    }
  ): Promise<ConsultantProposal> {
    const updated = { ...context.currentProposal };
    return {
      ...updated,
      consultantGreeting: `已根据您的指令「${context.instruction}」优化了章节侧重与立论细节。`,
      quickActions: [
        "强化定量数据支撑",
        "增加典型实战场景",
        "精简整体汇报篇幅",
        "强化管理层决策要点"
      ]
    };
  }
}

