import assert from "node:assert/strict";
import test from "node:test";
import { renderSlideIrToSvg, stringifySmartSlide, validateSlideIr } from "@ppt-agent/slide-ir";
import type { SlideDto } from "@ppt-agent/shared";
import {
  buildSlideIrPrompt,
  createMockSlideIr,
  normalizeSlideIr,
  slideIrJsonSchema,
  validateSlideIrVisualQuality
} from "./slideIrGeneration.js";

const slide: SlideDto = {
  id: "slide-1",
  projectId: "project-1",
  sortOrder: 1,
  title: "结构化设计语言",
  slideGoal: "说明 SmartSlide 的价值",
  keyMessage: "同一份结构化源码可以生成网页预览与原生可编辑 PPTX。",
  contentPoints: [
    "严格 schema 限制模型输出",
    "SVG 只负责预览",
    "PPTX 直接映射原生对象"
  ],
  recommendedLayout: "three-column",
  status: "planned",
  isContentLocked: false,
  isLayoutLocked: false,
  sourceFactIds: [],
  planJson: {
    title: "结构化设计语言",
    pageGoal: "说明 SmartSlide 的价值",
    keyMessage: "同一份结构化源码可以生成网页预览与原生可编辑 PPTX。",
    layoutType: "three-column",
    contentBlocks: [
      { type: "bullets", title: "约束", items: ["严格 schema 限制模型输出"] },
      { type: "bullets", title: "预览", items: ["SVG 只负责预览"] },
      { type: "bullets", title: "导出", items: ["PPTX 直接映射原生对象"] }
    ],
    sourceFactIds: []
  },
  generationStatus: "draft-ready",
  renderStrategy: "svg"
};

test("mock SmartSlide is schema-valid, visually renderable, and serializable", () => {
  const document = createMockSlideIr(slide, [], "white-blue", {
    presentationStyle: "apple-minimal"
  });
  assert.equal(validateSlideIr(document).ok, true);
  assert.equal(normalizeSlideIr(document).schema, "smartslide/1");
  assert.match(renderSlideIrToSvg(document), /^<svg\b/);
  assert.match(stringifySmartSlide(document), /schema: smartslide\/1/);
});

test("normalization repairs invalid model-generated theme token colors from the selected theme", () => {
  const document = createMockSlideIr(slide, [], "white-blue", {
    presentationStyle: "apple-minimal"
  });
  const invalid = structuredClone(document) as unknown as {
    theme: { tokens: Record<string, string> };
  };
  invalid.theme.tokens.body = "rgb(37, 49, 60)";
  invalid.theme.tokens.accent = "$accent";

  const normalized = normalizeSlideIr(invalid, "white-blue");

  assert.equal(normalized.theme.tokens.body, "#25313C");
  assert.equal(normalized.theme.tokens.accent, "#0066CC");
});

test("normalization force-overrides all tokens with the selected theme pack values", () => {
  const document = createMockSlideIr(slide, [], "white-blue", {
    presentationStyle: "apple-minimal"
  });
  const custom = structuredClone(document);
  custom.theme.tokens.body = "#123456";
  // 新行为：即使模型输出了合法的 hex 色，也强制用主题 tokens 覆盖，
  // 确保切换主题时颜色始终正确。
  assert.equal(normalizeSlideIr(custom, "white-blue").theme.tokens.body, "#25313C");

  const structurallyInvalid = structuredClone(document) as unknown as {
    canvas: { width: number; height: number };
  };
  structurallyInvalid.canvas.width = 960;
  assert.throws(() => normalizeSlideIr(structurallyInvalid, "white-blue"));
});

