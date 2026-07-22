# PPT-Agent 优化方案（可执行）（2026-07-17）

> 依据：[`HYBRID_IR_SVG_STRATEGY.md`](./HYBRID_IR_SVG_STRATEGY.md)、[`REFERENCE_svg2pptx_analysis.md`](./REFERENCE_svg2pptx_analysis.md)、[`ARCHITECTURE_REVIEW_2026-07-17.md`](./ARCHITECTURE_REVIEW_2026-07-17.md)、[`../prd/editable-ppt-agent-engine-prd.md`](../prd/editable-ppt-agent-engine-prd.md)、[`../../README.md`](../../README.md)，以及参考契约 `references/svg2pptx-skill/references/shared-standards.md`。  
> 范围：**只定契约与落地步骤**；本文不改业务代码。P0 供并行 Agent 按接口契约实现。

---

## 1. 目标与非目标

### 1.1 目标

1. **纠正架构漂移**：正式导出不再「几乎强制 SVG、失败整份挂掉」；改为**按页策略**（IR / SVG / Hybrid）编译，失败可降级。
2. **IR + SVG 相辅相成**：IR 保内容契约、可编辑骨架与兜底；可编译 SVG 保布局创意与视觉上限；原生 PPTX 为唯一交付物。
3. **硬化可编译 SVG 契约**：从 `shared-standards` 抽出硬门禁，写入提示词 + 导出前检查，避免静默丢元素。
4. **产品化导出模式**：`draft` / `standard` / `visual` 映射到策略，兼顾速度、成本与观感。
5. **为并行落地提供稳定接口**：shared schema、API body、renderer 入参、前端字段一次定清，减少合并冲突。

### 1.2 非目标（本方案明确不做）

| 非目标 | 原因 |
|--------|------|
| 整仓迁入 Python `svg2pptx-skill` / `ppt-master` 产品流 | 多运行时、场景不同；参考契约即可（见 REFERENCE 文档） |
| 放弃 pptxgenjs，全面改写 DrawingML OOXML | P1 前 ROI 低；先契约与降级 |
| 完整在线 PPT 编辑器、模板商城、多人协作 | PRD Non-Goals / P3 |
| 文档 / PDF / 网页导入 | PRD Non-Goals |
| 生产鉴权、Postgres、CI 全套 | 属 P2+ 运维线，不阻塞 P0 契约 |
| 推倒重写 `ppt-renderer` 全文件 | P0 只改导出优先级与门禁入口；拆分放 P1 |

---

## 2. 现状架构与问题

### 2.1 理想数据流（PRD + Hybrid 策略）

```text
资料粘贴
  → 事实提取 + 人机确认（事实库权威）
  → 大纲（结构 / recommendedLayout）
  → 单页策划 Plan（信息块，内容权威）
  → Slide IR（可编辑骨架：标题/要点/表格/指标）  ← 内容契约
  → 可编译 SVG（在 Plan/IR 约束下视觉编排）     ← 视觉增强
  → 质检门禁（SVG 硬规则 + IR schema）
  → 按页策略编译 PPTX
       ├─ svg / hybrid：SVG→原生；失败→同页 IR/主题模板
       └─ ir：直接 IR/主题模板；SVG 仅预览
```

### 2.2 当前实现数据流（架构债）

```text
资料 → 事实 → 大纲 → Plan（可选）
     → Gemini SVG/Bento（设计模型）
     → sanitize 幻觉文本 + 弱 validateSvgPreview（重试≤2）
     → renderProjectPptx：优先 renderSvgPreviewSlide
           ├─ SVG 编译成功 → 该页完成
           ├─ 有 SVG 但编译失败 → throw，整份导出失败   ← 致命
           └─ 无 SVG → IR / 主题模板 / fallback（草稿路径）
```

依据（现状代码行为）：

- API：`POST .../export-pptx` 在 `draft !== true` 时要求每页都有 `svgPreview`。
- Renderer：`renderProjectPptx` 中 SVG 编译失败直接 `throw`，不允许同页降级。
- 前端：正式导出前拦截「缺 SVG」；文案偏向「SVG 可编辑正式版」。
- IR / 主题模板主要服务草稿或无 SVG 旁路。

