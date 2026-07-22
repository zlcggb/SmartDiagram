/**
 * P2 对照回归：
 * 1) 内置伪线条防御用例（始终跑）
 * 2) 可选 references/svg2pptx-skill/examples/*.svg
 *
 * 运行（仓库根 ppt-agent-engine）：
 *   corepack pnpm --filter @ppt-agent/ppt-renderer test
 *   或：corepack pnpm test:svg-regression
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getThemePack, recolorSvgPreview } from "@ppt-agent/shared";
import { compileSvgPreviewToSlide } from "../src/svgCompile.js";
import { buildOoxmlCustomGeometry, decodeSvgShapeMetadata } from "../src/svgPathGeometry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 相对 ppt-agent-engine：../references/svg2pptx-skill/examples */
const EXAMPLES_DIR = path.resolve(__dirname, "../../../../references/svg2pptx-skill/examples");

const MIN_RENDERED = 8;

const CASES: Array<{ file: string; minRendered: number }> = [
  { file: "filtration_demo.svg", minRendered: MIN_RENDERED },
  { file: "support_structure_demo.svg", minRendered: MIN_RENDERED }
];

type ShapeCall = { shapeType: string; options: Record<string, unknown> };

function createMockTarget() {
  const shapes: ShapeCall[] = [];
  const pptx = {
    ShapeType: {
      rect: "rect",
      roundRect: "roundRect",
      line: "line",
      ellipse: "ellipse"
    }
  };
  const slide = {
    addShape: (shapeType: string, options: Record<string, unknown>) => {
      shapes.push({ shapeType, options });
    },
    addText: (
      _text: string | Array<{ text: string; options?: Record<string, unknown> }>,
      _options: Record<string, unknown>
    ) => undefined
  };
  return { pptx, slide, shapes };
}

function wrapSvg(body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">${body}</svg>`;
}

