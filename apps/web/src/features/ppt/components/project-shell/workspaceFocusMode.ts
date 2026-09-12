export const WORKSPACE_FOCUS_MODE_KEY = "ppt-workspace-focus-mode";
export const WORKSPACE_STUDIO_TOOLBAR_HOST_ID = "workspace-studio-toolbar-host";

interface StorageReader {
  getItem(key: string): string | null;
}

interface StorageWriter {
  setItem(key: string, value: string): void;
}

interface WorkspaceFocusShortcut {
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
  target?: unknown;
}

export function readWorkspaceFocusMode(storage: StorageReader | null | undefined): boolean {
  try {
    return storage?.getItem(WORKSPACE_FOCUS_MODE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeWorkspaceFocusMode(
  storage: StorageWriter | null | undefined,
  active: boolean
): void {
  try {
    storage?.setItem(WORKSPACE_FOCUS_MODE_KEY, String(active));
  } catch {
    // 隐私模式或浏览器策略可能禁用 localStorage；布局仍可在当前会话中切换。
  }
}

export function isWorkspaceFocusShortcut(event: WorkspaceFocusShortcut): boolean {
  const target =
    typeof event.target === "object" && event.target !== null
      ? event.target as { tagName?: unknown; isContentEditable?: unknown }
      : null;
  const tagName = typeof target?.tagName === "string" ? target.tagName.toUpperCase() : undefined;
  const isEditable =
    target?.isContentEditable === true ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT";

  return !isEditable && event.metaKey && event.shiftKey && event.key.toLowerCase() === "f";
}