这与 PRD「Slide IR 是模型与渲染器之间的稳定契约」「正式导出目标 L1/L2」发生漂移。

### 2.3 问题清单（按影响）

| # | 问题 | 影响 |
|---|------|------|
| A | 正式导出 SVG-only 门禁 | 成本高、慢；IR 沦为旁路；与 PRD 护城河不一致 |
| B | SVG 编译失败整份失败 | 单页坏设计拖死整份交付 |
| C | 解析靠正则、硬门禁不足 | 复杂嵌套/style/mask 等易静默丢元素 |
| D | 无按页策略字段 | 无法区分「风险表要稳」与「封面要炫」 |
| E | `exportPptxSchema` 仅 `draft: boolean` | 无法表达 standard / visual |
| F | 无自动化回归 | 改 renderer 不敢大胆优化 |
| G | `ppt-renderer` 单体耦合 | 主题 / IR / SVG 难测难拆 |

---

## 3. IR + SVG 相辅相成原则与决策表

### 3.1 原则（必须遵守）

1. **业务正文权威在 Plan / IR / 事实库，不在 SVG。** SVG 文字须来自已确认内容；sanitize 保留。
2. **SVG 是布局与装饰编译源，不是唯一真相。** 可重排版，不可发明新数字/日期。
3. **失败必须可降级。** SVG 编译失败 → 同页 IR/主题模板，不得使「整份 PPT 失败」成为唯一结果。
4. **按页选用，不整链押一种中间态。**

角色分工：

| 角色 | 承担 | 不承担 |
|------|------|--------|
| Slide IR | 内容契约、可编辑骨架、质检、降级 | 海报级自由视觉 |
| 可编译 SVG | 布局创意、Bento、预览与高视觉导出 | 未校验业务正文权威 |
| 原生 PPTX | 最终交付（文本框/形状可改） | 不让模型直接写 OOXML |

### 3.2 「何时用什么」决策表

#### 按页面类型（默认 `renderStrategy`）

| 页面类型（layout / recommendedLayout 关键词） | 默认策略 | 辅路径 | 原因 |
|-----------------------------------------------|----------|--------|------|
| 封面 / 章节 / 强视觉总结（`cover`、`hero`、`section`、`chapter`） | `svg` | 失败→IR | 需要剪影与层次 |
| 流程 / 架构 / 对比 Bento（`process`、`architecture`、`bento`、`compare`、`matrix`） | `svg` 或 `hybrid` | IR 保标题与关键结论 | 关系表达靠布局 |
| 风险表 / 行动计划 / 数据密集（`risk`、`table`、`action`、`metric`、`timeline`） | `ir` | SVG 仅预览 | 表格/指标可编辑优先 |
| 纯文字结论 / 待确认清单（`list`、`blank`、`text`） | `ir` | 可不生成 SVG | 成本与稳定性 |
| 状态/进度卡片（`status-cards`、`progress-cards`、`generic-cards`） | `hybrid` | SVG 失败→IR 卡片 | 观感与可编辑平衡 |

#### 按导出模式（产品按钮）

| 模式 | 行为 | 用户感知 |
|------|------|----------|
| `draft` 快速草稿 | 全页按 `ir`（或主题模板）；跳过设计模型强制 | 快、能改、一般好看 |
| `standard` 标准版（推荐） | 尊重每页 `renderStrategy`；缺 SVG 的 `svg/hybrid` 页降级 IR，不拦整份 | 平衡 |
| `visual` 高视觉版 | 尽量把可视觉页提升为 `svg`；仍失败则降级 IR；禁止整份因单页 SVG 挂掉 | 更好看、更贵、更慢 |

#### 按生成阶段

设计模型（`GEMINI_DESIGN_MODEL`）只应对 `svg` / `hybrid` 页生成 SVG；`ir` 页可跳过，降低 token（P2 可强制，P0 至少不阻塞导出）。

---

## 4. 分阶段路线图

