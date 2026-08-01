# Web Frontend — Type Safety

## TypeScript Configuration

- Strict mode: `strict: true` in `tsconfig.base.json`
- Path alias: `@/` → `apps/web/src/`
- Target: ES2022+

## Type Patterns

### Store Types

```typescript
// ✅ Colocate types with store
export type CanvasPhase = 'idle' | 'routing' | 'designing' | 'generating' | 'done';

export interface ThinkingStep {
  id: string;
  label: string;
  startTime: number;
  duration?: number;
  status: 'running' | 'completed';
}
```

### Shared Types

Cross-module types go in `src/types/`:
- `diagram.ts` — DiagramEngineType, DiagramTaskType
- Shared DTO types from `@ppt-agent/shared` package

### PPT Types

PPT module imports types from the `@ppt-agent/shared` workspace package:

```typescript
import type { ProjectDto, SlideDto, ExportDto } from '@ppt-agent/shared';
```

## Conventions

- Use `type` imports: `import type { Foo } from '...'`
- Discriminated unions for variant types (Canvas phases, step types)
- `as const` for literal type narrowing
- Zod schemas for runtime validation in `@ppt-agent/shared`

## Forbidden

- ❌ `as any` type assertion
- ❌ Non-null assertion `!` without clear justification
- ❌ Duplicating types that exist in `@ppt-agent/shared`
