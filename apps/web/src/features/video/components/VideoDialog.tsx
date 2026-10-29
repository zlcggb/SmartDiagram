import React, { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

export interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

export function useVideoDialog() {
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { open: boolean }) | null>(
    null,
  );
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  const toastIdRef = useRef(1);

  const confirm = useCallback((options: ConfirmOptions | string): Promise<boolean> => {
    const opts: ConfirmOptions =
      typeof options === 'string' ? { message: options } : options;
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setConfirmState({
        title: opts.title || '确认操作',
        message: opts.message,
        confirmText: opts.confirmText || '确定',
        cancelText: opts.cancelText || '取消',
        danger: opts.danger ?? true,
        open: true,
      });
    });
  }, []);

  const handleConfirmClose = useCallback((result: boolean) => {
    setConfirmState(null);
    if (resolverRef.current) {
      resolverRef.current(result);
      resolverRef.current = null;
    }
  }, []);

  const notify = useCallback(
    (message: string, type: 'success' | 'error' | 'info' = 'info') => {
      const id = toastIdRef.current++;
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3000);
    },
    [],
  );

  const dialogElement =
    typeof document !== 'undefined'
      ? createPortal(
          <>
            {/* Floating Toasts */}
            {toasts.length > 0 && (
              <div className="pointer-events-none fixed inset-x-0 top-16 z-[120] flex flex-col items-center gap-2 px-4">
                {toasts.map((t) => (
                  <div
                    key={t.id}
                    className={`pointer-events-auto flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-medium shadow-lg backdrop-blur-md transition-all ${
                      t.type === 'error'
                        ? 'border-rose-200/90 bg-rose-50/95 text-rose-700'
                        : t.type === 'success'
                          ? 'border-emerald-200/90 bg-emerald-50/95 text-emerald-700'
                          : 'border-slate-200/90 bg-white/95 text-slate-800'
                    }`}
                  >
                    <span>
                      {t.type === 'error' ? '⚠️' : t.type === 'success' ? '✓' : 'ℹ️'}
                    </span>
                    <span>{t.message}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Built-in Apple-style Confirm Modal */}
            {confirmState?.open && (
              <div
                className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-[3px]"
                onClick={() => handleConfirmClose(false)}
              >
                <div
                  className="w-full max-w-[400px] overflow-hidden rounded-3xl border border-slate-200/80 bg-white/95 p-6 shadow-2xl backdrop-blur-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-start gap-3.5">
                    <div
                      className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-lg ${
                        confirmState.danger
                          ? 'bg-rose-50 text-rose-600'
                          : 'bg-[#0071e3]/10 text-[#0071e3]'
                      }`}
                    >
                      {confirmState.danger ? '⚠️' : '✨'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[15.5px] font-bold tracking-tight text-slate-900">
                        {confirmState.title}
                      </h3>
                      <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-slate-600">
                        {confirmState.message}
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 flex items-center justify-end gap-2.5">
                    <button
                      type="button"
                      onClick={() => handleConfirmClose(false)}
                      className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-[13px] font-medium text-slate-700 transition hover:bg-slate-100"
                    >
                      {confirmState.cancelText}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleConfirmClose(true)}
                      className={`rounded-full px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm transition ${
                        confirmState.danger
                          ? 'bg-rose-600 hover:bg-rose-700'
                          : 'bg-[#0071e3] hover:bg-[#0077ed]'
                      }`}
                    >
                      {confirmState.confirmText}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>,
          document.body,
        )
      : null;

  return {
    confirm,
    notify,
    dialogElement,
  };
}
