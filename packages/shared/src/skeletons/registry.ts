/* AUTO: registry of skeleton JSON frames — do not hand-edit imports */
import type { LayoutSkeletonFrame } from "./types.js";
import f0 from "./frames/action-checklist.json" with { type: "json" };
import f1 from "./frames/action-matrix.json" with { type: "json" };
import f2 from "./frames/case-split.json" with { type: "json" };
import f3 from "./frames/case-story.json" with { type: "json" };
import f4 from "./frames/closing-cta.json" with { type: "json" };
import f5 from "./frames/closing-summary.json" with { type: "json" };
import f6 from "./frames/comparison-dual.json" with { type: "json" };
import f7 from "./frames/comparison-tri.json" with { type: "json" };
import f8 from "./frames/content-bento.json" with { type: "json" };
import f9 from "./frames/content-focus.json" with { type: "json" };
import f10 from "./frames/cover-center-statement.json" with { type: "json" };
import f11 from "./frames/cover-dark-dashboard.json" with { type: "json" };
import f12 from "./frames/cover-hero-left.json" with { type: "json" };
import f13 from "./frames/distribution-ladder.json" with { type: "json" };
import f14 from "./frames/distribution-stack.json" with { type: "json" };
import f15 from "./frames/metrics-hero.json" with { type: "json" };
import f16 from "./frames/metrics-row.json" with { type: "json" };
import f17 from "./frames/observation-insight.json" with { type: "json" };
import f18 from "./frames/observation-quote.json" with { type: "json" };
import f19 from "./frames/process-steps.json" with { type: "json" };
import f20 from "./frames/progress-mix.json" with { type: "json" };
import f21 from "./frames/risk-cards.json" with { type: "json" };
import f22 from "./frames/risk-matrix.json" with { type: "json" };
import f23 from "./frames/statement-callout.json" with { type: "json" };
import f24 from "./frames/statement-quote.json" with { type: "json" };
import f25 from "./frames/status-focus.json" with { type: "json" };
import f26 from "./frames/status-triptych.json" with { type: "json" };
import f27 from "./frames/timeline-classic.json" with { type: "json" };
import f28 from "./frames/toc-numbered-list.json" with { type: "json" };
import f29 from "./frames/toc-rail.json" with { type: "json" };
import f30 from "./frames/transition-chapter.json" with { type: "json" };
import f31 from "./frames/transition-number.json" with { type: "json" };
import f32 from "./frames/trend-rail.json" with { type: "json" };
import f33 from "./frames/trend-stages.json" with { type: "json" };

const frames: Record<string, LayoutSkeletonFrame> = {
  "action-checklist": f0 as LayoutSkeletonFrame,
  "action-matrix": f1 as LayoutSkeletonFrame,
  "case-split": f2 as LayoutSkeletonFrame,
  "case-story": f3 as LayoutSkeletonFrame,
  "closing-cta": f4 as LayoutSkeletonFrame,
  "closing-summary": f5 as LayoutSkeletonFrame,
  "comparison-dual": f6 as LayoutSkeletonFrame,
  "comparison-tri": f7 as LayoutSkeletonFrame,
  "content-bento": f8 as LayoutSkeletonFrame,
  "content-focus": f9 as LayoutSkeletonFrame,
  "cover-center-statement": f10 as LayoutSkeletonFrame,
  "cover-dark-dashboard": f11 as LayoutSkeletonFrame,
  "cover-hero-left": f12 as LayoutSkeletonFrame,
  "distribution-ladder": f13 as LayoutSkeletonFrame,
  "distribution-stack": f14 as LayoutSkeletonFrame,
  "metrics-hero": f15 as LayoutSkeletonFrame,
  "metrics-row": f16 as LayoutSkeletonFrame,
  "observation-insight": f17 as LayoutSkeletonFrame,
  "observation-quote": f18 as LayoutSkeletonFrame,
  "process-steps": f19 as LayoutSkeletonFrame,
  "progress-mix": f20 as LayoutSkeletonFrame,
  "risk-cards": f21 as LayoutSkeletonFrame,
  "risk-matrix": f22 as LayoutSkeletonFrame,
  "statement-callout": f23 as LayoutSkeletonFrame,
  "statement-quote": f24 as LayoutSkeletonFrame,
  "status-focus": f25 as LayoutSkeletonFrame,
  "status-triptych": f26 as LayoutSkeletonFrame,
  "timeline-classic": f27 as LayoutSkeletonFrame,
  "toc-numbered-list": f28 as LayoutSkeletonFrame,
  "toc-rail": f29 as LayoutSkeletonFrame,
  "transition-chapter": f30 as LayoutSkeletonFrame,
  "transition-number": f31 as LayoutSkeletonFrame,
  "trend-rail": f32 as LayoutSkeletonFrame,
  "trend-stages": f33 as LayoutSkeletonFrame
};

export const skeletonVariantIds = Object.keys(frames);

export function getSkeletonFrame(variantId?: string | null): LayoutSkeletonFrame | undefined {
  if (!variantId) return undefined;
  return frames[variantId];
}

export function listSkeletonFrames(): LayoutSkeletonFrame[] {
  return Object.values(frames);
}

export function hasSkeletonFrame(variantId?: string | null): boolean {
  return Boolean(variantId && frames[variantId]);
}
