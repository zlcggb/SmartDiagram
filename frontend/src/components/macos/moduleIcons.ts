import type { ComponentType } from "react";
import { MindmapAppIcon, SlidesAppIcon } from "./MacOSIcons";

/** 按模块路由路径取 DeepDiagram 的 macOS 风格 artwork。 */
export const MODULE_ICONS: Record<string, ComponentType<{ size?: number }>> = {
  "/diagram": MindmapAppIcon,
  "/ppt": SlidesAppIcon
};
