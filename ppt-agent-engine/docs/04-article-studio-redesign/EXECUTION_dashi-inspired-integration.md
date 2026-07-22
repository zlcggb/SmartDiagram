# EXECUTION：Dashi 启发主题包 / 版式角色第一期（2026-07-17）

## 0. 方案对比与选型

| 方案 | 权重 | 说明 | 决策 |
|------|------|------|------|
| **A. 自研「Dashi 启发」主题包 + 版式角色模版 + 提示词/生成约束接入现有 IR/SVG** | **~88** | 学架构与心智，不碰 AGPL 源码；落在我们 Hybrid 栈 | **选用（本期执行）** |
| B. 子进程调用 dashi skill 生成 HTML 再导出 | ~35 | AGPL 传染 / SaaS 源码义务风险高 | 不做 |
| C. 整仓移植 1020 版式库 | ~15 | 许可 + 体量 + 产品定位均不可行 | 不做 |

合规依据见 [REFERENCE_dashi-ppt-skill.md](../00-architecture/REFERENCE_dashi-ppt-skill.md)。

---

## 1. 合规边界（硬约束）

| 允许 | 禁止 |
|------|------|
| 学习主题分层、角色选版、props 填空、右侧有限主题面板 | 复制 AGPL 源码进 `ppt-agent-engine` |
| 自研 ThemePack token、layout blueprint、提示词约束 | 并入专有 `html-deck-to-pptx` |
| 继续用 pptxgenjs + IR/SVG 导出 | 整包搬 1020 版式库 / Playwright HTML-deck 替代路径 |

`references/dashi-ppt-skill/` 保持 gitignore，仅本地对照。

---

## 2. 第一期做了什么

### 2.1 主题系统（颜色控制）

- `packages/shared/src/themePacks.ts`：`ThemePack` / `pptExportThemes` 扩展为 6 套  
  - 既有：`white-blue`、`blue-black`  
  - 自研：`cold-research`、`deep-strategy`、`growth-energy`、`chart-report`  
  - token：主色/辅色/背景/卡片/成功/风险/警告等（**概念对齐**「主题包」，非文件拷贝）
- `themeRecolor.ts`：色板映射覆盖全部 ThemePack；`detectSvgTheme` 按背景色最近邻推断
- Zod：`PptExportThemeSchema` / `exportPptxSchema` 同步扩展
- 文档说明：完整 12 主题后期可继续加 token，**不依赖** dashi 源码

### 2.2 版式模版 / 页面角色

- `packages/shared/src/layoutRoles.ts`：`pageLayoutRoles` + `recommendedLayouts` + `layoutBlueprints`
- 角色：封面 / 目录 / 指标 / 现状 / 对比 / 流程 / 风险 / 行动 / 收束 / 通用
- 骨架含区块类型与比例、props 填空提示；供 Outline / Plan / Design 引用
- `normalizeRecommendedLayout` 兼容旧 layout 字符串

### 2.3 生成链路分层（落在我们栈）

保持：`brief → research → outline → search → plan → design → export`

融入心智：

1. **先选主题包**：Home 入口 + Studio 设计稿右侧面板  
2. **版式 + 文案字段**：prompts 强制从角色模版选 `recommendedLayout`；Plan 的 `contentBlocks` 对齐 blueprint  
3. **一键导出**：沿用设计稿右栏导出（未引入 HTML-deck）

提示词改动（`packages/agents/src/prompts.ts`）：

- Outline Architect / Draft Planner / Design Bento：注入 blueprint 目录与 ThemePack token  
- `realGeminiAdapter` outline schema enum 与 `normalizeRecommendedLayout` 对齐

### 2.4 UI / API / Renderer

- Studio 右侧「主题包」列表 6 项；预览底色来自 pack.bg  
- Home 创建项目前可选 ThemePack  
- API `run-pipeline` / 导出日志使用 `normalizePptExportTheme` / `getThemePack`  
- ppt-renderer：新主题按 light/dark 族走既有白蓝 / 蓝黑模板（SVG 换色承担主差异）

---

## 3. 验证

```bash
corepack pnpm --filter @ppt-agent/shared typecheck
corepack pnpm --filter @ppt-agent/shared build
corepack pnpm --filter @ppt-agent/agents typecheck
corepack pnpm --filter @ppt-agent/ppt-renderer typecheck
corepack pnpm --filter @ppt-agent/api typecheck
corepack pnpm --filter @ppt-agent/web typecheck
```

均已通过（2026-07-17）。

---

## 4. 刻意不做 / 后续可增强

| 不做（本期） | 后续可增强 |
|--------------|------------|
| Playwright HTML-deck / 专有导出引擎 | 每 ThemePack 独立 IR 模板色值（不仅 light/dark 分流） |
| 复制 dashi HTML 编辑器控制台 | 页级 accent 枚举控件（有限选项） |
| 1020 页版式移植 | 补齐至约 12 套 ThemePack token |
| 子进程调用 AGPL skill | Brief 页展示主题网格预览图（自研素材） |

---

## 5. 关键文件

| 路径 | 变更 |
|------|------|
| `packages/shared/src/themePacks.ts` | 新增 |
| `packages/shared/src/layoutRoles.ts` | 新增 |
| `packages/shared/src/themeRecolor.ts` | 多主题色板 |
| `packages/shared/src/index.ts` | 导出与 infer 提示扩展 |
| `packages/agents/src/prompts.ts` | 角色模版 + ThemePack 指令 |
| `packages/agents/src/realGeminiAdapter.ts` | layout enum / normalize |
| `packages/agents/src/mockGeminiAdapter.ts` | mock 用 ThemePack tokens |
| `apps/web/src/lib/exportMode.ts` | 主题面板选项 |
| `apps/web/src/pages/StudioPage.tsx` / `HomePage.tsx` | UI |
| `apps/web/src/store/workbenchStore.ts` | normalize 主题 |
| `apps/api/src/routes/projects.ts` | 主题校验 |
| `packages/ppt-renderer/src/index.ts` | 主题族分流 |

经验文档：[EXPERIENCE_dashi-inspired-theme-layout.md](./EXPERIENCE_dashi-inspired-theme-layout.md)