function runDefenseCases() {
  // 1) 三次贝塞尔装饰 path：旧逻辑会把控制点连成穿越画布的线
  {
    const { pptx, slide, shapes } = createMockTarget();
    const svg = wrapSvg(`
      <rect x="40" y="40" width="200" height="120" fill="#fff" stroke="#D7E2EF"/>
      <circle cx="200" cy="200" r="40" fill="#0066CC"/>
      <text x="80" y="100" font-size="24" fill="#14202B">Safe</text>
      <path d="M0 0 C 400 40 800 600 1280 720" fill="none" stroke="#0066CC" stroke-width="2"/>
    `);
    const result = compileSvgPreviewToSlide(pptx, slide, svg, { minObjects: 1 });
    const lines = shapes.filter((s) => s.shapeType === "line");
    assert.equal(lines.length, 0, "曲线 path 不得编译为 line（防 WPS 伪对角线）");
    assert.ok(result.rendered >= 2, `防御用例应至少渲染 rect/circle/text，got ${result.rendered}`);
    console.log("✓ editable: cubic stroke path kept without line artifacts");
  }

  // 2) 无描边填充 path：不得拆折线
  {
    const { pptx, slide, shapes } = createMockTarget();
    const svg = wrapSvg(`
      <rect x="40" y="40" width="200" height="120" fill="#fff"/>
      <path d="M100 100 L140 80 L180 120 Z" fill="#0066CC"/>
      <text x="80" y="100" font-size="20" fill="#14202B">Icon</text>
    `);
    compileSvgPreviewToSlide(pptx, slide, svg, { minObjects: 1 });
    const lines = shapes.filter((s) => s.shapeType === "line");
    assert.equal(lines.length, 0, "fill-only path 不得拆成线");
    console.log("✓ editable: fill-only path kept without line artifacts");
  }

  // 3) 安全折线：显式 line 保留，path 升级为单个可编辑自由形状
  {
    const { pptx, slide, shapes } = createMockTarget();
    const svg = wrapSvg(`
      <rect x="40" y="40" width="200" height="80" fill="#fff"/>
      <line x1="80" y1="200" x2="400" y2="200" stroke="#0066CC" stroke-width="2"/>
      <path d="M80 260 L240 260 L240 320" fill="none" stroke="#00A6D6" stroke-width="2"/>
      <text x="80" y="100" font-size="20" fill="#14202B">Line</text>
    `);
    compileSvgPreviewToSlide(pptx, slide, svg, { minObjects: 1 });
    const lines = shapes.filter((s) => s.shapeType === "line");
    const customPaths = shapes.filter((shape) =>
      String(shape.options.objectName ?? "").startsWith("SVGCG_")
    );
    assert.equal(lines.length, 1, `显式 line 应保留，got ${lines.length}`);
    assert.ok(customPaths.length >= 1, "path 应升级为单个可编辑自由形状");
    console.log(`✓ editable: safe path kept as custom geometry (lines=${lines.length})`);
  }

  // 4) 从原点拉出的超长线段：跳过
  {
    const { pptx, slide, shapes } = createMockTarget();
    const svg = wrapSvg(`
      <rect x="40" y="40" width="120" height="80" fill="#fff"/>
      <line x1="0" y1="0" x2="900" y2="500" stroke="#0066CC" stroke-width="1"/>
      <text x="80" y="90" font-size="18" fill="#14202B">Origin</text>
    `);
    compileSvgPreviewToSlide(pptx, slide, svg, { minObjects: 1 });
    const lines = shapes.filter((s) => s.shapeType === "line");
    assert.equal(lines.length, 0, "从角上拉出的长线应被过滤");
    console.log("✓ defense: origin-spanning line skipped");
  }

  // 5) <g> 继承 fill / text-anchor / font-family；translate 生效
  {
    const { pptx, slide, shapes } = createMockTarget();
    const texts: Array<{ text: unknown; options: Record<string, unknown> }> = [];
    slide.addText = (text, options) => {
      texts.push({ text, options });
    };
    const svg = wrapSvg(`
      <rect x="0" y="0" width="1280" height="720" fill="#F4F7FB"/>
      <g transform="translate(200, 100)" fill="#0066CC" text-anchor="middle" font-family="PingFang SC, Microsoft YaHei, sans-serif">
        <rect x="0" y="0" width="240" height="80" fill="#FFFFFF" stroke="#D7E2EF"/>
        <text x="120" y="48" font-size="22" data-w="200" data-h="28">居中标题</text>
      </g>
      <circle cx="100" cy="100" r="20" fill="#00A6D6"/>
      <text x="40" y="200" font-size="16" fill="#14202B" data-w="120" data-h="22">旁注</text>
    `);
    const result = compileSvgPreviewToSlide(pptx, slide, svg, { minObjects: 1 });
    assert.ok(result.ok, `g 继承用例应编译成功: ${result.reason}`);
    const title = texts.find((t) => t.text === "居中标题");
    assert.ok(title, "应渲染继承组内文本");
    assert.equal(title?.options.align, "center", "应继承 text-anchor=middle");
    assert.equal(title?.options.fontFace, "Microsoft YaHei", "PingFang 应回退到 Microsoft YaHei");
    assert.equal(title?.options.lang, "zh-CN", "中文 run 应标记 zh-CN");
    assert.equal(title?.options.fit, "none", "不应启用 shrink autofit");
    assert.equal(title?.options.color, "0066CC", "应继承 g fill 作为文字色");
    // translate(200,100) 后锚点 x≈320；CJK 加宽后框左缘略左移，仍应明显高于无 translate（≈0.1–1.0in）
    const titleX = Number(title?.options.x);
    assert.ok(titleX > 2.0, `translate 后文本框 x 应明显右移, got ${titleX}`);
    assert.ok(Number(title?.options.fontSize) >= 14, `字号应按 ~0.75 换算而不过度缩小, got ${title?.options.fontSize}`);
    assert.ok(shapes.some((s) => s.shapeType === "rect"), "组内 rect 应渲染");
    console.log("✓ defense: g inherit + translate + safe font");
  }

  // 6) polygon / polyline 应保留为单个可编辑自由形状
  {
    const { pptx, slide, shapes } = createMockTarget();
    const svg = wrapSvg(`
      <rect x="40" y="40" width="200" height="100" fill="#fff"/>
      <polygon points="80,200 160,120 240,200" fill="none" stroke="#0066CC" stroke-width="2"/>
      <polyline points="300,180 360,220 420,160" fill="none" stroke="#00A6D6" stroke-width="2"/>
      <text x="80" y="90" font-size="18" fill="#14202B" data-w="100" data-h="24">Poly</text>
    `);
    compileSvgPreviewToSlide(pptx, slide, svg, { minObjects: 1 });
    const customPaths = shapes.filter((shape) =>
      String(shape.options.objectName ?? "").startsWith("SVGCG_")
    );
    assert.equal(customPaths.length, 2, "polygon/polyline 应各自保留为一个自由形状");
    console.log("✓ editable: polygon/polyline kept as custom geometry");
  }

  // 7) matrix transform 过多 → 编译失败（触发 IR 降级，避免错位导出）
  {
    const { pptx, slide } = createMockTarget();
    const svg = wrapSvg(`
      <rect x="40" y="40" width="200" height="100" fill="#fff"/>
      <g transform="matrix(1 0 0 1 40 40)"><text x="10" y="40" font-size="18" fill="#14202B" data-w="80" data-h="24">A</text></g>
      <g transform="scale(1.2)"><text x="10" y="80" font-size="18" fill="#14202B" data-w="80" data-h="24">B</text></g>
      <circle cx="200" cy="200" r="30" fill="#0066CC"/>
      <text x="80" y="300" font-size="16" fill="#14202B" data-w="100" data-h="22">C</text>
    `);
    const result = compileSvgPreviewToSlide(pptx, slide, svg, { minObjects: 1 });
    assert.equal(result.ok, false, "含多处 unsupported transform 应失败");
    assert.equal(result.reason, "unsupported_transform");
    console.log("✓ defense: unsupported transform fails compile");
  }

  // 8) CJK 正文：文本框应加宽（防提前换行）；字号仍按 ~0.75
  {
    const { pptx, slide } = createMockTarget();
    const texts: Array<{ text: unknown; options: Record<string, unknown> }> = [];
    slide.addText = (text, options) => {
      texts.push({ text, options });
    };
    const body =
      "明确下阶段重点，防范潜在风险，确保项目高质量交付。";
    const dataW = 220;
    const svg = wrapSvg(`
      <rect x="40" y="40" width="1280" height="720" fill="#FFF7F0"/>
      <rect x="48" y="180" width="260" height="480" fill="#F97316"/>
      <text x="72" y="320" font-size="20" fill="#FFFFFF" data-w="${dataW}" data-h="96" font-family="Microsoft YaHei, sans-serif">${body}</text>
      <text x="72" y="80" font-size="32" fill="#14202B" data-w="480" data-h="44">下阶段规划与潜在风险应对</text>
    `);
    const result = compileSvgPreviewToSlide(pptx, slide, svg, { minObjects: 1 });
    assert.ok(result.ok, `CJK fixture 应编译成功: ${result.reason}`);
    const bodyText = texts.find((t) => typeof t.text === "string" && String(t.text).includes("潜在风险"));
    assert.ok(bodyText, "应渲染橙块正文");
    const boxWIn = Number(bodyText?.options.w);
    const expectedMinIn = (dataW * 1.12) / 1280 * 13.333;
    assert.ok(
      boxWIn >= expectedMinIn * 0.98,
      `CJK 文本框应至少加宽 ~12%, got w=${boxWIn}, expect>=${expectedMinIn}`
    );
    assert.ok(Number(bodyText?.options.fontSize) >= 14.5 && Number(bodyText?.options.fontSize) <= 16, `正文 20px → ~15pt, got ${bodyText?.options.fontSize}`);
    assert.equal(bodyText?.options.fit, "none");
    console.log(`✓ defense: CJK wrap pad (w=${boxWIn.toFixed(3)}in, fontSize=${bodyText?.options.fontSize})`);
  }

  // 9) 小徽章：保留 data-h，valign middle；字号不撑破框
  {
    const { pptx, slide } = createMockTarget();
    const texts: Array<{ text: unknown; options: Record<string, unknown> }> = [];
    slide.addText = (text, options) => {
      texts.push({ text, options });
    };
    const svg = wrapSvg(`
      <rect x="0" y="0" width="1280" height="720" fill="#FFF7F0"/>
      <rect x="980" y="48" width="240" height="36" rx="8" fill="#F97316"/>
      <text x="1100" y="72" font-size="14" fill="#FFFFFF" text-anchor="middle" data-w="220" data-h="36" font-family="Microsoft YaHei, Arial, sans-serif">ROADMAP &amp; RISK CONTROL</text>
      <circle cx="100" cy="100" r="16" fill="#00A6D6"/>
      <text x="40" y="200" font-size="16" fill="#14202B" data-w="100" data-h="22">旁注</text>
    `);
    const result = compileSvgPreviewToSlide(pptx, slide, svg, { minObjects: 1 });
    assert.ok(result.ok, `徽章 fixture 应编译成功: ${result.reason}`);
    const badge = texts.find((t) => typeof t.text === "string" && String(t.text).includes("ROADMAP"));
    assert.ok(badge, "应渲染 ROADMAP 徽章文字");
    const hIn = Number(badge?.options.h);
    const expectedHIn = (36 / 720) * 7.5;
    assert.ok(
      hIn >= expectedHIn * 0.95,
      `徽章应保留 data-h≈36u, got h=${hIn}, expect≈${expectedHIn}`
    );
    assert.equal(badge?.options.valign, "middle", "徽章应垂直居中");
    assert.equal(badge?.options.align, "center");
    assert.ok(Number(badge?.options.fontSize) <= 12, `徽章字号应适配小框, got ${badge?.options.fontSize}`);
    console.log(`✓ defense: badge data-h + valign (h=${hIn.toFixed(3)}in, fontSize=${badge?.options.fontSize})`);
  }

  // 10) 曲线填充 path 必须保留为自由形状元数据，不得再降级为椭圆
  {
    const { pptx, slide, shapes } = createMockTarget();
    const svg = wrapSvg(`
      <rect x="40" y="40" width="200" height="120" fill="#fff"/>
      <path d="M 0 12 L 0 108 C 0 114.6 5.4 120 12 120 L 12 0 C 5.4 0 0 5.4 0 12 Z" fill="#F97316"/>
      <text x="80" y="100" font-size="20" fill="#14202B" data-w="80" data-h="24">Blob</text>
    `);
    compileSvgPreviewToSlide(pptx, slide, svg, { minObjects: 1 });
    const lines = shapes.filter((s) => s.shapeType === "line");
    const ellipses = shapes.filter((s) => s.shapeType === "ellipse");
    const editable = shapes.find((shape) =>
      String(shape.options.objectName ?? "").startsWith("SVGCG_")
    );
    assert.equal(lines.length, 0, "填充曲线 path 不得拆成线");
    assert.equal(ellipses.length, 0, "填充曲线 path 不得近似为 ellipse");
    assert.ok(editable, "应产生带自由形状元数据的占位形状");
    const metadata = decodeSvgShapeMetadata(String(editable?.options.objectName));
    assert.ok(metadata?.path?.includes("C 0 114.6"), "应保留原始贝塞尔控制点");
    const geometry = buildOoxmlCustomGeometry(metadata?.path ?? "", 114300, 1143000);
    assert.ok(geometry?.includes("<a:cubicBezTo>"), "OOXML 应包含三次贝塞尔段");
    assert.ok(geometry?.includes('w="114300" h="1143000"'), "OOXML 路径坐标系应与形状尺寸一致");
    console.log("✓ editable: cubic path → OOXML custom geometry");
  }

  // 11) SVG 渐变需保留 stops/方向，后处理写入 gradFill
  {
    const { pptx, slide, shapes } = createMockTarget();
    const svg = wrapSvg(`
      <defs>
        <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#EA580C"/>
          <stop offset="100%" stop-color="#F97316" stop-opacity="0.8"/>
        </linearGradient>
      </defs>
      <rect x="40" y="40" width="200" height="120" rx="12" fill="url(#accentGrad)"/>
      <circle cx="300" cy="100" r="20" fill="#00A6D6"/>
      <text x="80" y="100" font-size="20" fill="#14202B" data-w="80" data-h="24">Gradient</text>
    `);
    compileSvgPreviewToSlide(pptx, slide, svg, { minObjects: 1 });
    const editable = shapes.find((shape) =>
      String(shape.options.objectName ?? "").startsWith("SVGCG_")
    );
    const metadata = decodeSvgShapeMetadata(String(editable?.options.objectName));
    assert.equal(metadata?.gradient?.stops.length, 2, "应保留两个渐变 stop");
    assert.equal(metadata?.gradient?.angle, 0, "水平渐变应为 0°");
    assert.equal(Math.round(metadata?.gradient?.stops[1]?.transparency ?? 0), 20, "应保留 stop-opacity");
    console.log("✓ editable: linearGradient metadata kept");
  }

  // 12) A/S/T 命令需规范化为 PPT 支持的贝塞尔段
  {
    const arc = buildOoxmlCustomGeometry("M 20 60 A 40 40 0 0 1 100 60 S 160 100 200 60", 1800000, 720000);
    assert.ok(arc, "A/S 路径应可转换");
    assert.ok((arc?.match(/<a:cubicBezTo>/g)?.length ?? 0) >= 3, "圆弧和平滑曲线应转成多段三次贝塞尔");
    const smoothQuad = buildOoxmlCustomGeometry("M 20 80 Q 60 20 100 80 T 180 80", 1600000, 600000);
    assert.ok((smoothQuad?.match(/<a:quadBezTo>/g)?.length ?? 0) === 2, "T 应反射上一个二次控制点");
    console.log("✓ editable: arc/smooth commands normalized");
  }

  // 13) 虚线、连接箭头和虚线边框应映射到 PPT 原生 line 样式
  {
    const { pptx, slide, shapes } = createMockTarget();
    const svg = wrapSvg(`
      <defs>
        <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 Z" fill="#E11D48"/>
        </marker>
      </defs>
      <rect x="40" y="40" width="180" height="90" rx="8" fill="#FFFFFF" stroke="#EA580C" stroke-width="1.5" stroke-dasharray="4,4"/>
      <line x1="260" y1="80" x2="520" y2="80" stroke="#E11D48" stroke-width="1.5" stroke-dasharray="3,3" marker-end="url(#arrow)"/>
      <circle cx="600" cy="80" r="24" fill="none" stroke="#FED7AA" stroke-width="1" stroke-dasharray="2,2"/>
      <text x="60" y="90" font-size="18" fill="#14202B" data-w="120" data-h="24">Connector</text>
    `);
    compileSvgPreviewToSlide(pptx, slide, svg, { minObjects: 1 });
    const connector = shapes.find((shape) => shape.shapeType === "line");
    const connectorLine = connector?.options.line as Record<string, unknown> | undefined;
    assert.equal(connectorLine?.endArrowType, "triangle", "marker-end 应映射为 PPT 箭头");
    assert.ok(connectorLine?.dashType, "连接线应保留虚线类型");
    const dashedBorders = shapes.filter((shape) => {
      const line = shape.options.line as Record<string, unknown> | undefined;
      return Boolean(line?.dashType);
    });
    assert.ok(dashedBorders.length >= 3, "矩形、连接线和圆的虚线都应保留");
    console.log("✓ editable: dashes + marker arrow kept");
  }

  // 14) 金色指数：保持暮光蓝灰层级，金色只承担强调角色
  {
    const source = wrapSvg(`
      <rect width="1280" height="720" fill="#FFF8F5"/>
      <rect x="100" y="100" width="420" height="220" fill="#FFFFFF" stroke="#FED7AA"/>
      <rect x="100" y="100" width="12" height="220" fill="#EA580C"/>
      <text x="140" y="180" fill="#1C1917" font-size="28">Luxury Gold</text>
    `);
    const recolored = recolorSvgPreview(source, "gold-index", { accentId: "gold" });
    const tokens = getThemePack("gold-index").tokens;
    assert.equal(tokens.bg, "#1C2740", "金色指数背景应保持参考 theme10 的暮光蓝灰");
    assert.equal(tokens.primary, "#D7A85B", "金色指数主色应保持参考 theme10 的柔沙金");
    assert.ok(recolored.includes(tokens.bg), "应换为暮光蓝灰背景");
    assert.ok(recolored.includes(tokens.card), "白卡片应换为独立的蓝灰卡片色");
    assert.ok(recolored.includes(tokens.primary), "主强调色应为参考项目的柔沙金");
    assert.notEqual(tokens.bg, tokens.card, "背景与卡片必须有明度层级");
    assert.notEqual(tokens.card, tokens.primary, "金色不能铺满卡片表面");
    console.log("✓ theme: reference dusk-gold hierarchy kept");
  }

  // 15) 黑金实验：参考 theme08 是暖白纸面 + 墨黑 + 电光黄，而非另一套棕黑金
  {
    const tokens = getThemePack("black-gold").tokens;
    assert.equal(getThemePack("black-gold").family, "light", "黑金实验应归入明亮主题族");
    assert.equal(tokens.bg, "#FBFAF4", "黑金实验应使用参考 theme08 的暖白纸面");
    assert.equal(tokens.title, "#16150F", "黑金实验应使用参考 theme08 的近黑结构色");
    assert.equal(tokens.primary, "#E2E62A", "黑金实验应使用参考 theme08 的电光黄");
    console.log("✓ theme: reference black-lab palette kept");
  }
}

