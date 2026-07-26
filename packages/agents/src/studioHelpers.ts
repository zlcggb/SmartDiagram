/** Studio 阶段：Brief / Research / PageSearch — 供 Real / OpenAI / Mock 复用的轻量实现辅助 */

import type {
  BriefJson,
  BriefQuestion,
  FactDto,
  ResearchJson,
  SlideContentBlockDto,
  SlideDto,
  SlidePlanDto,
  SlideSearchJson,
  SlideSearchResult,
  SlideSearchSynthesis
} from "@ppt-agent/shared";

type DesignGuideInput = {
  layoutType: string;
  contentBlocks: SlideContentBlockDto[];
};

type SlideDesignGuide = NonNullable<SlidePlanDto["designGuide"]>;

function designGuideText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function blockShape(type: SlideContentBlockDto["type"]) {
  if (type === "timeline") return "带节点和连接线的时间轴形状";
  if (type === "table") return "分栏矩阵或对比面板";
  if (type === "callout") return "以大字阶和留白构成的聚焦引言区";
  return "单层圆角信息面，使用低对比边框、标题字重或顶部短细线";
}

function blockPlacement(index: number, total: number, layoutType: string) {
  if (layoutType.includes("cover") || layoutType.includes("statement") || layoutType.includes("transition")) {
    return `页面下方模块轨道的第 ${index + 1} 位`;
  }
  if (total <= 1) return "正文区通栏，占据主视觉宽度";
  if (total === 2) return index === 0 ? "正文区左列" : "正文区右列";
  if (total === 3) return `正文区三列中的第 ${index + 1} 列`;
  return `正文区 2×2 网格的第 ${index + 1} 位`;
}

/**
 * 初稿到设计稿的内部形状协议。界面不展示，但 IR / SVG 生成都必须消费。
 * 同时作为旧数据和模型漏字段时的确定性兜底。
 */
export function deriveSlideDesignGuide(input: DesignGuideInput): SlideDesignGuide {
  const { layoutType, contentBlocks } = input;
  const isHero = ["cover", "statement", "transition"].some((role) => layoutType.includes(role));
  const isFlow = ["timeline", "process", "roadmap", "action"].some((role) => layoutType.includes(role));
  const isCompare = ["compare", "table", "matrix"].some((role) => layoutType.includes(role));
  const total = Math.max(contentBlocks.length, 1);

  return {
    composition: isHero
      ? "大标题与核心结论形成主视觉，正文模块收在底部轨道，严禁全页文字平铺"
      : isFlow
        ? "顶部标题区 + 中部核心结论锚点 + 下方连续流程主视觉"
        : isCompare
          ? "顶部标题区 + 结论强调带 + 下方对照矩阵，保持明显的左右或行列关系"
          : "顶部标题区 + 编辑式核心结论 + 下方有主次的信息区，独立区域保持明确空气带",
    background: "使用主题纯色或单一浅表面分区建立层级；同页最多一种低对比结构装饰，避免泛用光晕、巨型透明圆和无目的渐变",
    title: isHero
      ? "大字阶标题作为第一视觉重心，与短强调线或小标签组合，不放入普通卡片"
      : "标题在顶部左对齐，以字阶、留白和一条短细线建立标题区，与正文保持明确间距",
    keyMessage: isHero
      ? "作为标题下方的大号观点或关键词锚点，使用主色强调，不写成普通正文段落"
      : "作为编辑式导语或数字/关键词锚点，依靠字阶与留白突出；不默认放入高饱和色带或悬浮卡",
    blocks: contentBlocks.map((block, index) => ({
      blockIndex: index,
      shape: blockShape(block.type),
      placement: blockPlacement(index, total, layoutType),
      treatment:
        block.type === "timeline"
          ? "将每条 item 变成节点，用线路、序号与方向组织，禁止普通项目符号"
          : block.type === "table"
            ? "将 item 按行列、对照或维度拆分，用色块与分割线建立可扫读结构"
            : block.type === "callout"
              ? "放大最重要的词或数字，使用色彩、留白和对比构成次级视觉焦点"
              : "每条 item 使用短标签、图标点或小序号组织，保留层级与留白，禁止大段文字"
    })),
    decoration: "只使用服务于结构的细连接线、局部浅色面和小型节点；禁止整高侧边色条，装饰不得抢过标题与结论"
  };
}

export function normalizeSlideDesignGuide(value: unknown, input: DesignGuideInput): SlideDesignGuide {
  const fallback = deriveSlideDesignGuide(input);
  const object = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const rawBlocks = Array.isArray(object.blocks) ? object.blocks : [];
  const blocksByIndex = new Map<number, Record<string, unknown>>();
  rawBlocks.forEach((block) => {
    if (typeof block !== "object" || block === null) return;
    const candidate = block as Record<string, unknown>;
    const blockIndex = Number(candidate.blockIndex);
    if (Number.isInteger(blockIndex) && blockIndex >= 0 && blockIndex < input.contentBlocks.length) {
      blocksByIndex.set(blockIndex, candidate);
    }
  });

  return {
    composition: designGuideText(object.composition, fallback.composition),
    background: designGuideText(object.background, fallback.background),
    title: designGuideText(object.title, fallback.title),
    keyMessage: designGuideText(object.keyMessage, fallback.keyMessage),
    blocks: fallback.blocks.map((block) => {
      const candidate = blocksByIndex.get(block.blockIndex);
      return {
        blockIndex: block.blockIndex,
        shape: designGuideText(candidate?.shape, block.shape),
        placement: designGuideText(candidate?.placement, block.placement),
        treatment: designGuideText(candidate?.treatment, block.treatment)
      };
    }),
    decoration: designGuideText(object.decoration, fallback.decoration ?? "") || undefined
  };
}

