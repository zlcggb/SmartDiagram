import { z } from "zod";

export * from "./studioPipeline.js";
import { pptExportThemes } from "./themePacks.js";
import { recommendedLayouts } from "./layoutRoles.js";
import { themeSurfaceIds } from "./themeSurfacePresets.js";
import {
  presentationStyleIds,
  type PresentationStyleId
} from "./presentationStyles.js";

export const themeTokens = {
  pageBg: "#FFFFFF",
  primaryBlue: "#0066CC",
  titleBlue: "#003F7D",
  bodyText: "#25313C",
  mutedText: "#667085",
  cardBg: "#F7FAFC",
  cardBorder: "#D9E2EC",
  blueTint: "#EAF4FF",
  accentBlue: "#00A6D6",
  success: "#12B76A",
  risk: "#D92D20",
  pending: "#F79009"
} as const;

export const factCategories = [
  "项目背景",
  "客户需求",
  "项目进展",
  "风险问题",
  "待确认事项",
  "下一步计划",
  "建议与判断"
] as const;

export const factStatuses = ["confirmed", "uncertain", "suggestion"] as const;

export const reportTypes = ["项目周报", "阶段汇报", "售前方案汇报", "客户沟通汇报"] as const;

export const slideStatuses = ["draft", "planned", "locked"] as const;
export const slideGenerationStatuses = [
  "draft",
  "planned",
  "search-ready",
  "draft-ready",
  "svg-ready",
  "error"
] as const;
export const slideDesignVersionSourceSchema = z.enum(["ai", "manual", "legacy"]);
export const projectModes = ["topic", "paste"] as const;
export const briefQuestionSources = ["ai", "fallback"] as const;
export {
  pptExportThemes,
  themePacks,
  themePackList,
  getThemePack,
  normalizePptExportTheme,
  themeFamily,
  isPptExportTheme,
  pickDefaultThemePack,
  normalizeAccentPresetId,
  getAccentPresetHex,
  formatThemePackCatalog
} from "./themePacks.js";
export type { PptExportTheme, ThemePackTokens, ThemePackMeta, ThemeAccentPreset } from "./themePacks.js";
export { validateSvgThemeCompliance } from "./svgThemeCompliance.js";
export type { SvgThemeComplianceResult } from "./svgThemeCompliance.js";
export {
  pageLayoutRoles,
  recommendedLayouts,
  layoutBlueprints,
  formatLayoutBlueprintCatalog,
  blueprintForLayout,
  layoutRoleFromRecommended,
  normalizeRecommendedLayout,
  isRecommendedLayout,
  recommendedLayoutEnumValues
} from "./layoutRoles.js";
export type {
  PageLayoutRole,
  RecommendedLayout,
  LayoutBlueprint,
  LayoutBlockHint,
  LayoutCompositionHint
} from "./layoutRoles.js";
export {
  layoutVariants,
  queryLayouts,
  pickDefaultVariant,
  getLayoutVariant,
  variantsForRole,
  variantsForRecommendedLayout,
  formatLayoutVariantCatalog,
  formatVariantCompositionInstruction
} from "./layoutVariants.js";
export type {
  LayoutVariant,
  LayoutComposition,
  LayoutTypeScale,
  HeroZone,
  QueryLayoutsInput
} from "./layoutVariants.js";
export {
  copyBudgets,
  formatCopyBudgetCatalog,
  softTrimCopy,
  applyCopyBudgetsToSlideFields,
  applyCopyBudgetsToBlockItems
} from "./copyBudgets.js";
export {
  getSkeletonFrame,
  listSkeletonFrames,
  hasSkeletonFrame,
  skeletonVariantIds,
  slotsFromSlide,
  formatSkeletonGeometryInstruction
} from "./skeletons/index.js";
export type {
  SkeletonCanvas,
  SkeletonElement,
  SkeletonElementType,
  LayoutSkeletonFrame,
  SkeletonSlotValues,
  SlideLikeForSkeleton
} from "./skeletons/index.js";
export {
  themeSurfaceIds,
  themeSurfacePresets,
  themeSurfaceList,
  isThemeSurfaceId,
  normalizeThemeSurfaceId,
  getThemeSurfacePreset
} from "./themeSurfacePresets.js";
export type { ThemeSurfaceId, ThemeSurfacePreset } from "./themeSurfacePresets.js";
export {
  defaultPresentationStyleId,
  presentationStyleIds,
  presentationStylePresets,
  presentationStyleList,
  isPresentationStyleId,
  normalizePresentationStyleId,
  getPresentationStylePreset,
  resolvePresentationStyleId
} from "./presentationStyles.js";
export type {
  PresentationStyleId,
  PresentationStylePreset
} from "./presentationStyles.js";
/** svg/theme 为主路径；ir/hybrid 为前端工作室与兼容策略（可编辑 IR / 混合） */
export const renderStrategies = ["svg", "theme", "ir", "hybrid"] as const;
export const exportModes = ["draft", "standard", "visual"] as const;
export const svgPptExportModes = ["fidelity", "editable"] as const;
/** A 全文可改/SVG 成功；B 主体可改/部分降级；C 装饰降级或纯 IR 模板 */
export const editableGrades = ["A", "B", "C"] as const;

