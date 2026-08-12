/**
 * useIsMobile — 响应式断点检测 hook
 * 基于 matchMedia 监听 viewport 变化，避免 resize 事件的性能问题
 */

import { useCallback, useSyncExternalStore } from 'react';

const MOBILE_BREAKPOINT = 768;

export function useIsMobile(breakpoint = MOBILE_BREAKPOINT): boolean {
  const subscribe = useCallback((notify: () => void) => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    mql.addEventListener('change', notify);
    return () => mql.removeEventListener('change', notify);
  }, [breakpoint]);

  const getSnapshot = useCallback(
    () => window.matchMedia(`(max-width: ${breakpoint - 1}px)`).matches,
    [breakpoint],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