test("SmartSlide visual gate does not falsely flag a mixed English-Chinese title that fits", () => {
  const document = createMockSlideIr(slide, [], "white-blue", {
    presentationStyle: "apple-minimal"
  });
  document.elements.push({
    id: "node-3-title",
    type: "text",
    bounds: [888, 236, 320, 32],
    paragraphs: [
      {
        runs: [
          {
            text: "3. PostgreSQL 隔离双库",
            fontSize: 22,
            fontWeight: 700,
            color: "$title"
          }
        ],
        align: "left"
      }
    ],
    verticalAlign: "top",
    autoFit: "shrink"
  });

  const contractOverflow = validateSlideIr(document).issues.filter(
    (issue) => issue.code === "text-overflow" && issue.elementId === "node-3-title"
  );
  assert.equal(contractOverflow.length, 0);

  const visual = validateSlideIrVisualQuality(document, slide, "apple-minimal");
  assert.equal(visual.issues.some((issue) => issue.includes("node-3-title")), false);
});

test("IR prompt carries style, layout, and a complete reference document", () => {
  const prompt = buildSlideIrPrompt(slide, [], "white-blue", {
    presentationStyle: "data-story"
  });
  assert.match(prompt, /演示风格：data-story/);
  assert.match(prompt, /推荐布局：three-column/);
  assert.match(prompt, /"schema":"smartslide\/1"/);
  assert.equal(slideIrJsonSchema.type, "object");
});

test("each presentation style produces a distinct valid SmartSlide composition", () => {
  const styles = [
    "apple-minimal",
    "consulting",
    "data-story",
    "tech-architecture",
    "editorial"
  ] as const;
  const documents = styles.map((presentationStyle) =>
    createMockSlideIr(slide, [], "white-blue", { presentationStyle })
  );

  documents.forEach((document) => {
    assert.equal(validateSlideIr(document).ok, true);
  });
  const elementSignatures = documents.map((document) =>
    document.elements.map((element) => element.id).join(",")
  );
  assert.equal(new Set(elementSignatures).size, styles.length);
  assert.ok(
    documents[styles.indexOf("tech-architecture")]?.elements.some(
      (element) => element.type === "line"
    )
  );
});

test("科技架构参考骨架遵守 system-map 蓝图，不退化成三等分卡片且长文案不溢出", () => {
  const architectureSlide: SlideDto = {
    ...slide,
    title: "职责分离构成系统的基础安全边界",
    slideGoal: "解释系统边界、节点职责与调用关系",
    keyMessage:
      "系统以统一入口、专职渲染与数据域分离建立安全边界，调用方向和受控范围必须在同一张图中清晰可见。",
    recommendedLayout: "architecture",
    planJson: {
      title: "职责分离构成系统的基础安全边界",
      pageGoal: "解释系统边界、节点职责与调用关系",
      keyMessage:
        "系统以统一入口、专职渲染与数据域分离建立安全边界，调用方向和受控范围必须在同一张图中清晰可见。",
      layoutType: "architecture",
      contentBlocks: [
        {
          type: "point",
          title: "入口层 · FastAPI",
          items: ["集中承接用户请求和身份校验，并将受控任务下发给专职渲染服务。"]
        },
        {
          type: "point",
          title: "渲染层 · Node.js",
          items: ["专职执行 PPT 渲染与计算逻辑，通过内部受控接口读取必要数据。"]
        },
        {
          type: "point",
          title: "数据层 · PostgreSQL",
          items: ["按数据域隔离存储并执行最小权限审计，阻断横向越权和故障扩散。"]
        }
      ],
      visualHint: {
        heroVisual: "one dominant processing node inside an explicit system boundary",
        chartType: "process"
      },
      sourceFactIds: []
    }
  };

  const document = createMockSlideIr(architectureSlide, [], "growth-energy", {
    presentationStyle: "tech-architecture"
  });
  const contractIssues = validateSlideIr(document).issues;
  const visual = validateSlideIrVisualQuality(
    document,
    architectureSlide,
    "tech-architecture"
  );
  const nodes = document.elements.filter(
    (element) => element.type === "shape" && /^node-\d+$/.test(element.id)
  );

  assert.equal(contractIssues.some((issue) => issue.code === "text-overflow"), false);
  assert.equal(visual.ok, true, visual.issues.join("；"));
  assert.ok(
    document.elements.some(
      (element) => element.type === "shape" && element.id === "system-boundary"
    )
  );
  assert.ok(document.elements.filter((element) => element.type === "line").length >= 2);
  assert.equal(nodes.length, 3);
  assert.ok(
    Math.max(...nodes.map((element) => element.bounds[2] * element.bounds[3])) >
      Math.min(...nodes.map((element) => element.bounds[2] * element.bounds[3])) * 1.25
  );
  const renderedCopy = document.elements
    .filter((element) => element.type === "text")
    .flatMap((element) => element.paragraphs)
    .flatMap((paragraph) => paragraph.runs)
    .map((run) => run.text)
    .join("\n");
  assert.doesNotMatch(renderedCopy, /(?:…|\.{3})\s*$/m);
});