export const FactCategorySchema = z.enum(factCategories);
export const FactStatusSchema = z.enum(factStatuses);
export const ReportTypeSchema = z.enum(reportTypes);
export const SlideStatusSchema = z.enum(slideStatuses);
export const SlideGenerationStatusSchema = z.enum(slideGenerationStatuses);
export const ProjectModeSchema = z.enum(projectModes);
export const BriefQuestionSourceSchema = z.enum(briefQuestionSources);
export const PptExportThemeSchema = z.enum(pptExportThemes);
export const ThemeSurfaceIdSchema = z.enum(themeSurfaceIds);
export const PresentationStyleIdSchema = z.enum(presentationStyleIds);
export const RecommendedLayoutSchema = z.enum(recommendedLayouts);
export const RenderStrategySchema = z.enum(renderStrategies);
export const ExportModeSchema = z.enum(exportModes);
export const SvgPptExportModeSchema = z.enum(svgPptExportModes);
export const EditableGradeSchema = z.enum(editableGrades);

export const slideIdScopeSchema = z
  .array(z.string().min(1))
  .min(1)
  .max(100)
  .superRefine((slideIds, context) => {
    if (new Set(slideIds).size !== slideIds.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "slideIds 不能包含重复页面" });
    }
  });

export const narrationOptionsSchema = z.object({
  voice: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  prompt: z.string().max(500).optional(),
  languageCode: z.string().min(2).optional(),
  concurrency: z.coerce.number().int().min(1).max(5).optional(),
  slideIds: slideIdScopeSchema.optional(),
  force: z.boolean().optional().default(false)
});

export const narrationStyleSchema = narrationOptionsSchema
  .omit({ force: true, concurrency: true })
  .extend({ prompt: z.string().min(1).max(500) });

export const ttsPreviewSchema = narrationStyleSchema.omit({ slideIds: true }).extend({
  text: z.string().min(1).max(300)
});

export const subtitleStyleIds = ["minimal-outline", "soft-capsule", "brand-accent"] as const;
export const SubtitleStyleSchema = z.enum(subtitleStyleIds);
export type SubtitleStyleId = (typeof subtitleStyleIds)[number];

/** 字幕布局：位置（底部边距 / 水平偏移）与字号，均为占画面比例，可持久化进导出 options。 */
export const subtitleLayoutSchema = z.object({
  /** 底部边距占画面高度比例：越大字幕越往上（默认贴近底部安全区）。 */
  bottomRatio: z.coerce.number().min(0).max(0.35).optional().default(0.02),
  /** 水平偏移占画面宽度比例：负向左、正向右。 */
  offsetXRatio: z.coerce.number().min(-0.35).max(0.35).optional().default(-0.02),
  /** 基础字号占画面宽度比例：越小字越小。 */
  fontScaleRatio: z.coerce.number().min(0.01).max(0.03).optional().default(0.023)
});
export type SubtitleLayoutInput = z.input<typeof subtitleLayoutSchema>;
export type SubtitleLayout = z.infer<typeof subtitleLayoutSchema>;
/** 默认字幕布局：底部 2% 边距、水平左偏 2%、字号 2.3%（用户调试后选定的观感最佳值）。 */
export const defaultSubtitleLayout: SubtitleLayout = { bottomRatio: 0.02, offsetXRatio: -0.02, fontScaleRatio: 0.023 };
export const subtitleStylePresets: Array<{ id: SubtitleStyleId; label: string; description: string }> = [
  { id: "minimal-outline", label: "轻描边", description: "单行长字幕，无底板" },
  { id: "soft-capsule", label: "柔和胶囊", description: "单行字幕的半透明底" },
  { id: "brand-accent", label: "品牌强调", description: "单行深色胶囊加橙色短线" }
];

export const narrationStylePresets = [
  {
    id: "professional",
    label: "专业清晰",
    description: "沉稳、清晰，适合正式汇报",
    voice: "Kore",
    prompt: "Audio Profile：专业、可信、清晰的中文演讲者。Scene：在安静的会议室面向听众做汇报。Director's Notes：语速适中，断句自然，重点词稍加重，咬字清晰，保持亲和但不夸张。严格朗读原文，不增删内容。"
  },
  {
    id: "sweet-playful",
    label: "娇甜撒娇",
    description: "年轻清甜，尾音微上扬，带轻微鼻腔共鸣",
    voice: "Leda",
    prompt: "Audio Profile：年轻、清甜、亲昵又有灵气的成年中文女声。Scene：像一位熟悉的生活方式博主，近距离、放松地向观众分享。Director's Notes：整体音高略高但保持自然；句尾轻微上扬并稍停顿；加入少量鼻腔共鸣和柔和气声；语速略慢，情绪亲昵、俏皮、带一点撒娇感。咬字要清晰，避免尖锐、过度幼态、气声过重或吞字。严格朗读原文，不增删内容。"
  },
  {
    id: "soft-breathy",
    label: "轻柔轻声",
    description: "近距离、温柔，轻声与轻盈共鸣",
    voice: "Aoede",
    prompt: "用轻柔、温暖、亲切的成年中文女声朗读。语速略慢，音量稳定，句尾柔和收住，吐字清晰自然。严格朗读原文，不增删内容。"
  },
  {
    id: "bright-blogger",
    label: "明亮博主",
    description: "明亮、活泼，适合短视频口播",
    voice: "Zephyr",
    prompt: "Audio Profile：明亮、活泼、有感染力的成年中文女声博主。Scene：面对镜头录制节奏轻快的短视频口播。Director's Notes：语速中等偏快，开头带笑意，重点词音调和音量略加重，句尾有轻微上扬，停顿干净、节奏利落。保持自然，避免广告腔和过度兴奋。严格朗读原文，不增删内容。"
  }
] as const;

