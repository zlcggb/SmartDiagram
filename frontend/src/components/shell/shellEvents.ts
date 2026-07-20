export const DIAGRAM_SHELL_EVENT = "deepdiagram:diagram-command";

export type DiagramShellCommand =
  | "new-conversation"
  | "open-history"
  | "focus-chat"
  | "focus-canvas";

export interface DiagramShellEventDetail {
  command: DiagramShellCommand;
}

export function dispatchDiagramShellCommand(
  command: DiagramShellCommand,
  target?: EventTarget
): void {
  const resolvedTarget =
    target ?? (typeof window === "undefined" ? undefined : window);
  if (!resolvedTarget) return;
  resolvedTarget.dispatchEvent(
    new CustomEvent<DiagramShellEventDetail>(DIAGRAM_SHELL_EVENT, {
      detail: { command }
    })
  );
}
