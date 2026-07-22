# EXECUTION：Dashi 核心逻辑薄适配融合（2026-07-17）

## 0. 需求摘要

把 `references/dashi-ppt-skill` 的**核心产品心智**（主题包 / 版式角色 / 锁模板填文案 / 有限配色 / 文案预算）融入 `ppt-agent-engine`，并与既有 Hybrid IR/SVG、P0–P2 导出能力兼容。

**硬约束（继承既有合规）**：不并入 AGPL 源码；不并入专有 `html-deck-to-pptx`；不替换现有导出管线。

已有一期落地见 [EXECUTION_dashi-inspired-integration.md](./EXECUTION_dashi-inspired-integration.md)（6 ThemePack + 基础角色）。本期为**第二期加深**。

---

## 1. 差距清单（调研结论）

### 1.1 dashi 有而当前缺（本期前）

| 项 | dashi | 引擎一期后仍缺 |
|----|-------|----------------|
| 主题数量 | 12 themePack | 仅 6 |
| 主题元数据 | 适合场景 / 人群 / 勿默认自选 | 缺 `suitableFor` / `avoidAutoSelect` |
| 系列色 | 主题内图表色序 | 无 `series[]` |
| 页级 accent | 枚举控件 | 无 |
| 角色覆盖 | ~20 role | 10 角色，缺 statement/trend/case 等 |
| 文案预算 | fillPlan / copyBudgets | 仅提示词口头「短句」 |
| 生成前主题网格 | theme-style-grid | Home 仅 chip，信息弱 |
| 锁模板话术 | SKILL 硬规则 | prompts 有角色，未显式「锁模版」 |

### 1.2 已借鉴但未落地 / 本期仍不做

| 项 | 状态 |
|----|------|
| 1020 React 版式库 | **不做**（许可+体量） |
| HTML-deck + 专有导出 | **不做** |
| goal.json + layout:query 运行时 | **不做**（用 IR/SVG 代替） |
| accent 持久化到 DB / 导出服务端 | **后续**（本期会话级预览） |
| Brief 页主题网格图资产 | **后续**（Home 网格已增强） |

---

## 2. 方案对比与选型

| 方案 | 做法 | 影响面 | 风险 | 工期 | 权重(1-10) | 决策 |
|------|------|--------|------|------|------------|------|
| **A. 深度移植** | 移植模板/主题运行时/prompt 接到 hybrid 管线，逼近 goal+layout 契约 | shared+agents+renderer+大量资产 | AGPL 污染、体量大、与 IR 栈冲突 | 数周 | **4** | 否 |
| **B. 薄适配加深（选用）** | 自研补齐 12 ThemePack + 角色 + copyBudgets + accent 枚举 + prompts；不引入 dashi 运行时 | shared / agents / web / renderer 族分流 | 低；合规清晰 | 0.5–1 天 | **9** | **执行** |

**选型理由**：一期已证明「学心智、自研契约」路径；REFERENCE 明确禁止 AGPL/专有引擎入库；产品定位是文章式工作室 + Hybrid，而非 HTML-Deck。方案 B 在合规与 ROI 上最高。

---

## 3. 已执行改动

### 3.1 ThemePack → 12 + accent / series

`packages/shared/src/themePacks.ts`

- 12 套：`white-blue` / `soft-product` / `blue-black` / `code-surface` / `glass-brand` / `chart-report` / `deep-strategy` / `cold-research` / `black-gold` / `magazine-navy` / `gold-index` / `growth-energy`
- 每包：`suitableFor`、`series[]`、`accentPresets`（4 个有限色）、`avoidAutoSelect`（`gold-index`）
- 辅助：`formatThemePackCatalog` / `getAccentPresetHex` / `normalizeAccentPresetId` / `pickDefaultThemePack`

### 3.2 版式角色扩展

`packages/shared/src/layoutRoles.ts`

- 新增角色：`statement` / `transition` / `trend` / `distribution` / `case` / `observation`
- 新增 layout：`statement` / `transition` / `trend` / `distribution` / `case-study` / `observation`
- 兼容旧 layout 字符串 + 部分 dashi 角色别名映射（如 `breakdown→toc`）

### 3.3 文案预算

`packages/shared/src/copyBudgets.ts`：title / keyMessage / bullet / metric 等 maxChars；`formatCopyBudgetCatalog`

### 3.4 换色

`themeRecolor.ts`：覆盖 12 主题别名；`recolorSvgPreview(svg, theme, { accentId })` 支持同主题换强调色

### 3.5 Agents

- `prompts.ts`：锁模版话术、copyBudgets 注入、ThemePack series / accent 指令
- `realGeminiAdapter.ts`：outline schema enum 改为 `recommendedLayoutEnumValues()` 动态同步

### 3.6 Renderer

`ppt-renderer`：用 `normalizePptExportTheme` + `themeFamily` 替代硬编码 6 主题 / DARK_THEMES

### 3.7 Web

- Home：主题**网格卡片**（预览底色 + 适合场景）
- Studio：12 主题列表 + **页级强调色枚举**（会话 `themeAccentId`）
- `workbenchStore`：`themeAccentId` / `setThemeAccentId`

---

## 4. 验证

```bash
corepack pnpm --filter @ppt-agent/shared typecheck
corepack pnpm --filter @ppt-agent/shared build
corepack pnpm --filter @ppt-agent/agents typecheck
corepack pnpm --filter @ppt-agent/ppt-renderer typecheck
corepack pnpm --filter @ppt-agent/api typecheck
corepack pnpm --filter @ppt-agent/web typecheck
```

均已通过（2026-07-17）。ReadLints：相关 TS/TSX 无报错。

---

## 5. 改动文件清单

| 路径 | 变更 |
|------|------|
| `packages/shared/src/themePacks.ts` | 12 主题 + accent/series |
| `packages/shared/src/layoutRoles.ts` | 角色/layout 扩展 |
| `packages/shared/src/copyBudgets.ts` | 新增 |
| `packages/shared/src/themeRecolor.ts` | 12 色板 + accent 选项 |
| `packages/shared/src/index.ts` | 导出 |
| `packages/agents/src/prompts.ts` | 锁模版 + 预算 + series |
| `packages/agents/src/realGeminiAdapter.ts` | layout enum 动态 |
| `packages/ppt-renderer/src/index.ts` | 主题族共用 shared |
| `apps/web/src/lib/exportMode.ts` | 选项字段扩展 |
| `apps/web/src/store/workbenchStore.ts` | themeAccentId |
| `apps/web/src/pages/HomePage.tsx` | 主题网格 |
| `apps/web/src/pages/StudioPage.tsx` | accent 面板 |

---

## 6. 后续 / Blocker

| 项 | 说明 |
|----|------|
| accent 持久化 | 需否写入 Prisma `Project`？（默认否→仅会话预览；导出服务端暂不带 accent） |
| 每 ThemePack 独立 IR 色值 | 仍 light/dark 分流；真色差靠 SVG recolor |
| Brief 页主题确认 | 可把 Home 网格复用到 Brief |
| 分析模型页（SWOT 等） | 可用 case/observation + 提示词增强，不必移植组件 |

**需用户决策（非阻塞）**：是否要把 `themeAccentId` 落到数据库并参与导出 API。

经验文档：[EXPERIENCE_dashi-core-integration.md](./EXPERIENCE_dashi-core-integration.md)
