import { useEffect, useRef, useState } from "react";

export function useThrottledValue<T>(value: T, intervalMs: number): T {
  const [throttledValue, setThrottledValue] = useState(value);
  const latestValueRef = useRef(value);
  const lastCommitAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latestValueRef.current = value;
    if (lastCommitAtRef.current === null) {
      lastCommitAtRef.current = Date.now();
      return;
    }

    const elapsedMs = Date.now() - lastCommitAtRef.current;

    const commitLatest = () => {
      timerRef.current = null;
      lastCommitAtRef.current = Date.now();
      setThrottledValue(latestValueRef.current);
    };

    if (!timerRef.current) {
      timerRef.current = setTimeout(commitLatest, Math.max(0, intervalMs - elapsedMs));
    }
  }, [intervalMs, value]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return throttledValue;
}
