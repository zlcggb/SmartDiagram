import {
  getPresentationStylePreset,
  getThemePack,
  normalizePptExportTheme
} from "@ppt-agent/shared";
import type {
  KimiDesignKnowledgeRequest,
  KimiKnowledgeSelection
} from "./types.js";
import { selectColorPalettesForScene, type SceneColorPalette } from "./colorPalettes.js";

export type KimiLayoutArchetype =
  | "hero-statement"
  | "staged-roadmap"
  | "system-map"
  | "risk-matrix"
  | "evidence-spotlight"
  | "editorial-feature"
  | "asymmetric-argument";

export interface KimiCompiledDesignBrief {
  version: "design-brief/1";
  archetype: KimiLayoutArchetype;
  rationale: string;
  reference: {
    category: string | null;
    designSystem: string | null;
  };
  composition: {
    pattern: string;
    safeArea: [number, number, number, number];
    titleZone: [number, number, number, number];
    thesisZone: [number, number, number, number];
    visualZone: [number, number, number, number];
    footerZone: [number, number, number, number];
    requiredVisualObjects: string[];
  };
  typography: {
    title: [number, number];
    keyMessage: [number, number];
    body: [number, number];
    label: [number, number];
    maxLevels: number;
  };
  content: {
    maxMainGroups: number;
    maxBodyCharsPerGroup: number;
    instruction: string;
  };
  visualLanguage: {
    theme: string;
    style: string;
    instruction: string;
    colorHints?: Array<{ label: string; base: string; structural: string; accent: string; rationale: string }>;
  };
  forbidden: string[];
}

