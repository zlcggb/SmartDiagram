# Web Frontend — Quality Guidelines

## Code Standards

### Import Order

1. React / framework imports
2. Third-party libraries
3. `@/` aliased imports (shared → features)
4. Relative imports (same feature)
5. Type-only imports last

```tsx
// ✅ Correct import order
import { useState } from 'react';
import { create } from 'zustand';
import { useChatStore } from '@/features/diagram/model/chatStore';
import type { DiagramEngineType } from '@/types/diagram';
```

### TypeScript

- Strict mode enabled
- Prefer `interface` over `type` for object shapes
- Use `type` for unions, intersections, and mapped types
- Export types separately with `export type`

### Styling

- **Tailwind v4** — use utility classes, not custom CSS
- Follow existing class patterns in the file you're editing
- No `style={{}}` inline styles unless dynamic values require it

## Forbidden Patterns

| Pattern | Why | Alternative |
|---------|-----|-------------|
| `any` type | Defeats type checking | `unknown` + type guard |
| `console.log` in committed code | Noise in production | Remove or use logger |
| `// @ts-ignore` | Hides real errors | Fix the type issue |
| `useEffect` for derived state | Causes extra renders | `useMemo` or compute in render |
| `index.tsx` as component name | Hard to navigate | Use descriptive names |

## Testing

- Tests colocated: `*.test.ts` next to source file
- Example: `diagramHistory.test.ts` next to `diagramHistory.ts`
- Use Node's built-in `node:test` runner through `tsx`; run the cross-workspace suite with the root `npm run test:typescript` command
