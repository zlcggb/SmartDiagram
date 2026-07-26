import assert from "node:assert/strict";
import test from "node:test";
import { validateSvgThemeCompliance, type SlideDto } from "@ppt-agent/shared";
import { MockGeminiAdapter } from "../mockGeminiAdapter.js";
import { buildSvgPreviewPrompt } from "../prompts.js";
import { buildDesignRecipeInstruction } from "./assembler.js";
import { selectDesignRecipe } from "./selector.js";
import { DESIGN_RECIPES } from "./templates.js";
import { validateSvgAgainstDesignRecipe } from "./visualQuality.js";

function makeSlide(overrides: Partial<SlideDto> = {}): SlideDto {
  return {
    id: "slide-1",
    projectId: "project-1",
    sortOrder: 1,
    title: "AI应用工程师全面成长指南",
    slideGoal: "说明两类能力如何融合",
    keyMessage: "大模型工具链与传统全栈深度融合，推动工程师跃迁为系统架构师",
    contentPoints: ["大模型与专属工具链", "传统全栈与工程实践"],
    recommendedLayout: "generic-cards",
    status: "planned",
    isContentLocked: false,
    isLayoutLocked: false,
    sourceFactIds: [],
    generationStatus: "draft-ready",
    planJson: {
      title: "AI应用工程师全面成长指南",
      pageGoal: "说明两类能力如何融合",
      keyMessage: "大模型工具链与传统全栈深度融合，推动工程师跃迁为系统架构师",
      layoutType: "generic-cards",
      contentBlocks: [
        { type: "bullets", title: "大模型与专属工具链", items: ["掌握提示词工程与RAG", "设计Agent协同流程"] },
        { type: "bullets", title: "传统全栈与工程实践", items: ["具备后端开发与优化能力", "建立监控评估体系"] }
      ],
      sourceFactIds: [],
      visualHint: { chartType: "none", heroVisual: "两类能力融合为系统架构能力", emphasis: ["深度融合"] }
    },
    ...overrides
  } as SlideDto;
}

test("两个互补能力模块选择双引擎桥接，而不是通用卡片墙", () => {
  const selected = selectDesignRecipe(makeSlide());
  assert.equal(selected.recipe.id, "dual-engine-bridge");
  assert.match(selected.reason, /双模块|内容语义/);
});

test("时间线视觉提示选择阶梯路线图", () => {
  const slide = makeSlide({
    title: "四步成长路线",
    recommendedLayout: "timeline",
    planJson: {
      ...makeSlide().planJson!,
      layoutType: "timeline",
      visualHint: { chartType: "timeline", heroVisual: "从入门到架构的阶梯路径" },
      contentBlocks: [
        { type: "timeline", title: "基础", items: ["掌握模型调用"] },
        { type: "timeline", title: "应用", items: ["构建RAG系统"] },
        { type: "timeline", title: "工程", items: ["建立评估体系"] },
        { type: "timeline", title: "架构", items: ["设计Agent平台"] }
      ]
    }
  });
  assert.equal(selectDesignRecipe(slide).recipe.id, "stepped-roadmap");
});

test("数据型页面选择证据型数据叙事", () => {
  const slide = makeSlide({
    title: "关键指标与增长趋势",
    recommendedLayout: "metrics",
    planJson: {
      ...makeSlide().planJson!,
      layoutType: "metrics",
      visualHint: { chartType: "line", heroVisual: "核心指标趋势图" }
    }
  });
  assert.equal(selectDesignRecipe(slide).recipe.id, "evidence-dashboard");
});

test("风险表布局优先选择风险登记配方，不被系统语义误判为中心辐射生态", () => {
  const slide = makeSlide({
    title: "内部通信密钥一旦泄露，PPT 引擎可能被直接操纵",
    slideGoal: "说明三类高优先级风险与闭环措施",
    keyMessage: "PPT_INTERNAL_API_SECRET 是最高权限凭据，必须完成存储、传输、使用和审计闭环",
    recommendedLayout: "risk-table",
    contentPoints: ["核心权限越权风险", "生命周期管理不足", "隔离收益受运维回灌影响"],
    planJson: {
      ...makeSlide().planJson!,
      title: "内部通信密钥一旦泄露，PPT 引擎可能被直接操纵",
      pageGoal: "说明三类高优先级风险与闭环措施",
      keyMessage: "PPT_INTERNAL_API_SECRET 是最高权限凭据，必须完成全链路闭环",
      layoutType: "risk-table",
      visualHint: {
        chartType: "none",
        heroVisual: "左侧主结论条 + 三张横向风险卡",
        emphasis: ["最高权限凭据", "全链路闭环"]
      },
      contentBlocks: [
        { type: "bullets", title: "风险一：核心权限越权", items: ["泄露后可能绕过业务校验"] },
        { type: "bullets", title: "风险二：生命周期管理不足", items: ["轮换与吊销必须形成制度"] },
        { type: "bullets", title: "风险三：隔离收益被回灌", items: ["高权限口令不得回流普通链路"] }
      ]
    }
  });

  const selected = selectDesignRecipe(slide);
  assert.equal(selected.recipe.id, "risk-register");
  assert.match(selected.reason, /risk-table|风险/);
});

