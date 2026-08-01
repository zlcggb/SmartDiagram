# @ppt-agent/slide-ir — Frontend Guidelines

> 此包为纯 TypeScript 库。"Frontend" 指其对外 API，被 `apps/web`、`@ppt-agent/shared`、`@ppt-agent/ppt-renderer` 消费。

---

## Overview

`packages/slide-ir/` 定义了 SmartSlide 页面中间表示（IR），提供解析、校验、SVG 渲染和 PPTX 编译能力。

## Consumer Pattern

```typescript
// From apps/web or other packages
import { SlideIrSchema, parseSmartSlide, renderSlideIrToSvg } from '@ppt-agent/slide-ir';
import type { SlideIrDocument, SlideIrElement } from '@ppt-agent/slide-ir';
```

## Key Exports

| Category | Functions |
|----------|-----------|
| **Schema** | `SlideIrSchema`, `SlideIrElementSchema`, `BoundsSchema` |
| **Types** | `SlideIrDocument`, `SlideIrElement`, `Bounds`, `TextElement`... |
| **Language** | `parseSmartSlide()`, `stringifySmartSlide()` |
| **Validate** | `validateSlideIr()`, `estimateTextElementHeight()` |
| **Render** | `renderSlideIrToSvg()` |
| **Compile** | `compileSlideIrToPptx()` |
| **Tokens** | `resolveColor()`, `collectColorReferences()` |

## Conventions

- Schema-first: Zod schema is the source of truth, TS types derived from it
- Pure functions: no side effects, no DOM, no network
- Constants: `SMARTSLIDE_WIDTH`, `SMARTSLIDE_HEIGHT`, `SMARTSLIDE_SCHEMA_VERSION`
