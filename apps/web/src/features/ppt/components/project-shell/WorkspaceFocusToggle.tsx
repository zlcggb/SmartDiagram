import { Maximize2, Minimize2 } from "lucide-react";

interface WorkspaceFocusToggleProps {
  active: boolean;
  onToggle: () => void;
}

export function WorkspaceFocusToggle({ active, onToggle }: WorkspaceFocusToggleProps) {
  const Icon = active ? Minimize2 : Maximize2;
  const label = active ? "退出沉浸模式" : "进入沉浸模式";

  return (
    <button
      type="button"
      className="workspace-focus-toggle"
      aria-label={label}
      aria-pressed={active}
      title={`${label}（⌘⇧F）`}
      onClick={onToggle}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span>{active ? "退出沉浸" : "沉浸模式"}</span>
      <kbd aria-hidden="true">⌘⇧F</kbd>
    </button>
  );
}
