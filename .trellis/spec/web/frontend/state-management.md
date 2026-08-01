# Web Frontend — State Management

## Pattern: Zustand v4 Stores

All global state uses Zustand `create()`. No Redux, no Context for global state.

### Store Location

| Module | Store | File |
|--------|-------|------|
| Diagram | `useChatStore` | `features/diagram/model/chatStore.ts` |
| PPT | `useWorkbenchStore` | `features/ppt/store/workbenchStore.ts` |
| Shared | platform stores | `shared/store/` |

### Store Pattern

```typescript
// ✅ Correct: Zustand v4 with TypeScript
import { create } from 'zustand';

interface ChatState {
  messages: Message[];
  canvasPhase: CanvasPhase;
  addMessage: (msg: Message) => void;
  setCanvasPhase: (phase: CanvasPhase) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  canvasPhase: 'idle',
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setCanvasPhase: (phase) => set({ canvasPhase: phase }),
}));
```

### Forbidden

- ❌ `create<State>()(...)` — 不使用双括号柯里化形式
- ❌ Redux / useReducer for global state
- ❌ Context Provider for frequently changing state
- ❌ Direct store mutation (always use `set()`)

### SSE Streaming State

Diagram module uses SSE events to update store. The stream emits typed events:
`agent | design | code | code_end | error`. Store reducers handle each event type.

### PPT Store

`workbenchStore.ts` manages the 5-step workflow (Intent → Structure → Studio → Exports).
Uses `Step` type (1-5) for navigation. API calls go through `features/ppt/lib/api.ts`.
