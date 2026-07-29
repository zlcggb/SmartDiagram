import assert from "node:assert/strict";
import test from "node:test";
import {
  DesignGenerationModeSchema,
  SlideGenerationStatusSchema,
  SlideIrSchema,
  exportPptxSchema
} from "./index.js";

test("design generation mode accepts svg and slide-ir only", () => {
  assert.equal(DesignGenerationModeSchema.parse("svg"), "svg");
  assert.equal(DesignGenerationModeSchema.parse("slide-ir"), "slide-ir");
  assert.throws(() => DesignGenerationModeSchema.parse("html"));
});

test("export input keeps SVG as the backward-compatible default", () => {
  assert.equal(exportPptxSchema.parse({}).designMode, "svg");
  assert.equal(
    exportPptxSchema.parse({ designMode: "slide-ir" }).designMode,
    "slide-ir"
  );
});

test("shared contract exposes the SmartSlide runtime schema", () => {
  const result = SlideIrSchema.safeParse({
    schema: "smartslide/1",
    pageType: "content",
    canvas: { width: 1280, height: 720 },
    theme: {
      tokens: {
        bg: "#FFFFFF",
        surface: "#FFFFFF",
        surfaceAlt: "#F5F5F7",
        text: "#111111",
        muted: "#666666",
        primary: "#0071E3",
        accent: "#00A6D6",
        success: "#12B76A",
        warning: "#F79009",
        danger: "#D92D20",
        border: "#D9E2EC"
      }
    },
    background: { color: "$bg" },
    elements: [
      {
        id: "title",
        type: "text",
        bounds: [72, 54, 800, 80],
        paragraphs: [
          {
            runs: [
              {
                text: "结构化页面",
                fontSize: 40,
                fontWeight: 700,
                color: "$text"
              }
            ]
          }
        ]
      }
    ]
  });
  assert.equal(result.success, true);
  assert.equal(SlideGenerationStatusSchema.parse("ir-ready"), "ir-ready");
});

