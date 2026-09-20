import type { ComponentType } from "react";
import { MindmapAppIcon, RecruitAppIcon, SlidesAppIcon } from "./MacOSIcons";

/** 按模块路由路径取 SmartDiagram 的 macOS 风格 artwork。 */
export const MODULE_ICONS: Record<string, ComponentType<{ size?: number }>> = {
  "/diagram": MindmapAppIcon,
  "/recruit": RecruitAppIcon,
  "/ppt": SlidesAppIcon
};
