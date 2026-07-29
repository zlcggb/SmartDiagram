import type {
  FactDto,
  PresentationStyleId,
  ProjectDto,
  PptExportTheme,
  SlideDto,
  SpeechWritingStyleId,
  ThemeSurfaceId
} from "@ppt-agent/shared";
import {
  blueprintForLayout,
  formatCopyBudgetCatalog,
  formatLayoutBlueprintCatalog,
  formatLayoutVariantCatalog,
  formatThemePackCatalog,
  formatSkeletonGeometryInstruction,
  formatVariantCompositionInstruction,
  getAccentPresetHex,
  getPresentationStylePreset,
  getSkeletonFrame,
  getThemePack,
  getThemeSurfacePreset,
  normalizeAccentPresetId,
  normalizePresentationStyleId,
  normalizePptExportTheme,
  pickDefaultVariant,
  queryLayouts,
  recommendedLayoutEnumValues,
  searchReferenceForDraft,
  speechWritingStylePresets,
  themeFamily
} from "@ppt-agent/shared";
import {
  buildDesignRecipeInstruction,
  buildKimiDesignKnowledgeInstruction,
  designRecipeMeta
} from "./designKnowledge/index.js";
import { normalizeSlideDesignGuide, selectedSearchMaterials } from "./studioHelpers.js";

export const extractFactsSystemPrompt = [
  "你是严谨的企业 PPT 资料分析师。",
  "只输出符合 JSON Schema 的中文 JSON，不要输出解释文字。",
  "必须保留事实原文依据，区分项目进展、风险、待确认事项和下一步计划。",
  "当资料包含【证据块 <ID>｜<位置>】时，每条事实的 sourceLocation 必须原样填写对应证据块 ID。",
  "不要编造资料里没有的公司、时间、数字、结论。"
].join("\n");

export const outlineSystemPrompt = [
  "# Role: 顶级的 PPT 结构架构师（Outline Architect）",
  "",
  "## Profile",
  "- 版本：3.1 (Role-Template + CopyBudget)",
  "- 专业：PPT 逻辑结构设计",
  "- 特长：运用金字塔原理 + 页面角色模版，构建清晰的演示逻辑",
  "",
  "## Goals",
  "基于用户提供的 PPT 主题、受众、汇报目的、页数要求和已确认事实，设计一份逻辑严密、层次清晰的 PPT 大纲。",
  "",
  "## Core Methodology: 金字塔原理",
  "1. 结论先行：每个部分以核心观点开篇。",
  "2. 以上统下：上层观点是下层内容的总结。",
  "3. 归类分组：同一层级内容属于同一逻辑范畴。",
  "4. 逻辑递进：内容按照时间、问题-方案、重要性或因果关系展开。",
  "",
  "## 版式角色硬规则（锁模版填文案）",
  "- recommendedLayout 必须从角色模版枚举中选择，禁止自由发明版式名。",
  "- 首页优先 cover；需要目录时用 toc；收尾用 action-list 或 closing。",
  "- 同一叙事弧内角色应有变化，避免连续多页都是 generic-cards。",
  "- 长稿可穿插 statement（金句）或 transition（章节分隔），勿整套同构。",
  "- 对照「精选版式变体」选剪影不同的角色：禁止整套 PPT 全是横幅+三等分卡。",
  "- 遵守文案预算：标题/结论/要点不要写成长段落。",
  "",
  "## 重要：利用调研信息",
  "你将获得关于主题的事实摘要。请务必参考这些信息来规划大纲，使其切合当前资料事实，不要凭空捏造。",
  "",
  "## 输出规范",
  "工程运行时只输出符合 JSON Schema 的中文 JSON，不要输出 [PPT_OUTLINE] 包裹符。"
].join("\n");

