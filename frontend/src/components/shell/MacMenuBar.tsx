import { useEffect, useRef, useState, type ReactNode } from "react";
import { MacMenu } from "./MacMenu";
import type { ShellMenu, ShellMenuItem } from "./shellModel";

interface MacMenuBarProps {
  menus: ShellMenu[];
  onAction: (item: ShellMenuItem) => void;
  homeControl: ReactNode;
  trailing: ReactNode;
}

export function MacMenuBar({
  menus,
  onAction,
  homeControl,
  trailing
}: MacMenuBarProps) {
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const barRef = useRef<HTMLElement>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});

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

  return (
    <header ref={barRef} className="mac-menu-bar">
      <div className="mac-menu-home">{homeControl}</div>
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
            onAction={onAction}
          />
        ))}
      </nav>
      <div className="mac-menu-trailing">{trailing}</div>
    </header>
  );
}
