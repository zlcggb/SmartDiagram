/**
 * 自研精选版式变体库（类 dashi layout 池，体量可控）。
 * 每角色 2–3 个固定构图剪影 + 字阶/间距/主视觉位；生成侧「选 variant → 填槽」，
 * 不移植外部 React 版式源码。
 */

import {
  blueprintForLayout,
  layoutRoleFromRecommended,
  type PageLayoutRole,
  type RecommendedLayout
} from "./layoutRoles.js";
import type { ThemePackMeta } from "./themePacks.js";

/** 主视觉落点（画布分区） */
export type HeroZone =
  | "left-wide"
  | "right-wide"
  | "top-band"
  | "center-hero"
  | "full-bleed-title"
  | "split-50-50"
  | "metric-grid"
  | "timeline-rail";

export interface LayoutTypeScale {
  /** 页标题建议 px（1280 画布） */
  titlePx: [number, number];
  /** 卡片标题 */
  cardTitlePx: [number, number];
  /** 正文 */
  bodyPx: [number, number];
  /** 指标数字 */
  metricPx: [number, number];
}

export interface LayoutComposition {
  /** 一句话剪影，供提示词/日志识别 */
  silhouette: string;
  heroZone: HeroZone;
  /** 卡片最小间距（画布 px） */
  gutterPx: number;
  /** 页边距（画布 px） */
  marginPx: number;
  typeScale: LayoutTypeScale;
  /** 禁止的同质构图（提示词硬约束） */
  avoid: string[];
  /** 填槽字段（类 props / copyKeys） */
  slots: string[];
}

export interface LayoutVariant {
  id: string;
  role: PageLayoutRole;
  recommendedLayout: RecommendedLayout;
  label: string;
  /** 何时选用 */
  whenToUse: string;
  /** light / dark / any — 与 ThemePack.family 对齐偏好 */
  prefersFamily: "light" | "dark" | "any";
  composition: LayoutComposition;
}

const defaultTypeScale = (kind: "hero" | "dense" | "metric" | "balanced"): LayoutTypeScale => {
  switch (kind) {
    case "hero":
      return { titlePx: [42, 56], cardTitlePx: [22, 28], bodyPx: [16, 20], metricPx: [36, 48] };
    case "dense":
      return { titlePx: [28, 36], cardTitlePx: [18, 24], bodyPx: [14, 18], metricPx: [24, 32] };
    case "metric":
      return { titlePx: [32, 40], cardTitlePx: [18, 24], bodyPx: [15, 19], metricPx: [40, 56] };
    default:
      return { titlePx: [34, 44], cardTitlePx: [20, 26], bodyPx: [16, 20], metricPx: [28, 40] };
  }
};

function v(
  partial: Omit<LayoutVariant, "composition"> & {
    composition: Omit<LayoutComposition, "typeScale" | "gutterPx" | "marginPx"> & {
      typeScale?: LayoutTypeScale;
      gutterPx?: number;
      marginPx?: number;
    };
  }
): LayoutVariant {
  return {
    ...partial,
    composition: {
      gutterPx: partial.composition.gutterPx ?? 24,
      marginPx: partial.composition.marginPx ?? 48,
      typeScale: partial.composition.typeScale ?? defaultTypeScale("balanced"),
      silhouette: partial.composition.silhouette,
      heroZone: partial.composition.heroZone,
      avoid: partial.composition.avoid,
      slots: partial.composition.slots
    }
  };
}