export const slidePlanSystemPrompt = [
  "你是专业 PPT 单页文案编辑（Draft Writer / 初稿阶段）。",
  "递进职责：便利贴只提供页意图；检索阶段的资料提炼稿提供知识与论据；你必须综合二者写出真正的初稿文案，而不是复述标题/要点原文。",
  "用户可见且会传给设计稿的文案契约只有三类：title（页面标题）、keyMessage（一句话核心结论）、contentBlocks（正文模块）。",
  "pageGoal、layoutType、sourceFactIds、visualHint、designGuide 是系统内部元数据，不是额外页面文案。",
  "策划稿必须清爽克制：只做信息架构与版式规划，不要花哨装饰、不要营销海报语言。",
  "默认「锁模版填文案」：layoutType 必须等于或映射自 recommendedLayout；contentBlocks 按该角色的区块骨架填空（类 props），不要改角色骨架去硬凑。",
  "每页只允许有一个主结论，其他信息必须服务这个主结论。",
  "不要把所有信息平铺成清单；要建立主次、归类和递进关系。",
  "不要重复同一条事实；同一观点只表达一次。",
  "keyMessage 已经承担全页总结，contentBlocks 禁止再输出 summary 类型或重复核心结论；正文只提供支撑结论的证据、分类、步骤、对比或行动。",
  "正文应简洁并适合放入 PPT 卡片，但必须保持句子和语义完整。",
  "每个内容块最多 3 条 items；每条 item 单字段建议不超过 300 字，禁止用截断和省略号规避完整表达。",
  "若提供了“初稿参考文字”：以它作为主要内容输入；资料卡只用于核对来源和证据边界。",
  "不得把待核验内容写成确定事实。",
  "若无初稿参考文字：才可依据检索参考资料、页意图与事实库，并在文案中保持克制。",
  "同时在 visualHint 字段给出本页视觉指导：chartType 建议图形类型（bar/line/pie/process/timeline/table/metric/none）、heroVisual 主视觉表达、emphasis 需视觉强调的数据点或关键词。无合适图形时 chartType 用 none。",
  "必须同时生成 designGuide，明确 composition、background、title、keyMessage，并为每个 contentBlock 按相同 blockIndex 给出 shape、placement、treatment。",
  "designGuide 必须可执行：说清形状、相对位置、层级和内容处理；禁止只写‘简洁’‘高级’‘科技感’这类空泛形容词。",
  "设计交接默认必须包含背景层、标题区、独立核心结论形状和有主次的正文模块；禁止把文字直接平铺到空白画布。",
  "只输出符合 JSON Schema 的中文 JSON。"
].join("\n");

export const briefSystemPrompt = [
  "你是资深 PPT 顾问，擅长需求调研。",
  "根据用户主题，提出 3-5 个关键澄清问题，帮助确认受众、目的、页数、风格禁忌。",
  "只输出符合 JSON Schema 的中文 JSON，不要解释。"
].join("\n");

export const researchSystemPrompt = [
  "你是行业研究员。",
  "根据 PPT 主题与需求摘要，输出背景调研摘要与要点列表。",
  "当前模型通道没有联网工具：只可基于通用知识整理，必须标注为待核验，不要捏造精确财报数字或网页 URL。",
  "只输出符合 JSON Schema 的中文 JSON。"
].join("\n");

export const pageSearchSystemPrompt = [
  "你是单页研究与资料提炼助手。",
  "当前模型通道没有联网搜索工具：不得声称已经访问网页，不得生成、猜测或冒充真实 URL。",
  "先生成 3-5 条可执行的检索 query，再基于通用知识整理待核验线索；mode 固定为 ai-knowledge。",
  "结果不能停留在资料卡罗列：必须输出 synthesis，包括综合回答 summary、带资料卡序号的 keyFindings、可直接进入初稿的连续文字 draftReference、以及 caveats。",
  "draftReference 要回答本页核心问题，形成有主次、有因果或分类关系的 150-350 字参考文字，不要复述页面标题。",
  "资料卡和关键发现必须服务本页结论；无法确认的事实要明确标为待核验。",
  "只输出符合 JSON Schema 的中文 JSON。"
].join("\n");

export function buildBriefStartPrompt(topic: string) {
  return [
    "请为以下 PPT 主题生成需求澄清问题。",
    `主题：${topic}`,
    "问题要具体、可回答，覆盖：受众、使用场景、页数、必须讲清的点、禁忌。"
  ].join("\n");
}

export function buildBriefFinalizePrompt(topic: string, answers: Record<string, string>) {
  return [
    "请根据主题与用户回答，整理需求摘要，并推断 audience、purpose、建议页数、风格备注。",
    `主题：${topic}`,
    "用户回答 JSON：",
    JSON.stringify(answers, null, 2)
  ].join("\n");
}

export function buildResearchPrompt(topic: string, briefSummary: string) {
  return [
    "请输出主题背景调研摘要。",
    `主题：${topic}`,
    `需求摘要：${briefSummary || "（未提供）"}`
  ].join("\n");
}

export function buildPageSearchPrompt(slide: SlideDto, context: { topic?: string; researchSummary?: string }) {
  return [
    "请为本页生成检索方向、知识线索和一份可直接供初稿 Agent 使用的资料提炼稿。",
    "输出重点是 synthesis.draftReference；results 只是支撑线索，不要只列卡片。",
    `项目主题：${context.topic ?? ""}`,
    `背景调研：${context.researchSummary ?? ""}`,
    "页面信息：",
    JSON.stringify(
      {
        title: slide.title,
        slideGoal: slide.slideGoal,
        keyMessage: slide.keyMessage,
        contentPoints: slide.contentPoints,
        partTitle: slide.partTitle
      },
      null,
      2
    )
  ].join("\n\n");
}

