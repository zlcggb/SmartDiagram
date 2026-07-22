# EXECUTION · 导出配置迁入设计稿主题栏

日期：2026-07-17  
范围：`apps/web`（ExportPage / StudioPage / ProjectShell / workbenchStore / exportMode）

## 需求摘要

用户产品决策：不再在导出页选择 draft/standard/visual 与主题；导出页只做历史下载；主题与一键导出放到 Studio「设计稿」右侧；各页 `renderStrategy` 只读展示。

## 方案对比

| 方案 | 内容 | 权重 |
|------|------|------|
| **A（采用）** | 导出页=历史列表；设计稿右栏=主题+一键导出；UI 隐藏 mode；后端默认 `standard` + 页策略 | **~90** |
| B | 保留导出页全部配置，仅挪位置/文案 | ~35 |

选用 A：配置与预览同屏，历史与生成职责分离；mode 仍可由 API 接收，前端不再暴露。

## 实现要点

1. **ExportPage**：标题「导出历史」；列表下载 `exports[]`；引导去工作室一键导出；去掉模式/主题/主生成按钮/Hybrid·A·B·C 说明。
2. **StudioPage 设计稿右栏**：
   - 主题白蓝 / 蓝黑 → 乐观 `setExportTheme` + **`recolorSvgPreview` 即时换色**（shared 色板映射，不调 AI）
   - 导出路径同样对 SVG 做 `recolorSvgPreview` 再 compile
   - 「按主题重新生成本页/全部」才走 AI（布局级深浅重排）
   - 「一键导出 PPTX」→ `exportPptx()`（固定 standard）
   - Agent 日志折叠到底部；搜索/初稿 Tab 仍完整显示日志
3. **策略 UI**：去掉 IR/SVG/混合切换，只读徽章展示当前策略。
4. **Store**：`exportPptx` / 设计生成 / `runPipeline` 默认 `mode: "standard"`；`setExportTheme` 持久化项目 theme；busy 时主题按钮禁用。
5. **顶栏**：「全部自动生成」保留；与「一键导出」区分（流水线 vs 仅导出 PPTX）。
6. **导航文案**：导出 →「导出历史」。

## 未改动

- 后端仍接受 `mode` 字段；Hybrid 降级与页策略逻辑不变。
- 并行落地的搜索/初稿 `SlideMetaEditor` 可编辑表单保留，未覆盖。

## 验证

```bash
corepack pnpm --filter @ppt-agent/web typecheck
```

手动：设计稿切主题 → 左侧预览刷新；一键导出下载；导出历史页可再下；顶栏全部自动生成仍可用。
