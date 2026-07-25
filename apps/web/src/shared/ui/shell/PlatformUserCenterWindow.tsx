import type { RefObject } from "react";
import { useT } from "@/app/i18n";
import { isPlatformAdminSession } from "@/shared/lib/config/auth";
import { usePlatformAuth } from "@/shared/store/authStore";
import PlatformUserCenterPanel from "@/shared/ui/settings/PlatformUserCenterPanel";
import { MacWindow } from "./MacWindow";

interface PlatformUserCenterWindowProps {
  open: boolean;
  onClose: () => void;
  triggerRef?: RefObject<HTMLElement | null>;
}

export function PlatformUserCenterWindow({
  open,
  onClose,
  triggerRef
}: PlatformUserCenterWindowProps) {
  const { t } = useT();
  const session = usePlatformAuth((state) => state.session);

  if (!open || !session || !isPlatformAdminSession(session)) return null;

  return (
    <MacWindow
      title={t("settings.platformUsersTitle")}
      onClose={onClose}
      wide
      modal={false}
      triggerRef={triggerRef}
    >
      <div className="mac-platform-users-shell">
        <PlatformUserCenterPanel open />
      </div>
    </MacWindow>
  );
}