### P0 — 把「相辅相成」写进契约（1–3 天，并行可落）

| 项 | 改哪些包/文件 | 验收标准 | 风险 |
|----|---------------|----------|------|
| P0-1 策略字段与推断 | `packages/shared`；可选 Prisma `Slide.renderStrategy` | schema/DTO 含 `renderStrategy`；有纯函数 `inferRenderStrategy`；单测或可手工验证映射表 | 旧数据无字段→必须有默认推断 |
| P0-2 导出模式 | `shared` `exportPptxSchema`；`apps/api` `export-pptx`；`apps/web` store/UI | body 支持 `mode: draft\|standard\|visual`；兼容旧 `draft: true` | 前后端枚举不一致导致 400 |
| P0-3 导出优先级与降级 | `packages/ppt-renderer` `renderProjectPptx`；API 去掉「缺 SVG 则 400」硬拦（standard/visual） | svg/hybrid 先 SVG，失败写 IR；ir 直 IR；**有 SVG 编译失败不得整份 throw** | 降级后视觉落差需在响应里告知 |
| P0-4 硬门禁 + 文档 | 新建 `docs/00-architecture/COMPILABLE_SVG.md`；`packages/agents` prompts；API `validateSvgPreview` 增强 | 禁 style/class/mask/foreignObject 等；失败重生成或标记降级 | 过严导致设计模型重试成本升 |
| P0-5 前端模式与策略展示 | `App.tsx` / `workbenchStore` / api client | 三模式按钮；页上可见策略；正式导出不再强制全页 SVG | UI 文案与后端 mode 不同步 |

### P1 — 提高 SVG 编译上限（1–2 周）

| 项 | 改哪些包/文件 | 验收标准 | 风险 |
|----|---------------|----------|------|
| P1-1 XML DOM 解析 | `ppt-renderer` 拆出 `svg-compile` | 替代主要正则路径；嵌套/`tspan` 不丢 run | 性能与兼容旧 SVG |
| P1-2 能力补齐 | `svg-compile` | 基础 `linearGradient`、箭头 `marker`、合理 `<g>` | pptxgenjs 能力边界 |
| P1-3 包拆分 | `ppt-renderer` → `svg-compile` / `ir-render` / `themes` | 单测可分别跑 | 大 diff 合并冲突 |
| P1-4 对照回归 | `references/svg2pptx-skill/examples/*.svg` + 本仓 fixture | 对象数/可编辑性对照报告 | 参考仓未提交进主仓，CI 需可选跳过 |

### P2 — 体验与成本（随后）

| 项 | 改哪些包/文件 | 验收标准 | 风险 |
|----|---------------|----------|------|
| P2-1 按页策略切换 UI | web + API patch slide | 用户可强制「这一页只要稳 / 要好看」 | 覆盖默认推断需持久化 |
| P2-2 按策略跳过设计模型 | api generate-all-designs | `ir` 页默认不调设计模型 | 与「全部生成设计」按钮语义变化 |
| P2-3 可编辑等级标注 | shared + export meta | A/B/C 等级写入导出摘要 | 定义漂移需对齐 PRD L1/L2/L3 |
| P2-4 质检与成本看板 | agents + api | 溢出/元素数；token/耗时指标 | 范围易膨胀 |

---

## 5. P0 详细设计（接口契约）

> **并行 Agent 必读本节。** 实现时以本节字段名为准；勿另起同义枚举。

### 5.1 `renderStrategy`：`ir` | `svg` | `hybrid`

#### 语义

| 值 | 导出行为 | 生成 SVG |
|----|----------|----------|
| `ir` | 直接 IR / 主题模板；忽略 SVG 编译结果（SVG 可仍存预览） | 可选，不阻塞导出 |
| `svg` | 优先 SVG→原生；**失败必须降级 IR**（不得 throw 整份） | 推荐有；无则直接 IR |
| `hybrid` | 同 `svg` 的编译优先级；语义上强调「SVG 视觉 + IR 内容锁定」；失败同降级 | 推荐有；无则 IR |

