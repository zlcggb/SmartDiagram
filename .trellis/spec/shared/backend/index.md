# @ppt-agent/shared — Backend Development Guidelines

> 共享类型包：TypeScript，PPT 工作流的核心 DTO、主题系统、配置

---

## Pre-Development Checklist

1. [ ] Check if the type/constant already exists before adding
2. [ ] Barrel exports through `src/index.ts`
3. [ ] Use Zod schemas for runtime validation where needed

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | To fill |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | Filled |

---

## Key Conventions

### Export Pattern

All public types and functions MUST be re-exported from `src/index.ts`:

```typescript
// ✅ src/index.ts
export * from "./studioPipeline.js";
export { SlideIrSchema };
export type { SlideIrDocument };
```

### Theme System

```typescript
// Theme tokens are centralized in this package
export const themeTokens = {
  pageBg: "#FFFFFF",
  primaryBlue: "#0066CC",
  // ...
} as const;
```

- `pptExportThemes` — 导出主题配置
- `themeSurfacePresets` — 表面预设
- `presentationStyles` — 演示风格
- `layoutRoles` — 推荐布局

### DTO Naming

- `*Dto` suffix for data transfer objects: `ProjectDto`, `SlideDto`, `ExportDto`
- `*Input` suffix for mutation inputs: `CreateProjectInput`, `UpdateSlideInput`
- Zod schemas named `*Schema`: `SlideIrSchema`

### Forbidden

- ❌ Business logic in this package (it's types + config only)
- ❌ Direct database access
- ❌ Side effects on import
- ❌ Non-barrel exports (everything goes through `index.ts`)

---

## Quality Check

1. [ ] New exports added to `src/index.ts`
2. [ ] DTO changes backward compatible or versioned
3. [ ] Zod schemas match TypeScript types
4. [ ] No circular imports
