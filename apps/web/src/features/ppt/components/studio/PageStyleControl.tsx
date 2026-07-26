import {
  getPresentationStylePreset,
  presentationStyleList,
  resolvePresentationStyleId,
  type PresentationStyleId
} from "@ppt-agent/shared";
import {
  Check,
  ChevronDown,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Sparkles
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface PageStyleControlProps {
  busy: boolean;
  projectStyle: PresentationStyleId;
  configuredStyle: PresentationStyleId | null;
  appliedStyle: PresentationStyleId;
  pendingStyle?: PresentationStyleId | null;
  hasPendingChange: boolean;
  onChange: (style: PresentationStyleId | null) => void;
}

export function PageStyleControl({
  busy,
  projectStyle,
  configuredStyle,
  appliedStyle,
  pendingStyle,
  hasPendingChange,
  onChange
}: PageStyleControlProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const appliedPreset = getPresentationStylePreset(appliedStyle);
  const projectPreset = getPresentationStylePreset(projectStyle);
  const selectedStyle = hasPendingChange
    ? pendingStyle ?? null
    : configuredStyle;
  const requestedPreset = getPresentationStylePreset(
    resolvePresentationStyleId(projectStyle, selectedStyle)
  );

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const selectStyle = (style: PresentationStyleId | null) => {
    setOpen(false);
    if (style === selectedStyle) return;
    onChange(style);
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={
          hasPendingChange
            ? `本页当前已应用${appliedPreset.label}，已选择${requestedPreset.label}待重新生成`
            : `本页当前已应用${appliedPreset.label}`
        }
        className={`inline-flex h-9 items-center gap-1.5 rounded-[10px] border px-3 text-xs font-medium transition ${
          open
            ? "border-[rgba(0,0,0,0.3)] bg-[rgba(0,0,0,0.045)] text-[rgba(0,0,0,0.9)]"
            : hasPendingChange
              ? "border-amber-300 bg-amber-50 text-amber-950"
              : "border-[rgba(0,0,0,0.13)] bg-white text-[rgba(0,0,0,0.78)] hover:border-[rgba(0,0,0,0.3)]"
        } disabled:cursor-not-allowed disabled:opacity-50`}
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="text-[rgba(0,0,0,0.42)]">风格</span>
        <span aria-hidden="true" className="text-[rgba(0,0,0,0.24)]">·</span>
        <span>{appliedPreset.label}</span>
        <span className="ml-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700">
          已应用
        </span>
        {hasPendingChange ? (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-800">
            待更新
          </span>
        ) : null}
        <ChevronDown
          aria-hidden="true"
          className={`ml-0.5 h-3.5 w-3.5 text-[rgba(0,0,0,0.38)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="本页演示风格"
          className="absolute right-0 top-full z-40 mt-2 w-60 rounded-xl border border-[rgba(0,0,0,0.13)] bg-white p-1.5 shadow-[0_16px_36px_rgba(0,0,0,0.16)]"
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={selectedStyle === null}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition hover:bg-[rgba(0,0,0,0.045)]"
            onClick={() => selectStyle(null)}
          >
            <span>
              <span className="block font-medium text-[rgba(0,0,0,0.86)]">跟随整套默认</span>
              <span className="mt-0.5 block text-[10px] text-[rgba(0,0,0,0.42)]">{projectPreset.label}</span>
            </span>
            {selectedStyle === null ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : null}
          </button>
          <div className="my-1 h-px bg-[rgba(0,0,0,0.08)]" />
          {presentationStyleList.map((style) => {
            const active = selectedStyle === style.id;
            return (
              <button
                key={style.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition hover:bg-[rgba(0,0,0,0.045)]"
                onClick={() => selectStyle(style.id)}
              >
                <span className={active ? "font-medium text-[rgba(0,0,0,0.9)]" : "text-[rgba(0,0,0,0.72)]"}>
                  {style.label}
                </span>
                {active ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : null}
              </button>
            );
          })}
          <p className="px-2.5 pb-1 pt-1.5 text-[10px] leading-4 text-[rgba(0,0,0,0.45)]">
            {hasPendingChange
              ? `已选择“${requestedPreset.label}”，重新生成成功后应用`
              : "选择新风格后，可确认重新生成或忽略更改"}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function PageStyleChangePrompt({
  appliedStyle,
  requestedStyle,
  busy,
  onRegenerate,
  onIgnore
}: {
  appliedStyle: PresentationStyleId;
  requestedStyle: PresentationStyleId;
  busy: boolean;
  onRegenerate: () => void;
  onIgnore: () => void;
}) {
  const appliedPreset = getPresentationStylePreset(appliedStyle);
  const requestedPreset = getPresentationStylePreset(requestedStyle);

  return (
    <section
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3"
      aria-label="页面风格待应用"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <Sparkles className="h-4 w-4" />
        </span>
        <div>
          <p className="text-sm font-semibold text-amber-950">
            当前使用“{appliedPreset.label}”，已选择“{requestedPreset.label}”
          </p>
          <p className="mt-0.5 text-xs leading-5 text-amber-800">
            当前设计稿保持不变；重新生成成功后，新风格才会应用到本页。
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 text-xs font-medium text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"
          disabled={busy}
          onClick={onIgnore}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          忽略更改
        </button>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-900 px-3 text-xs font-medium text-white transition hover:bg-amber-800 disabled:opacity-50"
          disabled={busy}
          onClick={onRegenerate}
        >
          {busy ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          按新风格重新生成
        </button>
      </div>
    </section>
  );
}
