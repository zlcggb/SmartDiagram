import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface DialogShellProps {
  open: boolean;
  title: string;
  closeLabel: string;
  children: ReactNode;
  onClose: () => void;
}

function DialogShell({ open, title, closeLabel, children, onClose }: DialogShellProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
      <section className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-950 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900"
            title={closeLabel}
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function TextInputDialog({
  open,
  title,
  label,
  description,
  initialValue,
  confirmLabel,
  cancelLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  label: string;
  description?: string;
  initialValue: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  onConfirm: (value: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setError('');
    }
  }, [open, initialValue]);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError(label);
      return;
    }
    await onConfirm(trimmed);
  };

  return (
    <DialogShell open={open} title={title} closeLabel={cancelLabel} onClose={onCancel}>
      <div className="px-5 py-4">
        {description && <p className="mb-4 text-xs leading-relaxed text-slate-500">{description}</p>}
        <label className="mb-1.5 block text-xs font-medium text-slate-700">{label}</label>
        <input
          autoFocus
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError('');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit();
            if (event.key === 'Escape') onCancel();
          }}
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
        />
        {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
      </div>
      <footer className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-xl px-4 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
        >
          {confirmLabel}
        </button>
      </footer>
    </DialogShell>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <DialogShell open={open} title={title} closeLabel={cancelLabel} onClose={onCancel}>
      <div className="flex gap-3 px-5 py-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
          <AlertTriangle className="h-4 w-4" />
        </div>
        <p className="text-sm leading-relaxed text-slate-600">{message}</p>
      </div>
      <footer className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-xl px-4 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={() => void onConfirm()}
          disabled={busy}
          className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
        >
          {confirmLabel}
        </button>
      </footer>
    </DialogShell>
  );
}

export function NoticeDialog({
  open,
  title,
  message,
  closeLabel,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <DialogShell open={open} title={title} closeLabel={closeLabel} onClose={onClose}>
      <div className="px-5 py-5">
        <p className="text-sm leading-relaxed text-slate-600">{message}</p>
      </div>
      <footer className="flex justify-end border-t border-slate-100 bg-slate-50 px-5 py-4">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
        >
          {closeLabel}
        </button>
      </footer>
    </DialogShell>
  );
}
