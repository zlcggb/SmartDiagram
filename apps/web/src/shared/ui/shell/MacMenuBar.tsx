import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, MoreHorizontal } from "lucide-react";
import { MacMenu } from "./MacMenu";
import type { ShellMenu, ShellMenuItem } from "./shellModel";

interface MacMenuBarProps {
  menus: ShellMenu[];
  onAction: (item: ShellMenuItem, opener: HTMLButtonElement | null) => boolean | void;
  homeControl: ReactNode;
  trailing: ReactNode;
  mobileUtilities?: ReactNode;
  closeSignal: string;
  overlayActive: boolean;
}

export function MacMenuBar({
  menus,
  onAction,
  homeControl,
  trailing,
  mobileUtilities,
  closeSignal,
  overlayActive
}: MacMenuBarProps) {
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const barRef = useRef<HTMLElement>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const moveTopLevel = (menuId: string, direction: 1 | -1) => {
    const currentIndex = menus.findIndex((menu) => menu.id === menuId);
    if (currentIndex < 0 || menus.length === 0) return;
    const nextMenu = menus[(currentIndex + direction + menus.length) % menus.length];
    if (!nextMenu) return;
    if (activeMenuId) {
      setActiveMenuId(nextMenu.id);
    } else {
      window.requestAnimationFrame(() => triggerRefs.current[nextMenu.id]?.focus());
    }
  };

  useEffect(() => {
    if (!activeMenuId && !mobileOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) {
        setActiveMenuId(null);
        setMobileOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveMenuId(null);
        setMobileOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [activeMenuId, mobileOpen]);

  useEffect(() => {
    setActiveMenuId(null);
    setMobileOpen(false);
  }, [closeSignal]);

  useEffect(() => {
    if (overlayActive) {
      setActiveMenuId(null);
      setMobileOpen(false);
    }
  }, [overlayActive]);

  const executeMobileAction = (item: ShellMenuItem) => {
    if (item.disabled || item.separator || !item.action) return;
    setMobileOpen(false);
    onAction(item, null);
  };

  return (
    <header ref={barRef} className="mac-menu-bar">
      <div className="mac-menu-home" onPointerDown={() => setActiveMenuId(null)}>{homeControl}</div>
      <strong className="mac-mobile-module-title">{menus[0]?.label ?? "SmartDiagram"}</strong>
      <nav className="mac-menu-list" aria-label="应用菜单">
        {menus.map((menu) => (
          <MacMenu
            key={menu.id}
            menu={menu}
            open={activeMenuId === menu.id}
            triggerRef={{
              get current() {
                return triggerRefs.current[menu.id] ?? null;
              },
              set current(element) {
                triggerRefs.current[menu.id] = element;
              }
            }}
            onOpenChange={(open) => setActiveMenuId(open ? menu.id : null)}
            onPointerEnter={() => {
              if (activeMenuId && activeMenuId !== menu.id) setActiveMenuId(menu.id);
            }}
            onMoveTopLevel={(direction) => moveTopLevel(menu.id, direction)}
            onAction={onAction}
          />
        ))}
      </nav>
      <div className="mac-mobile-menu-root">
        <button
          type="button"
          className="mac-mobile-menu-trigger"
          aria-label="更多菜单"
          aria-haspopup="menu"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((open) => !open)}
        >
          <MoreHorizontal aria-hidden="true" />
        </button>
        {mobileOpen ? (
          <div className="mac-mobile-menu-popover" role="menu" aria-label="应用菜单">
            {mobileUtilities ? <div className="mac-mobile-menu-utilities">{mobileUtilities}</div> : null}
            {menus.map((menu) => (
              <section className="mac-mobile-menu-section" key={menu.id} aria-label={menu.label}>
                <h2>{menu.label}</h2>
                <div>
                  {menu.items.map((item) => item.separator ? (
                    <hr key={item.id} />
                  ) : (
                    <button
                      key={item.id}
                      type="button"
                      role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                      aria-checked={item.checked}
                      disabled={item.disabled}
                      onClick={() => executeMobileAction(item)}
                    >
                      <span className="mac-mobile-menu-check" aria-hidden="true">
                        {item.checked ? <Check /> : null}
                      </span>
                      <span>{item.label}</span>
                      {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </div>
      <div className="mac-menu-trailing" onPointerDown={() => setActiveMenuId(null)}>{trailing}</div>
    </header>
  );
}
