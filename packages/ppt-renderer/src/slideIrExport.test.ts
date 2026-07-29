import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { SlideIrSchema, renderSlideIrToSvg } from "@ppt-agent/slide-ir";
import type { ProjectDto, SlideDto } from "@ppt-agent/shared";
import { renderProjectPptx } from "./index.js";

const ir = SlideIrSchema.parse({
  schema: "smartslide/1",
  pageType: "content",
  canvas: { width: 1280, height: 720 },
  theme: {
    tokens: {
      bg: "#F5F7FA",
      bgSoft: "#EAF2FF",
      card: "#FFFFFF",
      title: "#111827",
      body: "#334155",
      muted: "#64748B",
      primary: "#0066CC",
      accent: "#22A06B",
      accentAlt: "#7C3AED",
      border: "#D8E1EC",
      onAccent: "#FFFFFF",
      success: "#22A06B",
      risk: "#D92D20",
      warning: "#F59E0B"
    },
    fonts: { heading: "Arial", body: "Arial", mono: "Menlo" }
  },
  background: { color: "$bg" },
  elements: [
    {
      id: "panel",
      type: "shape",
      bounds: [64, 64, 1152, 592],
      shape: "roundRect",
      radius: 24,
      fill: { color: "$card" },
      stroke: { color: "$border", width: 1 }
    },
    {
      id: "title",
      type: "text",
      bounds: [112, 112, 920, 64],
      paragraphs: [
        {
          align: "left",
          runs: [
            {
              text: "SmartSlide 原生可编辑导出",
              fontSize: 36,
              fontWeight: 700,
              color: "$title"
            }
          ]
        }
      ],
      verticalAlign: "middle",
      autoFit: "shrink"
    }
  ],
  metadata: {
    title: "SmartSlide 原生可编辑导出",
    description: "验证结构化 IR 不经过 SVG 解析即可进入 PPTX。",
    locale: "zh-CN"
  }
});

const now = new Date().toISOString();
const project: ProjectDto = {
  id: "project-ir-export",
  name: "SmartSlide 导出回归",
  reportType: "技术方案",
  audience: "产品与研发团队",
  purpose: "验证结构化页面语言",
  pageCount: 1,
  theme: "white-blue",
  presentationStyle: "apple-minimal",
  mode: "topic",
  topic: "SmartSlide",
  createdAt: now,
  updatedAt: now
};

const slide: SlideDto = {
  id: "slide-ir-export",
  projectId: project.id,
  sortOrder: 1,
  title: "SmartSlide 原生可编辑导出",
  slideGoal: "验证结构化 IR 导出",
  keyMessage: "文字与形状应成为 PowerPoint 原生对象。",
  contentPoints: ["原生文本", "原生形状"],
  recommendedLayout: "hero",
  status: "planned",
  isContentLocked: false,
  isLayoutLocked: false,
  sourceFactIds: [],
  svgPreview: renderSlideIrToSvg(ir),
  irJson: ir,
  generationStatus: "ir-ready",
  renderStrategy: "ir"
};

test("SmartSlide active design exports as native PPTX objects", async () => {
  const outputPath = path.join(
    os.tmpdir(),
    `smartslide-ir-export-${process.pid}-${Date.now()}.pptx`
  );
  try {
    const result = await renderProjectPptx(
      {
        project,
        slides: [slide],
        facts: [],
        mode: "standard",
        svgExportMode: "editable"
      },
      outputPath
    );

    assert.equal(result.pageResults[0]?.path, "ir");
    assert.equal(result.warnings.length, 0);
    assert.ok(fs.statSync(outputPath).size > 4_000);

    const zip = await JSZip.loadAsync(fs.readFileSync(outputPath));
    const slideXml = await zip.file("ppt/slides/slide1.xml")?.async("string");
    assert.ok(slideXml);
    assert.match(slideXml, /SmartSlide shape panel/);
    assert.match(slideXml, /SmartSlide text title/);
    assert.match(slideXml, /SmartSlide 原生可编辑导出/);
  } finally {
    fs.rmSync(outputPath, { force: true });
  }
});
