/**
 * 场景感知的配色推荐知识层。
 *
 * 数据来源：kimi-slides.skill 各场景文档（business-plan / management-report / tech-engineering /
 * analysis-decision / brand-creative / academic-research / education-training）中的
 * 「Color Palette Reference」章节，经人工精选后结构化。
 *
 * 用途：在 designBrief 编译时根据 presentationStyle + slideGoal 选择匹配的配色方向，
 * 作为 prompt 提示注入，引导模型选择更有场景感的 theme.tokens 值。
 * 不覆盖 ThemePack —— ThemePack 仍是最终色彩真相源。
 */

export interface SceneColorPalette {
  /** 配色方案 ID */
  id: string;
  /** 适用场景描述 */
  label: string;
  /** 背景色 hex */
  base: string;
  /** 结构色 / 主色 hex */
  structural: string;
  /** 强调色 hex */
  accent: string;
  /** 设计理由：为什么选这组色 */
  rationale: string;
}

export interface SceneColorGroup {
  /** 场景 ID，对应 classifier.ts 的 CATEGORY_KEYWORDS key */
  sceneId: string;
  /** 场景名称 */
  sceneName: string;
  /** 该场景的精选配色方案 */
  palettes: SceneColorPalette[];
}

// ─── Tech / Engineering ───────────────────────────────────────────

const techPalettes: SceneColorPalette[] = [
  {
    id: "tech-ink-neon",
    label: "Tech/AI/SaaS 发布会",
    base: "#141414",
    structural: "#C6F24E",
    accent: "#C6F24E",
    rationale: "墨黑底 + 荧光黄绿：发布会级色彩冲击，拒绝蓝紫渐变"
  },
  {
    id: "tech-mist-indigo",
    label: "Tech/AI/SaaS 介绍",
    base: "#F2F4F7",
    structural: "#2B3A8E",
    accent: "#A8E05F",
    rationale: "雾白底 + 靛蓝 + 青柠：清晰、现代、高对比"
  },
  {
    id: "tech-graphite-pine",
    label: "互联网/科技月报",
    base: "#F4F7F6",
    structural: "#2B2D42",
    accent: "#4C7A5A",
    rationale: "冷白底 + 石墨灰 + 松绿：内敛的技术感"
  },
  {
    id: "tech-ink-celadon",
    label: "互联网/增长报告",
    base: "#101418",
    structural: "#3FA68C",
    accent: "#F4F7F6",
    rationale: "墨黑底 + 青瓷绿 + 冷白：深色看板上的数据叙事"
  }
];

// ─── Business / Proposal ──────────────────────────────────────────

const businessPalettes: SceneColorPalette[] = [
  {
    id: "biz-cream-baking",
    label: "消费品/餐饮/招商",
    base: "#F3D9A4",
    structural: "#6B4226",
    accent: "#A63A2E",
    rationale: "奶油杏底 + 烘焙棕 + 砖红：温暖而有食欲感"
  },
  {
    id: "biz-ink-luxury",
    label: "奢侈/时尚/美妆",
    base: "#0D0D0D",
    structural: "#F5F0E6",
    accent: "#6D1F2C",
    rationale: "墨黑底 + 象牙白 + 勃艮第：编辑式高端调性"
  },
  {
    id: "biz-offwhite-brass",
    label: "金融/法律/专业服务",
    base: "#F7F3E8",
    structural: "#123B2F",
    accent: "#B08D3E",
    rationale: "暖纸白 + 墨绿 + 铜金：沉稳的专业主义"
  },
  {
    id: "biz-charcoal-safety",
    label: "工业/能源/物流",
    base: "#232323",
    structural: "#E8590C",
    accent: "#868E96",
    rationale: "炭黑底 + 安全橙 + 钢灰：重工业的力量感"
  },
  {
    id: "biz-warmwhite-purple",
    label: "教育/知识付费",
    base: "#FAF6EE",
    structural: "#3D2C4F",
    accent: "#F2C14E",
    rationale: "暖白底 + 墨紫 + 奶黄：知性而亲切"
  }
];

// ─── Management Report ────────────────────────────────────────────

const managementPalettes: SceneColorPalette[] = [
  {
    id: "mgmt-offwhite-ink",
    label: "运营/财务/董事会",
    base: "#F7F3E8",
    structural: "#123B2F",
    accent: "#B08D3E",
    rationale: "暖纸白 + 墨绿 + 铜金：经营报告的权威感"
  },
  {
    id: "mgmt-stone-navy",
    label: "运营/财务报告（深色）",
    base: "#E7E2D8",
    structural: "#16283C",
    accent: "#C0652B",
    rationale: "浅石色 + 深海军蓝 + 铜橙：稳重的叙事底色"
  },
  {
    id: "mgmt-warmwhite-wine",
    label: "零售/消费/供应链",
    base: "#F8F5EF",
    structural: "#5E1F2D",
    accent: "#D8C3A5",
    rationale: "暖白底 + 酒红 + 米金：零售运营的温度感"
  },
  {
    id: "mgmt-mist-indigo",
    label: "HR/行政/政务",
    base: "#F6F4EF",
    structural: "#1B2A4A",
    accent: "#AEB4BC",
    rationale: "暖灰底 + 深海军 + 银灰：政务级的中性与严谨"
  }
];

// ─── Analysis / Decision ──────────────────────────────────────────

