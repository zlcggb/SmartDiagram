import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject
} from "react";
import { Check } from "lucide-react";
import {
  nextEnabledMenuIndex,
  type ShellMenu,
  type ShellMenuItem
} from "./shellModel";

interface MacMenuProps {
  menu: ShellMenu;
  open: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onOpenChange: (open: boolean) => void;
  onAction: (item: ShellMenuItem) => void;
  onPointerEnter?: () => void;
}

export function MacMenu({
  menu,
  open,
  triggerRef,
  onOpenChange,
  onAction,
  onPointerEnter
}: MacMenuProps) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusItem = (index: number) => {
    if (index >= 0) itemRefs.current[index]?.focus();
  };

  const firstEnabledIndex = nextEnabledMenuIndex(menu.items, menu.items.length - 1, 1);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => focusItem(firstEnabledIndex));
    return () => window.cancelAnimationFrame(frame);
  }, [firstEnabledIndex, open]);

  const closeAndRestoreFocus = () => {
    onOpenChange(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const execute = (item: ShellMenuItem) => {
    if (item.disabled || item.separator || !item.action) return;
    onAction(item);
    closeAndRestoreFocus();
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const activeIndex = itemRefs.current.findIndex((item) => item === document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      focusItem(nextEnabledMenuIndex(menu.items, activeIndex, direction));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusItem(firstEnabledIndex);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusItem(nextEnabledMenuIndex(menu.items, 0, -1));
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndRestoreFocus();
      return;
    }
    if (event.key === "Tab") onOpenChange(false);
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenChange(true);
    }
  };

  return (
    <div className="mac-menu-root" onPointerEnter={onPointerEnter}>
      <button
        ref={triggerRef}
        type="button"
        className="mac-menu-trigger"
        data-active={open}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={"mac-menu-" + menu.id}
        onClick={() => onOpenChange(!open)}
        onKeyDown={handleTriggerKeyDown}
      >
        {menu.label}
      </button>

      {open ? (
        <div
          id={"mac-menu-" + menu.id}
          className="mac-menu-popover"
          role="menu"
          aria-label={menu.label}
          data-shell-menu={menu.id}
          onKeyDown={handleMenuKeyDown}
        >
          {menu.items.map((item, index) => {
            if (item.separator) {
              itemRefs.current[index] = null;
              return <div key={item.id} className="mac-menu-separator" role="separator" />;
            }
            const checkable = item.checked !== undefined;
            return (
              <button
                key={item.id}
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                type="button"
                role={checkable ? "menuitemcheckbox" : "menuitem"}
                aria-checked={checkable ? item.checked : undefined}
                aria-disabled={item.disabled || undefined}
                disabled={item.disabled}
                className="mac-menu-item"
                onClick={() => execute(item)}
              >
                <span className="mac-menu-check" aria-hidden="true">
                  {item.checked ? <Check /> : null}
                </span>
                <span className="mac-menu-label">{item.label}</span>
                {item.shortcut ? (
                  <kbd className="mac-menu-shortcut">{item.shortcut}</kbd>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