/** 检索后的参考资料；界面不再要求用户逐卡勾选。 */
export function selectedSearchMaterials(slide: SlideDto): SlideSearchResult[] {
  return slide.searchJson?.results ?? [];
}

function shortLine(text: string, _max = 28) {
  return text.replace(/\s+/g, " ").trim();
}

function compactParagraph(text: string, _max = 420) {
  return text.replace(/\s+/g, " ").trim();
}

export function buildSearchSynthesis(
  slide: SlideDto,
  results: SlideSearchResult[],
  input: Partial<SlideSearchSynthesis> = {}
): SlideSearchSynthesis {
  const findings =
    input.keyFindings?.filter((finding) => finding.statement.trim()) ??
    results.slice(0, 4).map((result, index) => ({
      statement: compactParagraph(result.snippet || result.title, 120),
      sourceIndexes: [index + 1]
    }));
  const summary = compactParagraph(
    input.summary ||
      slide.keyMessage ||
      findings[0]?.statement ||
      `围绕「${slide.title}」尚未形成可用的资料结论。`,
    220
  );
  const draftReference = compactParagraph(
    input.draftReference ||
      [summary, ...findings.map((finding) => finding.statement)]
        .filter(Boolean)
        .filter((line, index, lines) => lines.indexOf(line) === index)
        .join("；"),
    700
  );

  return {
    summary,
    keyFindings: findings.slice(0, 6),
    draftReference,
    caveats: input.caveats?.filter(Boolean) ?? []
  };
}

type AiPageSearchDraft = {
  queries?: string[];
  results?: Array<{ title?: string; snippet?: string; selected?: boolean }>;
  synthesis?: {
    summary?: string;
    keyFindings?: Array<{ statement?: string; sourceIndexes?: number[] }>;
    draftReference?: string;
    caveats?: string[];
  };
  notes?: string;
};

/**
 * 普通 LLM 通道没有联网工具：只允许产出“知识整理”，并强制移除模型臆造 URL。
 * 真正的 web 来源只由 ResearchAdapter 写入。
 */
export function normalizeAiPageSearch(slide: SlideDto, draft: AiPageSearchDraft): SlideSearchJson {
  const fallback = mockPageSearch(slide);
  const results = draft.results
    ?.filter((item) => item.title?.trim() && item.snippet?.trim())
    .map((item) => ({
      title: String(item.title).trim(),
      snippet: compactParagraph(String(item.snippet), 260),
      selected: item.selected !== false
    }));
  const normalizedResults = results?.length ? results : fallback.results;
  const synthesisDraft = draft.synthesis;
  const keyFindings = synthesisDraft?.keyFindings
    ?.filter((finding) => finding.statement?.trim())
    .map((finding) => ({
      statement: compactParagraph(String(finding.statement), 140),
      sourceIndexes: (finding.sourceIndexes ?? []).filter(
        (index) => Number.isInteger(index) && index > 0 && index <= normalizedResults.length
      )
    }));

  return {
    mode: "ai-knowledge",
    queries: draft.queries?.filter((query) => query.trim()).slice(0, 5) ?? fallback.queries,
    results: normalizedResults,
    synthesis: buildSearchSynthesis(slide, normalizedResults, {
      summary: synthesisDraft?.summary,
      keyFindings,
      draftReference: synthesisDraft?.draftReference,
      caveats: synthesisDraft?.caveats?.filter(Boolean) ?? ["当前未接入联网检索，关键事实与数据需人工核验。"]
    }),
    notes: draft.notes || "当前为 AI 知识整理（未联网）；不生成或冒充网页来源。"
  };
}

