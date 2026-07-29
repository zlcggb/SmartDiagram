import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import type { SlideDto } from "@ppt-agent/shared";
import { buildSlideIrPrompt } from "../../slideIrGeneration.js";
import { buildSvgPreviewPrompt } from "../../prompts.js";
import {
  assembleKimiDesignKnowledge,
  clearKimiDesignKnowledgeCache,
  inspectKimiDesignKnowledgeCatalog
} from "./service.js";

let fixtureRoot = "";
let previousRoot: string | undefined;
let previousMode: string | undefined;

function write(relativePath: string, content: string) {
  const path = resolve(fixtureRoot, relativePath);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

const slide: SlideDto = {
  id: "slide-1",
  projectId: "project-1",
  sortOrder: 1,
  title: "FastAPI 与 Node.js 安全架构",
  slideGoal: "解释系统边界与接口关系",
  keyMessage: "建立可验证的安全闭环",
  contentPoints: ["接口隔离", "权限校验"],
  recommendedLayout: "architecture",
  status: "draft",
  isContentLocked: false,
  isLayoutLocked: false,
  sourceFactIds: [],
  generationStatus: "draft",
  planJson: {
    title: "FastAPI 与 Node.js 安全架构",
    keyMessage: "建立可验证的安全闭环",
    layoutType: "architecture",
    contentBlocks: [
      { type: "point", title: "接口", items: ["内部 API 隔离"] },
      { type: "point", title: "权限", items: ["逐层校验"] }
    ],
    visualHint: {
      heroVisual: "system architecture",
      chartType: "process"
    }
  }
};

before(() => {
  fixtureRoot = mkdtempSync(resolve(tmpdir(), "kimi-knowledge-test-"));
  write("SKILL.md", "# Fixture skill");
  write(
    "reference/slides_categories.md",
    "# General rules\nUse one visual focus. Never copy source brands. Avoid equal card walls."
  );
  write(
    "reference/fonts.md",
    "# Font system\nUse a restrained sans-serif hierarchy with a large display title."
  );
  write(
    "reference/slides_categories/tech-engineering.md",
    "# Tech & Engineering\nExplain system boundaries, flow and trade-offs before decoration."
  );
  write(
    "reference/slides_categories/business-plan.md",
    "# Business Proposal\nUse a persuasive storyline and leave breathing room."
  );
  write(
    "reference/slides_categories/brand-creative.md",
    "# Brand / Creative Showcase\nBuild one recognizable focal point."
  );
  write(
    "reference/design_system/consulting/apricot-white-brief/design.md",
    "# Apricot White Brief\nWhite editorial cover, one hero, generous whitespace, restrained blue accent."
  );
  write(
    "reference/design_system/work/orange-tech/design.md",
    [
      "# Orange Tech Engineering Atlas",
      "## Style Positioning",
      "One page sets only one visual anchor. Structural clarity is more important than exhaustive paragraphs.",
      "## Page Skeleton",
      "Use one dominant system diagram with a short conclusion and restrained side evidence.",
      "## Components and Graphic Elements",
      "Use explicit connectors, one visible system boundary, thin rules, and one dominant processing node.",
      "## Prohibited",
      "Do not use three equal card columns, decorative glow, or unrelated icon walls."
    ].join("\n")
  );
  write(
    "reference/design_system/promotion/silver-gray-magazine/design.md",
    "# Silver Gray Magazine\nEditorial grid with image-led storytelling."
  );
  write(
    "reference/design_system/promotion/blue-tech/design.md",
    "# Blue System\nDark black diagrams."
  );

  previousRoot = process.env.KIMI_SLIDES_SKILL_DIR;
  previousMode = process.env.PPT_KIMI_KNOWLEDGE_MODE;
  process.env.KIMI_SLIDES_SKILL_DIR = fixtureRoot;
  process.env.PPT_KIMI_KNOWLEDGE_MODE = "auto";
  clearKimiDesignKnowledgeCache();
});

after(() => {
  if (previousRoot === undefined) delete process.env.KIMI_SLIDES_SKILL_DIR;
  else process.env.KIMI_SLIDES_SKILL_DIR = previousRoot;
  if (previousMode === undefined) delete process.env.PPT_KIMI_KNOWLEDGE_MODE;
  else process.env.PPT_KIMI_KNOWLEDGE_MODE = previousMode;
  clearKimiDesignKnowledgeCache();
  rmSync(fixtureRoot, { recursive: true, force: true });
});

test("目录只索引场景与设计系统 Markdown", () => {
  const summary = inspectKimiDesignKnowledgeCatalog(fixtureRoot);
  assert.equal(summary.available, true);
  assert.equal(summary.categories.length, 3);
  assert.equal(summary.designSystems.length, 4);
});

test("技术主题会匹配技术场景和技术设计系统", () => {
  const bundle = assembleKimiDesignKnowledge({
    topic: "FastAPI Node.js API 安全架构与系统组件",
    title: "技术架构",
    pageType: "content",
    slideGoal: "说明接口关系",
    theme: "blue-black",
    presentationStyle: "tech-architecture",
    outputDialect: "smartslide",
    knowledgeRoot: fixtureRoot
  });
  assert.equal(bundle.available, true);
  assert.equal(bundle.category?.id, "tech-engineering");
  assert.match(bundle.designSystem?.id ?? "", /orange-tech/);
  assert.match(bundle.prompt, /只能使用这一套设计系统/);
  assert.match(bundle.prompt, /DESIGN_SYSTEM_CONTRACT/);
  assert.match(bundle.prompt, /One page sets only one visual anchor/);
  assert.match(bundle.prompt, /one visible system boundary/);
  assert.match(bundle.prompt, /不要输出 PPTD\/YAML/);
});

test("同一主题与演示风格在不同页面语义下仍选择同一套设计系统", () => {
  const architecture = assembleKimiDesignKnowledge({
    topic: "FastAPI Node.js API 安全架构与系统组件",
    title: "技术架构",
    pageType: "content",
    slideGoal: "说明接口关系",
    theme: "blue-black",
    presentationStyle: "tech-architecture",
    outputDialect: "smartslide",
    knowledgeRoot: fixtureRoot
  });
  const summary = assembleKimiDesignKnowledge({
    topic: "品牌创意发布与视觉故事",
    title: "品牌总结",
    pageType: "ending",
    slideGoal: "建立品牌记忆",
    theme: "blue-black",
    presentationStyle: "tech-architecture",
    outputDialect: "smartslide",
    knowledgeRoot: fixtureRoot
  });

  assert.equal(architecture.designSystem?.id, summary.designSystem?.id);
});

test("Apple 封面优先选择浅色简报设计并遵守字符预算", () => {
  const bundle = assembleKimiDesignKnowledge({
    topic: "产品发布与商业提案",
    title: "AI 销售培训体系",
    pageType: "cover",
    slideGoal: "产品发布",
    theme: "white-blue",
    presentationStyle: "apple-minimal",
    outputDialect: "svg",
    maxPromptChars: 3_000,
    knowledgeRoot: fixtureRoot
  });
  assert.equal(bundle.available, true);
  assert.match(bundle.designSystem?.id ?? "", /apricot-white-brief/);
  assert.equal(bundle.constraints.focalPoints, 1);
  assert.ok(bundle.prompt.length <= 3_000);
  assert.match(bundle.prompt, /DESIGN_BLUEPRINT/);
  assert.match(bundle.prompt, /hero-statement/);
  assert.match(bundle.prompt, /card wall generated directly from contentBlocks/);
  assert.doesNotMatch(bundle.prompt, /# PPT category guide/);
});

test("资料缺失时无损回退", () => {
  const bundle = assembleKimiDesignKnowledge({
    topic: "fallback",
    outputDialect: "smartslide",
    knowledgeRoot: resolve(fixtureRoot, "missing")
  });
  assert.equal(bundle.available, false);
  assert.equal(bundle.prompt, "");
  assert.match(bundle.warnings.join(" "), /回落|未找到/);
});

test("SVG 与 SmartSlide 提示词都会自动注入知识包", () => {
  const svgPrompt = buildSvgPreviewPrompt(
    slide,
    [],
    "blue-black",
    undefined,
    [],
    undefined,
    undefined,
    "tech-architecture"
  );
  const irPrompt = buildSlideIrPrompt(
    slide,
    [],
    "blue-black",
    { presentationStyle: "tech-architecture" }
  );
  assert.match(svgPrompt, /Kimi Slides 编译设计指令/);
  assert.match(irPrompt, /Kimi Slides 编译设计指令/);
  assert.match(svgPrompt, /DESIGN_BLUEPRINT/);
  assert.match(irPrompt, /DESIGN_BLUEPRINT/);
  assert.doesNotMatch(irPrompt, /# PPT category guide/);
});

test("CLI 与内部 API 使用同一知识服务", () => {
  const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      cliPath,
      "--topic",
      "FastAPI 安全架构",
      "--style",
      "tech-architecture",
      "--theme",
      "blue-black",
      "--root",
      fixtureRoot,
      "--format",
      "json"
    ],
    {
      cwd: resolve(fileURLToPath(new URL("../../../../", import.meta.url))),
      encoding: "utf8"
    }
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as { available: boolean; category?: { id: string } };
  assert.equal(output.available, true);
  assert.equal(output.category?.id, "tech-engineering");
});
