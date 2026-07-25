import { softTrimCopy, copyBudgets } from "../copyBudgets.js";
import { pickDefaultVariant } from "../layoutVariants.js";
import type { ThemePackMeta } from "../themePacks.js";
import { getSkeletonFrame } from "./registry.js";
import type { LayoutSkeletonFrame, SkeletonElement, SkeletonElementType, SkeletonSlotValues } from "./types.js";

export interface SlideLikeForSkeleton {
  id?: string;
  title: string;
  slideGoal?: string;
  keyMessage?: string;
  contentPoints?: string[];
  recommendedLayout?: string | null;
  planJson?: {
    title?: string;
    layoutType?: string | null;
    pageGoal?: string;
    keyMessage?: string;
    contentBlocks?: Array<{ title?: string; items?: string[]; type?: string }>;
  } | null;
}

function asText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean).join("\n");
  return fallback;
}

function asItems(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function getByPath(slots: SkeletonSlotValues, path: string): unknown {
  if (Object.prototype.hasOwnProperty.call(slots, path)) return slots[path];
  const m = path.match(/^([a-zA-Z0-9_]+)\.(\d+)$/);
  if (!m) return undefined;
  const base = m[1]!;
  const index = Number(m[2]);
  const arr = slots[base];
  if (Array.isArray(arr) && typeof arr[0] !== "object") {
    return (arr as string[])[index];
  }
  return undefined;
}


/** 从大纲/策划页抽取槽位文案 */
export function slotsFromSlide(slide: SlideLikeForSkeleton): SkeletonSlotValues {
  const blocks = slide.planJson?.contentBlocks ?? [];
  const visibleBlocks = blocks.filter((block) => block.type !== "summary");
  const points = visibleBlocks.flatMap((b) => b.items ?? []).filter(Boolean);
  const contentPoints = (points.length > 0 ? points : slide.contentPoints ?? []).filter(Boolean);
  const claim = slide.planJson?.keyMessage || slide.keyMessage || "";
  const title = slide.planJson?.title || slide.title || "";
  const sectionLabel = visibleBlocks[0]?.title || "";

  const slots: SkeletonSlotValues = {
    pageTitle: title,
    title,
    kicker: sectionLabel || "要点",
    lead: claim,
    claim,
    quote: claim,
    judgment: claim,
    insight: claim,
    conclusion: claim,
    context: claim,
    focus: claim,
    goal: claim,
    chapter: title,
    teaser: claim || sectionLabel,
    partNo: "01",
    heroMetric: contentPoints[0] || claim.slice(0, 12) || "关键",
    heroValue: contentPoints[0] || "核心",
    heroLabel: "关键指标",
    summary: claim || sectionLabel,
    notes: contentPoints.slice(0, 3),
    bullets: contentPoints.slice(0, 5),
    supports: contentPoints.slice(0, 2),
    evidence: contentPoints.slice(0, 3),
    cards: contentPoints.slice(0, 4),
    chapters: contentPoints.slice(0, 6),
    steps: contentPoints.slice(0, 5),
    stages: contentPoints.slice(0, 5),
    nodes: contentPoints.slice(0, 5),
    actions: contentPoints.slice(0, 5),
    levels: contentPoints.slice(0, 4),
    shares: contentPoints.slice(0, 3),
    columns: contentPoints.slice(0, 3),
    progressCards: contentPoints.slice(0, 2),
    secondaryCards: contentPoints.slice(1, 3),
    primaryCard: contentPoints[0] || claim,
    leftItems: contentPoints.slice(0, Math.ceil(contentPoints.length / 2) || 1),
    rightItems: contentPoints.slice(Math.ceil(contentPoints.length / 2)),
    leftTitle: "对照 A",
    rightTitle: "对照 B",
    metrics: contentPoints.slice(0, 4),
    panels: contentPoints.slice(0, 2),
    metaCards: contentPoints.slice(0, 3),
    riskCards: contentPoints.slice(0, 3),
    recap: contentPoints.slice(0, 3),
    challenge: contentPoints[0] || claim,
    action: contentPoints[1] || sectionLabel,
    outcome: contentPoints[2] || claim,
    overview: contentPoints.slice(0, 4).join("；") || claim,
    matrixRows: [
      ["风险", "影响", "缓解"],
      ...(contentPoints.slice(0, 4).map((p) => [softTrimCopy(p, 16), "中", "跟进闭环"]))
    ],
    actionRows: [
      ["事项", "责任", "时间"],
      ...(contentPoints.slice(0, 4).map((p) => [softTrimCopy(p, 16), "待定", "本周"]))
    ],
    rationale: contentPoints.slice(0, 4).join("；") || claim,
    milestone: contentPoints[0] || "关键里程碑",
    implication: contentPoints.slice(0, 3).join("；") || claim || sectionLabel,
    tips: contentPoints.slice(0, 3),
    closeLoop: contentPoints[0] || "本周闭环确认",
    cta: claim || sectionLabel || "请确认下一步行动",
    note: contentPoints[0] || sectionLabel
  };

  // 展开索引槽，便于 metrics.0 等直接命中
  for (const key of Object.keys(slots)) {
    const value = slots[key];
    if (Array.isArray(value) && typeof value[0] === "string") {
      (value as string[]).forEach((item, index) => {
        slots[`${key}.${index}`] = item;
      });
    }
  }
  return slots;
}


export function formatSkeletonGeometryInstruction(frame: LayoutSkeletonFrame): string {
  const lines = frame.elements.map(
    (el) =>
      `- ${el.id} (${el.type}/${el.role}) slot=${el.slot} @ (${el.x},${el.y},${el.w},${el.h}) z=${el.z}`
  );
  return [
    `坐标骨架 variant=${frame.variantId}（lockGeometry=${frame.lockGeometry}）。`,
    "必须严格使用下列元素 id/type/坐标，只改 content 文案，禁止改 x/y/w/h/z/type：",
    ...lines
  ].join("\n");
}