export type NarrationOptionsInput = z.input<typeof narrationOptionsSchema>;
export type NarrationStyleInput = z.input<typeof narrationStyleSchema>;
export type TtsPreviewInput = z.input<typeof ttsPreviewSchema>;
export type NarrationStylePresetId = (typeof narrationStylePresets)[number]["id"] | "custom";

/**
 * 演讲稿「写稿风格」预设 —— 控制主模型如何把页面内容写成口播稿。
 * 与上面的 narrationStylePresets（TTS 朗读 prompt，决定「怎么念」）完全解耦：
 * 这里决定「稿子内容怎么写」。writingPrompt 是写稿 system prompt，不是朗读指令。
 */
export const speechWritingStylePresets = [
  {
    id: "formal-report",
    label: "正式汇报",
    description: "沉稳、有逻辑、用词规范，适合商务与正式汇报",
    writingPrompt: [
      "你是一位资深的中文商务演讲撰稿人。请把给定幻灯片的内容改写成一段适合正式汇报场合的口播稿。",
      "要求：语气沉稳、专业、可信；逻辑清晰、层次分明；用词规范、克制，不口语化、不夸张；",
      "开场与结尾得体，页间过渡自然；只依据提供的标题、要点与核心信息撰写，不编造任何事实或数据；",
      "输出为连贯的口播正文，不含标题、不含页码标签、不含 Markdown、不含任何解释性文字；长度约 150–220 字。"
    ].join("")
  },
  {
    id: "clear-explainer",
    label: "清晰讲解",
    description: "循循善诱、把概念讲清楚，适合教学与培训",
    writingPrompt: [
      "你是一位擅长把复杂概念讲清楚的中文讲师。请把给定幻灯片的内容改写成一段清晰易懂的讲解式口播稿。",
      "要求：循循善诱、循序渐进；先点明这一页要讲什么，再逐条把要点解释清楚，必要时用通俗的说法帮助理解；",
      "语气亲切、耐心、有条理；只依据提供的标题、要点与核心信息撰写，不编造任何事实或数据；",
      "输出为连贯的口播正文，不含标题、不含页码标签、不含 Markdown、不含任何解释性文字；长度约 150–220 字。"
    ].join("")
  },
  {
    id: "storytelling",
    label: "故事化叙述",
    description: "有叙事线与画面感，适合演讲与路演",
    writingPrompt: [
      "你是一位善于讲故事的中文演讲撰稿人。请把给定幻灯片的内容改写成一段有叙事感、有画面感的口播稿。",
      "要求：用叙事的方式组织内容，有铺垫、有推进、有情绪节奏；适当运用具象的表达和过渡，让听众有代入感；",
      "但不得脱离原意、不得编造事实、数据或情节；保持内容准确是首要约束；",
      "输出为连贯的口播正文，不含标题、不含页码标签、不含 Markdown、不含任何解释性文字；长度约 150–220 字。"
    ].join("")
  },
  {
    id: "casual-vlog",
    label: "轻松口播",
    description: "口语化、节奏快、有网感，适合短视频与博主口播",
    writingPrompt: [
      "你是一位中文短视频口播撰稿人。请把给定幻灯片的内容改写成一段轻松、有网感的口播稿。",
      "要求：口语化、节奏明快、像和朋友聊天一样自然；句子短、有呼吸感，可适当使用口语连接词；",
      "开头能抓住注意力，重点突出；只依据提供的标题、要点与核心信息撰写，不编造任何事实或数据，不堆砌网络流行语；",
      "输出为连贯的口播正文，不含标题、不含页码标签、不含 Markdown、不含任何解释性文字；长度约 130–200 字。"
    ].join("")
  }
] as const;

export type SpeechWritingStyleId = (typeof speechWritingStylePresets)[number]["id"];

export const speechWritingStyleIds = speechWritingStylePresets.map((preset) => preset.id) as [
  SpeechWritingStyleId,
  ...SpeechWritingStyleId[]
];

export const SpeechWritingStyleIdSchema = z.enum(speechWritingStyleIds);

export const speechScriptRequestSchema = z.object({
  slideIds: slideIdScopeSchema.optional(),
  style: SpeechWritingStyleIdSchema,
  force: z.boolean().optional().default(false)
});
export type SpeechScriptRequestInput = z.input<typeof speechScriptRequestSchema>;

export const updateNarrationSchema = z.object({
  scriptText: z.string().min(1).max(4000),
  ttsText: z.string().min(1).max(4000).optional(),
  voice: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  prompt: z.string().max(500).nullable().optional(),
  languageCode: z.string().min(2).optional()
});

export const videoExportSchema = narrationOptionsSchema.extend({
  width: z.coerce.number().int().min(640).max(3840).default(1920),
  height: z.coerce.number().int().min(360).max(2160).default(1080),
  fps: z.coerce.number().int().min(15).max(60).default(30),
  subtitles: z.boolean().optional().default(false),
  subtitleFont: z.enum(["noto-sans-cjk-sc"]).optional().default("noto-sans-cjk-sc"),
  subtitleStyle: SubtitleStyleSchema.optional().default("soft-capsule"),
  subtitleLayout: subtitleLayoutSchema.optional()
});

