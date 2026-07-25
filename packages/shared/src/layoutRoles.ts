/**
 * 自研页面角色 + 版式骨架（blueprint）。
 * 对齐「先选角色再填文案」心智；结构骨架供 Outline / Plan / Design 提示词引用。
 * 角色命名概念对齐常见职场 deck（封面/论点/趋势/对比等），不移植外部版式库。
 */

/** 叙事角色（选版式池用） */
export const pageLayoutRoles = [
  "cover",
  "toc",
  "statement",
  "transition",
  "metrics",
  "status",
  "trend",
  "comparison",
  "distribution",
  "process",
  "case",
  "risk",
  "observation",
  "action",
  "closing",
  "content",
  "context",
  "image",
  "relationship",
  "ambient",
  "result",
  "team"
] as const;

export type PageLayoutRole = (typeof pageLayoutRoles)[number];

/**
 * 写入 Slide.recommendedLayout / plan.layoutType 的稳定枚举。
 * 含历史值，保证旧项目可读。
 */
export const recommendedLayouts = [
  "cover",
  "toc",
  "statement",
  "transition",
  "metrics",
  "status-cards",
  "progress-cards",
  "trend",
  "comparison",
  "timeline",
  "process",
  "distribution",
  "case-study",
  "risk-table",
  "observation",
  "action-list",
  "closing",
  "generic-cards",
  "context-matrix",
  "image-gallery",
  "relationship-map",
  "ambient-divider",
  "result-poster",
  "team-profile"
] as const;

export type RecommendedLayout = (typeof recommendedLayouts)[number];

export interface LayoutBlockHint {
  /** 对应 plan contentBlocks.type 或 IR 元素族 */
  type: "summary" | "bullets" | "timeline" | "table" | "callout" | "hero" | "metric" | "process";
  /** 大致面积比例，如 40% / 60% */
  ratio: string;
  /** 文案字段提示（类 props 填空） */
  propHint: string;
}

export interface LayoutCompositionHint {
  /** 默认剪影（与 layoutVariants 呼应） */
  silhouette: string;
  /** 主视觉意图 */
  heroIntent: string;
  /** 字阶档：hero / balanced / dense / metric */
  typeScale: "hero" | "balanced" | "dense" | "metric";
  /** 最小卡片间距意图（提示词用） */
  minGutter: string;
}

export interface LayoutBlueprint {
  role: PageLayoutRole;
  recommendedLayout: RecommendedLayout;
  label: string;
  description: string;
  /** 结构骨架 */
  blocks: LayoutBlockHint[];
  /** 建议 partTitle */
  defaultPartTitle: string;
  /** 构图规范（防同质三卡墙） */
  composition: LayoutCompositionHint;
}