P0 中 `svg` 与 `hybrid` 在编译器内可共用一条路径；区别留给 P2（hybrid 可做「标题/关键 metric 强制来自 IR」的后校验）。P0 至少枚举三分，前端可展示。

#### 默认推断：`inferRenderStrategy(layout: string, options?)`

输入优先级：

1. 显式 `slide.renderStrategy`（若已持久化）
2. `slide.planJson?.layoutType`
3. `slide.recommendedLayout`
4. 页序：`index === 0` → 倾向 `svg`（封面）

推荐实现（伪代码，落在 `packages/shared`）：

```ts
export const renderStrategies = ["ir", "svg", "hybrid"] as const;
export type RenderStrategy = (typeof renderStrategies)[number];

export function inferRenderStrategy(layout: string, index = 0): RenderStrategy {
  const key = `${layout}`.toLowerCase();
  if (!key && index === 0) return "svg";

  // IR 优先：表格 / 行动 / 风险 / 密集数据
  if (/(risk|table|action|清单|计划|metric|timeline|待确认|list|blank|text-only)/i.test(key)) {
    return "ir";
  }
  // SVG 优先：封面 / 章节 / 强视觉 / 流程架构
  if (/(cover|hero|section|chapter|封面|分隔|process|architecture|bento|compare|matrix)/i.test(key)) {
    return "svg";
  }
  // 默认混合：状态卡、通用卡等
  if (/(status|progress|generic|cards|卡片)/i.test(key)) {
    return "hybrid";
  }
  return index === 0 ? "svg" : "hybrid";
}
```

与现有 layout 枚举对齐（agents 已用）：

| recommendedLayout | 默认 strategy |
|-------------------|---------------|
| `cover` | `svg` |
| `status-cards` / `progress-cards` / `generic-cards` | `hybrid` |
| `timeline` | `ir`（可编辑节点优先；P1 可改 hybrid） |
| `risk-table` | `ir` |
| `action-list` | `ir` |
| `blank-card` | `ir` |
| 未知 | `index===0 ? svg : hybrid` |

#### 持久化（二选一，P0 推荐 A）

| 方案 | 做法 | 说明 |
|------|------|------|
| **A（推荐）** | 不新增 DB 列；导出/生成时用 `inferRenderStrategy`；`updateSlide` 可选覆盖字段进内存/JSON | 少迁移，并行冲突小 |
| B | Prisma `Slide.renderStrategy String?` | 便于按页 UI 切换；需 migration |

若选 A：`SlideDto.renderStrategy?: RenderStrategy` 为**响应计算字段**（读时推断）；`updateSlideSchema` 可暂不加，或加 optional 写入 `planJson` 旁路扩展。  
若并行 Agent 已开 migration，统一用 B，字段名必须为 `renderStrategy`。

### 5.2 导出模式：`draft` | `standard` | `visual`

#### Schema 变更（`packages/shared`）

```ts
export const pptExportModes = ["draft", "standard", "visual"] as const;
export const PptExportModeSchema = z.enum(pptExportModes);

export const exportPptxSchema = z.object({
  theme: PptExportThemeSchema.default("white-blue"),
  /** @deprecated 使用 mode；true 等价 mode=draft */
  draft: z.boolean().default(false),
  mode: PptExportModeSchema.optional()
}).transform((v) => {
  const mode = v.mode ?? (v.draft ? "draft" : "standard");
  return { theme: v.theme, draft: mode === "draft", mode };
});
```

#### 模式 → 策略映射

| mode | 每页生效策略 | 是否要求 svgPreview | 缺 SVG / 编译失败 |
|------|--------------|---------------------|-------------------|
| `draft` | 强制视为 `ir` | 否 | 走 IR/主题模板 |
| `standard` | `infer` 或显式 strategy | 否（不再 400） | svg/hybrid 无 SVG 或失败 → IR |
| `visual` | `ir` 保持 `ir`；其余提升为 `svg`（或至少按原 strategy 且优先生成 SVG） | 否（尽量生成，但不因单页失败拒整份） | 同降级；响应带 warnings |

伪代码：