test("风险页会按演示风格切换构图，而不是始终锁死三列风险卡", () => {
  const slide = makeSlide({
    title: "内部通信密钥一旦泄露，PPT 引擎可能被直接操纵",
    recommendedLayout: "risk-table",
    contentPoints: ["核心权限越权风险", "生命周期管理不足", "隔离收益受运维回灌影响"],
    planJson: {
      ...makeSlide().planJson!,
      layoutType: "risk-table",
      visualHint: { chartType: "none", heroVisual: "三类风险与治理闭环" },
      contentBlocks: [
        { type: "bullets", title: "风险一：核心权限越权", items: ["泄露后可能绕过业务校验"] },
        { type: "bullets", title: "风险二：生命周期管理不足", items: ["轮换与吊销必须形成制度"] },
        { type: "bullets", title: "风险三：隔离收益被回灌", items: ["高权限口令不得回流普通链路"] }
      ]
    }
  });

  assert.equal(selectDesignRecipe(slide, "consulting").recipe.id, "risk-register");
  assert.equal(selectDesignRecipe(slide, "data-story").recipe.id, "risk-signal-story");
  assert.equal(selectDesignRecipe(slide, "apple-minimal").recipe.id, "asymmetric-card-stack");
  assert.notEqual(
    selectDesignRecipe(slide, "data-story").recipe.id,
    selectDesignRecipe(slide, "apple-minimal").recipe.id
  );
});

test("组装后的配方包含坐标、语义分组、形状程序与退化禁令", () => {
  const instruction = buildDesignRecipeInstruction(makeSlide());
  assert.match(instruction, /dual-engine-bridge/);
  assert.match(instruction, /<g id="visual-anchor">/);
  assert.match(instruction, /x=548, y=300, w=184, h=220/);
  assert.match(instruction, /形状组装程序/);
  assert.match(instruction, /禁止纯文字平铺/);
  assert.match(instruction, /必须实际使用的非矩形图元：path、circle/);
});

test("SVG 提示使用视觉配方且不再注入锁死的通用坐标骨架", () => {
  const prompt = buildSvgPreviewPrompt(makeSlide(), []);
  assert.match(prompt, /本页视觉配方（SVG 阶段最高优先级）/);
  assert.match(prompt, /SVG 只继承上述页面角色与信息意图，不继承通用坐标骨架/);
  assert.doesNotMatch(prompt, /有坐标骨架时禁止改几何/);
  assert.doesNotMatch(prompt, /坐标骨架模板/);
});

test("SVG 提示默认使用战略咨询风格契约", () => {
  const prompt = buildSvgPreviewPrompt(makeSlide(), []);
  assert.match(prompt, /STYLE_CONTRACT/);
  assert.match(prompt, /styleId: consulting/);
  assert.match(prompt, /名称: 战略咨询/);
  assert.match(prompt, /禁止整高侧边色条/);
  assert.match(prompt, /按 layer 从低到高输出/);
  assert.match(prompt, /独立业务区不得相交/);
  assert.doesNotMatch(prompt, /Design Bento/);
});

test("SVG 提示可显式切换为 Apple 极简风格", () => {
  const prompt = buildSvgPreviewPrompt(
    makeSlide(),
    [],
    "white-blue",
    undefined,
    [],
    undefined,
    undefined,
    "apple-minimal"
  );

  assert.match(prompt, /styleId: apple-minimal/);
  assert.match(prompt, /名称: Apple 极简/);
  assert.match(prompt, /每页只建立一个视觉重心/);
  assert.match(prompt, /等宽卡片墙/);
});

test("第二次 SVG 提示携带上一候选并要求定向修复而非重新设计", () => {
  const previousSvg = '<svg viewBox="0 0 1280 720"><g id="content-zone-1"><rect x="72" y="226" width="8" height="348"/></g></svg>';
  const prompt = buildSvgPreviewPrompt(
    makeSlide(),
    [],
    "white-blue",
    undefined,
    ["content-zone-1 检测到附着式整高强调色条"],
    undefined,
    previousSvg
  );

  assert.match(prompt, /仅修复/);
  assert.match(prompt, /上一候选 SVG/);
  assert.match(prompt, /content-zone-1 检测到附着式整高强调色条/);
  assert.match(prompt, /<svg viewBox="0 0 1280 720">/);
});

