import assert from "node:assert/strict";
import test from "node:test";
import { validateSvgThemeCompliance, type SlideDto } from "@ppt-agent/shared";
import { MockGeminiAdapter } from "../mockGeminiAdapter.js";
import { buildSvgPreviewPrompt } from "../prompts.js";
import { buildDesignRecipeInstruction } from "./assembler.js";
import { selectDesignRecipe } from "./selector.js";
import { validateSvgAgainstDesignRecipe } from "./visualQuality.js";

function makeSlide(overrides: Partial<SlideDto> = {}): SlideDto {
  return {
    id: "slide-1",
    projectId: "project-1",
    sortOrder: 1,
    title: "AI应用工程师全面成长指南",
    slideGoal: "说明两类能力如何融合",
    keyMessage: "大模型工具链与传统全栈深度融合，推动工程师跃迁为系统架构师",
    contentPoints: ["大模型与专属工具链", "传统全栈与工程实践"],
    recommendedLayout: "generic-cards",
    status: "planned",
    isContentLocked: false,
    isLayoutLocked: false,
    sourceFactIds: [],
    generationStatus: "draft-ready",
    planJson: {
      title: "AI应用工程师全面成长指南",
      pageGoal: "说明两类能力如何融合",
      keyMessage: "大模型工具链与传统全栈深度融合，推动工程师跃迁为系统架构师",
      layoutType: "generic-cards",
      contentBlocks: [
        { type: "bullets", title: "大模型与专属工具链", items: ["掌握提示词工程与RAG", "设计Agent协同流程"] },
        { type: "bullets", title: "传统全栈与工程实践", items: ["具备后端开发与优化能力", "建立监控评估体系"] }
      ],
      sourceFactIds: [],
      visualHint: { chartType: "none", heroVisual: "两类能力融合为系统架构能力", emphasis: ["深度融合"] }
    },
    ...overrides
  } as SlideDto;
}

test("两个互补能力模块选择双引擎桥接，而不是通用卡片墙", () => {
  const selected = selectDesignRecipe(makeSlide());
  assert.equal(selected.recipe.id, "dual-engine-bridge");
  assert.match(selected.reason, /双模块|内容语义/);
});

test("时间线视觉提示选择阶梯路线图", () => {
  const slide = makeSlide({
    title: "四步成长路线",
    recommendedLayout: "timeline",
    planJson: {
      ...makeSlide().planJson!,
      layoutType: "timeline",
      visualHint: { chartType: "timeline", heroVisual: "从入门到架构的阶梯路径" },
      contentBlocks: [
        { type: "timeline", title: "基础", items: ["掌握模型调用"] },
        { type: "timeline", title: "应用", items: ["构建RAG系统"] },
        { type: "timeline", title: "工程", items: ["建立评估体系"] },
        { type: "timeline", title: "架构", items: ["设计Agent平台"] }
      ]
    }
  });
  assert.equal(selectDesignRecipe(slide).recipe.id, "stepped-roadmap");
});

test("数据型页面选择证据型数据叙事", () => {
  const slide = makeSlide({
    title: "关键指标与增长趋势",
    recommendedLayout: "metrics",
    planJson: {
      ...makeSlide().planJson!,
      layoutType: "metrics",
      visualHint: { chartType: "line", heroVisual: "核心指标趋势图" }
    }
  });
  assert.equal(selectDesignRecipe(slide).recipe.id, "evidence-dashboard");
});

test("组装后的配方包含坐标、语义分组、形状程序与退化禁令", () => {
  const instruction = buildDesignRecipeInstruction(makeSlide());
  assert.match(instruction, /dual-engine-bridge/);
  assert.match(instruction, /<g id="visual-anchor">/);
  assert.match(instruction, /x=570, y=326, w=140, h=210/);
  assert.match(instruction, /形状组装程序/);
  assert.match(instruction, /禁止纯文字平铺/);
  assert.match(instruction, /必须实际使用的非矩形图元：path、circle/);
});

test("SVG 提示使用视觉配方且不再注入锁死的通用坐标骨架", () => {
  const prompt = buildSvgPreviewPrompt(makeSlide(), []);
  assert.match(prompt, /本页视觉配方（SVG 阶段最高优先级）/);
  assert.match(prompt, /SVG 只继承上述页面角色与信息意图，不继承通用坐标骨架/);
  assert.doesNotMatch(prompt, /有坐标骨架时禁止改几何/);
  assert.doesNotMatch(prompt, /坐标骨架模板/);
});

test("SVG 提示把浅色主题作为结构化硬契约传给设计模型", () => {
  const prompt = buildSvgPreviewPrompt(makeSlide(), [], "white-blue");
  assert.match(prompt, /THEME_CONTRACT/);
  assert.match(prompt, /"themeId": "white-blue"/);
  assert.match(prompt, /"canvasMode": "light"/);
  assert.match(prompt, /"canvas": "#EDF6FB"/);
  assert.match(prompt, /浅色主题禁止深蓝、深灰、黑色大面积铺底/);
});

test("浅色主题质量门禁拒绝深色全画布背景", () => {
  const svg = '<svg viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#111827"/><text data-w="300" data-h="50">标题</text></svg>';
  const result = validateSvgThemeCompliance(svg, "white-blue");
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes("浅色主题") && issue.includes("#111827")));
});

test("浅色主题质量门禁接受主题包规定的浅色画布", () => {
  const svg = '<svg viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#EDF6FB"/><text data-w="300" data-h="50">标题</text></svg>';
  const result = validateSvgThemeCompliance(svg, "white-blue");
  assert.deepEqual(result.issues, []);
});

test("浅色主题质量门禁也会检查全画布渐变的颜色", () => {
  const svg = '<svg viewBox="0 0 1280 720"><defs><linearGradient id="bg"><stop offset="0" stop-color="#071C33"/><stop offset="1" stop-color="#111827"/></linearGradient></defs><rect width="1280" height="720" fill="url(#bg)"/></svg>';
  const result = validateSvgThemeCompliance(svg, "white-blue");
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes("浅色主题")));
});

test("视觉质量检查能识别缺少语义层和非矩形图元的卡片墙", () => {
  const svg = '<svg viewBox="0 0 1280 720"><rect width="1280" height="720"/><rect/><rect/><rect/><rect/><rect/><text data-w="10" data-h="10">A</text></svg>';
  const result = validateSvgAgainstDesignRecipe(svg, makeSlide());
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes("visual-anchor")));
  assert.ok(result.issues.some((issue) => issue.includes("卡片墙")));
});

test("Mock 设计输出也遵循选中配方，避免开发环境回退成旧卡片墙", async () => {
  const slide = makeSlide();
  const svg = await new MockGeminiAdapter().generateSvgPreview(slide, []);
  const result = validateSvgAgainstDesignRecipe(svg, slide);
  assert.equal(result.recipeId, "dual-engine-bridge");
  assert.deepEqual(result.issues, []);
  assert.match(svg, /id="visual-anchor"/);
  assert.match(svg, /id="connector-layer"/);
});
