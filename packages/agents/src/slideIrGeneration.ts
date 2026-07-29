import {
  estimateTextElementHeight,
  SlideIrSchema,
  slideIrJsonSchema,
  type SlideIrDocument,
  type SlideIrElement
} from "@ppt-agent/slide-ir";
import {
  getAccentPresetHex,
  getPresentationStylePreset,
  getThemePack,
  type FactDto,
  type PresentationStyleId,
  type PptExportTheme,
  type SlideDto
} from "@ppt-agent/shared";
import type { SvgGenerationOptions } from "./types.js";
import {
  buildKimiDesignKnowledgeInstruction,
  compileKimiDesignBriefForSlide
} from "./designKnowledge/index.js";

export { slideIrJsonSchema };

function completeClause(value: string, max: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const characters = Array.from(normalized);
  if (characters.length <= max) return normalized;
  const clipped = characters.slice(0, max).join("");
  const boundary = Math.max(
    clipped.lastIndexOf("。"),
    clipped.lastIndexOf("；"),
    clipped.lastIndexOf("，"),
    clipped.lastIndexOf("：")
  );
  if (boundary >= Math.floor(max * 0.55)) {
    return clipped.slice(0, boundary + 1).replace(/[，；：]$/u, "");
  }
  return clipped;
}

function slideContent(slide: SlideDto, facts: FactDto[]) {
  const blocks = slide.planJson?.contentBlocks.filter((block) => block.type !== "summary") ?? [];
  const factContent = facts
    .filter((fact) => slide.sourceFactIds.includes(fact.id))
    .map((fact) => fact.content);
  const items = blocks.length
    ? blocks.map((block) => ({
        title: completeClause(block.title, 18),
        body: completeClause(block.items.filter(Boolean).join("；"), 52)
      }))
    : (slide.contentPoints.length ? slide.contentPoints : factContent).map((point, index) => ({
        title: `要点 ${index + 1}`,
        body: completeClause(point, 52)
      }));
  return items.filter((item) => item.body).slice(0, 3);
}

function text(
  id: string,
  bounds: [number, number, number, number],
  value: string,
  fontSize: number,
  color: string,
  fontWeight = 400,
  align: "left" | "center" | "right" = "left"
): SlideIrElement {
  return {
    id,
    type: "text",
    bounds,
    paragraphs: [
      {
        runs: [{ text: value, fontSize, color, fontWeight }],
        align,
        lineHeight: 1.22
      }
    ],
    verticalAlign: "top",
    autoFit: "shrink"
  };
}