/** 精选变体：约 40 个，覆盖 16 角色 × 2–3 剪影 */
export const layoutVariants: LayoutVariant[] = [
  v({
    id: "cover-hero-left",
    role: "cover",
    recommendedLayout: "cover",
    label: "封面·左主视觉",
    whenToUse: "默认封面：大标题左置 + 右侧指标块",
    prefersFamily: "any",
    composition: {
      silhouette: "左大标题区 + 右竖指标 + 底三小卡",
      heroZone: "left-wide",
      typeScale: defaultTypeScale("hero"),
      avoid: ["三等分卡片墙", "把页数当主指标"],
      slots: ["kicker", "title", "lead", "heroMetric", "metaCards[3]"]
    }
  }),
  v({
    id: "cover-center-statement",
    role: "cover",
    recommendedLayout: "cover",
    label: "封面·居中金句",
    whenToUse: "品牌/叙事开场，强调一句主张",
    prefersFamily: "light",
    composition: {
      silhouette: "居中超大标题 + 底部分栏元信息",
      heroZone: "center-hero",
      typeScale: defaultTypeScale("hero"),
      avoid: ["右侧塞满小指标", "多卡片抢视线"],
      slots: ["title", "lead", "metaCards[2-3]"]
    }
  }),
  v({
    id: "cover-dark-dashboard",
    role: "cover",
    recommendedLayout: "cover",
    label: "封面·深色看板",
    whenToUse: "科技/战略主题，开场即给数字信号",
    prefersFamily: "dark",
    composition: {
      silhouette: "顶标题 + 中横幅结论 + 三指标条 + 底双栏",
      heroZone: "top-band",
      typeScale: defaultTypeScale("metric"),
      avoid: ["浅色大留白封面"],
      slots: ["title", "claim", "metrics[3]", "panels[2]"]
    }
  }),

  v({
    id: "toc-numbered-list",
    role: "toc",
    recommendedLayout: "toc",
    label: "目录·编号列表",
    whenToUse: "标准章节导航",
    prefersFamily: "any",
    composition: {
      silhouette: "左摘要 + 右编号章节列表",
      heroZone: "split-50-50",
      avoid: ["把目录做成三卡墙"],
      slots: ["summary", "chapters[4-7]"]
    }
  }),
  v({
    id: "toc-rail",
    role: "toc",
    recommendedLayout: "toc",
    label: "目录·轨道",
    whenToUse: "章节少、需强节奏感",
    prefersFamily: "any",
    composition: {
      silhouette: "横向步骤轨 + 每步短标题",
      heroZone: "timeline-rail",
      avoid: ["长段落章节说明"],
      slots: ["summary", "steps[4-6]"]
    }
  }),

  v({
    id: "statement-quote",
    role: "statement",
    recommendedLayout: "statement",
    label: "论点·金句",
    whenToUse: "一页一论、强记忆点",
    prefersFamily: "any",
    composition: {
      silhouette: "超大居中金句 + 底 1–2 支撑",
      heroZone: "center-hero",
      typeScale: defaultTypeScale("hero"),
      gutterPx: 32,
      avoid: ["三卡并列", "表格"],
      slots: ["quote", "supports[1-2]"]
    }
  }),
  v({
    id: "statement-callout",
    role: "statement",
    recommendedLayout: "statement",
    label: "论点·左判右证",
    whenToUse: "需要同时给判断与证据",
    prefersFamily: "any",
    composition: {
      silhouette: "左侧大判断 + 右侧证据卡",
      heroZone: "left-wide",
      avoid: ["多结论并列"],
      slots: ["judgment", "evidence[2-3]"]
    }
  }),

  v({
    id: "transition-chapter",
    role: "transition",
    recommendedLayout: "transition",
    label: "过渡·章节名",
    whenToUse: "章节切换，正文极少",
    prefersFamily: "any",
    composition: {
      silhouette: "全幅章节名 + 一句预告",
      heroZone: "full-bleed-title",
      typeScale: defaultTypeScale("hero"),
      gutterPx: 40,
      avoid: ["多卡片", "指标墙"],
      slots: ["chapter", "teaser"]
    }
  }),
  v({
    id: "transition-number",
    role: "transition",
    recommendedLayout: "transition",
    label: "过渡·章节号",
    whenToUse: "强调 Part 序号",
    prefersFamily: "dark",
    composition: {
      silhouette: "巨型章节号 + 右侧标题",
      heroZone: "left-wide",
      typeScale: defaultTypeScale("hero"),
      avoid: ["正文列表"],
      slots: ["partNo", "chapter", "teaser"]
    }
  }),

  v({
    id: "metrics-row",
    role: "metrics",
    recommendedLayout: "metrics",
    label: "指标·横排",
    whenToUse: "3–4 个并列 KPI",
    prefersFamily: "any",
    composition: {
      silhouette: "顶结论条 + 横排 3–4 指标卡",
      heroZone: "metric-grid",
      typeScale: defaultTypeScale("metric"),
      avoid: ["假图表装饰为主视觉"],
      slots: ["claim", "metrics[3-4]", "insight"]
    }
  }),
  v({
    id: "metrics-hero",
    role: "metrics",
    recommendedLayout: "metrics",
    label: "指标·单核",
    whenToUse: "一个核心数字压场",
    prefersFamily: "any",
    composition: {
      silhouette: "左侧超大数字 + 右侧解读列表",
      heroZone: "left-wide",
      typeScale: defaultTypeScale("metric"),
      avoid: ["四个同权小指标"],
      slots: ["heroValue", "heroLabel", "notes[3]"]
    }
  }),

  v({
    id: "status-triptych",
    role: "status",
    recommendedLayout: "status-cards",
    label: "现状·三联",
    whenToUse: "三维并列现状",
    prefersFamily: "any",
    composition: {
      silhouette: "顶结论 + 三竖卡",
      heroZone: "top-band",
      avoid: ["超过四张同权卡"],
      slots: ["claim", "cards[3]"]
    }
  }),
  v({
    id: "status-focus",
    role: "status",
    recommendedLayout: "status-cards",
    label: "现状·主次",
    whenToUse: "一主两辅现状",
    prefersFamily: "any",
    composition: {
      silhouette: "左大卡 + 右上下两小卡",
      heroZone: "left-wide",
      avoid: ["三等分无主次"],
      slots: ["claim", "primaryCard", "secondaryCards[2]"]
    }
  }),
  v({
    id: "progress-mix",
    role: "status",
    recommendedLayout: "progress-cards",
    label: "进展·混合",
    whenToUse: "进展叙述 + 完成率",
    prefersFamily: "any",
    composition: {
      silhouette: "顶结论 + 两进展卡 + 右指标簇",
      heroZone: "top-band",
      avoid: ["纯列表无指标"],
      slots: ["claim", "progressCards[2]", "metrics[2]"]
    }
  }),

  v({
    id: "trend-rail",
    role: "trend",
    recommendedLayout: "trend",
    label: "趋势·轨道",
    whenToUse: "阶段/走势叙事",
    prefersFamily: "any",
    composition: {
      silhouette: "顶结论 + 左时间轨 + 右解读",
      heroZone: "timeline-rail",
      avoid: ["三卡墙冒充趋势"],
      slots: ["claim", "stages[3-5]", "insight"]
    }
  }),
  v({
    id: "trend-stages",
    role: "trend",
    recommendedLayout: "trend",
    label: "趋势·阶段卡",
    whenToUse: "离散阶段对比",
    prefersFamily: "any",
    composition: {
      silhouette: "横向 3–4 阶段卡 + 底洞察条",
      heroZone: "metric-grid",
      avoid: ["连续折线假图为主"],
      slots: ["claim", "stages[3-4]", "insight"]
    }
  }),

  v({
    id: "comparison-dual",
    role: "comparison",
    recommendedLayout: "comparison",
    label: "对比·双栏",
    whenToUse: "现状 vs 方案 / A vs B",
    prefersFamily: "any",
    composition: {
      silhouette: "顶结论 + 左右等宽对照栏",
      heroZone: "split-50-50",
      avoid: ["三卡无对照语义"],
      slots: ["claim", "leftTitle", "leftItems", "rightTitle", "rightItems"]
    }
  }),
  v({
    id: "comparison-tri",
    role: "comparison",
    recommendedLayout: "comparison",
    label: "对比·三栏",
    whenToUse: "三方对照（竞品/方案/维度）",
    prefersFamily: "any",
    composition: {
      silhouette: "顶结论 + 三对照栏",
      heroZone: "metric-grid",
      avoid: ["无表头语义的三卡"],
      slots: ["claim", "columns[3]"]
    }
  }),

  v({
    id: "distribution-stack",
    role: "distribution",
    recommendedLayout: "distribution",
    label: "分布·结构条",
    whenToUse: "占比/结构拆解",
    prefersFamily: "any",
    composition: {
      silhouette: "左结构数字 + 右分段解读",
      heroZone: "left-wide",
      typeScale: defaultTypeScale("metric"),
      avoid: ["装饰饼图占主区且无数字"],
      slots: ["claim", "shares[3-5]", "notes"]
    }
  }),
  v({
    id: "distribution-ladder",
    role: "distribution",
    recommendedLayout: "distribution",
    label: "分布·梯队",
    whenToUse: "梯队/漏斗层级",
    prefersFamily: "any",
    composition: {
      silhouette: "纵向层级条 + 右侧结论",
      heroZone: "right-wide",
      avoid: ["平板三卡"],
      slots: ["claim", "levels[3-4]", "insight"]
    }
  }),

  v({
    id: "process-steps",
    role: "process",
    recommendedLayout: "process",
    label: "流程·步骤",
    whenToUse: "实施路径/方法步骤",
    prefersFamily: "any",
    composition: {
      silhouette: "顶结论 + 横向步骤 + 右里程碑",
      heroZone: "timeline-rail",
      avoid: ["无序要点卡"],
      slots: ["claim", "steps[3-5]", "milestone"]
    }
  }),
  v({
    id: "timeline-classic",
    role: "process",
    recommendedLayout: "timeline",
    label: "时间线·经典",
    whenToUse: "按时间节点推进",
    prefersFamily: "any",
    composition: {
      silhouette: "顶结论 + 左时间线 + 右依据",
      heroZone: "timeline-rail",
      avoid: ["三卡墙"],
      slots: ["claim", "nodes[3-5]", "rationale"]
    }
  }),

  v({
    id: "case-split",
    role: "case",
    recommendedLayout: "case-study",
    label: "案例·分屏",
    whenToUse: "背景/做法/结果叙事",
    prefersFamily: "any",
    composition: {
      silhouette: "左背景结论 + 右做法结果列表",
      heroZone: "split-50-50",
      avoid: ["无故事线的三卡"],
      slots: ["context", "actions", "results"]
    }
  }),
  v({
    id: "case-story",
    role: "case",
    recommendedLayout: "case-study",
    label: "案例·三段",
    whenToUse: "挑战→动作→结果",
    prefersFamily: "any",
    composition: {
      silhouette: "三段横向叙事卡",
      heroZone: "metric-grid",
      avoid: ["指标墙冒充案例"],
      slots: ["challenge", "action", "outcome"]
    }
  }),

  v({
    id: "risk-matrix",
    role: "risk",
    recommendedLayout: "risk-table",
    label: "风险·矩阵",
    whenToUse: "风险表 + 缓解",
    prefersFamily: "any",
    composition: {
      silhouette: "顶结论 + 左概览 + 右矩阵表",
      heroZone: "right-wide",
      typeScale: defaultTypeScale("dense"),
      avoid: ["纯三卡无风险语义"],
      slots: ["claim", "overview", "matrixRows"]
    }
  }),
  v({
    id: "risk-cards",
    role: "risk",
    recommendedLayout: "risk-table",
    label: "风险·卡片",
    whenToUse: "少量高优风险深讲",
    prefersFamily: "any",
    composition: {
      silhouette: "顶结论 + 2–3 风险卡（影响/缓解）",
      heroZone: "top-band",
      avoid: ["空表头"],
      slots: ["claim", "riskCards[2-3]"]
    }
  }),

  v({
    id: "observation-insight",
    role: "observation",
    recommendedLayout: "observation",
    label: "洞察·双栏",
    whenToUse: "洞察 + 含义",
    prefersFamily: "any",
    composition: {
      silhouette: "左洞察大卡 + 右含义/下一步",
      heroZone: "split-50-50",
      avoid: ["清单堆砌"],
      slots: ["insight", "implication"]
    }
  }),
  v({
    id: "observation-quote",
    role: "observation",
    recommendedLayout: "observation",
    label: "洞察·引述",
    whenToUse: "观点引述型",
    prefersFamily: "light",
    composition: {
      silhouette: "大引述区 + 底注释条",
      heroZone: "center-hero",
      typeScale: defaultTypeScale("hero"),
      avoid: ["多卡分散"],
      slots: ["quote", "note"]
    }
  }),

  v({
    id: "action-matrix",
    role: "action",
    recommendedLayout: "action-list",
    label: "行动·矩阵",
    whenToUse: "事项/责任/时间",
    prefersFamily: "any",
    composition: {
      silhouette: "顶目标 + 左行动表 + 右提示",
      heroZone: "left-wide",
      typeScale: defaultTypeScale("dense"),
      avoid: ["无责任人的口号卡"],
      slots: ["goal", "actionRows", "tips"]
    }
  }),
  v({
    id: "action-checklist",
    role: "action",
    recommendedLayout: "action-list",
    label: "行动·清单轨",
    whenToUse: "本周必做清单",
    prefersFamily: "any",
    composition: {
      silhouette: "顶目标 + 时间轨行动项 + 闭环提示",
      heroZone: "timeline-rail",
      avoid: ["空表格"],
      slots: ["goal", "actions[3-5]", "closeLoop"]
    }
  }),

  v({
    id: "closing-cta",
    role: "closing",
    recommendedLayout: "closing",
    label: "收束·诉求",
    whenToUse: "结论 + 希望对方做什么",
    prefersFamily: "any",
    composition: {
      silhouette: "大结论 + CTA 卡",
      heroZone: "center-hero",
      typeScale: defaultTypeScale("hero"),
      avoid: ["再铺三卡要点"],
      slots: ["conclusion", "cta"]
    }
  }),
  v({
    id: "closing-summary",
    role: "closing",
    recommendedLayout: "closing",
    label: "收束·要点回顾",
    whenToUse: "需快速回顾 3 点再 CTA",
    prefersFamily: "any",
    composition: {
      silhouette: "结论条 + 三回顾点 + CTA",
      heroZone: "top-band",
      avoid: ["新开话题"],
      slots: ["conclusion", "recap[3]", "cta"]
    }
  }),

  v({
    id: "content-bento",
    role: "content",
    recommendedLayout: "generic-cards",
    label: "通用·主次 Bento",
    whenToUse: "兜底：一主结论 + 支撑卡",
    prefersFamily: "any",
    composition: {
      silhouette: "顶结论条 + 一主两辅或三卡有主次",
      heroZone: "top-band",
      avoid: ["完全等权三卡墙（无主视觉）"],
      slots: ["claim", "cards[2-4]"]
    }
  }),
  v({
    id: "content-focus",
    role: "content",
    recommendedLayout: "generic-cards",
    label: "通用·焦点",
    whenToUse: "信息少、需强焦点",
    prefersFamily: "any",
    composition: {
      silhouette: "左大焦点卡 + 右要点列表",
      heroZone: "left-wide",
      avoid: ["装饰过多"],
      slots: ["focus", "bullets"]
    }
  }),

  // ── 新增角色变体（dashi 启发，自研落地）──────────────

  v({
    id: "context-quadrant",
    role: "context",
    recommendedLayout: "context-matrix",
    label: "背景·四象限",
    whenToUse: "定位矩阵/竞争格局",
    prefersFamily: "any",
    composition: {
      silhouette: "顶结论 + 四象限矩阵",
      heroZone: "center-hero",
      avoid: ["纯文字墙", "指标堆砌"],
      slots: ["claim", "quadrants[4]", "insight"]
    }
  }),
  v({
    id: "context-landscape",
    role: "context",
    recommendedLayout: "context-matrix",
    label: "背景·全景",
    whenToUse: "市场全景/区域画像",
    prefersFamily: "any",
    composition: {
      silhouette: "左概览 + 右分层画像卡",
      heroZone: "left-wide",
      avoid: ["三卡无层次"],
      slots: ["overview", "layers[3-4]"]
    }
  }),

  v({
    id: "image-hero",
    role: "image",
    recommendedLayout: "image-gallery",
    label: "图片·主图",
    whenToUse: "一张大图 + 说明",
    prefersFamily: "any",
    composition: {
      silhouette: "全幅大图 + 底部说明条",
      heroZone: "full-bleed-title",
      avoid: ["图片被文字挤小", "多图拼贴"],
      slots: ["heroImage", "caption", "note"]
    }
  }),
  v({
    id: "image-gallery-grid",
    role: "image",
    recommendedLayout: "image-gallery",
    label: "图片·画廊",
    whenToUse: "多图陈列展示",
    prefersFamily: "any",
    composition: {
      silhouette: "顶标题 + 2×2 或 3 列图片网格",
      heroZone: "metric-grid",
      avoid: ["图片太小看不清"],
      slots: ["title", "images[3-6]", "summary"]
    }
  }),

  v({
    id: "relationship-radial",
    role: "relationship",
    recommendedLayout: "relationship-map",
    label: "关系·径向",
    whenToUse: "中心节点 + 周围关联",
    prefersFamily: "any",
    composition: {
      silhouette: "中心大节点 + 径向连接小节点",
      heroZone: "center-hero",
      avoid: ["线性列表冒充关系图"],
      slots: ["centerNode", "relatedNodes[4-6]", "insight"]
    }
  }),
  v({
    id: "relationship-hierarchy",
    role: "relationship",
    recommendedLayout: "relationship-map",
    label: "关系·层级",
    whenToUse: "生态层级/组织架构",
    prefersFamily: "any",
    composition: {
      silhouette: "自上而下层级树 + 右侧解读",
      heroZone: "left-wide",
      avoid: ["扁平三卡"],
      slots: ["topNode", "layers[2-3]", "note"]
    }
  }),

  v({
    id: "ambient-visual",
    role: "ambient",
    recommendedLayout: "ambient-divider",
    label: "氛围·视觉",
    whenToUse: "强视觉冲击的章节分隔",
    prefersFamily: "dark",
    composition: {
      silhouette: "全幅视觉 + 居中章节名",
      heroZone: "full-bleed-title",
      typeScale: defaultTypeScale("hero"),
      gutterPx: 40,
      avoid: ["多卡片", "正文列表"],
      slots: ["chapter", "mood"]
    }
  }),
  v({
    id: "ambient-gradient",
    role: "ambient",
    recommendedLayout: "ambient-divider",
    label: "氛围·渐变",
    whenToUse: "柔和过渡、氛围转换",
    prefersFamily: "light",
    composition: {
      silhouette: "渐变底 + 大字章节名 + 一句引导",
      heroZone: "center-hero",
      typeScale: defaultTypeScale("hero"),
      gutterPx: 40,
      avoid: ["指标墙", "表格"],
      slots: ["chapter", "teaser"]
    }
  }),

  v({
    id: "result-number",
    role: "result",
    recommendedLayout: "result-poster",
    label: "结论·数字海报",
    whenToUse: "一个核心数字为视觉焦点",
    prefersFamily: "any",
    composition: {
      silhouette: "超大数字 + 下方解读条",
      heroZone: "center-hero",
      typeScale: defaultTypeScale("hero"),
      avoid: ["数字与解读等权"],
      slots: ["heroValue", "heroLabel", "interpretation"]
    }
  }),
  v({
    id: "result-takeaway",
    role: "result",
    recommendedLayout: "result-poster",
    label: "结论·要点回顾",
    whenToUse: "多条核心结论汇总",
    prefersFamily: "any",
    composition: {
      silhouette: "左大结论 + 右 3 要点回顾",
      heroZone: "left-wide",
      avoid: ["新开话题"],
      slots: ["conclusion", "takeaways[3]"]
    }
  }),

  v({
    id: "team-grid",
    role: "team",
    recommendedLayout: "team-profile",
    label: "团队·网格",
    whenToUse: "3-6 人团队展示",
    prefersFamily: "any",
    composition: {
      silhouette: "顶团队名 + 人物卡片网格",
      heroZone: "metric-grid",
      avoid: ["纯文字无人物区分"],
      slots: ["teamName", "members[3-6]"]
    }
  }),
  v({
    id: "team-spotlight",
    role: "team",
    recommendedLayout: "team-profile",
    label: "团队·聚光灯",
    whenToUse: "核心人物 + 团队概述",
    prefersFamily: "any",
    composition: {
      silhouette: "左核心人物大卡 + 右团队列表",
      heroZone: "left-wide",
      avoid: ["等权列表"],
      slots: ["leadProfile", "teamList[3-5]"]
    }
  })
];