export const layoutBlueprints: LayoutBlueprint[] = [
  {
    role: "cover",
    recommendedLayout: "cover",
    label: "封面",
    description: "大标题 + 核心信息 + 2–3 个支撑点",
    defaultPartTitle: "开场",
    composition: {
      silhouette: "左大标题或居中主张 + 指标/元信息",
      heroIntent: "标题区占视觉主导，勿三卡开场",
      typeScale: "hero",
      minGutter: "24px"
    },
    blocks: [
      { type: "hero", ratio: "55%", propHint: "title / keyMessage" },
      { type: "metric", ratio: "25%", propHint: "核心数字或关键词" },
      { type: "bullets", ratio: "20%", propHint: "2–3 条场景/受众提示" }
    ]
  },
  {
    role: "toc",
    recommendedLayout: "toc",
    label: "目录",
    description: "章节导航，条目短、可扫读",
    defaultPartTitle: "开场",
    composition: {
      silhouette: "摘要 + 编号列表或步骤轨",
      heroIntent: "章节名可扫读，禁止三卡墙",
      typeScale: "balanced",
      minGutter: "20px"
    },
    blocks: [
      { type: "summary", ratio: "30%", propHint: "本篇叙事一句话" },
      { type: "bullets", ratio: "70%", propHint: "章节标题列表（4–7 项）" }
    ]
  },
  {
    role: "statement",
    recommendedLayout: "statement",
    label: "论点/金句",
    description: "一页一论：摘要、金句或核心判断",
    defaultPartTitle: "开场",
    composition: {
      silhouette: "超大金句 + 少量支撑",
      heroIntent: "一页一论，留白充分",
      typeScale: "hero",
      minGutter: "32px"
    },
    blocks: [
      { type: "hero", ratio: "60%", propHint: "金句 / 核心判断（短）" },
      { type: "callout", ratio: "40%", propHint: "1–2 条支撑理由" }
    ]
  },
  {
    role: "transition",
    recommendedLayout: "transition",
    label: "章节分隔",
    description: "章节过渡页，标题大、正文极少",
    defaultPartTitle: "过渡",
    composition: {
      silhouette: "全幅章节名",
      heroIntent: "几乎无正文，强章节感",
      typeScale: "hero",
      minGutter: "40px"
    },
    blocks: [
      { type: "hero", ratio: "70%", propHint: "章节名" },
      { type: "summary", ratio: "30%", propHint: "本章一句话预告" }
    ]
  },
  {
    role: "metrics",
    recommendedLayout: "metrics",
    label: "指标",
    description: "3–5 个指标卡 + 一句解读",
    defaultPartTitle: "进展",
    composition: {
      silhouette: "横排 KPI 或单核大数字",
      heroIntent: "数字/关键词压场，假图勿占主区",
      typeScale: "metric",
      minGutter: "24px"
    },
    blocks: [
      { type: "metric", ratio: "60%", propHint: "指标 label / value / note" },
      { type: "summary", ratio: "40%", propHint: "指标背后的主结论" }
    ]
  },
  {
    role: "status",
    recommendedLayout: "status-cards",
    label: "现状卡",
    description: "多卡并列现状/能力",
    defaultPartTitle: "背景",
    composition: {
      silhouette: "顶结论 + 三联或主次卡",
      heroIntent: "有主次，避免完全等权",
      typeScale: "balanced",
      minGutter: "24px"
    },
    blocks: [{ type: "bullets", ratio: "100%", propHint: "每卡：标题 + ≤3 短句" }]
  },
  {
    role: "trend",
    recommendedLayout: "trend",
    label: "趋势",
    description: "时间线、阶段或走势叙事",
    defaultPartTitle: "背景",
    composition: {
      silhouette: "时间轨或阶段卡 + 解读",
      heroIntent: "必须有阶段顺序感",
      typeScale: "balanced",
      minGutter: "24px"
    },
    blocks: [
      { type: "timeline", ratio: "70%", propHint: "阶段节点短句" },
      { type: "callout", ratio: "30%", propHint: "趋势解读一句" }
    ]
  },
  {
    role: "comparison",
    recommendedLayout: "comparison",
    label: "对比",
    description: "两栏或三栏对照",
    defaultPartTitle: "方案",
    composition: {
      silhouette: "双栏/三栏对照",
      heroIntent: "栏目标题形成对照语义",
      typeScale: "balanced",
      minGutter: "24px"
    },
    blocks: [
      { type: "bullets", ratio: "50%", propHint: "左侧：现状/竞品" },
      { type: "bullets", ratio: "50%", propHint: "右侧：方案/差异" }
    ]
  },
  {
    role: "distribution",
    recommendedLayout: "distribution",
    label: "结构分布",
    description: "比例、漏斗、梯队或结构演变",
    defaultPartTitle: "分析",
    composition: {
      silhouette: "结构数字 + 分段解读",
      heroIntent: "占比/层级清晰可读",
      typeScale: "metric",
      minGutter: "20px"
    },
    blocks: [
      { type: "metric", ratio: "45%", propHint: "结构占比 / 关键数字" },
      { type: "bullets", ratio: "55%", propHint: "分段解读（每段≤2 句）" }
    ]
  },
  {
    role: "process",
    recommendedLayout: "process",
    label: "流程",
    description: "步骤流或实施路径",
    defaultPartTitle: "落地",
    composition: {
      silhouette: "步骤轨 + 里程碑",
      heroIntent: "有序步骤，非无序要点",
      typeScale: "balanced",
      minGutter: "24px"
    },
    blocks: [
      { type: "timeline", ratio: "70%", propHint: "步骤/节点短句" },
      { type: "callout", ratio: "30%", propHint: "关键里程碑提示" }
    ]
  },
  {
    role: "case",
    recommendedLayout: "case-study",
    label: "案例",
    description: "典型案例、分屏叙事",
    defaultPartTitle: "案例",
    composition: {
      silhouette: "背景 | 做法 | 结果",
      heroIntent: "故事线清晰",
      typeScale: "balanced",
      minGutter: "24px"
    },
    blocks: [
      { type: "summary", ratio: "35%", propHint: "案例背景与结论" },
      { type: "bullets", ratio: "65%", propHint: "做法 / 结果 / 可复用点" }
    ]
  },
  {
    role: "risk",
    recommendedLayout: "risk-table",
    label: "风险",
    description: "风险表或风险卡 + 缓解",
    defaultPartTitle: "风险",
    composition: {
      silhouette: "概览 + 矩阵或风险卡",
      heroIntent: "每项含影响与缓解",
      typeScale: "dense",
      minGutter: "20px"
    },
    blocks: [
      { type: "table", ratio: "65%", propHint: "风险 | 影响 | 缓解" },
      { type: "callout", ratio: "35%", propHint: "需客户确认项" }
    ]
  },
  {
    role: "observation",
    recommendedLayout: "observation",
    label: "洞察",
    description: "展望、观点引述或专题洞察",
    defaultPartTitle: "洞察",
    composition: {
      silhouette: "洞察大卡 + 含义",
      heroIntent: "观点突出，少清单",
      typeScale: "hero",
      minGutter: "28px"
    },
    blocks: [
      { type: "summary", ratio: "50%", propHint: "核心洞察" },
      { type: "callout", ratio: "50%", propHint: "含义 / 下一步含义" }
    ]
  },
  {
    role: "action",
    recommendedLayout: "action-list",
    label: "行动",
    description: "下一步：事项 / 责任 / 时间",
    defaultPartTitle: "收束",
    composition: {
      silhouette: "行动表或清单轨 + 提示",
      heroIntent: "可执行：事项/责任/时间",
      typeScale: "dense",
      minGutter: "20px"
    },
    blocks: [
      { type: "timeline", ratio: "70%", propHint: "行动项短句" },
      { type: "callout", ratio: "30%", propHint: "本周必须闭环" }
    ]
  },
  {
    role: "closing",
    recommendedLayout: "closing",
    label: "收束",
    description: "一句话结论 + 诉求/CTA",
    defaultPartTitle: "收束",
    composition: {
      silhouette: "结论 + CTA",
      heroIntent: "收束勿再开新话题",
      typeScale: "hero",
      minGutter: "32px"
    },
    blocks: [
      { type: "summary", ratio: "50%", propHint: "最终结论" },
      { type: "callout", ratio: "50%", propHint: "希望对方做什么" }
    ]
  },
  {
    role: "content",
    recommendedLayout: "generic-cards",
    label: "通用内容",
    description: "Bento 卡片兜底",
    defaultPartTitle: "正文",
    composition: {
      silhouette: "顶结论 + 有主次的支撑卡",
      heroIntent: "禁止完全等权三卡墙",
      typeScale: "balanced",
      minGutter: "24px"
    },
    blocks: [
      { type: "summary", ratio: "30%", propHint: "主结论" },
      { type: "bullets", ratio: "70%", propHint: "支撑要点卡" }
    ]
  },
  {
    role: "context",
    recommendedLayout: "context-matrix",
    label: "背景/定位",
    description: "市场背景、定位矩阵、区域画像、批注说明",
    defaultPartTitle: "背景",
    composition: {
      silhouette: "上下分层或四象限矩阵",
      heroIntent: "关系或定位清晰可读，非纯文字堆砌",
      typeScale: "balanced",
      minGutter: "24px"
    },
    blocks: [
      { type: "summary", ratio: "35%", propHint: "背景概述与核心定位" },
      { type: "bullets", ratio: "65%", propHint: "定位维度或区域特征（每条≤2 句）" }
    ]
  },
  {
    role: "image",
    recommendedLayout: "image-gallery",
    label: "图片/画廊",
    description: "全景、拼贴、陈列、画廊、图片主导页",
    defaultPartTitle: "展示",
    composition: {
      silhouette: "大图主视觉 + 辅助说明",
      heroIntent: "图片占主区，文字克制",
      typeScale: "balanced",
      minGutter: "20px"
    },
    blocks: [
      { type: "hero", ratio: "70%", propHint: "主图区域" },
      { type: "summary", ratio: "30%", propHint: "图片说明或标题" }
    ]
  },
  {
    role: "relationship",
    recommendedLayout: "relationship-map",
    label: "关系/生态",
    description: "联投、层级、网络、交集、径向关系",
    defaultPartTitle: "生态",
    composition: {
      silhouette: "中心节点 + 径向连接或层级树",
      heroIntent: "关系网络可视化，节点有主次",
      typeScale: "balanced",
      minGutter: "20px"
    },
    blocks: [
      { type: "summary", ratio: "30%", propHint: "关系总述" },
      { type: "process", ratio: "70%", propHint: "核心节点与连接关系" }
    ]
  },
  {
    role: "ambient",
    recommendedLayout: "ambient-divider",
    label: "氛围/视觉章节",
    description: "动态背景、氛围页、视觉章节页",
    defaultPartTitle: "过渡",
    composition: {
      silhouette: "全幅视觉 + 极简标题",
      heroIntent: "氛围主导，正文极少，强视觉冲击",
      typeScale: "hero",
      minGutter: "40px"
    },
    blocks: [
      { type: "hero", ratio: "80%", propHint: "视觉主区或章节标题" },
      { type: "summary", ratio: "20%", propHint: "一句话情绪引导" }
    ]
  },
  {
    role: "result",
    recommendedLayout: "result-poster",
    label: "结论/数字海报",
    description: "核心结论、数字海报、核心要点",
    defaultPartTitle: "结论",
    composition: {
      silhouette: "超大结论数字或关键词 + 解读",
      heroIntent: "结论强度最大化，视觉压场",
      typeScale: "hero",
      minGutter: "28px"
    },
    blocks: [
      { type: "metric", ratio: "55%", propHint: "核心结论数字或关键词" },
      { type: "callout", ratio: "45%", propHint: "结论解读与意义" }
    ]
  },
  {
    role: "team",
    recommendedLayout: "team-profile",
    label: "团队/关于我们",
    description: "团队成员、关于我们、核心班底",
    defaultPartTitle: "团队",
    composition: {
      silhouette: "团队成员卡片网格或左右分栏",
      heroIntent: "人物信息清晰，有角色/职责标注",
      typeScale: "balanced",
      minGutter: "24px"
    },
    blocks: [
      { type: "summary", ratio: "25%", propHint: "团队概述" },
      { type: "bullets", ratio: "75%", propHint: "成员卡（姓名/角色/专长）" }
    ]
  }
];