export type FactCategory = z.infer<typeof FactCategorySchema>;
export type FactStatus = z.infer<typeof FactStatusSchema>;
export type ReportType = z.infer<typeof ReportTypeSchema>;
export type SlideStatus = z.infer<typeof SlideStatusSchema>;
export type SlideGenerationStatus = z.infer<typeof SlideGenerationStatusSchema>;
export type ProjectMode = z.infer<typeof ProjectModeSchema>;
export type BriefQuestionSource = z.infer<typeof BriefQuestionSourceSchema>;
export type RenderStrategy = z.infer<typeof RenderStrategySchema>;
export type ExportMode = z.infer<typeof ExportModeSchema>;
export type SvgPptExportMode = z.infer<typeof SvgPptExportModeSchema>;
export type EditableGrade = z.infer<typeof EditableGradeSchema>;

export const createProjectSchema = z.object({
  name: z.string().min(1, "请填写项目名称"),
  reportType: z.string().min(1).default("项目周报"),
  audience: z.string().min(1).default("待确认受众"),
  purpose: z.string().min(1).default("待确认目的"),
  pageCount: z.coerce.number().int().min(1).max(16).default(8),
  theme: z.string().default("white-blue"),
  presentationStyle: PresentationStyleIdSchema.default("consulting"),
  mode: ProjectModeSchema.default("paste"),
  topic: z.string().optional()
});

export const updateProjectSchema = createProjectSchema.partial();

export const BriefQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  placeholder: z.string().optional()
});

export const briefAnswerSchema = z.object({
  answers: z.record(z.string())
});

export const BriefJsonSchema = z.object({
  topic: z.string(),
  questions: z.array(BriefQuestionSchema).default([]),
  answers: z.record(z.string()).default({}),
  questionSource: BriefQuestionSourceSchema.optional(),
  summary: z.string().optional(),
  audience: z.string().optional(),
  purpose: z.string().optional(),
  pageCount: z.number().optional(),
  styleNotes: z.string().optional()
});

export const ResearchJsonSchema = z.object({
  summary: z.string(),
  bullets: z.array(z.string()).default([]),
  sources: z
    .array(
      z.object({
        title: z.string(),
        snippet: z.string(),
        url: z.string().optional()
      })
    )
    .default([])
});

export const SlideSearchResultSchema = z.object({
  title: z.string(),
  snippet: z.string(),
  url: z.string().optional(),
  sourceName: z.string().optional(),
  score: z.number().min(0).max(1).optional(),
  selected: z.boolean().default(true)
});

export const SlideSearchSynthesisSchema = z.object({
  /** 对本页问题的综合回答，而不是来源标题的复述 */
  summary: z.string(),
  /** 可追溯到资料卡序号（从 1 开始）的关键发现 */
  keyFindings: z
    .array(
      z.object({
        statement: z.string(),
        sourceIndexes: z.array(z.number().int().positive()).default([])
      })
    )
    .default([]),
  /** 可直接交给初稿 Agent 的连续参考文字 */
  draftReference: z.string(),
  caveats: z.array(z.string()).default([])
});

export const SlideSearchJsonSchema = z.object({
  /** web=真实联网来源；ai-knowledge=模型知识整理；mock=演示数据 */
  mode: z.enum(["web", "ai-knowledge", "mock"]).optional(),
  queries: z.array(z.string()).default([]),
  results: z.array(SlideSearchResultSchema).default([]),
  synthesis: SlideSearchSynthesisSchema.optional(),
  notes: z.string().optional()
});

export type BriefQuestion = z.infer<typeof BriefQuestionSchema>;
export type BriefJson = z.infer<typeof BriefJsonSchema>;
export type ResearchJson = z.infer<typeof ResearchJsonSchema>;
export type SlideSearchResult = z.infer<typeof SlideSearchResultSchema>;
export type SlideSearchSynthesis = z.infer<typeof SlideSearchSynthesisSchema>;
export type SlideSearchJson = z.infer<typeof SlideSearchJsonSchema>;

export interface SearchReferenceForDraft {
  summary: string;
  keyFindings: string[];
  draftReference: string;
  caveats: string[];
  selectedSourceIndexes: number[];
}

/** 将检索后的提炼结果转换为真正交给初稿 Agent 的研究参考。 */
export function searchReferenceForDraft(
  searchJson: SlideSearchJson | null | undefined
): SearchReferenceForDraft | null {
  if (!searchJson) return null;

  const selectedEntries = (searchJson.results ?? []).map((result, index) => ({
    result,
    sourceIndex: index + 1
  }));
  if (selectedEntries.length === 0) return null;

  const selectedSourceIndexes = selectedEntries.map(({ sourceIndex }) => sourceIndex);
  const synthesis = searchJson.synthesis;
  const findings = synthesis?.keyFindings ?? [];
  const fallbackLines = selectedEntries.map(
    ({ result, sourceIndex }) => `[${sourceIndex}] ${result.title}：${result.snippet}`
  );
  const findingLines = findings.map((finding) => finding.statement);

  return {
    summary: synthesis?.summary ?? findingLines[0] ?? fallbackLines[0] ?? "",
    keyFindings: findingLines.length > 0 ? findingLines : fallbackLines,
    draftReference:
      synthesis?.draftReference?.trim()
        ? synthesis.draftReference.trim()
        : (findingLines.length > 0 ? findingLines : fallbackLines).join("\n"),
    caveats: synthesis?.caveats ?? [],
    selectedSourceIndexes
  };
}