```ts
function effectiveStrategy(slide, mode, index): RenderStrategy {
  if (mode === "draft") return "ir";
  const base = slide.renderStrategy ?? inferRenderStrategy(
    slide.planJson?.layoutType ?? slide.recommendedLayout,
    index
  );
  if (mode === "visual" && base !== "ir") return "svg";
  return base;
}
```

### 5.3 导出优先级（Renderer 契约）

`renderProjectPptx` **必须**改为按页决策，禁止当前「有 SVG 编译失败就 throw」：

```ts
type PageRenderResult = {
  slideId: string;
  strategy: RenderStrategy;
  used: "svg" | "ir" | "theme" | "fallback";
  warning?: string;
};

// 单页伪代码
const strategy = effectiveStrategy(outline, mode, index);
let used: PageRenderResult["used"] = "fallback";

if (strategy === "svg" || strategy === "hybrid") {
  const ok = tryRenderSvgPreviewSlide(pptx, slide, outline.svgPreview);
  if (ok) {
    used = "svg";
  } else {
    // 禁止 throw；记录 warning 后降级
    renderIrOrThemeOrFallback(...);
    used = outline.irJson ? "ir" : "theme";
    warning = outline.svgPreview
      ? `第 ${index + 1} 页 SVG 无法编译，已降级为 IR/模板`
      : `第 ${index + 1} 页无 SVG，已使用 IR/模板`;
  }
} else {
  // strategy === "ir"：即使有 svgPreview 也不走 SVG 编译主路径
  renderIrOrThemeOrFallback(...);
  used = outline.irJson ? "ir" : "theme";
}
```

API 层：

- **删除/放宽**：`!draft && missingSvgSlides.length > 0 → 400`（standard/visual 下禁止再作为硬失败）。
- `draft`：保持可跳过设计生成。
- `visual`：可在导出前对缺 SVG 的非 `ir` 页尝试生成；单页生成失败 → 该页 IR，继续导出。
- 响应建议扩展（P0 推荐，字段名固定）：

```ts
interface ExportDto {
  id: string;
  projectId: string;
  versionName: string;
  pptxPath: string;
  downloadUrl: string;
  createdAt: string;
  mode?: "draft" | "standard" | "visual";
  pageResults?: PageRenderResult[];
  warnings?: string[];
}
```

`versionName` 建议：`快速草稿` / `标准混合版` / `高视觉版` + 时间戳。

### 5.4 可编译 SVG 硬门禁规则摘要

对照 `references/svg2pptx-skill/references/shared-standards.md`，P0 抽出并落地为 `docs/00-architecture/COMPILABLE_SVG.md` + 代码检查（**错误级** vs **警告级**）：

#### 错误级（门禁失败 → 重生成或放弃本页 SVG，转 IR）

| 规则 | 说明 |
|------|------|
| 非法 XML / 裸 `&` `<` | 文本须 well-formed；业务符号用 Unicode，XML 保留字用实体 |
| `mask` | DrawingML 无 per-pixel alpha |
| `<style>` / `class` / 外部 CSS | 仅允许元素 inline 属性 |
| `foreignObject` | 禁止嵌入 HTML |
| `symbol` + `use`（非 icon 约定） | P0 直接禁 `use`（本仓暂无 icon finalize） |
| `textPath` / `@font-face` / `animate*` / `script` / 事件属性 | 无等价或危险 |
| `viewBox` 非 `0 0 1280 720` | 与现网约定一致 |
| `rgba(...)` 填色 | 改为 `#RRGGBB` + `fill-opacity` |

#### 警告级（P0 可降级处理或剥离，不必然整页废）

| 规则 | 说明 |
|------|------|
| 滤镜阴影/glow | 能力弱，可忽略属性 |
| 未支持的复杂 `transform` | 能解析则用，否则跳过该元素并 warning |
| `radialGradient` / 复杂 pattern | P0 可警告；P1 再支持 linearGradient |

#### 与现有 `validateSvgPreview` 关系

保留现有「内容完整性」检查（rect 数量、text 数量、截断、重复），并**叠加**硬门禁。建议函数拆分：