function wrappedText(
  id: string,
  bounds: [number, number, number, number],
  value: string,
  charsPerLine: number,
  fontSize: number,
  color: string,
  fontWeight = 400,
  align: "left" | "center" | "right" = "left"
): SlideIrElement {
  const normalized = value.replace(/\s+/g, " ").trim();
  const characters = Array.from(normalized);
  const lines: string[] = [];
  const closingPunctuation = /^[，。；：、！？,.!?;:）】》」』\])}]$/u;
  const openingPunctuation = /^[（【《「『“‘([{]$/u;
  while (characters.length > 0) {
    const line = characters.splice(0, charsPerLine);
    while (characters[0] === " ") characters.shift();
    while (characters[0] && closingPunctuation.test(characters[0])) {
      line.push(characters.shift()!);
    }
    while (
      line.length > 1 &&
      openingPunctuation.test(line[line.length - 1]!)
    ) {
      characters.unshift(line.pop()!);
    }
    const output = line.join("").trim();
    if (output) lines.push(output);
  }
  return {
    id,
    type: "text",
    bounds,
    paragraphs: (lines.length ? lines : [""]).map((line) => ({
      runs: [{ text: line, fontSize, color, fontWeight }],
      align,
      lineHeight: 1.24,
      spaceAfter: 3
    })),
    verticalAlign: "top",
    autoFit: "shrink"
  };
}

function stagedRoadmapItems(slide: SlideDto, fallback: Array<{ title: string; body: string }>) {
  const blocks = slide.planJson?.contentBlocks
    .filter((block) => !["summary", "callout"].includes(block.type))
    .map((block) => ({
      title: completeClause(block.title.replace(/^\d{1,2}[\s.、-]*/, ""), 10),
      body: completeClause(block.items.find(Boolean) ?? "", 24)
    }))
    .filter((item) => item.body)
    .slice(0, 3);
  return blocks?.length ? blocks : fallback.slice(0, 3);
}

/**
 * 本地、确定性的 IR 设计稿。它既是 mock adapter 的实现，也是模型失败时可观测的
 * 参考样本；不依赖 SVG 字符串，因此能直接编译成可编辑 PPT 元素。
 */
export function createMockSlideIr(
  slide: SlideDto,
  facts: FactDto[],
  theme: PptExportTheme = "white-blue",
  options?: SvgGenerationOptions
): SlideIrDocument {
  const pack = getThemePack(theme);
  const accent = getAccentPresetHex(theme, options?.accentId);
  const tokens = {
    bg: pack.tokens.bg,
    bgSoft: pack.tokens.bgSoft,
    card: pack.tokens.card,
    title: pack.tokens.title,
    body: pack.tokens.body,
    muted: pack.tokens.muted,
    primary: pack.tokens.primary,
    accent,
    accentAlt: pack.tokens.accentAlt,
    border: pack.tokens.border,
    onAccent: pack.tokens.onAccent,
    success: pack.tokens.success,
    risk: pack.tokens.risk,
    warning: pack.tokens.warning
  };
  const title = completeClause(slide.planJson?.title || slide.title, 38);
  const keyMessage = completeClause(slide.planJson?.keyMessage || slide.keyMessage, 74);
  const items = slideContent(slide, facts);
  const fallback = items.length ? items : [{ title: "核心结论", body: keyMessage }];
  const style = options?.presentationStyle ?? "consulting";
  const designBrief = compileKimiDesignBriefForSlide(
    slide,
    theme,
    style,
    "smartslide"
  );
  const elements: SlideIrElement[] = [];

  if (designBrief.archetype === "staged-roadmap") {
    const stages = stagedRoadmapItems(slide, fallback);
    const roadmapThesis = completeClause(
      slide.planJson?.keyMessage || slide.keyMessage,
      60
    );
    const stagePoints: Array<[number, number]> = [
      [536, 430],
      [746, 320],
      [970, 210]
    ];
    const stageCards: Array<[number, number, number, number]> = [
      [510, 430, 190, 164],
      [720, 320, 210, 164],
      [942, 210, 234, 178]
    ];
    elements.push(
      {
        id: "roadmap-accent",
        type: "shape",
        bounds: [72, 50, 68, 4],
        shape: "roundRect",
        radius: 2,
        fill: { color: "$accent" }
      },
      text("slide-title", [72, 76, 920, 62], title, 42, "$title", 700),
      text(
        "roadmap-kicker",
        [72, 146, 360, 24],
        "NARRATIVE ROADMAP",
        14,
        "$accent",
        700
      ),
      {
        id: "thesis-surface",
        type: "shape",
        bounds: [72, 184, 360, 410],
        shape: "roundRect",
        radius: 30,
        fill: { color: "$primary" }
      },
      text("thesis-label", [108, 224, 280, 26], "核心判断", 14, "$onAccent", 700),
      wrappedText(
        "key-message",
        [108, 278, 286, 214],
        roadmapThesis,
        10,
        22,
        "$onAccent",
        700
      ),
      text(
        "thesis-note",
        [108, 530, 270, 30],
        "先确定边界，再沿路径完成核验与行动",
        16,
        "$onAccent",
        400
      ),
      {
        id: "roadmap-field",
        type: "shape",
        bounds: [476, 184, 732, 410],
        shape: "roundRect",
        radius: 30,
        fill: { color: "$bgSoft" }
      },
      text("roadmap-label", [516, 216, 260, 24], "三阶段推进路径", 14, "$muted", 700),
      {
        id: "roadmap-connector-1",
        type: "line",
        points: [stagePoints[0], stagePoints[1]],
        stroke: { color: "$accent", width: 3 },
        markerEnd: "arrow"
      },
      {
        id: "roadmap-connector-2",
        type: "line",
        points: [stagePoints[1], stagePoints[2]],
        stroke: { color: "$accent", width: 3 },
        markerEnd: "arrow"
      }
    );
    stages.forEach((item, index) => {
      const [cx, cy] = stagePoints[index] ?? stagePoints[stagePoints.length - 1]!;
      const [cardX, cardY, cardWidth, cardHeight] =
        stageCards[index] ?? stageCards[stageCards.length - 1]!;
      const textX = cardX + 38;
      const textWidth = cardWidth - 52;
      elements.push(
        {
          id: `stage-card-${index + 1}`,
          type: "shape",
          bounds: [cardX, cardY, cardWidth, cardHeight],
          shape: "roundRect",
          radius: 20,
          fill: { color: index === 2 ? "$card" : "$bg" },
          stroke: {
            color: index === 2 ? "$primary" : "$border",
            width: index === 2 ? 2 : 1.25
          }
        },
        {
          id: `stage-node-${index + 1}`,
          type: "shape",
          bounds: [cx - 27, cy - 27, 54, 54],
          shape: "ellipse",
          fill: { color: index === 2 ? "$primary" : "$card" },
          stroke: { color: index === 2 ? "$primary" : "$accent", width: 3 }
        },
        text(
          `stage-number-${index + 1}`,
          [cx - 22, cy - 13, 44, 26],
          String(index + 1).padStart(2, "0"),
          14,
          index === 2 ? "$onAccent" : "$accent",
          700,
          "center"
        ),
        wrappedText(
          `stage-title-${index + 1}`,
          [textX, cardY + 28, textWidth, 50],
          item.title,
          index === 0 ? 7 : 9,
          20,
          "$title",
          700
        ),
        wrappedText(
          `stage-body-${index + 1}`,
          [textX, cardY + 80, textWidth, cardHeight - 90],
          item.body,
          index === 0 ? 8 : index === 1 ? 9 : 11,
          16,
          "$body",
          400
        )
      );
    });
  } else if (style === "apple-minimal") {
    elements.push(
      {
        id: "title-accent",
        type: "shape",
        bounds: [88, 64, 58, 4],
        shape: "roundRect",
        radius: 2,
        fill: { color: "$accent" }
      },
      text("slide-title", [88, 94, 1080, 130], title, 52, "$title", 700),
      text("key-message", [88, 242, 1030, 76], keyMessage, 27, "$body", 500),
      {
        id: "focus-surface",
        type: "shape",
        bounds: [72, 382, 1136, 250],
        shape: "roundRect",
        radius: 32,
        fill: { color: "$bgSoft" }
      }
    );
    fallback.forEach((item, index) => {
      const columnWidth = 330;
      const x = 104 + index * 365;
      elements.push(
        text(`focus-index-${index + 1}`, [x, 424, 48, 28], `0${index + 1}`, 14, "$accent", 700),
        text(`focus-title-${index + 1}`, [x, 466, columnWidth, 52], item.title, 23, "$title", 700),
        text(`focus-body-${index + 1}`, [x, 530, columnWidth, 70], item.body, 17, "$muted", 400)
      );
    });
  } else if (style === "data-story") {
    const lead = fallback[0]!;
    elements.push(
      text("slide-title", [72, 64, 780, 64], title, 38, "$title", 700),
      text("key-message", [72, 140, 1080, 48], keyMessage, 19, "$muted", 500),
      {
        id: "lead-panel",
        type: "shape",
        bounds: [72, 230, 450, 410],
        shape: "roundRect",
        radius: 26,
        fill: { color: "$primary" }
      },
      text("lead-label", [108, 276, 330, 28], "关键证据", 15, "$onAccent", 700),
      text("lead-title", [108, 332, 350, 100], lead.title, 34, "$onAccent", 700),
      text("lead-body", [108, 466, 350, 110], lead.body, 21, "$onAccent", 400)
    );
    fallback.slice(1).forEach((item, index) => {
      const y = 230 + index * 214;
      elements.push(
        {
          id: `evidence-${index + 1}`,
          type: "shape",
          bounds: [558, y, 650, 196],
          shape: "roundRect",
          radius: 22,
          fill: { color: "$card" },
          stroke: { color: "$border", width: 1.25 }
        },
        {
          id: `evidence-accent-${index + 1}`,
          type: "shape",
          bounds: [590, y + 28, 54, 4],
          shape: "roundRect",
          radius: 2,
          fill: { color: index === 0 ? "$accent" : "$accentAlt" }
        },
        text(`evidence-title-${index + 1}`, [590, y + 52, 550, 42], item.title, 23, "$title", 700),
        text(`evidence-body-${index + 1}`, [590, y + 106, 550, 58], item.body, 17, "$body", 400)
      );
    });
  } else if (style === "tech-architecture") {
    const nodes = fallback.slice(0, 3).map((item, index) => ({
      title: completeClause(item.title, index === 1 ? 18 : 12),
      body: completeClause(item.body, index === 1 ? 46 : 24)
    }));
    const nodeBounds: Array<[number, number, number, number]> = [
      [116, 336, 250, 180],
      [448, 298, 380, 236],
      [914, 336, 250, 180]
    ];
    elements.push(
      {
        id: "architecture-accent",
        type: "shape",
        bounds: [72, 48, 64, 4],
        shape: "rect",
        fill: { color: "$accent" }
      },
      text(
        "architecture-kicker",
        [72, 66, 420, 22],
        "SYSTEM ARCHITECTURE / CONTROLLED BOUNDARY",
        13,
        "$accent",
        700
      ),
      text("slide-title", [72, 94, 980, 58], title, 40, "$title", 700),
      text("key-message", [72, 160, 1080, 52], keyMessage, 19, "$muted", 500),
      {
        id: "system-boundary",
        type: "shape",
        bounds: [72, 236, 1136, 352],
        shape: "rect",
        fill: { color: "$bgSoft" },
        stroke: { color: "$border", width: 2 }
      },
      text(
        "boundary-label",
        [96, 254, 360, 22],
        "CONTROLLED SYSTEM BOUNDARY / 受控系统边界",
        13,
        "$accent",
        700
      ),
      {
        id: "connector-1",
        type: "line",
        points: [
          [366, 418],
          [448, 418]
        ],
        stroke: { color: "$accent", width: 3 },
        markerEnd: "arrow"
      },
      {
        id: "connector-2",
        type: "line",
        points: [
          [828, 418],
          [914, 418]
        ],
        stroke: { color: "$accent", width: 3 },
        markerEnd: "arrow"
      }
    );
    nodes.forEach((item, index) => {
      const [x, y, width, height] =
        nodeBounds[index] ?? nodeBounds[nodeBounds.length - 1]!;
      const isDominant = index === 1;
      elements.push(
        {
          id: `node-${index + 1}`,
          type: "shape",
          bounds: [x, y, width, height],
          shape: "rect",
          fill: { color: "$card" },
          stroke: {
            color: isDominant ? "$accent" : "$border",
            width: isDominant ? 3 : 1.5
          }
        },
        text(
          `node-index-${index + 1}`,
          [x + 22, y + 18, 52, 22],
          `0${index + 1}`,
          13,
          "$accent",
          700
        ),
        text(
          `node-title-${index + 1}`,
          [x + 22, y + (isDominant ? 56 : 46), width - 44, isDominant ? 60 : 50],
          item.title,
          isDominant ? 24 : 20,
          "$title",
          700
        ),
        text(
          `node-body-${index + 1}`,
          [x + 22, y + (isDominant ? 130 : 108), width - 44, isDominant ? 78 : 60],
          item.body,
          isDominant ? 18 : 17,
          "$body",
          400
        )
      );
    });
    elements.push(
      text(
        "architecture-footer",
        [72, 628, 1136, 22],
        "输入 → 受控处理 → 最小权限数据出口",
        13,
        "$muted",
        500,
        "center"
      )
    );
  } else if (style === "editorial") {
    const lead = fallback[0]!;
    elements.push(
      {
        id: "editorial-rule",
        type: "shape",
        bounds: [72, 64, 6, 540],
        shape: "roundRect",
        radius: 3,
        fill: { color: "$accent" }
      },
      text("slide-title", [112, 72, 470, 170], title, 45, "$title", 700),
      text("key-message", [112, 270, 410, 130], keyMessage, 22, "$body", 500),
      {
        id: "feature-panel",
        type: "shape",
        bounds: [606, 72, 602, 420],
        shape: "roundRect",
        radius: 28,
        fill: { color: "$bgSoft" }
      },
      text("feature-kicker", [650, 118, 450, 28], "FEATURE", 14, "$accent", 700),
      text("feature-title", [650, 176, 470, 92], lead.title, 34, "$title", 700),
      text("feature-body", [650, 306, 470, 120], lead.body, 20, "$body", 400)
    );
    fallback.slice(1).forEach((item, index) => {
      const x = 112 + index * 548;
      elements.push(
        text(`editorial-index-${index + 1}`, [x, 510, 40, 26], `0${index + 2}`, 14, "$accentAlt", 700),
        text(`editorial-title-${index + 1}`, [x, 548, 470, 36], item.title, 21, "$title", 700),
        text(`editorial-body-${index + 1}`, [x, 594, 470, 54], item.body, 16, "$muted", 400)
      );
    });
  } else {
    const cardWidth = fallback.length === 1 ? 1136 : fallback.length === 2 ? 552 : 357;
    const gap = 28;
    const cardStart = 72;
    elements.push(
      {
        id: "header-soft",
        type: "shape",
        bounds: [48, 40, 1184, 170],
        shape: "roundRect",
        radius: 24,
        fill: { color: "$bgSoft" }
      },
      {
        id: "title-accent",
        type: "shape",
        bounds: [72, 66, 72, 5],
        shape: "roundRect",
        radius: 3,
        fill: { color: "$accent" }
      },
      text("slide-title", [72, 86, 870, 66], title, 36, "$title", 700),
      text("key-message", [72, 158, 1080, 38], keyMessage, 18, "$muted", 500)
    );
    fallback.forEach((item, index) => {
      const x = cardStart + index * (cardWidth + gap);
      const seriesColor = index === 0 ? "$primary" : index === 1 ? "$accentAlt" : "$success";
      elements.push(
        {
          id: `card-${index + 1}`,
          type: "shape",
          bounds: [x, 246, cardWidth, 390],
          shape: "roundRect",
          radius: 22,
          fill: { color: "$card" },
          stroke: { color: "$border", width: 1.5 }
        },
        {
          id: `card-accent-${index + 1}`,
          type: "shape",
          bounds: [x + 24, 272, 62, 4],
          shape: "roundRect",
          radius: 2,
          fill: { color: seriesColor }
        },
        text(`card-index-${index + 1}`, [x + 24, 294, 44, 28], String(index + 1).padStart(2, "0"), 15, seriesColor, 700),
        text(`card-title-${index + 1}`, [x + 24, 332, cardWidth - 48, 64], item.title, 24, "$title", 700),
        text(`card-body-${index + 1}`, [x + 24, 414, cardWidth - 48, 154], item.body, 18, "$body", 400)
      );
    });
  }

  return SlideIrSchema.parse({
    schema: "smartslide/1",
    pageType: slide.recommendedLayout === "cover" ? "cover" : "content",
    canvas: { width: 1280, height: 720 },
    theme: {
      tokens,
      fonts: {
        heading: "Arial",
        body: "Arial",
        mono: "Menlo"
      }
    },
    background: { color: "$bg" },
    elements,
    metadata: {
      title,
      description: keyMessage,
      locale: "zh-CN"
    }
  });
}

export interface SlideIrVisualQualityResult {
  ok: boolean;
  issues: string[];
}

function textRuns(element: Extract<SlideIrElement, { type: "text" }>) {
  return element.paragraphs.flatMap((paragraph) => paragraph.runs);
}

function textValue(element: Extract<SlideIrElement, { type: "text" }>) {
  return textRuns(element).map((run) => run.text).join("");
}

export function validateSlideIrVisualQuality(
  document: SlideIrDocument,
  slide: SlideDto,
  presentationStyle?: PresentationStyleId | string | null
): SlideIrVisualQualityResult {
  const brief = compileKimiDesignBriefForSlide(
    slide,
    undefined,
    presentationStyle,
    "smartslide"
  );
  const textElements = document.elements.filter(
    (element): element is Extract<SlideIrElement, { type: "text" }> => element.type === "text"
  );
  const issues: string[] = [];
  const titleElement =
    textElements.find((element) => element.id === "slide-title") ??
    textElements.find((element) => /title/i.test(element.id));
  const titleSize = titleElement
    ? Math.max(0, ...textRuns(titleElement).map((run) => run.fontSize))
    : 0;
  if (!titleElement || titleSize < brief.typography.title[0]) {
    issues.push(`主标题字号必须至少 ${brief.typography.title[0]}px，当前为 ${titleSize || "缺失"}`);
  }

  const smallBodyIds = textElements
    .filter((element) => {
      if (/(footer|source|page|breadcrumb|kicker|label|tag|index|number|num)/i.test(element.id)) {
        return false;
      }
      if (textValue(element).trim().length < 12) return false;
      return textRuns(element).some((run) => run.fontSize < brief.typography.body[0]);
    })
    .map((element) => element.id);
  if (smallBodyIds.length) {
    issues.push(
      `正文不得小于 ${brief.typography.body[0]}px：${smallBodyIds.slice(0, 5).join("、")}`
    );
  }

  const visiblyTruncatedIds = textElements
    .filter((element) => {
      if (/(footer|source|page|breadcrumb)/i.test(element.id)) return false;
      return /(?:…|\.{3})\s*$/u.test(textValue(element).trim());
    })
    .map((element) => element.id);
  if (visiblyTruncatedIds.length) {
    issues.push(
      `不得显示截断省略号；请把文案改写为完整短句：${visiblyTruncatedIds
        .slice(0, 5)
        .join("、")}`
    );
  }

  const overflowingText = textElements.flatMap((element) => {
    const estimatedHeight = estimateTextElementHeight(element);
    return estimatedHeight > element.bounds[3] + 4
      ? [
          `${element.id}（预计 ${Math.ceil(estimatedHeight)}px，可用 ${Math.round(
            element.bounds[3]
          )}px）`
        ]
      : [];
  });
  if (overflowingText.length) {
    issues.push(
      `文字溢出文本框；请先压缩为完整短句或在安全区内增大文字区域：${overflowingText
        .slice(0, 5)
        .join("、")}`
    );
  }

  const oversizedTextBoxes = textElements
    .filter((element) => {
      if (/(footer|source|page)/i.test(element.id)) return false;
      const estimated = estimateTextElementHeight(element);
      return element.bounds[3] >= 180 && element.bounds[3] > Math.max(180, estimated * 2.8);
    })
    .map((element) => element.id);
  if (oversizedTextBoxes.length) {
    issues.push(
      `文字框高度必须贴合内容，禁止用空框制造大片空白：${oversizedTextBoxes
        .slice(0, 4)
        .join("、")}`
    );
  }

  if (brief.archetype === "staged-roadmap") {
    const columnCandidates = textElements.filter((element) => {
      const [, y, width] = element.bounds;
      return y >= 190 && width >= 280 && width <= 430 && textValue(element).length >= 12;
    });
    const equalColumnCount = columnCandidates.filter((element, _, items) => {
      const [, y, width] = element.bounds;
      return (
        items.filter(
          (other) =>
            Math.abs(other.bounds[1] - y) <= 60 &&
            Math.abs(other.bounds[2] - width) <= 36
        ).length >= 3
      );
    }).length;
    if (equalColumnCount >= 3) {
      issues.push("导航/时间线页面禁止退化为三等分文字栏，必须使用阶段路径和节点建立递进关系");
    }
    const stageNodes = document.elements.filter(
      (element) =>
        element.type === "shape" &&
        (element.shape === "ellipse" || /(stage|node|milestone)/i.test(element.id))
    ).length;
    const arrowConnectors = document.elements.filter(
      (element) => element.type === "line" && element.markerEnd === "arrow"
    ).length;
    if (stageNodes < 3 || arrowConnectors < 2) {
      issues.push("staged-roadmap 必须包含至少 3 个阶段节点和 2 条箭头连接线");
    }
  }

  if (brief.archetype === "system-map") {
    const shapes = document.elements.filter(
      (element): element is Extract<SlideIrElement, { type: "shape" }> =>
        element.type === "shape"
    );
    const boundary = shapes.find(
      (element) =>
        /boundary|system-field|trust-zone/i.test(element.id) ||
        (element.bounds[2] >= 700 && element.bounds[3] >= 240)
    );
    const connectors = document.elements.filter(
      (element) => element.type === "line" && element.markerEnd === "arrow"
    );
    const nodes = shapes.filter(
      (element) =>
        element !== boundary &&
        /node|service|component|gateway|database|engine|layer/i.test(element.id) &&
        element.bounds[2] >= 100 &&
        element.bounds[3] >= 60
    );
    if (!boundary) {
      issues.push("system-map 必须包含一个可见的系统或信任边界");
    }
    if (connectors.length < 2) {
      issues.push("system-map 必须包含至少 2 条带方向的连接线");
    }
    if (nodes.length < 3) {
      issues.push("system-map 必须包含至少 3 个有明确职责的系统节点");
    } else {
      const nodeAreas = nodes.map((element) => element.bounds[2] * element.bounds[3]);
      const smallest = Math.min(...nodeAreas);
      const largest = Math.max(...nodeAreas);
      if (largest < smallest * 1.2) {
        issues.push("system-map 禁止退化为三个等权卡片；必须突出一个主处理节点并建立输入/输出层级");
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues: [...new Set(issues)]
  };
}

export const slideIrSystemPrompt = `你是专业的演示文稿版式引擎。你只输出满足 SmartSlide JSON Schema 的 JSON 对象。

硬规则：
1. 画布固定 1280×720；所有 bounds 和 line.points 必须在画布内。
2. elements 数组顺序就是图层顺序：背景和连接线在前，文字在后。
3. 文字字号正文至少 16，标题 40–48；控制字数并让文本框高度贴合实际内容，autoFit 使用 shrink；输出前逐个估算文字高度，不得把溢出留给渲染器。
4. 优先留白、短顶部细线、关键词着色；禁止附着式整高强调色条，禁止装饰压住文字。
5. theme.tokens 的值必须全部是六位十六进制字面量（例如 #25313C），禁止 rgb()/rgba()/hsl()、八位 HEX 或 $token 引用；只有元素颜色可以使用已声明的 $token。
6. 不输出 SVG、CSS、HTML、Markdown，也不输出解释。
7. 同一页最多 3 个主要内容组，连接线不得穿过任何文字框。
8. 每个元素 id 唯一，使用英文字母、数字、下划线或连字符。`;

export function buildSlideIrPrompt(
  slide: SlideDto,
  facts: FactDto[],
  theme: PptExportTheme = "white-blue",
  options?: SvgGenerationOptions
) {
  const reference = createMockSlideIr(slide, facts, theme, options);
  const style = getPresentationStylePreset(options?.presentationStyle);
  const kimiDesignKnowledge = buildKimiDesignKnowledgeInstruction(
    slide,
    theme,
    options?.presentationStyle,
    "smartslide"
  );
  const relevantFacts = facts
    .filter((fact) => slide.sourceFactIds.includes(fact.id))
    .slice(0, 8)
    .map((fact) => ({ category: fact.category, content: fact.content }));
  const repairInstruction = options?.revisionNotes?.length
    ? [
        "上一候选未通过视觉质量门禁。必须以原稿为基础定向修复，不得继续沿用失败的构图模式。",
        `需要修复：${options.revisionNotes.join("；")}`,
        options.previousSlideIr
          ? `上一候选 SmartSlide（保留正确内容，只修改失败的版式、字号和视觉关系）：\n${options.previousSlideIr}`
          : ""
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  return [
    "请生成一页 SmartSlide JSON 设计稿。",
    `页面标题：${slide.planJson?.title || slide.title}`,
    `核心结论：${slide.planJson?.keyMessage || slide.keyMessage}`,
    `用途：${slide.slideGoal}`,
    `推荐布局：${slide.recommendedLayout}`,
    `演示风格：${style.id}（${style.label}）`,
    `风格构图：${style.composition}`,
    `排版层级：${style.typography}`,
    `信息密度：${style.density}`,
    `风格禁止项：${style.forbiddenPatterns.join("、")}`,
    `主题：${theme}`,
    kimiDesignKnowledge,
    repairInstruction,
    `内容块：${JSON.stringify(slide.planJson?.contentBlocks ?? [])}`,
    `事实：${JSON.stringify(relevantFacts)}`,
    "下面是与 DESIGN_BLUEPRINT 匹配的 SmartSlide 参考骨架。保留它的非对称比例、主视觉关系和字号层级，只替换或压缩内容；不得重新退化为默认等分栏：",
    JSON.stringify(reference)
  ]
    .filter(Boolean)
    .join("\n");
}

const literalHexColor = /^#[0-9a-f]{6}$/i;

export function normalizeSlideIr(
  input: unknown,
  theme: PptExportTheme = "white-blue"
): SlideIrDocument {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return SlideIrSchema.parse(input);
  }
  const candidate = input as Record<string, unknown>;
  const candidateTheme = candidate.theme;
  if (!candidateTheme || typeof candidateTheme !== "object" || Array.isArray(candidateTheme)) {
    return SlideIrSchema.parse(input);
  }
  const themeRecord = candidateTheme as Record<string, unknown>;
  const candidateTokens = themeRecord.tokens;
  if (!candidateTokens || typeof candidateTokens !== "object" || Array.isArray(candidateTokens)) {
    return SlideIrSchema.parse(input);
  }

  const repairedTokens: Record<string, unknown> = {
    ...(candidateTokens as Record<string, unknown>)
  };
  const { series: _series, ...fallbackTokens } = getThemePack(theme).tokens;
  for (const [name, fallback] of Object.entries(fallbackTokens)) {
    const value = repairedTokens[name];
    if (typeof value !== "string" || !literalHexColor.test(value)) {
      repairedTokens[name] = fallback;
    }
  }

  return SlideIrSchema.parse({
    ...candidate,
    theme: {
      ...themeRecord,
      tokens: repairedTokens
    }
  });
}
