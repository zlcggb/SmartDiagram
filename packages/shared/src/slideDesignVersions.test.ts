import assert from "node:assert/strict";
import test from "node:test";
import { slideDesignVersionSourceSchema, updateSlideSchema } from "./index.js";

test("设计版本来源只允许 ai、manual 和 legacy", () => {
  assert.equal(slideDesignVersionSourceSchema.parse("ai"), "ai");
  assert.equal(slideDesignVersionSourceSchema.parse("manual"), "manual");
  assert.equal(slideDesignVersionSourceSchema.parse("legacy"), "legacy");
  assert.throws(() => slideDesignVersionSourceSchema.parse("unknown"));
});

test("手动 SVG 保存可携带版本主题元数据", () => {
  const parsed = updateSlideSchema.parse({
    svgPreview: '<svg viewBox="0 0 1280 720"></svg>',
    designVersionMeta: {
      theme: "apple-light",
      accentId: "blue",
      surfaceId: "paper"
    }
  });

  assert.deepEqual(parsed.designVersionMeta, {
    theme: "apple-light",
    accentId: "blue",
    surfaceId: "paper"
  });
});