- `validateCompilableSvg(svg): { errors: string[]; warnings: string[] }`
- `validateSvgContentQuality(svg): string[]`（现有逻辑）

生成路径：`errors.length > 0` → 重试（≤2）→ 仍失败则**不写入坏 SVG**或写入但 `generationStatus` 标记，导出时走 IR。

### 5.5 API / shared schema / 前端字段变更清单

#### `packages/shared`

| 变更 | 说明 |
|------|------|
| `renderStrategies` + `RenderStrategy` + `RenderStrategySchema` | 新枚举 |
| `inferRenderStrategy()` | 纯函数，单测友好 |
| `pptExportModes` + `PptExportModeSchema` | 新枚举 |
| `exportPptxSchema` | 增加 `mode`；兼容 `draft` |
| `SlideDto.renderStrategy?` | 计算或持久化字段 |
| `updateSlideSchema.renderStrategy?` | 若做按页覆盖（可 P0.5） |
| `ExportDto.mode?` / `warnings?` / `pageResults?` | 导出反馈 |
| 导出 `ExportPptxInput` 类型 | 随 schema |

#### `apps/api`

| 变更 | 说明 |
|------|------|
| `POST /api/projects/:id/export-pptx` | 解析 `mode`；取消 standard/visual 的「缺 SVG → 400」 |
| `validateSvgPreview` → 硬门禁 | 生成 SVG 时调用 |
| `generate-all-designs` / 单页 generate | 可选：跳过 strategy=`ir` 的页（P0 建议实现，降低浪费） |
| 导出记录 `versionName` | 按 mode 文案 |

**不改**（除非必要）：事实/大纲/Plan 主路径 URL。

#### `packages/ppt-renderer`

| 变更 | 说明 |
|------|------|
| `RenderProjectPptxInput` | 增加 `mode: PptExportMode`；可选 `strategies: Record<slideId, RenderStrategy>` |
| `renderProjectPptx` | 按页策略；**移除**「SVG 失败 throw 整份」 |
| 返回值 | 建议返回 `pageResults`（或通过 out 参数），供 API 写入 ExportDto |
| `renderSvgPreviewSlide` | 保持 boolean；调用方负责降级 |

#### `packages/agents`

| 变更 | 说明 |
|------|------|
| `svgPreviewSystemPrompt` / `buildSvgPreviewPrompt` | 嵌入 COMPILABLE_SVG 硬规则摘要 |
| Mock adapter | 生成的样例 SVG 不得含 style/class/mask/foreignObject |

#### `apps/web`

| 变更 | 说明 |
|------|------|
| `exportPptx(draft?: boolean)` → `exportPptx(mode?: PptExportMode)` | 兼容：`exportPptx(true)` 仍表示 draft |
| 导出 UI | 三按钮：快速草稿 / 标准版 / 高视觉版 |
| 去掉正式导出「必须全页 SVG」前端拦截 | 与 API 一致 |
| 页卡片展示 `renderStrategy` | 只读标签即可（P0） |
| api client body | `{ theme, mode }` |

#### Prisma

| 变更 | 说明 |
|------|------|
| P0 可选 | 无强制 migration（方案 A） |
| 若方案 B | 仅加 `renderStrategy String?`，禁止顺手改其它列 |

---

## 6. 测试与回归计划

### 6.1 P0 必测（实现 Agent 勾选）

| ID | 用例 | 期望 |
|----|------|------|
| T1 | `inferRenderStrategy` 表驱动 | cover→svg；risk-table→ir；status-cards→hybrid |
| T2 | `exportPptxSchema` | `{draft:true}`→mode=draft；`{mode:'visual'}`；默认 standard |
| T3 | 门禁：含 `<style>` / `foreignObject` / `mask` 的 SVG | errors 非空 |
| T4 | 门禁：合法子集样例 | errors 空 |
| T5 | Renderer：页 A 坏 SVG + 页 B 好 SVG，mode=standard | 整份成功；A 降级；B 用 SVG；有 warning |
| T6 | Renderer：strategy=ir 且存在 svgPreview | 不走 SVG 编译主路径 |
| T7 | API：standard 且缺部分 svgPreview | 200 + 文件；非 400 |
| T8 | API：draft | 不强制设计模型；导出成功 |
| T9 | `pnpm typecheck` | 通过 |

