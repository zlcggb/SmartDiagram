import assert from "node:assert/strict";
import test from "node:test";
import { fitSvgTextToBounds, getSvgTextBoxIssues } from "./svgTextFit.js";

test("wraps overflowing inline tspans instead of letting them escape their card", () => {
  const source = [
    '<svg viewBox="0 0 1280 720">',
    '<g transform="translate(780, 196)">',
    '<text x="42" y="112" font-size="15" data-w="390" data-h="52">',
    '<tspan font-weight="700">行为约束：</tspan>',
    '<tspan>设计 System Prompt 约束模型角色、语气以及输出格式，避免无边界生成。</tspan>',
    '</text>',
    '</g>',
    '</svg>'
  ].join("");

  assert.match(getSvgTextBoxIssues(source).join("\n"), /同一行内容超过 data-w/);

  const result = fitSvgTextToBounds(source);
  assert.equal(result.adjustedTextCount, 1);
  assert.match(result.svg, /<tspan x="42" dy="/);
  assert.doesNotMatch(getSvgTextBoxIssues(result.svg).join("\n"), /同一行内容超过 data-w/);
});

test("reports text boxes outside the horizontal canvas safe area after translate", () => {
  const source = [
    '<svg viewBox="0 0 1280 720">',
    '<g transform="translate(900, 100)">',
    '<text x="24" y="40" font-size="18" data-w="340" data-h="30">越界正文</text>',
    '</g>',
    '</svg>'
  ].join("");

  assert.match(getSvgTextBoxIssues(source).join("\n"), /超出画布横向安全区/);
});
