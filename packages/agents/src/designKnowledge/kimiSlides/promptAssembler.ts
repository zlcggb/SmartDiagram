import { createHash } from "node:crypto";
import {
  getPresentationStylePreset,
  getThemePack,
  normalizePresentationStyleId,
  normalizePptExportTheme
} from "@ppt-agent/shared";
import type {
  KimiDesignKnowledgeBundle,
  KimiDesignKnowledgeRequest,
  KimiKnowledgeCatalog,
  KimiKnowledgeSelection
} from "./types.js";
import {
  compileKimiDesignBrief,
  formatKimiDesignBrief
} from "./designBrief.js";

const DEFAULT_PROMPT_CHARS = 10_000;
const MIN_PROMPT_CHARS = 2_400;
const MAX_PROMPT_CHARS = 12_000;

type MarkdownHeading = {
  index: number;
  level: number;
  title: string;
};

function stripUnsafeReferenceSyntax(value: string) {
  return value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```(?:bash|sh|shell|python|javascript|typescript|powershell)[\s\S]*?```/gi, "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clipAtBoundary(value: string, maxChars: number) {
  const normalized = stripUnsafeReferenceSyntax(value);
  if (normalized.length <= maxChars) return normalized;
  const slice = normalized.slice(0, Math.max(1, maxChars - 1));
  const boundary = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf("。"), slice.lastIndexOf(". "));
  const clipped = boundary > maxChars * 0.7 ? slice.slice(0, boundary + 1) : slice;
  return `${clipped.trim()}…`;
}