test("视觉配方声明最小间距和显式允许的重叠", () => {
  for (const recipe of DESIGN_RECIPES) {
    assert.ok(recipe.minGutter >= 24, `${recipe.id} minGutter`);
    for (const [left, right] of recipe.allowedOverlaps) {
      assert.ok(recipe.zones.some((zone) => zone.id === left), `${recipe.id} overlap left ${left}`);
      assert.ok(recipe.zones.some((zone) => zone.id === right), `${recipe.id} overlap right ${right}`);
    }
  }
});

test("视觉配方中的独立坐标区默认不相交", () => {
  for (const recipe of DESIGN_RECIPES) {
    const allowed = new Set(
      recipe.allowedOverlaps.flatMap(([left, right]) => [`${left}|${right}`, `${right}|${left}`])
    );
    for (let leftIndex = 0; leftIndex < recipe.zones.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < recipe.zones.length; rightIndex += 1) {
        const left = recipe.zones[leftIndex]!;
        const right = recipe.zones[rightIndex]!;
        if (left.role === "connector" || right.role === "connector" || allowed.has(`${left.id}|${right.id}`)) {
          continue;
        }
        const overlapWidth = Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x);
        const overlapHeight = Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y);
        assert.ok(
          overlapWidth <= 0 || overlapHeight <= 0,
          `${recipe.id}: ${left.id} overlaps ${right.id} by ${overlapWidth}x${overlapHeight}`
        );
      }
    }
  }
});

test("视觉配方提示要求真实 DOM 层级并禁止整高色轨", () => {
  const instruction = buildDesignRecipeInstruction(makeSlide());
  assert.match(instruction, /最小间距：24px/);
  assert.match(instruction, /按 layer 从低到高输出/);
  assert.match(instruction, /禁止.*整高.*色条/);
});

test("SVG 提示把浅色主题作为结构化硬契约传给设计模型", () => {
  const prompt = buildSvgPreviewPrompt(makeSlide(), [], "white-blue");
  assert.match(prompt, /THEME_CONTRACT/);
  assert.match(prompt, /"themeId": "white-blue"/);
  assert.match(prompt, /"canvasMode": "light"/);
  assert.match(prompt, /"canvas": "#EDF6FB"/);
  assert.match(prompt, /浅色主题禁止深蓝、深灰、黑色大面积铺底/);
});

test("浅色主题质量门禁拒绝深色全画布背景", () => {
  const svg = '<svg viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#111827"/><text data-w="300" data-h="50">标题</text></svg>';
  const result = validateSvgThemeCompliance(svg, "white-blue");
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes("浅色主题") && issue.includes("#111827")));
});

test("浅色主题质量门禁接受主题包规定的浅色画布", () => {
  const svg = '<svg viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#EDF6FB"/><text data-w="300" data-h="50">标题</text></svg>';
  const result = validateSvgThemeCompliance(svg, "white-blue");
  assert.deepEqual(result.issues, []);
});

test("浅色主题质量门禁也会检查全画布渐变的颜色", () => {
  const svg = '<svg viewBox="0 0 1280 720"><defs><linearGradient id="bg"><stop offset="0" stop-color="#071C33"/><stop offset="1" stop-color="#111827"/></linearGradient></defs><rect width="1280" height="720" fill="url(#bg)"/></svg>';
  const result = validateSvgThemeCompliance(svg, "white-blue");
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes("浅色主题")));
});

test("视觉质量检查能识别缺少语义层和非矩形图元的卡片墙", () => {
  const svg = '<svg viewBox="0 0 1280 720"><rect width="1280" height="720"/><rect/><rect/><rect/><rect/><rect/><text data-w="10" data-h="10">A</text></svg>';
  const result = validateSvgAgainstDesignRecipe(svg, makeSlide());
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes("visual-anchor")));
  assert.ok(result.issues.some((issue) => issue.includes("卡片墙")));
});

test("视觉质量门禁拒绝中央主视觉遮挡内容卡", () => {
  const svg = `<svg viewBox="0 0 1280 720">
    <g id="background-layer"><rect width="1280" height="720"/></g>
    <g id="connector-layer"><path d="M500 400 L560 400"/></g>
    <g id="content-zone-1"><rect x="72" y="226" width="500" height="388"/></g>
    <g id="content-zone-2"><rect x="768" y="226" width="440" height="388"/></g>
    <g id="visual-anchor"><circle cx="560" cy="410" r="86"/></g>
    <g id="title-zone"><text x="72" y="104" data-w="620" data-h="52">标题</text></g>
  </svg>`;
  const result = validateSvgAgainstDesignRecipe(svg, makeSlide());
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => /visual-anchor.*content-zone-1|content-zone-1.*visual-anchor/.test(issue)));
});

