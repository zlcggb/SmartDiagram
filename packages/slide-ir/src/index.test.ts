import assert from "node:assert/strict";
import test from "node:test";
import {
  SlideIrSchema,
  compileSlideIrToPptx,
  parseSmartSlide,
  renderSlideIrToSvg,
  stringifySmartSlide,
  validateSlideIr,
  type SlideIrDocument
} from "./index.js";

const document: SlideIrDocument = {
  schema: "smartslide/1",
  pageType: "content",
  canvas: { width: 1280, height: 720 },
  theme: {
    tokens: {
      bg: "#F5F5F7",
      surface: "#FFFFFF",
      surfaceAlt: "#F0F4F8",
      text: "#1D1D1F",
      muted: "#6E6E73",
      primary: "#0071E3",
      accent: "#00A6D6",
      success: "#12B76A",
      warning: "#F79009",
      danger: "#D92D20",
      border: "#D9E2EC"
    },
    fonts: { heading: "Arial", body: "Arial" }
  },
  background: { color: "$bg" },
  elements: [
    {
      id: "card",
      type: "shape",
      bounds: [60, 44, 1160, 612],
      shape: "roundRect",
      fill: { color: "$surface" },
      stroke: { color: "$border", width: 1 },
      radius: 22
    },
    {
      id: "title",
      type: "text",
      bounds: [96, 82, 860, 76],
      paragraphs: [
        {
          runs: [
            {
              text: "SmartSlide 核心能力",
              fontSize: 40,
              fontWeight: 700,
              color: "$text"
            }
          ]
        }
      ]
    },
    {
      id: "flow",
      type: "line",
      points: [
        [120, 230],
        [1120, 230]
      ],
      stroke: { color: "$primary", width: 3 },
      markerEnd: "arrow"
    },
    {
      id: "table",
      type: "table",
      bounds: [96, 300, 520, 260],
      columns: [180, 340],
      rows: [
        [
          { text: "目标", fill: { color: "$surfaceAlt" } },
          { text: "结构化、可验证、可编辑" }
        ],
        [{ text: "输出" }, { text: "SVG + PPTX" }]
      ]
    },
    {
      id: "chart",
      type: "chart",
      bounds: [670, 300, 460, 260],
      chartType: "bar",
      categories: ["预览", "导出", "编辑"],
      series: [{ name: "质量", values: [92, 88, 96], color: "$primary" }],
      showLegend: false
    }
  ]
};

test("Slide IR schema accepts a valid SmartSlide document", () => {
  const parsed = SlideIrSchema.parse(document);
  assert.equal(parsed.schema, "smartslide/1");
  assert.equal(parsed.elements.length, 5);
});

test("SmartSlide YAML round-trips through the runtime schema", () => {
  const source = stringifySmartSlide(document);
  assert.match(source, /^schema: smartslide\/1/m);
  assert.match(source, /type: chart/);
  assert.deepEqual(parseSmartSlide(source), SlideIrSchema.parse(document));
});

test("IR SVG compiler preserves z-order and emits no style element", () => {
  const svg = renderSlideIrToSvg(document);
  assert.match(svg, /viewBox="0 0 1280 720"/);
  assert.equal(svg.includes("<style"), false);
  assert.equal(svg.includes("foreignObject"), false);
  assert.ok(svg.indexOf('data-element-id="card"') < svg.indexOf('data-element-id="title"'));
  assert.ok(svg.indexOf('data-element-id="title"') < svg.indexOf('data-element-id="chart"'));
});

test("quality validation catches duplicate ids, overflow and connector-through-text", () => {
  const invalid = structuredClone(document);
  invalid.elements.push({
    id: "title",
    type: "shape",
    bounds: [1260, 700, 80, 60],
    shape: "rect",
    fill: { color: "$surface" }
  });
  invalid.elements.push({
    id: "crossing",
    type: "line",
    points: [
      [80, 120],
      [1000, 120]
    ],
    stroke: { color: "$danger", width: 2 }
  });
  const result = validateSlideIr(invalid);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "duplicate-element-id"));
  assert.ok(result.issues.some((issue) => issue.code === "out-of-bounds"));
  assert.ok(result.issues.some((issue) => issue.code === "connector-crosses-text"));
});

test("PPTX compiler maps structured elements to native slide calls", () => {
  const calls = {
    shapes: [] as unknown[],
    texts: [] as unknown[],
    tables: [] as unknown[],
    charts: [] as unknown[]
  };
  const pptx = {
    ShapeType: {
      rect: "rect",
      roundRect: "roundRect",
      ellipse: "ellipse",
      line: "line"
    },
    ChartType: {
      bar: "bar",
      line: "line",
      pie: "pie",
      doughnut: "doughnut"
    }
  };
  const slide = {
    addShape: (...args: unknown[]) => calls.shapes.push(args),
    addText: (...args: unknown[]) => calls.texts.push(args),
    addImage: () => undefined,
    addTable: (...args: unknown[]) => calls.tables.push(args),
    addChart: (...args: unknown[]) => calls.charts.push(args)
  };

  const result = compileSlideIrToPptx(pptx, slide, document);
  assert.equal(result.ok, true);
  assert.ok(calls.shapes.length >= 2);
  assert.equal(calls.texts.length, 1);
  assert.equal(calls.tables.length, 1);
  assert.equal(calls.charts.length, 1);
});