export function getLayoutVariant(id?: string | null): LayoutVariant | undefined {
  if (!id) return undefined;
  return layoutVariants.find((item) => item.id === id);
}

export function variantsForRole(role: PageLayoutRole): LayoutVariant[] {
  return layoutVariants.filter((item) => item.role === role);
}

export function variantsForRecommendedLayout(layout: RecommendedLayout): LayoutVariant[] {
  return layoutVariants.filter((item) => item.recommendedLayout === layout);
}

export interface QueryLayoutsInput {
  role?: PageLayoutRole;
  recommendedLayout?: RecommendedLayout;
  /** ThemePack.family */
  themeFamily?: ThemePackMeta["family"] | "any";
  /** 本 deck 已用 variant，避免重复剪影 */
  usedVariantIds?: string[];
  /** 同 deck 已用 recommendedLayout（可选去重） */
  usedLayouts?: string[];
  limit?: number;
  /** 简单可复现洗牌 */
  seed?: string;
}

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffleWithSeed<T>(items: T[], seed: string): T[] {
  const arr = [...items];
  let state = hashSeed(seed) || 1;
  for (let i = arr.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/**
 * 轻量 layout:query：按角色/版式/主题族筛候选，打散顺序，避开已用 variant。
 * 封面角色不会混入正文变体。
 */
export function queryLayouts(input: QueryLayoutsInput = {}): LayoutVariant[] {
  const limit = Math.max(1, Math.min(input.limit ?? 8, 16));
  const used = new Set(input.usedVariantIds ?? []);
  const usedLayouts = new Set((input.usedLayouts ?? []).map((x) => x.toLowerCase()));

  let pool = [...layoutVariants];
  if (input.role) {
    pool = pool.filter((item) => item.role === input.role);
  }
  if (input.recommendedLayout) {
    pool = pool.filter((item) => item.recommendedLayout === input.recommendedLayout);
  }
  if (input.themeFamily && input.themeFamily !== "any") {
    const family = input.themeFamily;
    pool = pool.filter((item) => item.prefersFamily === "any" || item.prefersFamily === family);
  }

  const fresh = pool.filter((item) => !used.has(item.id));
  const base = fresh.length > 0 ? fresh : pool;

  const ranked = base.slice().sort((a, b) => {
    const aUsed = usedLayouts.has(a.recommendedLayout) ? 1 : 0;
    const bUsed = usedLayouts.has(b.recommendedLayout) ? 1 : 0;
    return aUsed - bUsed;
  });

  const ordered = input.seed ? shuffleWithSeed(ranked, input.seed) : ranked;
  return ordered.slice(0, limit);
}

/** 为某页解析默认/首选变体（outline 未指定 variant 时） */
export function pickDefaultVariant(
  recommendedLayout?: string | null,
  themeFamily: ThemePackMeta["family"] = "light",
  usedVariantIds: string[] = [],
  seed?: string
): LayoutVariant {
  const role = layoutRoleFromRecommended(recommendedLayout);
  const bp = blueprintForLayout(recommendedLayout);
  const candidates = queryLayouts({
    role,
    recommendedLayout: bp.recommendedLayout,
    themeFamily,
    usedVariantIds,
    limit: 6,
    seed: seed ?? `${role}-${bp.recommendedLayout}`
  });
  return candidates[0] ?? layoutVariants.find((item) => item.role === role) ?? layoutVariants[layoutVariants.length - 1]!;
}

export function formatLayoutVariantCatalog(limitPerRole = 2): string {
  const byRole = new Map<PageLayoutRole, LayoutVariant[]>();
  for (const item of layoutVariants) {
    const list = byRole.get(item.role) ?? [];
    if (list.length < limitPerRole) list.push(item);
    byRole.set(item.role, list);
  }
  return [...byRole.entries()]
    .map(([role, items]) => {
      const lines = items.map(
        (v) =>
          `  · ${v.id}（${v.label}→${v.recommendedLayout}）：${v.composition.silhouette}；槽=${v.composition.slots.join(",")}`
      );
      return `- 角色 ${role}:\n${lines.join("\n")}`;
    })
    .join("\n");
}

/** 注入 Design/Plan 的构图硬约束 */
export function formatVariantCompositionInstruction(variant: LayoutVariant): string {
  const c = variant.composition;
  const ts = c.typeScale;
  return [
    `版式变体：${variant.id}（${variant.label}）。`,
    `剪影：${c.silhouette}；主视觉区：${c.heroZone}；边距≈${c.marginPx}px；间距≥${c.gutterPx}px。`,
    `字阶：标题 ${ts.titlePx[0]}-${ts.titlePx[1]} / 卡题 ${ts.cardTitlePx[0]}-${ts.cardTitlePx[1]} / 正文 ${ts.bodyPx[0]}-${ts.bodyPx[1]} / 指标 ${ts.metricPx[0]}-${ts.metricPx[1]}。`,
    `填槽：${c.slots.join(" · ")}。`,
    `禁止：${c.avoid.join("；")}。`,
    "锁剪影填文案：不要改成无关构图；内容装进上述槽位。"
  ].join("\n");
}
