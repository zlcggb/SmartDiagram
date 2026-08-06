import assert from "node:assert/strict";
import test from "node:test";
import { prepareSlideSvgSource } from "./slideImage.js";

test("prepareSlideSvgSource returns the exact fitted SVG used by image and focus rendering", () => {
  const source = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">',
    '<rect width="1280" height="720" fill="#FFFFFF"/>',
    '<text x="80" y="120" font-size="24" data-w="160" data-h="90">这是一段必须在最终渲染前自动换行的长文本内容</text>',
    '</svg>'
  ].join("");

  const prepared = prepareSlideSvgSource(source, { theme: "white-blue" });

  assert.match(prepared, /data-auto-fit="wrap"/);
  assert.match(prepared, /<tspan x="80" dy="/);
});