function requestSignal(request: KimiDesignKnowledgeRequest) {
  return [
    request.pageType,
    request.slideGoal,
    request.title,
    request.topic,
    JSON.stringify(request.visualHint ?? {})
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function selectArchetype(
  request: KimiDesignKnowledgeRequest
): { archetype: KimiLayoutArchetype; rationale: string } {
  const signal = requestSignal(request);
  const style = getPresentationStylePreset(request.presentationStyle);
  if (/(^|\b)cover($|\b)|封面|开场|title-page/.test(signal)) {
    return { archetype: "hero-statement", rationale: "封面页需要单一主张和强视觉焦点" };
  }
  if (/toc|timeline|roadmap|milestone|navigation|导航|目录|路线|阶段|里程碑|递进/.test(signal)) {
    return { archetype: "staged-roadmap", rationale: "页面表达顺序和阶段关系，必须以路径而非等分栏呈现" };
  }
  if (/risk|matrix|风险|优先级|概率|影响/.test(signal)) {
    return { archetype: "risk-matrix", rationale: "页面核心任务是比较风险等级与处置优先级" };
  }
  if (/architecture|system|process|flow|pipeline|架构|系统|流程|链路|组件|接口/.test(signal)) {
    return { archetype: "system-map", rationale: "页面包含节点、边界或流向关系" };
  }
  if (
    style.id === "data-story" ||
    /metric|kpi|chart|trend|data|数据|指标|趋势|增长|占比/.test(signal)
  ) {
    return { archetype: "evidence-spotlight", rationale: "页面需要用一个关键证据驱动结论" };
  }
  if (style.id === "editorial") {
    return { archetype: "editorial-feature", rationale: "编辑式风格需要主稿区与辅助叙事形成不对称版面" };
  }
  return { archetype: "asymmetric-argument", rationale: "一般内容页以主论点和次级证据形成不对称层级" };
}

function compositionFor(archetype: KimiLayoutArchetype) {
  const common = {
    safeArea: [48, 36, 1184, 648] as [number, number, number, number],
    titleZone: [72, 48, 860, 96] as [number, number, number, number],
    footerZone: [72, 656, 1136, 20] as [number, number, number, number]
  };
  if (archetype === "hero-statement") {
    return {
      ...common,
      pattern: "single centered or left-biased hero with one supporting sentence",
      thesisZone: [150, 186, 980, 220] as [number, number, number, number],
      visualZone: [96, 132, 1088, 430] as [number, number, number, number],
      requiredVisualObjects: ["one hero surface or image", "one short accent line"]
    };
  }
  if (archetype === "staged-roadmap") {
    return {
      ...common,
      pattern: "36/64 asymmetric split: thesis anchor on the left, ascending three-stage path on the right",
      thesisZone: [72, 176, 360, 420] as [number, number, number, number],
      visualZone: [480, 176, 728, 424] as [number, number, number, number],
      requiredVisualObjects: ["three stage nodes", "two arrow connectors", "one continuous visual path"]
    };
  }
  if (archetype === "system-map") {
    return {
      ...common,
      pattern: "one explicit system boundary with a dominant processing node and smaller input/output nodes",
      thesisZone: [72, 156, 340, 168] as [number, number, number, number],
      visualZone: [430, 156, 778, 470] as [number, number, number, number],
      requiredVisualObjects: [
        "three to five nodes",
        "explicit connectors",
        "one visible system boundary",
        "one dominant processing node"
      ]
    };
  }
  if (archetype === "risk-matrix") {
    return {
      ...common,
      pattern: "one dominant risk matrix or ranked risk field with a narrow mitigation column",
      thesisZone: [72, 156, 360, 130] as [number, number, number, number],
      visualZone: [72, 304, 1136, 322] as [number, number, number, number],
      requiredVisualObjects: ["risk field or matrix", "severity encoding", "mitigation linkage"]
    };
  }
  if (archetype === "evidence-spotlight") {
    return {
      ...common,
      pattern: "38/62 split: one oversized metric or chart, two annotated evidence bands",
      thesisZone: [72, 190, 400, 360] as [number, number, number, number],
      visualZone: [520, 168, 688, 430] as [number, number, number, number],
      requiredVisualObjects: ["one dominant evidence object", "direct annotation", "comparison or trend cue"]
    };
  }
  if (archetype === "editorial-feature") {
    return {
      ...common,
      pattern: "editorial spread with a large headline field and one feature panel",
      thesisZone: [72, 164, 440, 388] as [number, number, number, number],
      visualZone: [566, 148, 642, 450] as [number, number, number, number],
      requiredVisualObjects: ["one feature panel", "one strong typographic contrast", "one secondary caption"]
    };
  }
  return {
    ...common,
    pattern: "40/60 asymmetric argument: one thesis anchor, stacked evidence on the opposite side",
    thesisZone: [72, 176, 410, 400] as [number, number, number, number],
    visualZone: [530, 176, 678, 420] as [number, number, number, number],
    requiredVisualObjects: ["one thesis anchor", "two evidence groups", "one explicit relationship cue"]
  };
}

export function compileKimiDesignBrief(
  request: KimiDesignKnowledgeRequest,
  category?: KimiKnowledgeSelection | null,
  designSystem?: KimiKnowledgeSelection | null
): KimiCompiledDesignBrief {
  const style = getPresentationStylePreset(request.presentationStyle);
  const theme = getThemePack(normalizePptExportTheme(request.theme));
  const { archetype, rationale } = selectArchetype(request);
  const bodyMin = style.density === "high" ? 16 : style.density === "medium" ? 17 : 18;
  const maxMainGroups = archetype === "hero-statement" ? 1 : style.density === "low" ? 2 : 3;
  const categoryId = category?.entry.id.split(":").pop() ?? null;
  const colorGroup = selectColorPalettesForScene(categoryId);
  const colorHints: KimiCompiledDesignBrief["visualLanguage"]["colorHints"] =
    colorGroup
      ? colorGroup.palettes.slice(0, 4).map(({ label, base, structural, accent, rationale }) => ({
          label, base, structural, accent, rationale
        }))
      : undefined;
  return {
    version: "design-brief/1",
    archetype,
    rationale,
    reference: {
      category: category?.entry.title ?? null,
      designSystem: designSystem?.entry.title ?? null
    },
    composition: compositionFor(archetype),
    typography: {
      title: [40, 48],
      keyMessage: [20, 24],
      body: [bodyMin, Math.max(bodyMin, 20)],
      label: [12, 14],
      maxLevels: 4
    },
    content: {
      maxMainGroups,
      maxBodyCharsPerGroup: style.density === "high" ? 90 : style.density === "medium" ? 72 : 54,
      instruction: "先压缩文案再排版；每组保留一个判断和一个证据，不得把原始段落直接塞进大文本框"
    },
    visualLanguage: {
      theme: theme.label,
      style: style.label,
      instruction: `${style.composition} 使用主题 token 决定颜色；设计系统只提供构图语法，不复制其品牌与样例内容。配色应"出人意料但合理"，拒绝最常见的公式化配色。`,
      ...(colorHints ? { colorHints } : {})
    },
    forbidden: [
      "three equal text columns unless the archetype explicitly requires comparison",
      "body text below the declared minimum",
      "visible truncation ellipsis; rewrite copy as a complete short sentence",
      "large empty lower half caused by oversized text bounds",
      "card wall generated directly from contentBlocks",
      "full-height accent rails",
      "decorative pills, glows or icons without semantic purpose",
      "blue-purple gradients, cyan-purple neon, rainbow flares, glassmorphism cards, or glowing borders",
      "pure white #FFFFFF backgrounds; use textured off-whites like #F7F3E8 or #F4F6F8",
      ...style.forbiddenPatterns
    ]
  };
}

export function formatKimiDesignBrief(brief: KimiCompiledDesignBrief) {
  return `DESIGN_BLUEPRINT\n${JSON.stringify(brief)}`;
}