/** progress-cards 作为 status 族别名保留 */
const legacyLayoutToRole: Record<string, PageLayoutRole> = {
  cover: "cover",
  toc: "toc",
  statement: "statement",
  transition: "transition",
  metrics: "metrics",
  "status-cards": "status",
  "progress-cards": "status",
  trend: "trend",
  comparison: "comparison",
  compare: "comparison",
  timeline: "process",
  process: "process",
  flow: "process",
  distribution: "distribution",
  "case-study": "case",
  case: "case",
  "risk-table": "risk",
  risk: "risk",
  risks: "risk",
  observation: "observation",
  "action-list": "action",
  action: "action",
  actions: "action",
  closing: "closing",
  "generic-cards": "content",
  bento: "content",
  hero: "cover",
  breakdown: "toc",
  /* 新增角色（原 legacy 别名升级为独立角色） */
  context: "context",
  "context-matrix": "context",
  image: "image",
  "image-gallery": "image",
  gallery: "image",
  relationship: "relationship",
  "relationship-map": "relationship",
  network: "relationship",
  ambient: "ambient",
  "ambient-divider": "ambient",
  result: "result",
  "result-poster": "result",
  poster: "result",
  team: "team",
  "team-profile": "team",
  "about-us": "team"
};

export function isRecommendedLayout(value: unknown): value is RecommendedLayout {
  return typeof value === "string" && (recommendedLayouts as readonly string[]).includes(value);
}