export const exportPptxSchema = z
  .object({
    theme: PptExportThemeSchema.default("white-blue"),
    /** 页级强调色预设 id；缺省时 renderer 用主题默认 primary */
    accentId: z.string().min(1).optional(),
    /** 设计阶段的质感预设；与主题包一起传给 SVG 生成 */
    surfaceId: ThemeSurfaceIdSchema.optional(),
    /** 演示风格；设计生成时约束构图、排版和配方选择 */
    presentationStyle: PresentationStyleIdSchema.optional(),
    /** @deprecated 使用 mode；draft:true 等价 mode=draft */
    draft: z.boolean().optional(),
    mode: ExportModeSchema.optional(),
    /** fidelity=整页 SVG 保真图像；editable=拆分为 PPT 原生文本和形状 */
    svgExportMode: SvgPptExportModeSchema.optional().default("editable"),
    /** 仅导出指定页（项目内顺序保留）；缺省导出全部页 */
    slideIds: z.array(z.string().min(1)).min(1).optional(),
    /**
     * 导出前是否自动补齐缺失 plan/IR/SVG。
     * 默认 false：一键导出不应悄悄跑完全部生成；需要补齐时请显式传 true。
     */
    fillMissing: z.boolean().optional().default(false)
  })
  .transform((value) => {
    const mode: ExportMode = value.mode ?? (value.draft === true ? "draft" : "standard");
    return {
      theme: value.theme,
      accentId: value.accentId,
      surfaceId: value.surfaceId,
      presentationStyle: value.presentationStyle,
      mode,
      svgExportMode: value.svgExportMode,
      draft: mode === "draft",
      slideIds: value.slideIds,
      fillMissing: value.fillMissing ?? false
    };
  });

export const sourceTextSchema = z.object({
  text: z.string().min(20, "请至少输入 20 个字符的项目资料")
});

export const MaterialRouteModeSchema = z.enum(["auto", "text", "full-context", "rag", "vision"]);
export const ProjectMaterialStatusSchema = z.enum(["uploading", "processing", "ready", "failed"]);

export const FactEvidenceSchema = z.object({
  materialId: z.string().min(1).optional(),
  sourceTextId: z.string().min(1).optional(),
  documentId: z.string().min(1).optional(),
  chunkId: z.string().min(1).optional(),
  sourceLocation: z.string().min(1),
  quote: z.string().min(1)
});

export const ContextBlockSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  evidence: FactEvidenceSchema
});

export const ContextBundleSchema = z.object({
  version: z.literal("v1"),
  projectId: z.string().min(1),
  blocks: z.array(ContextBlockSchema).min(1)
});

export const extractFactsRequestSchema = sourceTextSchema.partial().extend({
  materialIds: z.array(z.string().min(1)).max(8).optional()
});

export const createFactSchema = z.object({
  category: FactCategorySchema,
  content: z.string().min(1),
  status: FactStatusSchema.default("uncertain"),
  confidence: z.coerce.number().min(0).max(1).default(0.76),
  sourceText: z.string().default("人工补充"),
  sourceLocation: z.string().default("手动录入"),
  canUseInPpt: z.boolean().default(true)
});

export const updateFactSchema = createFactSchema.partial();

export const SlideContentBlockSchema = z.object({
  type: z.enum(["summary", "bullets", "timeline", "table", "callout"]),
  title: z.string(),
  items: z.array(z.string())
});

export const SlideDesignGuideSchema = z.object({
  /** 全页构图与视觉重心 */
  composition: z.string(),
  /** 背景层次、色块或氛围形状 */
  background: z.string(),
  /** 标题区的形状、位置与字阶 */
  title: z.string(),
  /** 核心结论的视觉承载方式 */
  keyMessage: z.string(),
  /** 正文模块逐块映射到形状与位置 */
  blocks: z
    .array(
      z.object({
        blockIndex: z.number().int().nonnegative(),
        shape: z.string(),
        placement: z.string(),
        treatment: z.string()
      })
    )
    .default([]),
  decoration: z.string().optional()
});

export const SlidePlanDtoSchema = z.object({
  title: z.string(),
  pageGoal: z.string(),
  keyMessage: z.string(),
  layoutType: z.string(),
  contentBlocks: z.array(SlideContentBlockSchema),
  sourceFactIds: z.array(z.string()),
  /** 视觉指导：建议图形类型、主视觉表达、需强调的数据点 */
  visualHint: z
    .object({
      chartType: z.string().optional(),
      heroVisual: z.string().optional(),
      emphasis: z.array(z.string()).optional()
    })
    .partial()
    .nullable()
    .optional(),
  /** 初稿阶段生成、设计阶段消费的内部形状与构图提示；不作为页面文案展示 */
  designGuide: SlideDesignGuideSchema.nullable().optional()
});

