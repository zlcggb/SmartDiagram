# Web Frontend — Hook Guidelines

## Data Fetching

No dedicated data fetching library (no React Query / SWR). API calls are:
- **Diagram**: SSE streams in `chatStore.ts`, fetch in service functions
- **PPT**: `features/ppt/lib/api.ts` wrapping `fetch` calls to `/ppt-api/*`

## Custom Hook Patterns

### Location

- Feature-scoped hooks: `features/<module>/hooks/`
- Shared hooks: `shared/hooks/`

### Naming

- Prefix with `use`: `useWorkbench`, `useDiagramHistory`
- Colocate with the feature they serve

### Pattern

```typescript
// ✅ Simple custom hook
export function useDiagramHistory() {
  const { conversationId } = useChatStore();
  const [history, setHistory] = useState<DiagramVersion[]>([]);

  useEffect(() => {
    if (!conversationId) return;
    fetchHistory(conversationId).then(setHistory);
  }, [conversationId]);

  return history;
}
```

## SSE Streaming

Diagram chat uses Server-Sent Events. The SSE handler lives in `chatStore.ts`:

```typescript
// SSE event types from backend
type SSEEventType = 'agent' | 'design' | 'code' | 'code_end' | 'error';
```

PPT uses progress streaming via `features/ppt/lib/progressStream.ts`.

## Forbidden

- ❌ `useEffect` for derived state (use `useMemo`)
- ❌ Hooks that directly mutate Zustand store without going through actions
- ❌ Network calls inside render (use effect or event handler)
