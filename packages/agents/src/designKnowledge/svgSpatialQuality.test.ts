import assert from "node:assert/strict";
import test from "node:test";
import { getDesignRecipe } from "./templates.js";
import { validateSvgSpatialQuality } from "./svgSpatialQuality.js";

const bridgeRecipe = getDesignRecipe("dual-engine-bridge");

function svgWith(groups: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">${groups}</svg>`;
}

test("接受分离的语义区、嵌套 translate 和卡片内部承载关系", () => {
  const svg = svgWith(`
    <g id="background-layer"><rect width="1280" height="720" fill="#EDF6FB"/></g>
    <g id="connector-layer"><line x1="512" y1="420" x2="548" y2="420" stroke="#005AA6"/></g>
    <g id="content-zone-1" transform="translate(72,226)">
      <rect width="440" height="388" rx="18" fill="#FFFFFF"/>
      <text x="28" y="70" data-w="340" data-h="36" font-size="22">左侧能力</text>
    </g>
    <g id="content-zone-2"><rect x="768" y="226" width="440" height="388" rx="18" fill="#FFFFFF"/></g>
    <g id="visual-anchor"><circle cx="640" cy="410" r="86" fill="#F3F8FC"/></g>
    <g id="title-zone"><text x="72" y="104" data-w="620" data-h="52" font-size="42">标题</text></g>
    <g id="key-message-zone"><text x="812" y="104" data-w="360" data-h="40" font-size="22">核心结论</text></g>
  `);

  assert.deepEqual(validateSvgSpatialQuality(svg, bridgeRecipe).issues, []);
});

test("拒绝中央主视觉压住内容卡，并返回分组与坐标", () => {
  const svg = svgWith(`
    <g id="background-layer"><rect width="1280" height="720"/></g>
    <g id="connector-layer"><line x1="500" y1="400" x2="560" y2="400"/></g>
    <g id="content-zone-1"><rect x="72" y="226" width="500" height="388"/></g>
    <g id="content-zone-2"><rect x="768" y="226" width="440" height="388"/></g>
    <g id="visual-anchor"><circle cx="560" cy="410" r="86"/></g>
  `);

  const result = validateSvgSpatialQuality(svg, bridgeRecipe);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => /visual-anchor.*content-zone-1|content-zone-1.*visual-anchor/.test(issue)));
  assert.ok(result.issues.some((issue) => /x=\d+\.\.\d+、y=\d+\.\.\d+/.test(issue)));
});

test("拒绝不同语义区的文字互相覆盖", () => {
  const svg = svgWith(`
    <g id="content-zone-1"><text x="300" y="320" data-w="240" data-h="52" font-size="24">左侧文字</text></g>
    <g id="content-zone-2"><text x="420" y="320" data-w="240" data-h="52" font-size="24">右侧文字</text></g>
  `);

  const result = validateSvgSpatialQuality(svg, bridgeRecipe);
  assert.ok(result.issues.some((issue) => issue.includes("文字框") && issue.includes("content-zone-1") && issue.includes("content-zone-2")));
});

test("拒绝连接线穿过其他语义区文字", () => {
  const svg = svgWith(`
    <g id="connector-layer"><polyline points="80,300 640,300 1200,300" fill="none"/></g>
    <g id="content-zone-1"><text x="280" y="320" data-w="260" data-h="48" font-size="22">不允许线路穿过正文</text></g>
  `);

  const result = validateSvgSpatialQuality(svg, bridgeRecipe);
  assert.ok(result.issues.some((issue) => issue.includes("connector-layer") && issue.includes("穿过") && issue.includes("content-zone-1")));
});

test("接受先绘制的连接线从后绘制视觉锚点文字下方通过", () => {
  const svg = svgWith(`
    <g id="connector-layer"><path d="M420 410 L860 410" fill="none"/></g>
    <g id="visual-anchor">
      <circle cx="640" cy="410" r="86"/>
      <text x="640" y="418" text-anchor="middle" data-w="160" data-h="40" font-size="24">核心安全边界</text>
    </g>
  `);

  const result = validateSvgSpatialQuality(svg, bridgeRecipe);
  assert.ok(
    !result.issues.some((issue) => issue.includes("connector-layer") && issue.includes("visual-anchor")),
    result.issues.join("\n")
  );
});

test("拒绝业务元素越过画布安全区", () => {
  const svg = svgWith(`
    <g id="content-zone-1"><rect x="12" y="226" width="440" height="388"/></g>
  `);

  const result = validateSvgSpatialQuality(svg, bridgeRecipe);
  assert.ok(result.issues.some((issue) => issue.includes("content-zone-1") && issue.includes("安全区")));
});

test("拒绝语义分组 DOM 顺序违背 layer", () => {
  const svg = svgWith(`
    <g id="content-zone-1"><rect x="72" y="226" width="440" height="388"/></g>
    <g id="connector-layer"><line x1="512" y1="420" x2="548" y2="420"/></g>
  `);

  const result = validateSvgSpatialQuality(svg, bridgeRecipe);
  assert.ok(result.issues.some((issue) => issue.includes("DOM") && issue.includes("layer")));
});

test("拒绝附着在卡片边缘的整高强调色条", () => {
  const svg = svgWith(`
    <g id="content-zone-1">
      <rect x="72" y="226" width="440" height="388" rx="18" fill="#FFFFFF"/>
      <rect x="72" y="246" width="8" height="348" fill="#005AA6"/>
    </g>
  `);

  const result = validateSvgSpatialQuality(svg, bridgeRecipe);
  assert.ok(result.issues.some((issue) => issue.includes("content-zone-1") && issue.includes("整高强调色条")));
});

test("接受配方显式允许的主视觉与阶段节点包含关系", () => {
  const roadmap = getDesignRecipe("stepped-roadmap");
  const svg = svgWith(`
    <g id="visual-anchor"><rect x="78" y="210" width="1120" height="390"/></g>
    <g id="content-zone-1"><rect x="88" y="420" width="230" height="176"/></g>
  `);

  assert.deepEqual(validateSvgSpatialQuality(svg, roadmap).issues, []);
});
