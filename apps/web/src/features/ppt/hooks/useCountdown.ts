import { useCallback, useEffect, useRef, useState } from "react";

interface UseCountdownResult {
  /** 当前剩余秒数（向上取整） */
  secondsLeft: number;
  /** 是否正在倒计时 */
  isRunning: boolean;
  /** 开始倒计时，返回 Promise 在倒计时结束或跳过 时 resolve */
  start: (durationSeconds: number) => Promise<void>;
  /** 立即结束倒计时 */
  skip: () => void;
}

export function useCountdown(): UseCountdownResult {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolveRef = useRef<(() => void) | null>(null);
  const endAtRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    endAtRef.current = null;
  }, []);

  const stop = useCallback(() => {
    clearTimer();
    setIsRunning(false);
    setSecondsLeft(0);
    if (resolveRef.current) {
      resolveRef.current();
      resolveRef.current = null;
    }
  }, [clearTimer]);

  const start = useCallback(
    (durationSeconds: number) =>
      new Promise<void>((resolve) => {
        // 如果已经在运行，先停止上一个
        stop();

        resolveRef.current = resolve;
        const now = Date.now();
        const endAt = now + durationSeconds * 1000;
        endAtRef.current = endAt;

        setSecondsLeft(durationSeconds);
        setIsRunning(true);

        timerRef.current = setInterval(() => {
          const remaining = Math.ceil((endAtRef.current ?? endAt) - Date.now()) / 1000;
          if (remaining <= 0) {
            setSecondsLeft(0);
            stop();
          } else {
            setSecondsLeft(Math.ceil(remaining));
          }
        }, 200);
      }),
    [stop]
  );

  const skip = useCallback(() => {
    if (!isRunning) return;
    stop();
  }, [isRunning, stop]);

  useEffect(() => {
    return () => {
      clearTimer();
      if (resolveRef.current) {
        resolveRef.current();
        resolveRef.current = null;
      }
    };
  }, [clearTimer]);

  return {
    secondsLeft,
    isRunning,
    start,
    skip
  };
}
