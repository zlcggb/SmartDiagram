# @ppt-agent/shared — Frontend Guidelines

> 此包为纯类型/配置包。"Frontend" 指其对外导出给 `apps/web` 消费的 types 和 helpers。

---

## Overview

`packages/shared/` 是所有 PPT 模块的类型中心。前端 (`apps/web`) 通过 workspace protocol 直接 import。

## Consumer Pattern

```typescript
// ✅ From apps/web
import type { ProjectDto, SlideDto } from '@ppt-agent/shared';
import { getThemePack, normalizePptExportTheme } from '@ppt-agent/shared';
```

## Key Frontend-facing Exports

| Category | Examples |
|----------|---------|
| **DTOs** | `ProjectDto`, `SlideDto`, `ExportDto`, `FactDto` |
| **Inputs** | `CreateProjectInput`, `UpdateSlideInput` |
| **Theme** | `getThemePack`, `themeFamily`, `normalizePptExportTheme` |
| **Style** | `presentationStyleIds`, `getPresentationStylePreset` |
| **Layout** | `recommendedLayouts`, `normalizeRecommendedLayout` |
| **Render** | `renderStrategies`, `inferRenderStrategy` |

## Conventions

- Types use `Dto` suffix, mutation inputs use `Input` suffix
- Theme/style helpers are pure functions, no side effects
- `as const` objects for enumerations
- Chinese category names in `factCategories` (matches business domain)