export function normalizeRecommendedLayout(
  value?: string | null,
  fallback: RecommendedLayout = "generic-cards"
): RecommendedLayout {
  if (!value) return fallback;
  const trimmed = value.trim().toLowerCase();
  if (isRecommendedLayout(trimmed)) return trimmed;
  const role = legacyLayoutToRole[trimmed];
  if (role) {
    const bp = layoutBlueprints.find((b) => b.role === role);
    if (bp) return bp.recommendedLayout;
  }
  return fallback;
}

export function layoutRoleFromRecommended(layout?: string | null): PageLayoutRole {
  if (!layout) return "content";
  const key = layout.trim().toLowerCase();
  return legacyLayoutToRole[key] ?? "content";
}

export function blueprintForLayout(layout?: string | null): LayoutBlueprint {
  const role = layoutRoleFromRecommended(layout);
  return layoutBlueprints.find((b) => b.role === role) ?? layoutBlueprints[layoutBlueprints.length - 1]!;
}

/** 供提示词注入的精简目录 */
export function formatLayoutBlueprintCatalog(): string {
  return layoutBlueprints
    .map(
      (bp) =>
        `- ${bp.recommendedLayout}（角色:${bp.role}/${bp.label}）：${bp.description}；剪影=${bp.composition.silhouette}；主视觉=${bp.composition.heroIntent}；区块=${bp.blocks
          .map((b) => `${b.type}@${b.ratio}`)
          .join(" + ")}`
    )
    .join("\n");
}

export function recommendedLayoutEnumValues(): RecommendedLayout[] {
  return [...recommendedLayouts];
}
