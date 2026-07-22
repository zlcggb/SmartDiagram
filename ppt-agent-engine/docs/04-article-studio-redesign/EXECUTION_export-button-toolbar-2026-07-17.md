# EXECUTION · 一键导出移至设计稿工具条右上角

**日期**：2026-07-17  
**范围**：`apps/web` Studio 设计稿工具条 / 主题侧栏 / 导出历史文案

## 需求（来自标注截图）

1. 右侧主题配置底部「一键导出 PPTX」应挪到主内容区顶部右侧按钮簇。
2. 工具条里重复的「导出历史」打叉去掉（顶栏已有「导出历史」Tab）。
3. 「按主题重新生成本页/全部」留在右侧主题区；导出逻辑（theme、accentId）不可丢。

## 方案对比

| 方案 | 做法 | 权重 |
|------|------|------|
| **A（采用）** | 仅「一键导出 PPTX」进工具条；侧栏保留按主题重生；去掉工具条「导出历史」与侧栏「查看导出历史」 | **92** |
| B | 导出 + 重生整组搬到右上角 | **55** |

**选 A**：标注箭头指向工具条空位（原「导出历史」），红叉只叉掉历史入口；整组搬迁（B）会使「生成本页/全部设计稿」与双重生按钮挤在一排，且重生与主题配置语义更近。

## 改动

1. **`StudioPage.tsx`**
   - 设计稿工具条：删除 `Link`「导出历史」。
   - 新增 primary「一键导出 PPTX」→ `exportPptx()`（仍读 store 的 `exportTheme` / `themeAccentId`）。
2. **`ThemeConfigPanel.tsx`**
   - 移除导出按钮、`onExport`、`projectId`、「查看导出历史」。
   - 底部改为「按主题重生」区块；`exportWarnings` 仍在此展示。
3. **`ExportPage.tsx`**
   - 引导文案改为「工具条右上角」一键导出。

## 验证

- [x] React/TS lint：`StudioPage` / `ThemeConfigPanel` / `ExportPage` 无报错
- [ ] 手动：设计稿切主题 → 右上角一键导出仍带当前主题与 accent；顶栏可进导出历史；侧栏重生仍可用

## 相关经验

见 [EXPERIENCE_export-button-placement.md](./EXPERIENCE_export-button-placement.md)。