function normalizeHeading(value: string) {
  return value
    .replace(/[*_`]/g, "")
    .replace(/^\s*\d+(?:\.\d+)*[.)、:\s-]*/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function markdownHeadings(lines: string[]): MarkdownHeading[] {
  return lines.flatMap((line, index) => {
    const markdown = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (markdown) {
      return [
        {
          index,
          level: markdown[1]!.length,
          title: markdown[2]!
        }
      ];
    }
    const bracket = line.match(/^【(.+?)】\s*$/u);
    if (bracket) {
      return [{ index, level: 2, title: bracket[1]! }];
    }
    return [];
  });
}

function compactReferenceContract(
  content: string,
  wantedSections: string[],
  maxChars: number
) {
  const normalized = stripUnsafeReferenceSyntax(content);
  const lines = normalized.split("\n");
  const headings = markdownHeadings(lines);
  const selected: Array<{ start: number; end: number }> = [];

  for (const wanted of wantedSections) {
    const wantedKey = normalizeHeading(wanted);
    const heading = headings.find(
      (entry) =>
        !selected.some(({ start }) => start === entry.index) &&
        normalizeHeading(entry.title).includes(wantedKey)
    );
    if (!heading) continue;
    const next = headings.find(
      (entry) => entry.index > heading.index && entry.level <= heading.level
    );
    selected.push({
      start: heading.index,
      end: next?.index ?? lines.length
    });
  }

  const contract = selected.length
    ? selected
        .sort((left, right) => left.start - right.start)
        .map(({ start, end }) => lines.slice(start, end).join("\n").trim())
        .filter(Boolean)
        .join("\n\n")
    : normalized;
  return clipAtBoundary(contract, maxChars);
}

function emptyBundle(
  request: KimiDesignKnowledgeRequest,
  warnings: string[]
): KimiDesignKnowledgeBundle {
  const style = getPresentationStylePreset(request.presentationStyle);
  return {
    available: false,
    category: null,
    designSystem: null,
    prompt: "",
    constraints: {
      density: style.density,
      focalPoints: style.id === "apple-minimal" ? 1 : 2,
      maxMainGroups: style.density === "low" ? 2 : 3,
      forbiddenPatterns: [...style.forbiddenPatterns]
    },
    sources: [],
    fingerprint: "",
    warnings
  };
}

export function unavailableKimiDesignKnowledgeBundle(
  request: KimiDesignKnowledgeRequest,
  warning: string
) {
  return emptyBundle(request, [warning]);
}

export function assembleKimiPromptBundle(
  request: KimiDesignKnowledgeRequest,
  catalog: KimiKnowledgeCatalog,
  category: KimiKnowledgeSelection | null,
  designSystem: KimiKnowledgeSelection | null
): KimiDesignKnowledgeBundle {
  if (!category || !designSystem) {
    return emptyBundle(request, [
      ...catalog.warnings,
      "Kimi Slides 知识目录缺少可用的场景或设计系统"
    ]);
  }

  const maxChars = Math.max(
    MIN_PROMPT_CHARS,
    Math.min(MAX_PROMPT_CHARS, request.maxPromptChars ?? DEFAULT_PROMPT_CHARS)
  );
  const style = getPresentationStylePreset(request.presentationStyle);
  const theme = getThemePack(normalizePptExportTheme(request.theme));
  const styleId = normalizePresentationStyleId(request.presentationStyle);
  const dialectLabel = request.outputDialect === "smartslide" ? "SmartSlide JSON" : "可编辑 SVG";
  const sources = [
    category.entry.relativePath,
    designSystem.entry.relativePath
  ];
  const brief = compileKimiDesignBrief(request, category, designSystem);
  const categoryLabel = clipAtBoundary(category.entry.title, 120);
  const designSystemLabel = clipAtBoundary(designSystem.entry.title, 160);
  const referenceBudget = Math.max(800, Math.min(6_000, maxChars - 3_600));
  const categoryContract = compactReferenceContract(
    category.entry.content,
    [
      "Core Character",
      "General Prohibitions",
      "Prohibitions",
      "Visual References",
      "Color Palette Reference",
      "Page Rhythm and Information Density",
      "Architecture Diagrams and Flowcharts",
      "Pre-Delivery Checklist"
    ],
    Math.max(280, Math.floor(referenceBudget * 0.38))
  );
  const designSystemContract = compactReferenceContract(
    designSystem.entry.content,
    [
      "Color Palette",
      "Layout Skeleton",
      "Typography",
      "Chart Language",
      "Signature Components",
      "Prohibited",
      "Slide Types and Layouts",
      "Density Baseline",
      "Style Positioning",
      "Content Organization",
      "Content Page Layout System",
      "Fonts and Text Hierarchy",
      "Components and Graphic Elements",
      "Generation Checklist"
    ],
    Math.max(520, Math.floor(referenceBudget * 0.62))
  );

  const prompt = [
    "# Kimi Slides 编译设计指令",
    "原始 Skill 长文已经由系统离线编译。只执行下面这一份结构化蓝图，不要自行复述、混合或扩展参考文档。",
    `最终输出仍必须是 ${dialectLabel}；不要输出 PPTD/YAML 字段，不要提及本知识包。`,
    `参考场景：${categoryLabel}；唯一设计系统：${designSystemLabel}。`,
    "只能使用这一套设计系统的视觉语法；当前主题负责最终色彩，当前页面内容负责事实。",
    `页面：${request.pageType || "content"}；用途：${request.slideGoal || "未指定"}。`,
    `主题：${theme.label}（${theme.description}）；演示风格：${style.label}。`,
    `选择依据：${category.signals.join("；") || "确定性回退"}。`,
    formatKimiDesignBrief(brief),
    "# SCENARIO_CONTRACT",
    categoryContract,
    "# DESIGN_SYSTEM_CONTRACT",
    designSystemContract,
    "冲突处理：页面关系与读者任务决定构图，设计系统决定字体、组件、节奏与质感；不得为了套模板破坏真实关系。",
    "执行顺序：先按 archetype 和 composition 建立真实图形层，再放标题与结论，最后放已经压缩的证据文字。",
    `主要内容组不得超过 ${brief.content.maxMainGroups} 个；正文不得低于 ${brief.typography.body[0]}px，标题不得低于 ${brief.typography.title[0]}px。`,
    "文案必须先改写为完整短句；最终页面不得出现“…”或“...”等可见截断标记。",
    "文字框高度必须贴合实际文字，不得用超高空文本框伪造版面占用；页面下半部不能因为正文过短而出现大片无意义空白。",
    "关系型页面必须输出蓝图要求的节点、路径、箭头、边界或图表；禁止退化为三等分文字栏或内容卡片墙。",
    "不得复制参考样例的品牌名称、具体文案、版权、Logo 或专有图片。",
    `输出 ${dialectLabel} 前检查：主视觉、字阶差、有效画布占用、对齐、层级、关系表达和 forbidden 列表。`
  ]
    .filter(Boolean)
    .join("\n");

  const fittedPrompt = clipAtBoundary(prompt, maxChars);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        root: catalog.root,
        category: category.entry.id,
        designSystem: designSystem.entry.id,
        style: styleId,
        theme: theme.id,
        dialect: request.outputDialect,
        brief,
        prompt: fittedPrompt
      })
    )
    .digest("hex")
    .slice(0, 16);

  return {
    available: true,
    category: {
      id: category.entry.id,
      title: category.entry.title,
      score: category.score,
      signals: category.signals
    },
    designSystem: {
      id: designSystem.entry.id,
      title: designSystem.entry.title,
      score: designSystem.score,
      signals: designSystem.signals
    },
    prompt: fittedPrompt,
    constraints: {
      density: style.density,
      focalPoints: brief.archetype === "hero-statement" ? 1 : style.id === "apple-minimal" ? 1 : 2,
      maxMainGroups: brief.content.maxMainGroups,
      forbiddenPatterns: [...new Set([...brief.forbidden, ...style.forbiddenPatterns])]
    },
    sources,
    fingerprint,
    warnings: catalog.warnings
  };
}