### 6.2 手工回归（打开 PPTX / WPS）

1. 6 页周报样例：封面（SVG）、状态卡（hybrid）、风险表（IR）、行动清单（IR）。
2. 故意植入坏 SVG（foreignObject）于一页 → 导出仍成功，该页可编辑。
3. 对比 draft vs standard vs visual 耗时与观感（记录主观分即可）。

### 6.3 P1 回归

- 用 `references/svg2pptx-skill/examples/*.svg` 作 fixture（本地有 references 时跑）。
- 对比：可编辑对象数量、箭头/渐变是否出现。

### 6.4 建议目录

```text
packages/shared/src/inferRenderStrategy.test.ts
packages/ppt-renderer/src/exportPriority.test.ts
packages/ppt-renderer/fixtures/compilable-ok.svg
packages/ppt-renderer/fixtures/banned-style.svg
```

测试框架：若仓库尚无 vitest，P0 可用最小 vitest 接入 `packages/shared` + `ppt-renderer`；或先用 node assert 脚本，P1 再统一。

---

## 7. 里程碑与优先级权重说明

### 7.1 里程碑

| 里程碑 | 时间量级 | 完成定义 |
|--------|----------|----------|
| **M-P0** | 1–3 天 | 三模式导出可用；按页策略生效；SVG 失败降级；硬门禁文档+检查上线；typecheck 绿 |
| **M-P1** | 1–2 周 | DOM 解析；渐变/箭头/分组基础；renderer 拆分；example 对照 |
| **M-P2** | 随后 | 按页切换策略；设计模型按策略调度；可编辑等级；成本指标 |
| **对齐 PRD M2/M4** | 伴随 P0–P1 | IR 重新成为可信契约；SVG 为预览+高视觉编译源，而非唯一主链 |

### 7.2 优先级权重口径

用于阶段内排期（与架构评审口径兼容并扩展）：

| 维度 | 权重 | 说明 |
|------|------|------|
| 可控 / 可降级 | 30% | 单页失败不拖死整份 |
| 与 PRD / Hybrid 一致 | 25% | IR 契约 + SVG 增强 |
| 可测性 | 20% | schema、门禁、导出优先级可单测 |
| 视觉上限 | 15% | 不牺牲 standard/visual 观感路径 |
| 工期 / 并行友好 | 10% | 接口先定、少碰大拆分 |

**结论：先 P0 契约与降级（高可控），再 P1 编译器能力（高视觉）。**

---

## 8. 两个方案对比 + 选用 Hybrid

### 8.1 对比表

| 维度 | 方案 A：全面 SVG-only（弱化 IR） | 方案 B：IR 骨架 + SVG 视觉增强（Hybrid） |
|------|--------------------------------|------------------------------------------|
| 视觉上限 | 高 | 高（视觉页仍走 SVG） |
| 内容可控 / 防幻觉 | 低 | 高（权威在 Plan/IR/事实） |
| 失败降级 | 差（现状整份失败） | 强（按页 IR 兜底） |
| 与 PRD 护城河 | 漂移 | 对齐并扩展（IR 契约 + SVG 编译） |
| 可测试性 | 低 | 中高 |
| 成本 | 高（几乎每页设计模型） | 可控（按策略跳过 ir 页） |
| 短期改动量 | 小（维持现状） | 中（契约 + 导出优先级） |
| 长期维护 | 编译器债务堆积 | 分工清晰，可增量增强编译器 |
| **综合权重** | **52** | **90** |

权重口径（本方案）：可控 30% + PRD/Hybrid 一致 25% + 可测 20% + 视觉 15% + 工期 10%。