const analysisPalettes: SceneColorPalette[] = [
  {
    id: "analysis-white-navy",
    label: "咨询/分析报告",
    base: "#FFFFFF",
    structural: "#16283C",
    accent: "#16283C",
    rationale: "纯白底 + 单色骨架（深海军蓝），2-3 级同色梯度；图表去默认化"
  },
  {
    id: "analysis-white-ink",
    label: "尽调/决策分析",
    base: "#F7F3E8",
    structural: "#123B2F",
    accent: "#123B2F",
    rationale: "暖纸白 + 墨绿单色骨架：单色阶梯 + 中性灰的极简分析风"
  }
];

// ─── Academic / Research ──────────────────────────────────────────

const academicPalettes: SceneColorPalette[] = [
  {
    id: "acad-titanium-teal",
    label: "学术答辩（通用）",
    base: "#E7E8E5",
    structural: "#0F766E",
    accent: "#0F766E",
    rationale: "钛灰底 + 墨青强调：精致而非廉价的学术感"
  },
  {
    id: "acad-archival-vermilion",
    label: "人文社科/档案",
    base: "#F1E9DA",
    structural: "#27231F",
    accent: "#8C3B36",
    rationale: "档案纸底 + 墨黑 + 朱砂红：人文学术特刊的温度"
  },
  {
    id: "acad-ivory-hematoxylin",
    label: "医学/生物研究",
    base: "#F7F3E8",
    structural: "#684765",
    accent: "#C9828B",
    rationale: "象牙纸底 + 苏木紫 + 伊红粉：病理切片的学术色彩"
  },
  {
    id: "acad-gray-ochre",
    label: "地球/气候/环境",
    base: "#E7E8E5",
    structural: "#334047",
    accent: "#B66A3C",
    rationale: "岩层灰底 + 矿石赭 + 硫黄黄：地质学的材料感"
  }
];

// ─── Brand / Creative ─────────────────────────────────────────────

const brandPalettes: SceneColorPalette[] = [
  {
    id: "brand-klein-poster",
    label: "瑞士/现代主义海报",
    base: "#F7F5EF",
    structural: "#101010",
    accent: "#0038B8",
    rationale: "暖纸白 + 近黑 + 克莱因蓝：极简主义展览海报"
  },
  {
    id: "brand-stencil-indie",
    label: "独立杂志/丝印风",
    base: "#F1E2C2",
    structural: "#171512",
    accent: "#1646B8",
    rationale: "暖米纸 + 墨黑 + 钴蓝：手工装订独立杂志质感"
  },
  {
    id: "brand-brutalist-news",
    label: "粗野主义/报纸",
    base: "#F5F1E8",
    structural: "#111111",
    accent: "#C8102E",
    rationale: "新闻纸白 + 墨黑 + 新闻红：特刊版面的冲击力"
  },
  {
    id: "brand-memphis-pop",
    label: "孟菲斯/潮流活动",
    base: "#FFF3D8",
    structural: "#151427",
    accent: "#FF3EA5",
    rationale: "奶油白 + 深黑紫 + 荧光粉：八十年代波普海报"
  }
];

// ─── Education / Training ─────────────────────────────────────────

const educationPalettes: SceneColorPalette[] = [
  {
    id: "edu-neutral-accent",
    label: "课件/培训（通用）",
    base: "#F5F7FA",
    structural: "#1A2332",
    accent: "#0D9488",
    rationale: "近白底 + 近黑正文 + 一个结构强调色：适合独立阅读"
  },
  {
    id: "edu-warmwhite-indigo",
    label: "知识科普/能力建设",
    base: "#FAF6EE",
    structural: "#22315C",
    accent: "#F08A5D",
    rationale: "暖白底 + 深靛蓝 + 珊瑚橙：知性且有亲和力"
  }
];

// ─── All Scene Groups ─────────────────────────────────────────────

export const SCENE_COLOR_GROUPS: SceneColorGroup[] = [
  { sceneId: "tech-engineering", sceneName: "技术/工程", palettes: techPalettes },
  { sceneId: "business-plan", sceneName: "商业提案", palettes: businessPalettes },
  { sceneId: "management-report", sceneName: "管理汇报", palettes: managementPalettes },
  { sceneId: "analysis-decision", sceneName: "分析决策", palettes: analysisPalettes },
  { sceneId: "academic-research", sceneName: "学术研究", palettes: academicPalettes },
  { sceneId: "brand-creative", sceneName: "品牌创意", palettes: brandPalettes },
  { sceneId: "education-training", sceneName: "教育培训", palettes: educationPalettes }
];

/**
 * 根据场景 ID 选择匹配的配色方案组。
 * 如果场景不匹配任何组，返回 null。
 */
export function selectColorPalettesForScene(
  sceneId: string | null | undefined
): SceneColorGroup | null {
  if (!sceneId) return null;
  return SCENE_COLOR_GROUPS.find((group) => group.sceneId === sceneId) ?? null;
}

/**
 * 为 prompt 格式化配色推荐，作为设计方向参考。
 * 每个方案包含 base/structural/accent 三层色彩 + 设计理由。
 */
export function formatColorPaletteRecommendation(
  group: SceneColorGroup
): string {
  const lines = [
    `# 场景配色参考（${group.sceneName}）`,
    "以下是与当前场景匹配的精选配色方向。选择一组作为 theme.tokens 的色彩基调，或以此为起点调整。",
    ""
  ];
  for (const palette of group.palettes) {
    lines.push(
      `- ${palette.label}：背景 ${palette.base} + 结构色 ${palette.structural} + 强调色 ${palette.accent}`,
      `  理由：${palette.rationale}`
    );
  }
  lines.push(
    "",
    "不要直接复制这些色值——以此为方向，结合当前 theme 的 token 体系生成合理的 6 位 hex 值。"
  );
  return lines.join("\n");
}
