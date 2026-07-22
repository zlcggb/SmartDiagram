# EXECUTION：精选版式变体库（对齐 dashi「锁模板」心智，2026-07-17）

## 0. 需求摘要

学习 `references/dashi-ppt-skill`：好看靠的是 **1020 人工打磨 React 版式**（每主题 70–110 页固定构图 + 控件），不是再抄一套配色。

当前引擎已有 12 ThemePack + 16 角色 blueprint，但视觉仍偏「LLM 自由画 + IR 三卡兜底」。本期把**整体设计逻辑 / 设计模板**补到「可查询的精选变体库 + 硬构图约束 + 全 layout 主题模板」。

**硬约束**：不移植 AGPL 版式源码；不并入专有 HTML-deck 导出；不假装做出 1020 组件。

---

## 1. 方案对比与选型

| 方案 | 做法 | 影响面 | 风险 | 工期 | 权重(1-10) | 决策 |
|------|------|--------|------|------|------------|------|
| **A. 自研精选变体库（选用）** | 每角色 2–3 剪影（~40 variant）+ `queryLayouts` + blueprint 构图规范 + copyBudgets 硬门禁 + renderer 18 layout 分支 | shared / agents / renderer / api | 低；合规清晰 | 0.5–1 天 | **9** | **执行** |
| B. 放宽 SVG 表现力 + raster 导出 | 预览更好看，可编辑矢量变弱 | renderer / 导出策略 | 与 P1 可编译契约冲突 | 中 | **5** | 否（另线） |

**选型理由**：经验文档已写明「缺版式资产是主因」；方案 A 最接近 dashi「选 layout → 填 props」而不触碰许可红线。

---

## 2. 已执行改动

### 2.1 `layoutVariants.ts`（新）

- ~40 个自研变体：`id / role / recommendedLayout / silhouette / heroZone / typeScale / slots / avoid`
- `queryLayouts({ role, themeFamily, usedVariantIds, seed, limit })`：轻量 layout:query
- `pickDefaultVariant` / `formatLayoutVariantCatalog` / `formatVariantCompositionInstruction`

### 2.2 blueprint 构图规范

`layoutRoles.ts`：每个 blueprint 增加 `composition`（silhouette / heroIntent / typeScale / minGutter）；目录文案带剪影。

### 2.3 copyBudgets 硬门禁

`applyCopyBudgetsToSlideFields` / `applyCopyBudgetsToBlockItems` 接入 `normalizeOutline` / `normalizeSlidePlan`。

### 2.4 Agents 提示词

- Outline：注入 ThemePack 目录、变体目录、封面候选、正文剪影参考、选版规则
- Plan / IR / SVG：注入变体构图指令；SVG 可带质感 `regenerateHint`
- `generateSlidePlan` 增加 `theme` 参数；API 透传项目主题

### 2.5 Renderer

- 按 `normalizeRecommendedLayout` 精确匹配（不再靠 title 关键词）
- light / dark 两族补齐：toc / statement / observation / transition / metrics / distribution / comparison / case-study / trend / process / closing 等
- `generic-cards` 改为「主次 Bento」，避免等权三卡墙

---

## 3. 验证

```bash
corepack pnpm --filter @ppt-agent/shared typecheck
corepack pnpm --filter @ppt-agent/agents typecheck
corepack pnpm --filter @ppt-agent/ppt-renderer typecheck
corepack pnpm --filter @ppt-agent/api typecheck
```

---

## 4. 改动文件清单

| 路径 | 变更 |
|------|------|
| `packages/shared/src/layoutVariants.ts` | **新增** 精选变体库 |
| `packages/shared/src/layoutRoles.ts` | composition 规范 |
| `packages/shared/src/copyBudgets.ts` | 硬门禁 helpers |
| `packages/shared/src/index.ts` | 导出 |
| `packages/agents/src/prompts.ts` | 选版 + 变体指令 |
| `packages/agents/src/realGeminiAdapter.ts` | 预算裁剪 / theme |
| `packages/agents/src/openaiCompatibleAdapter.ts` | 同步签名 |
| `packages/agents/src/mockGeminiAdapter.ts` | 同步签名 |
| `packages/agents/src/types.ts` | 接口 |
| `packages/ppt-renderer/src/index.ts` | 18 layout 分支 |
| `apps/api/src/routes/projects.ts` | plan 传 theme |
| `apps/api/src/lib/aiUsage.ts` | 透传 theme |

---

## 5. 后续

- ~~真·固定 SVG/IR 骨架资产文件~~ → 已做：[EXECUTION_layout-skeleton-frames-2026-07-18.md](./EXECUTION_layout-skeleton-frames-2026-07-18.md)
- 持久化 `layoutVariantId` 到 Slide / DB
- 页级结构控件滑杆（无真实即时能力则不做假控件）
- 移植 dashi React 组件或 goal.json 运行时（不做）
