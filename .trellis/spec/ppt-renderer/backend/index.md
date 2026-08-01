# @ppt-agent/ppt-renderer — Backend Development Guidelines

> PPTX 渲染核心包：SVG → PPTX 编译、PNG 渲染、导出类型定义

---

## Pre-Development Checklist

1. [ ] Read `svgCompile.ts` for SVG → PPTX slide compilation
2. [ ] Check `exportTypes.ts` for render input/result types
3. [ ] Uses `pptxgenjs` as PPTX generation engine
4. [ ] Uses `@resvg/resvg-js` for SVG → PNG rasterization

---

## Architecture

```
packages/ppt-renderer/src/
├── index.ts              # Barrel exports
├── exportTypes.ts        # RenderProjectPptxInput / Result / PageRenderResult
├── svgCompile.ts         # tryRenderSvgSlide — SVG → PPTX slide
├── svgPathGeometry.ts    # SVG path 几何处理
├── pptxPostprocess.ts    # postprocessEditableSvgGeometry — 后处理
├── slideImage.ts         # renderSlidePng — SVG → PNG
├── slideIrExport.test.ts # SmartSlide IR 导出测试
├── subtitleOverlay.ts    # 字幕叠加
└── subtitleOverlay.test.ts
```

### Key Patterns

- **Dual render path**: SVG slides 和 SmartSlide IR slides 走不同编译路径
- **Theme aware**: 使用 `@ppt-agent/shared` 的 `themeFamily`, `normalizePptExportTheme` 等
- **Error tolerance**: `tryRenderSvgSlide` 返回 result + warnings，不抛异常

### Dependencies

| Package | Usage |
|---------|-------|
| `pptxgenjs` | PPTX 文件生成 |
| `@resvg/resvg-js` | SVG → PNG 光栅化 |
| `@ppt-agent/slide-ir` | SmartSlide IR → PPTX 编译 |
| `@ppt-agent/shared` | 主题、布局、类型定义 |

### Forbidden

- ❌ 在此包中做网络请求（纯渲染包）
- ❌ 直接写文件系统（输出为 Buffer，由调用方存储）
- ❌ 引入前端框架依赖

---

## Quality Check

1. [ ] 新增导出类型在 `exportTypes.ts` 定义，`index.ts` 导出
2. [ ] SVG 编译变更有测试覆盖
3. [ ] 主题兼容性：新主题在 `@ppt-agent/shared` 注册后此处无需改动