function main() {
  runDefenseCases();

  if (!fs.existsSync(EXAMPLES_DIR)) {
    console.warn(`[svg-compile-regression] examples skip: ${EXAMPLES_DIR}`);
    console.log("\n[svg-compile-regression] OK: defense cases only");
    return;
  }

  let passed = 0;
  const results: Array<{ file: string; rendered: number; ok: boolean; reason?: string }> = [];

  for (const spec of CASES) {
    const fullPath = path.join(EXAMPLES_DIR, spec.file);
    if (!fs.existsSync(fullPath)) {
      console.warn(`[svg-compile-regression] skip missing: ${spec.file}`);
      continue;
    }

    const svg = fs.readFileSync(fullPath, "utf8");
    const { pptx, slide } = createMockTarget();
    const result = compileSvgPreviewToSlide(pptx, slide, svg, { minObjects: 1 });

    results.push({
      file: spec.file,
      rendered: result.rendered,
      ok: result.ok,
      reason: result.reason
    });

    assert.ok(!result.reason || result.reason !== "parse_failed", `${spec.file}: XML 解析失败`);
    assert.ok(
      result.rendered >= spec.minRendered,
      `${spec.file}: rendered=${result.rendered} < min=${spec.minRendered}`
    );
    passed += 1;
    console.log(`✓ ${spec.file}: rendered=${result.rendered} (>= ${spec.minRendered})`);
  }

  console.log(`\n[svg-compile-regression] OK: defense + ${passed}/${CASES.length} examples`);
  if (results.length) {
    console.log(JSON.stringify({ examplesDir: EXAMPLES_DIR, results }, null, 2));
  }
}

main();