export const updateSlideSchema = z.object({
  title: z.string().min(1).optional(),
  slideGoal: z.string().optional(),
  keyMessage: z.string().optional(),
  contentPoints: z.array(z.string()).optional(),
  recommendedLayout: z.string().optional(),
  /** 章节标签；同 partTitle 在便利贴墙归为一行 */
  partTitle: z.string().nullable().optional(),
  status: SlideStatusSchema.optional(),
  isContentLocked: z.boolean().optional(),
  isLayoutLocked: z.boolean().optional(),
  /** 单页演示风格覆盖；null 表示继承项目默认 */
  presentationStyle: PresentationStyleIdSchema.nullable().optional(),
  /** 按页覆盖渲染策略（svg|theme）；手动设置后默认 strategyLocked=true */
  renderStrategy: RenderStrategySchema.optional(),
  /** 为 true 时大纲重生成（非 force）与 layout 重算不会覆盖 renderStrategy */
  strategyLocked: z.boolean().optional(),
  /** 更新检索后的参考内容 */
  searchJson: SlideSearchJsonSchema.optional(),
  /** 更新可编辑初稿；保存后会使设计稿失效 */
  planJson: SlidePlanDtoSchema.optional(),
  /** 设计阶段手工编辑后的完整 SVG 源码 */
  svgPreview: z.string().min(1).max(500_000).optional(),
  /** 手动保存 SVG 时记录当前主题环境，供版本历史展示与追溯 */
  designVersionMeta: z
    .object({
      theme: z.string().min(1).optional(),
      accentId: z.string().min(1).optional(),
      surfaceId: z.string().min(1).optional(),
      presentationStyle: PresentationStyleIdSchema.optional()
    })
    .optional()
});

export const reorderSlidesSchema = z.object({
  slideIds: z.array(z.string()).min(1)
});

