import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { WORKSPACE_STUDIO_TOOLBAR_HOST_ID } from "./workspaceFocusMode";

interface WorkspaceStudioPortalProps {
  children: ReactNode;
}

export function WorkspaceStudioPortal({ children }: WorkspaceStudioPortalProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setHost(document.getElementById(WORKSPACE_STUDIO_TOOLBAR_HOST_ID));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  if (host) return createPortal(children, host);

  return <div className="studio-command-bar-fallback">{children}</div>;
}
