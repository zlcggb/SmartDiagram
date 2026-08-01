# @ppt-agent/ppt-renderer — Frontend Guidelines

> 此包为纯 TypeScript 渲染库。"Frontend" 指其导出 API，被 `service-ppt-renderer` 消费。

---

## Overview

`packages/ppt-renderer/` 提供 SVG/IR → PPTX 编译和 PNG 渲染能力。

## Consumer Pattern

```typescript
import { tryRenderSvgSlide, compileSvgPreviewToSlide, renderSlidePng } from '@ppt-agent/ppt-renderer';
import type { RenderProjectPptxInput, PageRenderResult } from '@ppt-agent/ppt-renderer';
```

## Key Exports

| Function | Purpose |
|----------|---------|
| `tryRenderSvgSlide()` | SVG → PPTX slide（带 warnings） |
| `compileSvgPreviewToSlide()` | SVG preview → compiled slide |
| `renderSlidePng()` | SVG → PNG via @resvg/resvg-js |
| `postprocessEditableSvgGeometry()` | PPTX 后处理 |

## Conventions

- All render functions are pure: input → output, no file I/O
- Error handling via result objects (not exceptions)
- Heavy computation (SVG parsing, PPTX generation) should be called from background workers when possible
