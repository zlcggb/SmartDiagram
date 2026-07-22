# EXECUTION · Studio 主题「真换色」修复（2026-07-17）

## 问题

用户反馈：「切换颜色都是假的」。Studio 右侧选了「玻璃品牌」等 ThemePack / 强调色后，中心设计稿预览仍像浅色企业风大蓝块；UI 却写「切换即换色，无需重新生成」。

## 根因（必查项结论）

| 检查项 | 结论 |
| --- | --- |
| `themeRecolor` / `recolorSvgPreview` | **会改 SVG 内 `#hex`**（正则替换 fill/stroke 等处色值），不是只靠外层 CSS filter |
| Studio 预览路径 | `StudioPage` 的 `themedSvgPreview` **已调用** `recolorSvgPreview(svg, exportTheme, { accentId })`，状态也进了依赖 |
| ThemePack 与硬编码色 | token 映射规则存在，但 **AI 常写 Tailwind/自由蓝**（如 `#1E3A8A`、`#2563EB`），旧逻辑匹配失败 |
| 简单 hex replace 失败点 | ① `detectSvgTheme` **只看背景大矩形**：纯白/`#F8FAFC` 易误判为 `chart-report`/`glass-brand`；② `closestRole(maxDistance=48)` **仅在误判的 source 色板内匹配** → `#005AA6`/`#1E3A8A` 距离超限原样保留 |
| 强调色 / surface | accent **有进预览**；surface 仍是 **CSS filter 近似**（质感，非色板） |

典型失败链：白底 SVG → 误判 source → 大蓝块未落入角色 → 切到玻璃品牌后蓝块仍在 → 用户认为「假换色」。

## 方案对比与选型

| 方案 | 内容 | 权重 |
| --- | --- | --- |
| **A. 修真换色** | 强化 `recolorSvgPreview`：全主题色票匹配 + 亮度/饱和度启发式；改进检测投票；纯白按目标族映射 bg/onAccent；预览与导出同源 | **92**（优先：肉眼可见色板变化，兑现产品承诺） |
| **B. 降级文案** | 去掉「无需重新生成」，强制按主题重生才换色；顺带做一点弱预览 | **48**（诚实但体验倒退，且现有管线已能修） |

**选型：A。**

## 改动文件

- `packages/shared/src/themeRecolor.ts` — 核心算法
- `apps/web/src/components/ThemeConfigPanel.tsx` — 文案改为「切换即改 SVG 色板；版式大变可再按主题生成」

未改库存 SVG；导出路径本就调用同一 `recolorSvgPreview`（`ppt-renderer`），一并受益。

## 算法要点

1. **全局色票**：所有 ThemePack token + 别名（含 AI 常见蓝漂移）联合近邻匹配（阈值 64）
2. **启发式兜底**：中高饱和色 → `accent`；深色低饱和 → `bg`；灰阶 → title/body/muted
3. **检测投票**：背景加权 + 全 SVG hex 投票，避免纯白底误判
4. **纯白分流**：浅色目标 → `bg`（玻璃薄荷绿可见）；深色目标 → `onAccent`
5. **同主题换 accent**：凡分类为 `accent` 的色（含漂移蓝）一律换成预设

## 验证证据

示例 SVG（白底 + `#1E3A8A` 大色块 + `#2563EB`）：

| 目标 | 背景 | 主色块 |
| --- | --- | --- |
| 源稿 | `#FFFFFF` | `#1E3A8A` |
| `glass-brand` / teal | `#F7FBFA` | `#0D9488` |
| `glass-brand` / sky | `#F7FBFA` | `#0EA5E9` |
| `code-surface` | `#0D1117` | `#3FB950` |

- 修复前：`#1E3A8A` / `#005AA6` 在误判路径下常原样保留  
- 修复后：两 ThemePack 输出 hex **明显不同**；accent 预设可区分  
- `pnpm --filter @ppt-agent/shared typecheck` / `web typecheck` 通过  
- IDE lint：无新增问题  

## 残留限制

- 无语义 token 的 SVG 仍是近似映射；多系列色可能被收成单一 accent
- `rgb()` / `hsl()` / 渐变 stop 未覆盖（当前生成以 `#hex` 为主）
- 质感（surface）仍是 CSS filter，不是材质重绘
- 深浅构图大变（信息层级/留白）仍需「按主题重新生成」
