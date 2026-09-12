import assert from "node:assert/strict";
import test from "node:test";
import { autoHealSvgTextBoxes, fitSvgTextToBounds, getSvgTextBoxIssues } from "./svgTextFit.js";

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

test("shrinks and wraps long text without textLength compression or content loss", () => {
  const content = "设计提示负责约束模型角色、语气与输出格式，避免生成结果失去边界。";
  const source = `<svg viewBox="0 0 1280 720"><text x="80" y="120" font-size="24" data-w="180" data-h="96">${content}</text></svg>`;

  const result = fitSvgTextToBounds(source);

  assert.equal(result.adjustedTextCount, 1);
  assert.doesNotMatch(result.svg, /textLength=|lengthAdjust=/);
  assert.equal(
    result.svg.replace(/<[^>]+>/g, "").replace(/\s+/g, ""),
    content
  );
  assert.deepEqual(getSvgTextBoxIssues(result.svg), []);
});

test("keeps all text and reports height overflow when a box is physically impossible", () => {
  const content = "这是一段无法塞进极小文字框但绝不能静默截断的完整正文";
  const source = `<svg viewBox="0 0 1280 720"><text x="80" y="120" font-size="24" data-w="50" data-h="20">${content}</text></svg>`;

  const result = fitSvgTextToBounds(source);

  assert.doesNotMatch(result.svg, /textLength=|lengthAdjust=/);
  assert.equal(
    result.svg.replace(/<[^>]+>/g, "").replace(/\s+/g, ""),
    content
  );
  assert.match(getSvgTextBoxIssues(result.svg).join("\n"), /内容高度超过 data-h/);
});

test("does not treat an x-only tspan reset as a new visual line", () => {
  const source = [
    '<svg viewBox="0 0 1280 720">',
    '<text x="80" y="120" font-size="16" data-w="240" data-h="24">',
    '<tspan x="80" dy="0">【目标】</tspan>',
    '<tspan x="130">本周完成闭环</tspan>',
    "</text>",
    "</svg>"
  ].join("");

  assert.deepEqual(getSvgTextBoxIssues(source), []);
});

test("smart-extends data-w safely for short single-line labels without breaking into tspans", () => {
  const source = [
    '<svg viewBox="0 0 1280 720">',
    '<g id="visual-anchor">',
    '<text x="1110" y="254" font-size="12" font-weight="600" data-w="90" data-h="18">CET-4 → IELTS</text>',
    '</g>',
    '</svg>'
  ].join("");

  const result = fitSvgTextToBounds(source);
  // 不应该被切成多行 tspan，应该保持单行且扩展 data-w
  assert.doesNotMatch(result.svg, /<tspan/);
  assert.match(result.svg, /data-w="10[3-8]"/);
  assert.deepEqual(getSvgTextBoxIssues(result.svg), []);
});

test("autoHealSvgTextBoxes heals overflowing and missing text box bounds deterministically", () => {
  const brokenSvg = [
    '<svg viewBox="0 0 1280 720">',
    '<text x="100" y="200" font-size="12" data-w="90" data-h="18">',
    '<tspan x="100" dy="0">CET-4 →</tspan>',
    '<tspan x="100" dy="15.36">IELTS</tspan>',
    '</text>',
    '</svg>'
  ].join("");

  // 原始 brokenSvg 应该有高度溢出
  assert.match(getSvgTextBoxIssues(brokenSvg).join("\n"), /内容高度超过 data-h/);

  // 经过 autoHealSvgTextBoxes 自愈后，data-h 应自动匹配实际行高，消灭 issue
  const healed = autoHealSvgTextBoxes(brokenSvg);
  assert.ok(healed.healedCount >= 1);
  assert.deepEqual(getSvgTextBoxIssues(healed.svg), []);
});
