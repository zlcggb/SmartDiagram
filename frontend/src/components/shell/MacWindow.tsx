import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject
} from "react";
import { createPortal } from "react-dom";
import { windowControlAvailability } from "./shellModel";

interface MacWindowProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onMinimize?: () => void;
  onResize?: () => void;
  minimizable?: boolean;
  resizable?: boolean;
  wide?: boolean;
  modal?: boolean;
  triggerRef?: RefObject<HTMLElement | null>;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
}

export function MacWindow({
  title,
  children,
  onClose,
  onMinimize,
  onResize,
  minimizable,
  resizable,
  wide,
  modal = true,
  triggerRef
}: MacWindowProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const controls = windowControlAvailability({ minimizable, resizable });

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const triggerElement = triggerRef?.current;
    const frame = window.requestAnimationFrame(() => {
      const preferred = dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]");
      // Focus the window surface by default so a programmatically opened window
      // does not paint a keyboard focus ring around the red traffic-light button.
      (preferred ?? dialogRef.current)?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.requestAnimationFrame(() => (triggerElement ?? previousFocus)?.focus());
    };
  }, [triggerRef]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (!modal || event.key !== "Tab" || !dialogRef.current) return;
    const focusable = focusableElements(dialogRef.current);
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
      : (currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1);
    event.preventDefault();
    focusable[nextIndex]?.focus();
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="mac-window-backdrop mac-shell"
      data-modal={modal}
      onPointerDown={(event) => {
        if (modal && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="mac-window"
        data-wide={wide || undefined}
        role="dialog"
        aria-modal={modal || undefined}
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="mac-window-titlebar">
          <div className="mac-window-controls" aria-label="窗口控制">
            <button
              type="button"
              className="mac-window-control mac-window-control--close"
              aria-label="关闭"
              onClick={onClose}
            />
            <button
              type="button"
              className="mac-window-control mac-window-control--minimize"
              aria-label="最小化"
              disabled={!controls.minimize}
              onClick={onMinimize}
            />
            <button
              type="button"
              className="mac-window-control mac-window-control--resize"
              aria-label="调整窗口大小"
              disabled={!controls.resize}
              onClick={onResize}
            />
          </div>
          <h2 id={titleId} className="mac-window-title">{title}</h2>
          <span className="mac-window-titlebar-spacer" aria-hidden="true" />
        </div>
        <div className="mac-window-content">{children}</div>
      </div>
    </div>,
    document.body
  );
}