const tocSlide: SlideDto = {
  ...slide,
  title: "从架构边界出发，依次审视进展、风险与下一步",
  slideGoal: "建立全篇导航",
  keyMessage: "先看边界是否可收敛，再确认下一步要修哪些闭环。",
  recommendedLayout: "toc",
  planJson: {
    title: "安全梳理导航：从边界到风险再到行动",
    pageGoal: "建立全篇导航",
    keyMessage: "先看边界是否可收敛，再确认下一步要修哪些闭环。",
    layoutType: "toc",
    contentBlocks: [
      { type: "bullets", title: "01 架构边界", items: ["统一入口与职责隔离"] },
      { type: "bullets", title: "02 进展确认", items: ["把结论转成可复核指标"] },
      { type: "bullets", title: "03 核心风险", items: ["限流、清洗、轮换与审计"] }
    ],
    visualHint: {
      chartType: "timeline",
      heroVisual: "横向章节轨道，三个阶段节点沿路径递进"
    },
    sourceFactIds: []
  }
};

test("视觉质量门禁拒绝 toc 页面退化成小字号三等分文字栏", () => {
  const badDocument = normalizeSlideIr({
    schema: "smartslide/1",
    pageType: "content",
    canvas: { width: 1280, height: 720 },
    theme: {
      tokens: {
        bg: "#FFFFFF",
        surface: "#F4F7FA",
        title: "#0A192F",
        body: "#2D3748",
        accent: "#0052CC",
        border: "#DCE3EA"
      },
      fonts: { heading: "Arial", body: "Arial", mono: "Menlo" }
    },
    background: { color: "$bg" },
    elements: [
      {
        id: "slide-title",
        type: "text",
        bounds: [60, 60, 1160, 44],
        paragraphs: [
          {
            runs: [
              {
                text: "安全梳理导航：从边界到风险再到行动",
                fontSize: 32,
                fontWeight: 700,
                color: "$title"
              }
            ]
          }
        ]
      },
      {
        id: "summary-bg",
        type: "shape",
        bounds: [60, 126, 1160, 54],
        shape: "rect",
        fill: { color: "$surface" }
      },
      ...[60, 456, 852].map((x, index) => ({
        id: `col${index + 1}-body`,
        type: "text" as const,
        bounds: [x, 262, 366, 380] as [number, number, number, number],
        paragraphs: [
          {
            runs: [
              {
                text: `第 ${index + 1} 段使用大量小字描述，而不是视觉化阶段节点。`,
                fontSize: 14,
                fontWeight: 400,
                color: "$body"
              }
            ]
          }
        ]
      }))
    ],
    metadata: {
      title: "安全梳理导航",
      description: "失败样例",
      locale: "zh-CN"
    }
  });

  const result = validateSlideIrVisualQuality(badDocument, tocSlide, "consulting");
  assert.equal(result.ok, false);
  assert.match(result.issues.join("；"), /标题字号.*40/);
  assert.match(result.issues.join("；"), /正文.*16/);
  assert.match(result.issues.join("；"), /三等分文字栏|阶段路径/);
});