export const createBlankSlideSchema = z.object({
  title: z.string().min(1).default("新增空白页"),
  keyMessage: z.string().default("请补充本页核心结论"),
  /** 归属章节；缺省时若带 afterSlideId 则继承该页 partTitle */
  partTitle: z.string().min(1).optional(),
  /** 插在该页之后；缺省则追加到项目末尾 */
  afterSlideId: z.string().min(1).optional()
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ExportPptxInput = z.infer<typeof exportPptxSchema>;
export type CreateFactInput = z.infer<typeof createFactSchema>;
export type UpdateFactInput = z.infer<typeof updateFactSchema>;
export type UpdateSlideInput = z.infer<typeof updateSlideSchema>;
export type CreateBlankSlideInput = z.infer<typeof createBlankSlideSchema>;
export type MaterialRouteMode = z.infer<typeof MaterialRouteModeSchema>;
export type ProjectMaterialStatus = z.infer<typeof ProjectMaterialStatusSchema>;
export type FactEvidence = z.infer<typeof FactEvidenceSchema>;
export type ContextBlock = z.infer<typeof ContextBlockSchema>;
export type ContextBundle = z.infer<typeof ContextBundleSchema>;
export type ExtractFactsRequest = z.infer<typeof extractFactsRequestSchema>;

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message: string;
}

export interface ApiFailure<T = unknown> {
  success: false;
  data: T | null;
  message: string;
}

export type ApiResponse<T, TError = unknown> = ApiSuccess<T> | ApiFailure<TError>;

export interface SvgQualityFailureDto {
  code: "SVG_QUALITY_VALIDATION_FAILED";
  issues: string[];
  /** 最后一轮未采用的候选稿，仅供诊断预览与源码检查。 */
  svgPreview: string;
  attemptCount: number;
}

export interface ProjectDto {
  id: string;
  name: string;
  reportType: string;
  audience: string;
  purpose: string;
  pageCount: number;
  theme: string;
  presentationStyle: PresentationStyleId;
  mode: ProjectMode;
  topic?: string | null;
  briefJson?: BriefJson | null;
  researchJson?: ResearchJson | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceTextDto {
  id: string;
  projectId: string;
  content: string;
  createdAt: string;
}

export interface FactDto {
  id: string;
  projectId: string;
  category: FactCategory;
  content: string;
  status: FactStatus;
  confidence: number;
  sourceText: string;
  sourceLocation: string;
  evidence?: FactEvidence[];
  canUseInPpt: boolean;
  createdAt: string;
}

export interface ProjectMaterialDto {
  id: string;
  projectId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  routeMode: MaterialRouteMode;
  status: ProjectMaterialStatus;
  errorMessage?: string;
  documentId?: string;
  sourceId?: string;
  jobId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** 页面 IR 设计稿（结构化可编辑中间表示）；字段随生成器演进，前端按透传处理 */
export type SlideIrDto = Record<string, unknown>;

export type SlideDesignVersionSource = z.infer<typeof slideDesignVersionSourceSchema>;

export interface SlideDesignVersionDto {
  id: string;
  slideId: string;
  svgPreview: string;
  source: SlideDesignVersionSource;
  theme: string | null;
  accentId: string | null;
  surfaceId: string | null;
  presentationStyle: PresentationStyleId | null;
  createdAt: string;
}

export interface SlideDesignHistoryDto {
  activeVersionId: string | null;
  versions: SlideDesignVersionDto[];
}

export interface SlideDto {
  id: string;
  projectId: string;
  sortOrder: number;
  title: string;
  slideGoal: string;
  keyMessage: string;
  contentPoints: string[];
  recommendedLayout: string;
  status: SlideStatus;
  isContentLocked: boolean;
  isLayoutLocked: boolean;
  /** 可空；空值表示继承项目默认风格 */
  presentationStyle?: PresentationStyleId | null;
  sourceFactIds: string[];
  planJson?: SlidePlanDto | null;
  svgPreview?: string | null;
  activeDesignVersionId?: string | null;
  /** IR 策略产物；与 svgPreview 二选一或并存 */
  irJson?: SlideIrDto | null;
  searchJson?: SlideSearchJson | null;
  partTitle?: string | null;
  generationStatus: SlideGenerationStatus;
  /** 缺省时由 inferRenderStrategy 推断 */
  renderStrategy?: RenderStrategy;
  /** 手动锁定后，大纲重生成（非 force）保留该页策略 */
  strategyLocked?: boolean;
}

export interface SlideContentBlockDto {
  type: "summary" | "bullets" | "timeline" | "table" | "callout";
  title: string;
  items: string[];
}

export interface SlidePlanDto {
  title: string;
  pageGoal: string;
  keyMessage: string;
  layoutType: string;
  contentBlocks: SlideContentBlockDto[];
  sourceFactIds: string[];
  /** 视觉指导：建议图形类型、主视觉表达、需强调的数据点 */
  visualHint?: {
    chartType?: string;
    heroVisual?: string;
    emphasis?: string[];
  } | null;
  /** 内部设计交接：规定背景、标题、核心结论和正文模块的形状/位置 */
  designGuide?: {
    composition: string;
    background: string;
    title: string;
    keyMessage: string;
    blocks: Array<{
      blockIndex: number;
      shape: string;
      placement: string;
      treatment: string;
    }>;
    decoration?: string;
  } | null;
}

/** 单页导出结果（与 ppt-renderer pageResults 对齐） */
export interface PageRenderResult {
  slideId: string;
  strategy: RenderStrategy;
  /** svg-image=整页保真 SVG；svg=拆分为原生文本/形状；theme=降级为纯文本+版式 */
  path: "svg-image" | "svg" | "theme";
  warning?: string;
  /** 导出后标注；可由 inferEditableGrade 填充 */
  editableGrade?: EditableGrade;
}

/** AI 粗用量（进程内内存计数，非账单） */
export interface AiUsageCounts {
  extractFacts: number;
  outline: number;
  plan: number;
  svg: number;
}

export interface AiExportUsageSummary {
  projectId: string;
  mode: ExportMode;
  pageCount: number;
  gradeCounts: Record<EditableGrade, number>;
  warningCount: number;
  at: string;
}

export interface AiUsageDto {
  counts: AiUsageCounts;
  lastExportSummary: AiExportUsageSummary | null;
  /** 真实 Token 用量（来自 API 响应 usage 字段） */
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** 有 usage 数据的 API 调用次数 */
    callCount: number;
  };
}

export interface ExportDto {
  id: string;
  projectId: string;
  versionName: string;
  pptxPath: string;
  downloadUrl: string;
  createdAt: string;
  mode?: ExportMode;
  warnings?: string[];
  pageResults?: PageRenderResult[];
}

export interface SlideNarrationDto {
  id: string;
  slideId: string;
  scriptText: string;
  ttsText: string;
  voice: string;
  model: string;
  prompt?: string | null;
  languageCode: string;
  audioPath?: string | null;
  audioUrl?: string | null;
  audioDurationMs?: number | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface MediaExportDto {
  id: string;
  projectId: string;
  kind: "video";
  status: string;
  progress: number;
  subtitles?: boolean;
  subtitleFont?: string | null;
  subtitleStyle?: SubtitleStyleId | null;
  subtitleLayout?: SubtitleLayout | null;
  previewUrl?: string | null;
  downloadUrl?: string | null;
  subtitleUrl?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetailDto {
  project: ProjectDto;
  latestSourceText: SourceTextDto | null;
  facts: FactDto[];
  slides: SlideDto[];
  exports: ExportDto[];
  materials: ProjectMaterialDto[];
}

export interface ExtractedFactDraft {
  category: FactCategory;
  content: string;
  status: FactStatus;
  confidence: number;
  sourceText: string;
  sourceLocation: string;
  evidence?: FactEvidence[];
  canUseInPpt: boolean;
}

export interface ExtractFactsResult {
  facts: ExtractedFactDraft[];
  risks: ExtractedFactDraft[];
  uncertainties: ExtractedFactDraft[];
  nextSteps: ExtractedFactDraft[];
}

export interface OutlineSlideDraft {
  title: string;
  slideGoal: string;
  keyMessage: string;
  contentPoints: string[];
  sourceFactIds: string[];
  recommendedLayout: string;
  partTitle?: string;
}

/** 供启发式推断的最小 Slide 形状（避免强绑完整 DTO） */
export type InferRenderStrategyInput = {
  title?: string | null;
  recommendedLayout?: string | null;
  planJson?: { layoutType?: string | null } | null;
  /** 若已显式设置则优先采用 */
  renderStrategy?: RenderStrategy | null;
};

/**
 * 按页启发式选择渲染策略。
 * - 显式 renderStrategy 优先（用于用户手动锁定）
 * - 产品默认统一走 SVG，不再按版式自动降级 IR
 */
export function inferRenderStrategy(slide: InferRenderStrategyInput): RenderStrategy {
  if (slide.renderStrategy && (renderStrategies as readonly string[]).includes(slide.renderStrategy)) {
    return slide.renderStrategy;
  }

  return "svg";
}

/**
 * 导出/设计生成时的生效策略：
 * - draft → 强制 theme (跳过 svg)
 * - visual → 强制 svg
 * - standard → 尊重显式/推断策略
 */
export function effectiveRenderStrategy(
  slide: InferRenderStrategyInput,
  mode: ExportMode = "standard"
): RenderStrategy {
  if (mode === "draft") {
    return "theme";
  }
  const base = inferRenderStrategy(slide);
  if (mode === "visual") {
    return "svg";
  }
  return base;
}

/** 当前 mode 下是否应调用设计模型生成 SVG */
export function shouldGenerateSvgForMode(
  slide: InferRenderStrategyInput,
  mode: ExportMode = "standard"
): boolean {
  const strategy = effectiveRenderStrategy(slide, mode);
  return strategy === "svg";
}

export type InferEditableGradeInput = {
  strategy: RenderStrategy;
  path: "svg-image" | "svg" | "theme";
  warning?: string | null;
};

/**
 * 按页可编辑等级：
 * - A：SVG 编译成功且无警告（全文可改）
 * - B：SVG 带警告，或 svg 策略降级到 theme（主体可改）
 * - C：整页保真 SVG 图像，或主题模板 / 装饰降级
 */
export function inferEditableGrade(input: InferEditableGradeInput): EditableGrade {
  if (input.path === "svg-image") {
    return "C";
  }
  if (input.path === "svg" && !input.warning) {
    return "A";
  }
  if (input.path === "svg" && input.warning) {
    return "B";
  }
  if (input.path === "theme" && input.strategy === "svg") {
    return "B";
  }
  return "C";
}

/** 为 pageResults 批量填充 editableGrade */
export function withEditableGrades(results: PageRenderResult[]): PageRenderResult[] {
  return results.map((result) => ({
    ...result,
    editableGrade: result.editableGrade ?? inferEditableGrade(result)
  }));
}

const BANNED_SVG_CHECKS: Array<{ name: string; pattern: RegExp }> = [
  { name: "style", pattern: /<style[\s>]/i },
  { name: "class", pattern: /\sclass\s*=/i },
  { name: "mask", pattern: /<mask[\s>]|\smask\s*=/i },
  { name: "foreignObject", pattern: /<foreignObject[\s>]/i },
  { name: "symbol", pattern: /<symbol[\s>]/i },
  { name: "textPath", pattern: /<textPath[\s>]/i },
  { name: "@font-face", pattern: /@font-face\b/i },
  { name: "animate", pattern: /<(?:animate|animateTransform|animateMotion|set)[\s>]/i },
  { name: "script", pattern: /<script[\s>]/i },
  { name: "iframe", pattern: /<iframe[\s>]/i }
];

/** 可编译 SVG 硬门禁：返回命中的禁止特性名（空数组表示通过） */
export function getBannedSvgFeatures(svg: string): string[] {
  if (!svg || !svg.trim()) {
    return [];
  }
  const found: string[] = [];
  for (const check of BANNED_SVG_CHECKS) {
    if (check.pattern.test(svg)) {
      found.push(check.name);
    }
  }
  return found;
}

export const demoSourceText = `会议纪要：洲明智慧展厅升级项目周会
项目名称：智慧展厅二期升级
汇报对象：客户信息化负责人、销售总监、项目管理办公室

本周进展：
1. 展厅主屏控制系统已完成联调，播放稳定性测试通过 72 小时连续运行。
2. 三个重点展示场景已完成内容脚本初稿，客户对“能源调度”和“城市运营”两个场景表示认可。
3. 现场施工完成率约 68%，弱电桥架和主屏结构安装已完成。
4. 项目团队已提交第一版上线排期，预计下周完成客户评审。

客户需求：
客户希望汇报材料重点说明交付风险、下周资源需求、以及是否会影响 8 月 15 日试运行节点。
客户强调 PPT 不需要营销化表达，需要清楚说明事实、进度、风险和需要他们确认的事项。

风险与待确认：
1. 第三方内容供应商的视频素材交付延迟 3 天，可能影响最终联调窗口。
2. 客户现场网络策略尚未确认，远程运维端口是否开放需要信息化部门答复。
3. LED 备件清单还需要采购确认库存，预计本周五前反馈。

下一步计划：
1. 下周一完成上线排期评审。
2. 下周三完成第三方素材替换与主屏复测。
3. 本周五前推动客户确认网络策略和备件库存。
4. 项目经理需要客户安排信息化负责人参加风险闭环会议。`;

export { detectSvgTheme, recolorSvgPreview } from "./themeRecolor.js";
export type { RecolorTheme, ThemeColorRole, RecolorOptions } from "./themeRecolor.js";
export {
  GoalSpecSchema,
  GoalSlideSchema,
  projectToGoalSpec,
  goalSpecToDashiGoal,
  parseGoalSpec
} from "./goalSpec.js";
export type { GoalSpec, GoalSlide } from "./goalSpec.js";
export {
  validateGoalSpec
} from "./validateGoalSpec.js";
export type { ValidationIssue, ValidationResult } from "./validateGoalSpec.js";
export {
  validateCopyQuality
} from "./validateCopyQuality.js";
export type { CopyIssue, CopyValidationResult } from "./validateCopyQuality.js";
export { fitSvgTextToBounds, getSvgTextBoxIssues } from "./svgTextFit.js";
export type { SvgTextFitResult } from "./svgTextFit.js";
