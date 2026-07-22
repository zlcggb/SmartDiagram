# EXECUTION · Studio 主题配置 IA（2026-07-17）

## 需求摘要

学习参考产品右侧「主题/样式」面板的**信息架构与交互模式**（非深色霓虹换肤），改进 PPT-Agent Studio 设计稿侧栏：分层清晰、有限枚举、即时预览反馈，并与已有 ThemePack / accent / copyBudgets 兼容。

## 对比结论（管线能力）

| 参考控件 | 可迁移？ | 现状支撑 |
|----------|----------|----------|
| 样式族下拉 / 场景切换 | 部分 | 映射为「主题族」浅色/深色/全部筛选 + ThemePack 列表 |
| 质感分段（玻璃/扁平…） | 部分 | 新增 `themeSurfacePresets`；预览用 CSS filter；构图级需重生 |
| 圆角滑杆 | 否（即时） | SVG rx 写死；改需 IR/SVG 重生 → 不暴露假控件 |
| 站点数量 / 上下交替 / 贯穿线 | 否 | 结构参数由 layout/IR 决定 → 文案说明「需重新生成」 |
| 重点突出 + 序号 | 否 | 无页内 highlight index 字段 → 不暴露 |
| 主题色 / accent | 是 | `recolorSvgPreview` + accent 枚举；本次导出链路补传 `accentId` |

## 方案评分与选型

### 方案 A：完整版式参数面板（仿 timeline 全控件）

- 落地成本：高（新 IR 字段、renderer、生成提示词）
- 风险：高（假即时控件误导；与可编译 SVG 门禁冲突）
- 短期收益：中
- **权重：32 / 100**

### 方案 B：主题配置 IA 升级（分层 + 有限枚举 + 真实即时能力）

- 落地成本：中低（UI + shared 预设 + 导出 accent）
- 风险：低（不伪造结构参数）
- 短期收益：高（学到的 IA，不破坏现有管线）
- **权重：86 / 100**

**选型：方案 B**

## 实现要点

1. **shared** `themeSurfacePresets.ts`：`flat | soft | dense | glass` 有限枚举 + `previewFilter` + `regenerateHint`
2. **ThemeConfigPanel**：分组 = 主题族 → 主题包 → 强调色 → 质感 → 文案/结构说明 → 导出/重生 → Agent 日志
3. **Studio 预览**：`recolorSvgPreview` + surface CSS `filter` 即时反馈
4. **导出对齐预览**：`exportPptxSchema.accentId` → renderer `recolorSvgPreview(..., { accentId })`
5. **会话态**：`themeSurfaceId` / `themeAccentId` 存 workbenchStore（accent 仍不写库）

## 改动文件

- `packages/shared/src/themeSurfacePresets.ts`（新）
- `packages/shared/src/index.ts`（导出 + export schema accentId）
- `packages/ppt-renderer/src/exportTypes.ts` / `index.ts`
- `apps/api/src/routes/projects.ts`
- `apps/web/src/components/ThemeConfigPanel.tsx`（新）
- `apps/web/src/pages/StudioPage.tsx`
- `apps/web/src/store/workbenchStore.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/styles.css`

## 验证

- shared / web / renderer / api 相关 typecheck
- StudioPage / ThemeConfigPanel lint

## 未做 / 待决策

- accent / surface **持久化到 Project 表**（当前会话级）
- 质感 `regenerateHint` 注入 AI 设计提示词（已有字段，未接 generate API）
- 结构类参数（节点数等）真实即时编辑
