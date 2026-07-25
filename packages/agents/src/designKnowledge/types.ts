import type { SlideDto } from "@ppt-agent/shared";

export type DesignRecipeId =
  | "editorial-hero-split"
  | "dual-engine-bridge"
  | "radial-ecosystem"
  | "stepped-roadmap"
  | "evidence-dashboard"
  | "matrix-contrast"
  | "asymmetric-card-stack"
  | "quote-monument";

export interface DesignZone {
  id: string;
  role: "title" | "key-message" | "visual-anchor" | "content" | "connector" | "decoration";
  x: number;
  y: number;
  w: number;
  h: number;
  layer: number;
  instruction: string;
}

export interface DesignRecipe {
  id: DesignRecipeId;
  label: string;
  story: string;
  useWhen: string;
  layoutHints: string[];
  semanticTags: string[];
  minBlocks: number;
  maxBlocks: number;
  zones: DesignZone[];
  backgroundProgram: string[];
  titleProgram: string[];
  keyMessageProgram: string[];
  contentProgram: string[];
  connectorProgram: string[];
  signatureMotif: string;
  forbidden: string[];
  requiredGroupIds: string[];
  requiredPrimitives: Array<"path" | "polygon" | "circle" | "ellipse" | "line" | "polyline">;
}

export interface DesignRecipeSelection {
  recipe: DesignRecipe;
  reason: string;
  score: number;
  signals: string[];
}

export interface RecipeSelectionContext {
  slide: SlideDto;
  blockCount: number;
  text: string;
  layout: string;
  chartType: string;
}