export interface SpeechScriptContext {
  index: number;
  total: number;
  prevTitle?: string;
  nextTitle?: string;
  style: SpeechWritingStyleId;
}

/** 写稿风格对应的 system prompt（决定「稿子怎么写」，与 TTS 朗读 prompt 解耦）。 */
export function speechScriptSystemPrompt(style: SpeechWritingStyleId): string {
  const preset = speechWritingStylePresets.find((item) => item.id === style) ?? speechWritingStylePresets[0];
  return preset.writingPrompt;
}

export function buildSpeechScriptPrompt(slide: SlideDto, context: SpeechScriptContext) {
  const isFirst = context.index === 0;
  const isLast = context.index === context.total - 1;
  const positionHint = isFirst
    ? "这是整场的第 1 页，请写一个自然的开场。"
    : isLast
      ? "这是整场的最后一页，请写一个自然的收尾。"
      : `这是第 ${context.index + 1} 页（共 ${context.total} 页），承上启下即可。`;
  const transitionHint = context.nextTitle && !isLast ? `下一页将讲「${context.nextTitle}」，结尾可自然过渡。` : "";
  return [
    "请把下面这页幻灯片改写成一段口播稿。",
    positionHint,
    transitionHint,
    "页面信息：",
    JSON.stringify(
      {
        title: slide.planJson?.title || slide.title,
        keyMessage: slide.planJson?.keyMessage || slide.keyMessage,
        contentPoints: slide.planJson?.contentBlocks?.flatMap((block) => block.items) || slide.contentPoints,
        slideGoal: slide.slideGoal
      },
      null,
      2
    )
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildOutlinePrompt(
  project: Pick<ProjectDto, "name" | "audience" | "purpose" | "pageCount" | "theme">,
  confirmedFacts: FactDto[]
) {
  const layouts = recommendedLayoutEnumValues().join(" / ");
  const theme = normalizePptExportTheme(project.theme);
  const family = themeFamily(theme);
  const coverCandidates = queryLayouts({ role: "cover", themeFamily: family, limit: 3, seed: `${project.name}-cover` })
    .map((v) => v.id)
    .join(" / ");
  const bodyHint = queryLayouts({ themeFamily: family, limit: 8, seed: `${project.name}-body` })
    .filter((v) => v.role !== "cover")
    .slice(0, 6)
    .map((v) => `${v.recommendedLayout}←${v.id}`)
    .join("；");
  return [
    "你是 PPT 结构架构师（Outline Architect）。先想清叙事弧线，再落成可拖拽的数字便利贴大纲。",
    "输出目标：封面 → 若干章节（同 partTitle 归组）→ 内容页 → 收尾/行动页。",
    "运用金字塔原理：结论先行、以上统下、归类分组、逻辑递进；每页只打一个关键信息点。",
    "必须参考已确认事实/调研，不要编造数字或未给出的结论。",
    "每个页面给出 title、slideGoal、keyMessage、contentPoints、recommendedLayout、partTitle。",
    "partTitle：章节标签（如「背景」「进展」「风险」）；封面/目录可用「开场」，收尾用「收束」。",
    `recommendedLayout 必须从以下枚举选择（禁止自造）：${layouts}。`,
    "选版规则（类 layout:query）：首页只能用 cover；正文角色在叙事弧内轮换；同 deck 避免连续多页同一 recommendedLayout。",
    `当前主题族 ${family}（${theme}）封面候选变体：${coverCandidates || "cover-hero-left"}。`,
    `正文剪影参考（任选匹配角色，勿整套复用同一剪影）：${bodyHint}。`,
    "角色模版目录（选 layout 时对照）：",
    formatLayoutBlueprintCatalog(),
    "精选版式变体（每角色剪影，优先拉开页间差异）：",
    formatLayoutVariantCatalog(2),
    "ThemePack 场景参考（项目主题已选定，勿改 theme；仅帮助匹配语气）：",
    formatThemePackCatalog(),
    "文案预算（必须遵守）：",
    formatCopyBudgetCatalog(),
    `项目：${project.name}`,
    `受众：${project.audience}`,
    `目的：${project.purpose}`,
    `页数：${project.pageCount}`,
    `主题：${theme}`,
    "已确认事实 JSON：",
    JSON.stringify(
      confirmedFacts.map((fact) => ({
        id: fact.id,
        category: fact.category,
        content: fact.content,
        status: fact.status
      })),
      null,
      2
    )
  ].join("\n\n");
}


export const svgPreviewSystemPrompt = [
  "你是精通信息架构、演示叙事与 SVG 编码的高级企业演示设计专家。",
  "你的任务是将完整的单页策划稿转化为一张高质量、结构化、具备高级感、简洁感和专业感的 SVG 演示文稿页面。",
  "",
  "## 画布",
  "SVG viewBox 必须是 0 0 1280 720。",
  "- 背景可以铺满 1280×720；所有业务文字、卡片、图表和连接端点必须放在 x=32..1248、y=24..696 的内容安全区内。",
  "- 卡片与画布右边至少保留 32px；正文与卡片右边至少保留 20px，stroke 也不能越过画布。",
  "",
  "## 视觉基调",
  "- 严格服从本页 STYLE_CONTRACT；风格决定构图、字阶、密度与叙事语言，主题只决定色板。",
  "- 所有风格都必须克制、清晰、专业；强调依靠字阶、留白、细分隔线和单一页级强调色，不做营销海报或拟物界面。",
  "- 四级层次：标题/核心结论为 primary，正文为 secondary，注释为 tertiary，边框与分隔为 quaternary；除风险/成功语义色外，每页只使用一个 keyColor。",
  "- 严格遵循当前 ThemePack 色值（主色/辅色/背景/卡片/成功/风险/系列色），不要另起一套色盘。",
  "- 图表或多系列色块只用 ThemePack.series 枚举色，禁止无限自由取色。",
  "- 不要生成后台管理系统 UI、网页仪表盘、按钮式控件或浏览器界面。",
  "- 禁止整高侧边色条、泛用胶囊标签、无意义光晕、巨型透明圆和为了设计感制造的错位叠片。",
  "",
  "## 版式角色 + 视觉配方",
  "- recommendedLayout / layoutType 只规定页面角色（封面/指标/对比/流程/风险/行动等），不锁死 SVG 几何。",
  "- 必须执行本页注入的具体视觉配方：坐标区、形状组装程序、必要图元和语义分组优先于通用角色剪影。",
  "- 使用形状、连接关系、面积与字阶共同建立层级；最重要的信息必须形成可识别的视觉锚点。",
  "- 不同页面要选择不同构图母题，禁止整套 PPT 都是标题横幅加等宽卡片。",
  "- 独立业务区不得相交；主视觉必须拥有独立槽位。只有背景、连接线和视觉配方 allowedOverlaps 明确声明的关系可以穿插。",
  "- SVG 没有业务 z-index；必须按视觉配方 layer 从低到高输出语义 <g>，让 DOM 绘制顺序与层级一致。",
  "",
  "## 字体与文本框硬规则",
  "- font-family 统一使用 Microsoft YaHei, PingFang SC, Noto Sans CJK SC, Arial, sans-serif。",
  "- 中文标题建议 38-56px，普通卡片标题 24-32px，正文 18-23px，辅助说明 14-18px。",
  "- font-weight 保持克制：正文 400/500，卡片标题 600/700，大标题 600/700；不要整页都 800/900 粗体。",
  "- 每一个 <text> 都必须带 data-w 和 data-h。",
  "- data-w/data-h 必须贴合该段文字的真实区域，不能把一个文字框拉满半页或覆盖多个卡片。",
  "- 单行标题 data-h 通常为 font-size 的 1.3-1.7 倍；正文多行 data-h 按行数计算，不要超过所在卡片高度。",
  "- 徽章/胶囊标签：data-h 取整颗徽章高度（含上下 padding），font-size 约为 data-h 的 0.4-0.55，text-anchor=middle，填色与徽章对比清晰。",
  "- 多行中文正文：data-w 略宽于实际字宽（预留 8-12%），优先用多个 <tspan> 显式换行，避免依赖导出侧自动折行。",
  "- 注意：SVG 浏览器不会按 data-w 自动换行。只要正文可能超过 data-w，必须在生成的 SVG 中主动拆成 <tspan x=\"原 x\" dy=\"行高\"> 换行。",
  "- 若一个 text 内含“加粗标签 tspan + 正文 tspan”，两段合计超过 data-w 时，正文 tspan 必须设置 x=\"原 x\" 和 dy=\"行高\" 开启新行，禁止无 x/dy 地接在同一行。",
  "- data-w 必须小于等于所在卡片的内容宽度；文字最后一行的右边界必须至少距卡片右边 20px。",
  "- 标题、正文、指标请拆成多个独立 <text>，不要把一整张卡片的全部文字塞进一个巨大文本框。",
  "- 禁止输出只有“•”“·”“-”“。”的孤立文本；bullet 必须写成完整短句，例如“• 完成联调测试”。",
  "- 文字不能越过卡片边界，不能覆盖其他元素；独立文字框之间保留至少 8px，不确定时减少文字、增加留白。",
  "",
  "## 可编译 SVG 硬规则（导出门禁）",
  "- SVG 会被拆成 PowerPoint 原生文本框、形状和线条；业务正文以策划/IR 为准，勿虚构数字与日期。",
  "- 允许：rect / text / tspan / line / circle / ellipse / path / polygon / polyline / g；卡片背景用 rect。",
  "- 每一个 <text> 必须带贴合文字区域的 data-w 与 data-h；标题与正文拆成多个独立 text。",
  "- 颜色只用 HEX + fill-opacity/stroke-opacity；禁止 rgba()、禁止 <g opacity>。",
  "- transform 只用 translate(x,y)；禁止 matrix/scale/rotate/skew（导出编译会错位或降级 IR）。",
  "- font-family 栈必须以 Microsoft YaHei 开头（其后可跟 PingFang SC / Arial）；不要把 Inter/Roboto/Noto 放在首位。",
  "- 禁止：style 标签、class=、mask、foreignObject、symbol、textPath、@font-face、animate/set、script、iframe。",
  "- 正文必须用 text/tspan，不要画进 path/image/滤镜；可用 rx/ry，勿依赖复杂 filter 表达主信息。",
  "",
  "## 内容质量约束",
  "- 页面文案只能使用输入中的 designCopy（title / keyMessage / contentBlocks）；不得补写未在初稿中出现的新正文。",
  "- 每页只允许一个主结论，其他卡片都要服务这个主结论。",
  "- 卡片内容不能重复，同一事实只表达一次。",
  "- 禁止把页数、版本号、序号、普通日期等弱信息当核心指标或主视觉，除非它就是业务事实中的核心结论。",
  "- 没有合适数字时，用关键词或结论短语作为主视觉。",
  "- 正文短句化，不要把长段落塞进卡片；遵守文案预算。",
  "- 不要出现省略号、截断符或明显装不下的长句。",
  "- 不要虚构日期、公司、作者、编号、倒计时或不存在的数据。",
  "",
  "## 文案门禁（渲染后自动校验）",
  "- 禁止出现模板占位文案：请输入文本/示例文本/placeholder/lorem ipsum/待填写。",
  "- 禁止出现与用户主题无关的默认文案：AI Capital/SoundWave/Key Metrics/Roadmap/End of Report。",
  "- 禁止输出只有bullet符号的孤立文本；bullet 必须写成完整短句。",
  "",
  "只输出完整 SVG 代码，不要输出解释文字。"
].join("\n");

function themeInstruction(theme: PptExportTheme = "white-blue", accentId?: string | null) {
  const pack = getThemePack(normalizePptExportTheme(theme));
  const t = pack.tokens;
  const resolvedAccentId = normalizeAccentPresetId(pack.id, accentId);
  const resolvedAccent = getAccentPresetHex(pack.id, resolvedAccentId);
  const contract = {
    themeId: pack.id,
    themeLabel: pack.label,
    canvasMode: pack.family,
    colors: {
      canvas: t.bg,
      canvasSoft: t.bgSoft,
      card: t.card,
      title: t.title,
      body: t.body,
      muted: t.muted,
      primary: resolvedAccent,
      accent: t.accent,
      accentAlt: t.accentAlt,
      border: t.border,
      onAccent: t.onAccent
    },
    series: t.series
  };
  return [
    `当前 ThemePack：${pack.id}（${pack.label}）。`,
    `场景：${pack.description}；适合：${pack.suitableFor}；族：${pack.family}。`,
    `设计 token（必须使用）：背景 ${t.bg} / ${t.bgSoft}，卡片 ${t.card}，标题 ${t.title}，正文 ${t.body}，弱化 ${t.muted}，主色 ${t.primary}，辅色 ${t.accent} / ${t.accentAlt}，边框 ${t.border}，成功 ${t.success}，风险 ${t.risk}，警告 ${t.warning}。`,
    `系列色（图表/多卡强调，按序取用）：${t.series.join(" / ")}。`,
    `页级 accent 预设（当前必须使用 ${resolvedAccentId}=${resolvedAccent}）：${pack.accentPresets
      .map((a) => `${a.id}=${a.hex}`)
      .join("，")}。`,
    "THEME_CONTRACT（硬约束；与初稿内容同等传入，禁止自行换主题）：",
    JSON.stringify(contract, null, 2),
    pack.family === "light"
      ? `浅色主题禁止深蓝、深灰、黑色大面积铺底。全画布背景只能使用 ${t.bg} 或 ${t.bgSoft}；${t.title} 仅用于文字和小型线条。`
      : `深色主题禁止白色、浅灰大面积铺底。全画布背景只能使用 ${t.bg} 或 ${t.bgSoft}；${t.card} 用于内容承载。`,
    "所有大面积形状必须从 THEME_CONTRACT.colors 取色；不得复用其他主题的背景、卡片或强调色。",
    "封面优先：大标题区 + 核心关键词/数字块 + 底部 2-3 个小卡片。",
    "行动/风险页不要做成传统 Excel 表，优先时间线卡、责任卡、重点提示卡。",
    "避免：灰色空框、密集小字、后台管理系统 UI、所有页面同一个模板。"
  ].join("\n");
}

function layoutBlueprintInstruction(
  slide: SlideDto,
  theme: PptExportTheme = "white-blue",
  options: { lockGeometry?: boolean } = {}
) {
  const lockGeometry = options.lockGeometry !== false;
  const layout = slide.planJson?.layoutType || slide.recommendedLayout;
  const bp = blueprintForLayout(layout);
  const family = themeFamily(normalizePptExportTheme(theme));
  const variant = pickDefaultVariant(layout, family, [], `${slide.id ?? slide.title}-${layout}`);
  const frame = getSkeletonFrame(variant.id);
  const comp = bp.composition;
  return [
    `本页角色模版：${bp.recommendedLayout}（${bp.label} / role=${bp.role}）。`,
    `结构意图：${bp.description}`,
    `构图规范：剪影=${comp.silhouette}；主视觉=${comp.heroIntent}；字阶档=${comp.typeScale}；间距≥${comp.minGutter}。`,
    `区块骨架：${bp.blocks.map((b) => `${b.type}@${b.ratio}「${b.propHint}」`).join("；")}`,
    formatVariantCompositionInstruction(variant),
    lockGeometry && frame ? formatSkeletonGeometryInstruction(frame) : "",
    lockGeometry
      ? "请按上述骨架与变体剪影填文案与排版，不要偏离角色；有坐标骨架时禁止改几何。"
      : "SVG 只继承上述页面角色与信息意图，不继承通用坐标骨架；实际几何必须服从后续‘本页视觉配方’，禁止退回默认卡片墙。"
  ]
    .filter(Boolean)
    .join("\n");
}

function surfaceInstruction(surfaceId?: ThemeSurfaceId | string | null) {
  const preset = getThemeSurfacePreset(surfaceId);
  if (!preset.regenerateHint) return "";
  return `质感预设「${preset.label}」构图提示：${preset.regenerateHint}。`;
}

function presentationStyleInstruction(
  presentationStyle?: PresentationStyleId | string | null
) {
  const style = getPresentationStylePreset(
    normalizePresentationStyleId(presentationStyle)
  );
  return [
    "# STYLE_CONTRACT（演示风格，决定布局与排版）",
    `styleId: ${style.id}`,
    `名称: ${style.label}`,
    `适用场景: ${style.useCases.join(" / ")}`,
    `构图: ${style.composition}`,
    `排版: ${style.typography}`,
    `信息密度: ${style.density}`,
    `视觉指导: ${style.promptHint}`,
    `偏好配方: ${style.preferredRecipeIds.join(" / ")}`,
    `禁止模式: ${style.forbiddenPatterns.join(" / ")}`,
    "主题色不得替代风格职责；不要因为换色而改变上述构图逻辑。"
  ].join("\n");
}

function visualHintInstruction(slide: SlideDto) {
  const hint = slide.planJson?.visualHint;
  if (!hint) return "";

  const lines: string[] = [];
  if (hint.chartType && hint.chartType !== "none") {
    const chartLabels: Record<string, string> = {
      bar: "柱状/条形图",
      line: "折线图",
      pie: "饼图",
      process: "流程图",
      timeline: "时间线",
      table: "表格",
      metric: "关键指标卡"
    };
    lines.push(`建议图形：${chartLabels[hint.chartType] ?? hint.chartType}`);
  }
  if (hint.heroVisual) {
    lines.push(`主视觉表达：${hint.heroVisual}`);
  }
  if (hint.emphasis?.length) {
    lines.push(`需视觉强调：${hint.emphasis.join("、")}`);
  }

  if (lines.length === 0) return "";
  return `初稿视觉指导：${lines.join("；")}。`;
}

function designGuideInstruction(slide: SlideDto) {
  const guide = designHandoff(slide).designMeta.designGuide;
  return [
    "初稿形状与构图指令（必须执行，不得降级成纯文字排版）：",
    `全页：${guide.composition}`,
    `背景：${guide.background}`,
    `标题：${guide.title}`,
    `核心结论：${guide.keyMessage}`,
    ...guide.blocks.map(
      (block) =>
        `正文模块 ${block.blockIndex + 1}：形状=${block.shape}；位置=${block.placement}；处理=${block.treatment}`
    ),
    guide.decoration ? `装饰：${guide.decoration}` : "",
    "IR 若锁定几何骨架，必须在既有几何内通过 element type、style、色块、连接线和字阶落实这些指令；不得以‘骨架已锁定’为由忽略。"
  ]
    .filter(Boolean)
    .join("\n");
}

/** 设计阶段唯一可用的文案契约；内部策划字段不再混入设计输入。 */
function designHandoff(slide: SlideDto) {
  const plan = slide.planJson;
  const contentBlocks = (plan?.contentBlocks ?? [])
    .filter((block) => block.type !== "summary" && block.items.length > 0)
    .map((block) => ({
      type: block.type,
      title: block.title,
      items: block.items
    }));
  const fallbackBlocks = [
    {
      type: "bullets" as const,
      title: "正文内容",
      items: slide.contentPoints
    }
  ];
  const designBlocks = contentBlocks.length > 0 ? contentBlocks : fallbackBlocks;
  const layoutType = plan?.layoutType || slide.recommendedLayout;
  const designGuide = normalizeSlideDesignGuide(plan?.designGuide, {
    layoutType,
    contentBlocks: designBlocks
  });

  return {
    designCopy: {
      title: plan?.title || slide.title,
      keyMessage: plan?.keyMessage || slide.keyMessage,
      contentBlocks: designBlocks
    },
    designMeta: {
      layoutType,
      visualHint: plan?.visualHint ?? null,
      designGuide
    }
  };
}

export function buildExtractFactsPrompt(text: string) {
  return [
    "请从以下资料中提取可用于制作 PPT 的结构化事实。",
    "要求：保留事实原文依据；区分进展、风险、待确认事项、下一步计划；不要编造资料里没有的信息。",
    "sourceText 必须是资料中的简短直接引文；sourceLocation 必须原样复制该引文所在的证据块 ID，不要把页码或自由描述替代证据块 ID。",
    "资料：",
    text
  ].join("\n\n");
}

export function buildSlidePlanPrompt(slide: SlideDto, facts: FactDto[], theme: PptExportTheme = "white-blue") {
  const searchCards = selectedSearchMaterials(slide);
  const searchReference = searchReferenceForDraft(slide.searchJson);
  return [
    "请为这一页 PPT 生成可直接交给设计稿的单页文案初稿。",
    "这是递进链路的第 2 步：第 1 步已完成资料检索与提炼；本步必须基于「初稿参考文字」+「页意图」综合改写真正初稿。",
    "禁止把 pageIntent.contentPoints / keyMessage 原样抄进 contentBlocks；要把资料提炼稿改写成适合 PPT 的短句块。",
    "最终页面文案只由 title、keyMessage、contentBlocks 三部分组成；pageGoal 等字段仅供系统内部使用。",
    "contentBlocks 只写支撑正文，禁止 summary 类型，禁止与 keyMessage 重复。",
    "同时在 visualHint 字段给出建议图形与主视觉，供设计阶段复用；无合适图形时 chartType 用 none。",
    "同时生成系统内部 designGuide：标题怎么设计、背景怎么分层、核心结论用什么视觉容器、每个正文模块使用什么形状与位置。",
    "designGuide.blocks 必须与 contentBlocks 一一对应，blockIndex 从 0 开始；只写可执行的形状/布局指令，不得写空泛审美形容词。",
    layoutBlueprintInstruction(slide, theme),
    "默认锁模版填文案：layoutType 必须使用角色模版枚举值；contentBlocks 对齐区块骨架与变体填槽。",
    "每页只保留一个主结论；删掉重复事实；文案简洁但必须保持完整语义。",
    "文案预算：",
    formatCopyBudgetCatalog(),
    "每个 contentBlock 最多 3 条 items；每条 item 单字段建议不超过 300 字，禁止截断。",
    "页意图（便利贴，仅作方向，勿原文复述）：",
    JSON.stringify(
      {
        id: slide.id,
        title: slide.title,
        slideGoal: slide.slideGoal,
        keyMessage: slide.keyMessage,
        contentPoints: slide.contentPoints,
        recommendedLayout: slide.recommendedLayout,
        sourceFactIds: slide.sourceFactIds
      },
      null,
      2
    ),
    searchReference
      ? "检索阶段产出的初稿参考文字（本步主要内容输入，必须优先使用）："
      : "检索阶段未产出可用参考文字。",
    searchReference
      ? JSON.stringify(
          {
            summary: searchReference.summary,
            keyFindings: searchReference.keyFindings,
            draftReference: searchReference.draftReference,
            caveats: searchReference.caveats,
            selectedSourceIndexes: searchReference.selectedSourceIndexes
          },
          null,
          2
        )
      : "",
    searchCards.length > 0
      ? "检索参考资料（用于核对证据与来源，不要逐卡复述）："
      : "检索参考资料：无。请依据参考文字、页意图与事实库，并保持克制。",
    JSON.stringify(
      searchCards.map((card, index) => ({
        index: index + 1,
        title: card.title,
        snippet: card.snippet,
        url: slide.searchJson?.mode === "web" ? card.url : undefined
      })),
      null,
      2
    ),
    slide.searchJson?.notes ? `检索备注：${slide.searchJson.notes}` : "",
    "相关事实 JSON（补充，次于资料卡）：",
    JSON.stringify(
      facts.map((fact) => ({
        id: fact.id,
        category: fact.category,
        content: fact.content,
        status: fact.status,
        confidence: fact.confidence
      })),
      null,
      2
    )
  ]
    .filter((part) => part !== "")
    .join("\n\n");
}


export function buildSvgPreviewPrompt(
  slide: SlideDto,
  _facts: FactDto[],
  theme: PptExportTheme = "white-blue",
  surfaceId?: ThemeSurfaceId | string | null,
  revisionNotes: string[] = [],
  accentId?: string | null,
  previousSvg?: string,
  presentationStyle?: PresentationStyleId | string | null
) {
  const surfaceLine = surfaceInstruction(surfaceId);
  const kimiDesignKnowledge = buildKimiDesignKnowledgeInstruction(
    slide,
    theme,
    presentationStyle,
    "svg"
  );
  const repairInstruction =
    revisionNotes.length > 0
      ? [
          "上一次生成未通过质量门禁。请仅修复下列问题，保留候选 SVG 中已经正确的文字、语义分组、配方结构和视觉层级；禁止无关重写或重新设计整页：",
          revisionNotes.map((note) => `- ${note}`).join("\n"),
          previousSvg
            ? `上一候选 SVG（必须以此为基准做定向修复，并输出修复后的完整 SVG）：\n${previousSvg}`
            : "没有可用候选 SVG 时，仍须逐条落实以上修复项并输出完整 SVG。"
        ].join("\n\n")
      : "";
  return [
    "请严格按照下面契约生成专业企业演示 SVG 页面。",
    themeInstruction(theme, accentId),
    presentationStyleInstruction(presentationStyle),
    kimiDesignKnowledge,
    layoutBlueprintInstruction(slide, theme, { lockGeometry: false }),
    buildDesignRecipeInstruction(slide, presentationStyle),
    visualHintInstruction(slide),
    designGuideInstruction(slide),
    surfaceLine,
    repairInstruction,
    "",
    "我的内容是：",
    JSON.stringify(
      {
        slideId: slide.id,
        ...designHandoff(slide),
        presentationStyle: normalizePresentationStyleId(presentationStyle),
        visualRecipe: designRecipeMeta(slide, presentationStyle)
      },
      null,
      2
    ),
    "",
    "输出前自检：是否完整执行 STYLE_CONTRACT 的构图、排版、密度和禁止模式；viewBox 是否为 0 0 1280 720；全部业务内容是否处于 x=32..1248、y=24..696 安全区；独立业务区是否完全不相交并保留配方 minGutter；是否按 layer 从低到高输出语义 <g>；连接线是否位于内容后方且没有穿过文字；是否没有整高侧边色条、泛用胶囊、无意义光晕和错位叠片；是否存在视觉配方规定的全部 <g id> 与必要非矩形图元；是否逐步执行背景、标题、结论、正文和关系层的形状组装程序；是否没有退化成标题居中、等宽白卡和纯文字平铺；是否存在明确主视觉；是否体现 visualHint；是否所有 text 都有贴合文字范围的 data-w/data-h；超过 data-w 的文字是否已用带 x/dy 的 tspan 显式换行；文字右边是否与容器保留至少 20px；是否没有孤立 bullet/标点、重复事实和文字截断；是否能被拆成可编辑 PPT 文本和形状。"
  ].filter(Boolean).join("\n\n");
}
