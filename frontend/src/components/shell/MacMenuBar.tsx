import { useEffect, useRef, useState, type ReactNode } from "react";
import { MacMenu } from "./MacMenu";
import type { ShellMenu, ShellMenuItem } from "./shellModel";

interface MacMenuBarProps {
  menus: ShellMenu[];
  onAction: (item: ShellMenuItem, opener: HTMLButtonElement | null) => boolean | void;
  homeControl: ReactNode;
  trailing: ReactNode;
  closeSignal: string;
  overlayActive: boolean;
}

export function MacMenuBar({
  menus,
  onAction,
  homeControl,
  trailing,
  closeSignal,
  overlayActive
}: MacMenuBarProps) {
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
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
    if (!activeMenuId) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setActiveMenuId(null);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveMenuId(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [activeMenuId]);

  useEffect(() => {
    setActiveMenuId(null);
  }, [closeSignal]);

  useEffect(() => {
    if (overlayActive) setActiveMenuId(null);
  }, [overlayActive]);

  return (
    <header ref={barRef} className="mac-menu-bar">
      <div className="mac-menu-home" onPointerDown={() => setActiveMenuId(null)}>{homeControl}</div>
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
      <div className="mac-menu-trailing" onPointerDown={() => setActiveMenuId(null)}>{trailing}</div>
    </header>
  );
}
