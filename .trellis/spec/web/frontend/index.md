# @smartdiagram/web — Frontend Development Guidelines

> 统一 SPA 前端：React 18 + Vite + Tailwind v4 + Zustand + react-router

---

## Pre-Development Checklist

Before writing frontend code, verify:

1. [ ] Read the route structure in `apps/web/src/app/main.tsx`
2. [ ] Identify the target feature: `features/diagram/` or `features/ppt/`
3. [ ] Check relevant Zustand store for existing state
4. [ ] Verify import alias: `@/` resolves to `apps/web/src/`

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Filled |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition | Filled |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, data fetching patterns | Filled |
| [State Management](./state-management.md) | Local state, global state, server state | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | Filled |
| [Type Safety](./type-safety.md) | Type patterns, validation | Filled |

---

## Quality Check

After completing frontend changes, verify:

1. [ ] No `console.log` left in production code
2. [ ] New components follow existing naming conventions
3. [ ] Zustand stores use `create()` from `zustand` (not v3 patterns)
4. [ ] Import paths use `@/` alias, not relative `../../../`
5. [ ] Canvas components export correctly from `CanvasPanel.tsx` routing
6. [ ] New routes registered in both `main.tsx` and `modules/registry.tsx`

---

**Language**: English for code, 中文 for comments is acceptable (matches existing codebase).