> 说明：[`ARCHITECTURE_REVIEW_2026-07-17.md`](./ARCHITECTURE_REVIEW_2026-07-17.md) 阶段曾选「IR-first（84）vs SVG-first（58）」以纠正漂移。本方案在其基础上采纳 [`HYBRID_IR_SVG_STRATEGY.md`](./HYBRID_IR_SVG_STRATEGY.md) 的终态：**不是回到「SVG 仅预览、正式永远不用 SVG」**，而是 **IR 保底 + 按页 SVG 编译**。二者不矛盾——评审否定的是 SVG-only 主链，Hybrid 保留 IR 主权同时释放视觉上限。

### 8.2 选用结论

**选用方案 B（Hybrid）。**

一句话：

> IR 保「能改、能控、能降级」；SVG 保「好看、有层次、有技术感」；导出按页策略编译，失败降级，而不是整条链路押一种中间态。

---

## 9. 并行 Agent 落地任务拆分（P0）

| 任务 ID | Owner 建议 | 依赖 | 交付物 |
|---------|------------|------|--------|
| P0-shared | Agent-Shared | 无 | 枚举、infer、export schema、类型导出 |
| P0-renderer | Agent-Renderer | 可读 shared 类型（可先本地复制枚举再对齐） | `renderProjectPptx` 降级逻辑 + pageResults |
| P0-gate | Agent-Gate | 无 | `COMPILABLE_SVG.md` + validate 函数 + prompts 摘要 |
| P0-api | Agent-API | shared + renderer + gate | export-pptx mode、取消缺 SVG 400、warnings |
| P0-web | Agent-Web | shared + api | 三模式 UI、去掉强制 SVG 拦截、策略标签 |

**建议合并顺序：** shared → renderer/gate（可并行）→ api → web。

### 9.1 接口冲突风险（给调度者）

| 风险点 | 级别 | 规避 |
|--------|------|------|
| `exportPptxSchema` 多 Agent 同改 | 高 | **仅 Agent-Shared 改 schema**；他人只消费 |
| `renderProjectPptx` 签名 | 高 | 以本文 `mode` + 返回 `pageResults` 为准；勿再引入 `strictSvg: boolean` 等旁路名 |
| 删除「缺 SVG → 400」 | 中 | API/Web 必须同 PR 或紧耦合顺序，否则一端仍拦截 |
| Prisma migration vs 计算字段 | 中 | 默认方案 A；若有人加列必须用名 `renderStrategy` |
| `validateSvgPreview` 行为变严 | 中 | 生成失败应降级，不要把「更严门禁」又做成整份导出失败 |
| `ExportDto` 扩展 | 低 | 字段只增不删；前端可选读 warnings |

**结论：** 只要 shared 契约先合并（或先 PR 锁定类型），并行冲突可控；最大风险是多人同时改 `exportPptxSchema` 与 `renderProjectPptx` 中心函数——应用本文字段名并分文件改（renderer 逻辑抽 `resolvePageRenderPlan.ts` 可再降冲突）。

---

## 10. 经验（可复用）

AI PPT 类系统的中间态最佳实践：

- **语义中间态（IR/JSON）** → 正确性、可测、降级  
- **视觉中间态（canonical SVG）** → 布局表现力  
- **编译器 + 硬门禁** → 可编辑交付  

缺任一环：要么丑且稳，要么美但不稳。优化顺序永远是 **契约与降级 → 编译能力 → 体验成本**，而不是先换技术栈。

---

## 11. 文档维护

| 文档 | 关系 |
|------|------|
| 本文 `OPTIMIZATION_PLAN.md` | 执行总册 |
| `HYBRID_IR_SVG_STRATEGY.md` | 策略原则来源 |
| `REFERENCE_svg2pptx_analysis.md` | 参考仓吸收边界 |
| `ARCHITECTURE_REVIEW_2026-07-17.md` | 漂移诊断与包结构 |
| `COMPILABLE_SVG.md`（P0 新建） | 硬门禁细则（从 shared-standards 裁剪） |
| PRD | 护城河与 Non-Goals 边界 |

P0 落地完成后，应另写 `EXECUTION_optimization-p0-YYYY-MM-DD.md` 记录实际 diff 与验收勾选（由实现 Agent 填写）。
