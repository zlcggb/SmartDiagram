/**
 * 版式变体坐标骨架（1280×720 IR 帧）。
 * JSON 文件为唯一真相源；运行时只填槽，不改几何（lockGeometry）。
 */

import type { RecommendedLayout } from "../layoutRoles.js";

export type SkeletonElementType =
  | "text"
  | "card"
  | "metric"
  | "table"
  | "timeline"
  | "process"
  | "callout"
  | "decor";

export interface SkeletonCanvas {
  width: 1280;
  height: 720;
}

export interface SkeletonElement {
  id: string;
  type: SkeletonElementType;
  role: string;
  /** 填槽路径，如 claim / metrics.0 / cards.1 */
  slot: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  editable?: boolean;
  style?: {
    fill?: string;
    stroke?: string;
    color?: string;
    accent?: string;
    fontSize?: number;
    bold?: boolean;
    align?: "left" | "center" | "right";
    tone?: "primary" | "default" | "accent" | "success" | "warning" | "risk";
  };
}

export interface LayoutSkeletonFrame {
  variantId: string;
  canvas: SkeletonCanvas;
  recommendedLayout: RecommendedLayout;
  /** true：生成/归一化时锁定 x/y/w/h/z/type */
  lockGeometry: boolean;
  elements: SkeletonElement[];
}

export type SkeletonSlotValues = Record<string, string | string[] | string[][] | undefined>;
