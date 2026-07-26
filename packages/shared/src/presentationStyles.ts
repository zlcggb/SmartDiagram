export const presentationStyleIds = [
  "apple-minimal",
  "consulting",
  "data-story",
  "tech-architecture",
  "editorial"
] as const;

export type PresentationStyleId = (typeof presentationStyleIds)[number];

export interface PresentationStylePreset {
  id: PresentationStyleId;
  label: string;
  shortLabel: string;
  description: string;
  useCases: readonly string[];
  composition: string;
  typography: string;
  density: "low" | "medium" | "high";
  preferredRecipeIds: readonly string[];
  promptHint: string;
  forbiddenPatterns: readonly string[];
}

export const defaultPresentationStyleId: PresentationStyleId = "consulting";

export const presentationStylePresets: Record<PresentationStyleId, PresentationStylePreset> = {
  "apple-minimal": {
    id: "apple-minimal",
    label: "Apple 极简",
    shortLabel: "极简",
    description: "大字阶、大留白与单一视觉焦点",
    useCases: ["产品发布", "高层观点", "产品战略"],
    composition: "每页只建立一个视觉重心，以尺度、对齐和留白组织内容；正文模块从严合并。",
    typography: "标题与核心结论形成显著尺度对比，正文克制，最多三个主要字阶。",
    density: "low",
    preferredRecipeIds: ["editorial-hero-split", "quote-monument", "asymmetric-card-stack"],
    promptHint: "像高端产品发布会与年度报告一样克制，不把页面画成后台界面。",
    forbiddenPatterns: ["等宽卡片墙", "整高强调色条", "多重胶囊标签", "无意义光晕", "密集小字"]
  },
  consulting: {
    id: "consulting",
    label: "战略咨询",
    shortLabel: "咨询",
    description: "结论先行，结构清楚，适合决策沟通",
    useCases: ["管理汇报", "决策分析", "方案建议"],
    composition: "先呈现结论，再用对比、矩阵、因果或行动结构提供证据，保持稳定阅读顺序。",
    typography: "标题、结论、模块标题与证据正文层级明确；重点使用字重和局部强调色。",
    density: "high",
    preferredRecipeIds: ["matrix-contrast", "risk-register", "dual-engine-bridge", "evidence-dashboard"],
    promptHint: "让听众在数秒内看懂结论、依据与下一步，不做装饰性拼贴。",
    forbiddenPatterns: ["没有结论的卡片罗列", "过度装饰", "重复事实", "装饰性大图占据证据空间"]
  },
  "data-story": {
    id: "data-story",
    label: "数据叙事",
    shortLabel: "数据",
    description: "数字和趋势优先，从证据走向结论",
    useCases: ["经营复盘", "研究报告", "业绩分析"],
    composition: "以关键数字、趋势或比较作为主视觉，并用注释建立证据到结论的阅读路径。",
    typography: "关键数字最大，结论次之，口径和来源弱化但清晰可读。",
    density: "medium",
    preferredRecipeIds: ["evidence-dashboard", "matrix-contrast", "stepped-roadmap"],
    promptHint: "图表和数字必须承载真实信息，所有标注服务于解释变化与差异。",
    forbiddenPatterns: ["虚构数据", "纯装饰图表", "无口径 KPI", "所有数字同等强调", "仪表盘式碎片堆叠"]
  },
  "tech-architecture": {
    id: "tech-architecture",
    label: "科技架构",
    shortLabel: "架构",
    description: "系统边界、流程节点与关系优先",
    useCases: ["技术方案", "系统设计", "产品发布会"],
    composition: "先建立系统边界和层级，再绘制节点、流向与依赖；连接线从明确端点出发。",
    typography: "系统名和层级标签清楚，节点正文短而可读，技术关键词可局部着色。",
    density: "medium",
    preferredRecipeIds: ["radial-ecosystem", "dual-engine-bridge", "stepped-roadmap"],
    promptHint: "关系必须可追踪，架构不是卡片集合；连接线必须避让文字并位于内容后方。",
    forbiddenPatterns: ["悬空连接线", "连线穿字", "边界不明", "无关系的节点散布", "霓虹光污染"]
  },
  editorial: {
    id: "editorial",
    label: "编辑杂志",
    shortLabel: "编辑",
    description: "非对称网格与有节奏的图文叙事",
    useCases: ["品牌故事", "人物专题", "行业洞察"],
    composition: "使用非对称网格、尺度跳跃和有意留白建立叙事节奏，避免平均分栏。",
    typography: "展示标题具有编辑感，正文保持舒适行长，关键词通过字阶而非色块突出。",
    density: "medium",
    preferredRecipeIds: ["editorial-hero-split", "quote-monument", "asymmetric-card-stack"],
    promptHint: "像经过艺术指导的专题版面，允许节奏变化，但信息路径必须清楚。",
    forbiddenPatterns: ["平均三栏", "通用卡片模板", "满版小组件", "过多装饰图标", "无目的错位叠片"]
  }
};

export const presentationStyleList = presentationStyleIds.map((id) => presentationStylePresets[id]);

export function isPresentationStyleId(value: unknown): value is PresentationStyleId {
  return typeof value === "string" && (presentationStyleIds as readonly string[]).includes(value);
}

export function normalizePresentationStyleId(value: unknown): PresentationStyleId {
  return isPresentationStyleId(value) ? value : defaultPresentationStyleId;
}

export function getPresentationStylePreset(value: unknown): PresentationStylePreset {
  return presentationStylePresets[normalizePresentationStyleId(value)];
}

export function resolvePresentationStyleId(
  projectStyle: unknown,
  slideStyle?: unknown
): PresentationStyleId {
  return isPresentationStyleId(slideStyle)
    ? slideStyle
    : normalizePresentationStyleId(projectStyle);
}