test("Mock 设计输出也遵循选中配方，避免开发环境回退成旧卡片墙", async () => {
  const slide = makeSlide();
  const svg = await new MockGeminiAdapter().generateSvgPreview(slide, []);
  const result = validateSvgAgainstDesignRecipe(svg, slide);
  assert.equal(result.recipeId, "dual-engine-bridge");
  assert.deepEqual(result.issues, []);
  assert.doesNotMatch(svg, /width="7"\s+height="/);
  assert.match(svg, /id="visual-anchor"/);
  assert.match(svg, /id="connector-layer"/);
});

test("Mock 设计输出覆盖核心视觉配方且全部通过空间门禁", async () => {
  const block = (title: string) => ({ type: "bullets" as const, title, items: [`${title}证据`] });
  const cases: Array<[string, SlideDto]> = [
    ["dual-engine-bridge", makeSlide()],
    [
      "radial-ecosystem",
      makeSlide({
        title: "平台系统架构与组件生态",
        recommendedLayout: "architecture",
        planJson: {
          ...makeSlide().planJson!,
          layoutType: "architecture",
          contentBlocks: [block("接入层"), block("能力层"), block("治理层")]
        }
      })
    ],
    [
      "risk-register",
      makeSlide({
        title: "三类高优先级安全风险",
        recommendedLayout: "risk-table",
        planJson: {
          ...makeSlide().planJson!,
          layoutType: "risk-table",
          contentBlocks: [block("越权风险"), block("轮换风险"), block("隔离风险")]
        }
      })
    ],
    [
      "stepped-roadmap",
      makeSlide({
        title: "四步行动路线",
        recommendedLayout: "timeline",
        planJson: {
          ...makeSlide().planJson!,
          layoutType: "timeline",
          visualHint: { chartType: "timeline", heroVisual: "阶段路径" },
          contentBlocks: [block("阶段一"), block("阶段二"), block("阶段三"), block("阶段四")]
        }
      })
    ],
    [
      "evidence-dashboard",
      makeSlide({
        title: "关键指标增长趋势",
        recommendedLayout: "metrics",
        planJson: {
          ...makeSlide().planJson!,
          layoutType: "metrics",
          visualHint: { chartType: "line", heroVisual: "指标趋势" },
          contentBlocks: [block("核心指标"), block("增长证据")]
        }
      })
    ],
    [
      "matrix-contrast",
      makeSlide({
        title: "现状与目标方案对比",
        recommendedLayout: "comparison",
        planJson: {
          ...makeSlide().planJson!,
          layoutType: "comparison",
          visualHint: { chartType: "table", heroVisual: "对照矩阵" },
          contentBlocks: [block("现状"), block("目标")]
        }
      })
    ],
    [
      "editorial-hero-split",
      makeSlide({
        title: "面向未来的工程指南",
        recommendedLayout: "cover",
        contentPoints: ["工程指南"],
        planJson: {
          ...makeSlide().planJson!,
          layoutType: "cover",
          contentBlocks: [block("章节导语")]
        }
      })
    ],
    [
      "asymmetric-card-stack",
      makeSlide({
        title: "四类工作原则与方法",
        slideGoal: "归纳四类原则",
        keyMessage: "四类原则共同构成稳定的方法体系",
        recommendedLayout: "generic-cards",
        contentPoints: ["原则一", "原则二", "原则三", "原则四"],
        planJson: {
          ...makeSlide().planJson!,
          title: "四类工作原则与方法",
          pageGoal: "归纳四类原则",
          keyMessage: "四类原则共同构成稳定的方法体系",
          layoutType: "generic-cards",
          visualHint: { chartType: "none", heroVisual: "一大三小的信息层级" },
          contentBlocks: [block("原则一"), block("原则二"), block("原则三"), block("原则四")]
        }
      })
    ],
    [
      "quote-monument",
      makeSlide({
        title: "一句话总结关键本质",
        recommendedLayout: "statement",
        contentPoints: ["关键结论"],
        planJson: {
          ...makeSlide().planJson!,
          layoutType: "statement",
          contentBlocks: []
        }
      })
    ]
  ];

  for (const [expectedRecipe, slide] of cases) {
    assert.equal(selectDesignRecipe(slide).recipe.id, expectedRecipe);
    const svg = await new MockGeminiAdapter().generateSvgPreview(slide, []);
    assert.deepEqual(validateSvgAgainstDesignRecipe(svg, slide).issues, [], expectedRecipe);
  }
});