/** Mock / 回落：用检索后的参考素材综合出初稿，避免原样复述 contentPoints */
export function buildMockPlanFromSearch(
  slide: SlideDto,
  facts: FactDto[] = []
): SlidePlanDto {
  const cards = selectedSearchMaterials(slide);
  const supportingFacts = facts.filter((fact) => slide.sourceFactIds.includes(fact.id));
  const sourceFacts =
    supportingFacts.length > 0 ? supportingFacts : facts.filter((fact) => fact.canUseInPpt).slice(0, 4);

  const snippets = cards
    .map((card) => shortLine(card.snippet || card.title, 32))
    .filter(Boolean);
  const factLines = sourceFacts.slice(0, 3).map((fact) => shortLine(`${fact.category}：${fact.content}`, 32));

  const bulletItems =
    snippets.length > 0
      ? snippets.slice(0, 3)
      : slide.contentPoints.length > 0
        ? slide.contentPoints.slice(0, 3).map((item) => shortLine(item, 28))
        : factLines.slice(0, 3);

  const calloutItems =
    cards.length > 1
      ? cards.slice(1, 4).map((card) => shortLine(`${card.title}：${card.snippet}`, 36))
      : factLines.length > 0
        ? factLines
        : [shortLine(slide.slideGoal || "补充落地提示与边界条件", 28)];

  const blocks: SlideContentBlockDto[] = [
    {
      type: slide.recommendedLayout.includes("timeline") ? "timeline" : "bullets",
      title: cards.length > 0 ? "素材提炼要点" : "正文要点",
      items: bulletItems
    },
    {
      type: slide.recommendedLayout.includes("risk") ? "table" : "callout",
      title: cards.length > 0 ? "资料延伸" : "引用事实",
      items: calloutItems.slice(0, 3)
    }
  ];

  return {
    title: slide.title,
    pageGoal: shortLine(
      cards.length > 0
        ? `基于 ${cards.length} 条检索素材，讲清「${slide.keyMessage || slide.title}」`
        : slide.slideGoal || `讲清「${slide.title}」`,
      48
    ),
    keyMessage: shortLine(slide.keyMessage || snippets[0] || "请补充本页核心结论", 40),
    layoutType: slide.recommendedLayout,
    contentBlocks: blocks,
    sourceFactIds: sourceFacts.map((fact) => fact.id),
    designGuide: deriveSlideDesignGuide({
      layoutType: slide.recommendedLayout,
      contentBlocks: blocks
    })
  };
}

export function mockBriefQuestions(topic: string): BriefQuestion[] {
  return [
    { id: "audience", question: `这份「${topic}」主要讲给谁听？`, placeholder: "例如：客户决策层 / 内部项目组" },
    { id: "purpose", question: "希望听完后对方做什么？", placeholder: "例如：批准预算 / 对齐风险 / 了解产品" },
    { id: "pages", question: "期望大概多少页？", placeholder: "例如：8-12 页" },
    { id: "must", question: "必须讲清楚的 1-3 个要点是什么？", placeholder: "核心卖点或关键结论" },
    { id: "avoid", question: "有什么禁忌或不要出现的内容？", placeholder: "可选" }
  ];
}

export function mockFinalizeBrief(topic: string, answers: Record<string, string>): BriefJson {
  const pageCount = Number.parseInt(answers.pages?.replace(/\D/g, "") || "8", 10);
  return {
    topic,
    questions: mockBriefQuestions(topic),
    answers,
    summary: `围绕「${topic}」为 ${answers.audience || "目标受众"} 制作演示，目标：${answers.purpose || "完成汇报"}。必讲：${answers.must || "核心结论"}。`,
    audience: answers.audience || "待确认受众",
    purpose: answers.purpose || "待确认目的",
    pageCount: Number.isFinite(pageCount) && pageCount > 0 ? Math.min(16, pageCount) : 8,
    styleNotes: answers.avoid || ""
  };
}

export function mockResearch(topic: string, briefSummary: string): ResearchJson {
  return {
    summary: `关于「${topic}」的背景调研摘要。${briefSummary ? `结合需求：${briefSummary}` : ""} 第一期为模型整理的行业与产品语境，正式交付前请人工核对关键数字。`,
    bullets: [
      `${topic} 当前市场关注点集中在效率、可控与可落地。`,
      "受众通常关心：价值主张、差异化、实施路径与风险。",
      "演示结构建议：封面 → 目录 → 问题/机会 → 方案 → 案例/能力 → 落地 → 收尾。"
    ],
    sources: [
      { title: `${topic} 概览线索`, snippet: "产品定位、能力边界与典型场景摘要（待核验）。" },
      { title: `${topic} 行业语境线索`, snippet: "相关技术趋势与竞品对照要点（待核验）。" }
    ]
  };
}

export function mockPageSearch(slide: SlideDto): SlideSearchJson {
  const base = slide.title || "本页主题";
  const results: SlideSearchResult[] = [
    {
      title: `${base}：关键结论线索`,
      snippet: slide.keyMessage || `围绕「${base}」的核心论述与支撑点。`,
      selected: true
    },
    {
      title: `${base}：支撑论据线索`,
      snippet: (slide.contentPoints?.[0] as string) || "补充可验证的论据与边界条件。",
      selected: true
    },
    {
      title: `${base}：落地提示线索`,
      snippet: slide.slideGoal || "实施步骤、责任人与验收标准提示。",
      selected: true
    }
  ];
  return {
    mode: "ai-knowledge",
    queries: [`${base} 核心要点`, `${base} 实践案例`, `${base} 风险与注意`],
    results,
    synthesis: buildSearchSynthesis(slide, results, {
      caveats: ["当前未接入联网检索，关键事实与数据需人工核验。"]
    }),
    notes: "当前为 AI 知识整理（未联网）；不生成或冒充网页来源。"
  };
}