test("toc Prompt 使用结构化阶段路径蓝图而不是注入整篇 Skill 长文", () => {
  const prompt = buildSlideIrPrompt(tocSlide, [], "white-blue", {
    presentationStyle: "consulting"
  });
  assert.match(prompt, /DESIGN_BLUEPRINT/);
  assert.match(prompt, /staged-roadmap/);
  assert.doesNotMatch(prompt, /# PPT category guide/);
  assert.doesNotMatch(prompt, /Solid, compact content with extremely high-density layout/);
});

test("toc 参考骨架没有文字溢出或连接线穿过业务文字", () => {
  const longCopySlide: SlideDto = {
    ...tocSlide,
    keyMessage:
      "将安全判断拆成架构边界、进展核验、核心风险与后续验证四段，先看边界是否收敛，再确认下一步要修哪些闭环。",
    planJson: {
      ...tocSlide.planJson!,
      keyMessage:
        "将安全判断拆成架构边界、进展核验、核心风险与后续验证四段，先看边界是否收敛，再确认下一步要修哪些闭环。",
      contentBlocks: [
        {
          type: "bullets",
          title: "01 架构边界",
          items: ["FastAPI 作为统一入口负责身份与权限，降低无关模块直接接触核心资源的可能性。"]
        },
        {
          type: "bullets",
          title: "02 进展确认",
          items: ["已形成较完整的安全评估材料，当前基础结论可以作为下一轮复核起点。"]
        },
        {
          type: "bullets",
          title: "03 核心风险",
          items: ["AI 账单耗尽、SVG XSS 与内部高权限密钥需要按优先级治理。"]
        }
      ]
    }
  };
  const document = createMockSlideIr(longCopySlide, [], "white-blue", {
    presentationStyle: "consulting"
  });
  const issues = validateSlideIr(document).issues;
  assert.equal(issues.some((issue) => issue.code === "text-overflow"), false);
  assert.equal(
    issues.some(
      (issue) =>
        issue.code === "connector-crosses-text" &&
        !/stage-number/.test(issue.message)
    ),
    false
  );
  const renderedCopy = document.elements
    .filter((element) => element.type === "text")
    .flatMap((element) => element.paragraphs)
    .flatMap((paragraph) => paragraph.runs)
    .map((run) => run.text)
    .join("\n");
  assert.doesNotMatch(renderedCopy, /(?:…|\.{3})\s*$/m);
  assert.doesNotMatch(renderedCopy, /^[，。；：、！？）】]/m);
});

test("视觉质量门禁拒绝正文溢出和可见截断标记", () => {
  const document = createMockSlideIr(tocSlide, [], "white-blue", {
    presentationStyle: "consulting"
  });
  const keyMessage = document.elements.find(
    (element) => element.type === "text" && element.id === "key-message"
  );
  assert.ok(keyMessage && keyMessage.type === "text");
  keyMessage.bounds[3] = 18;
  keyMessage.paragraphs = [
    {
      runs: [
        {
          text: "这是一句被强行截断的结论…",
          fontSize: 22,
          color: "$onAccent",
          fontWeight: 700
        }
      ],
      lineHeight: 1.24
    }
  ];

  const result = validateSlideIrVisualQuality(document, tocSlide, "consulting");
  assert.equal(result.ok, false);
  assert.match(result.issues.join("；"), /文字溢出/);
  assert.match(result.issues.join("；"), /截断省略号/);
});

test("第二轮 SmartSlide 修复携带上一候选源码", () => {
  const previous = createMockSlideIr(tocSlide, [], "white-blue", {
    presentationStyle: "consulting"
  });
  const prompt = buildSlideIrPrompt(tocSlide, [], "white-blue", {
    presentationStyle: "consulting",
    revisionNotes: ["正文不得小于 16px"],
    previousSlideIr: stringifySmartSlide(previous)
  });
  assert.match(prompt, /上一候选 SmartSlide/);
  assert.match(prompt, /正文不得小于 16px/);
  assert.match(prompt, /schema: smartslide\/1/);
});
