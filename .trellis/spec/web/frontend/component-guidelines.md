# Web Frontend — Component Guidelines

## Naming Conventions

- **Page components**: PascalCase, suffix with `Space` for PPT workflow pages: `IntentSpace`, `StudioSpace`, `ExportsSpace`
- **Canvas components**: suffix `Canvas`: `MermaidCanvas`, `FlowCanvas`
- **Feature modules**: camelCase directory, PascalCase component file

## Component Patterns

### Page Component

```tsx
// ✅ PPT workflow page
export function StudioSpace() {
  const store = useWorkbenchStore();
  // ... component logic
  return <div className="studio-space">...</div>;
}
```

### Canvas Component

```tsx
// ✅ Diagram canvas — receives data from chatStore
export default function MermaidCanvas() {
  const { currentCode } = useChatStore();
  // ... render Mermaid diagram
}
```

### Shared Shell

All routes wrapped in `<AppShell />` which provides:
- macOS-style menu bar
- Spotlight search
- Settings panel
- Module navigation (from `modules/registry.tsx`)

## Props Conventions

- Use TypeScript interfaces, not inline types
- Prefer destructuring in function parameters
- Default exports for page-level components, named exports for shared components

## Forbidden

- ❌ Class components (functional only)
- ❌ `React.FC` type annotation (use plain function signatures)
- ❌ Prop drilling > 2 levels (use Zustand store or context)
- ❌ CSS-in-JS (use Tailwind v4 classes)
