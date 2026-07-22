import { softTrimCopy, copyBudgets } from "../copyBudgets.js";
import { pickDefaultVariant } from "../layoutVariants.js";
import type { ThemePackMeta } from "../themePacks.js";
import { getSkeletonFrame } from "./registry.js";
import type { LayoutSkeletonFrame, SkeletonElement, SkeletonElementType, SkeletonSlotValues } from "./types.js";

/** 与 SlideIrDto 结构对齐，避免与 index 循环依赖 */
interface IrContent {
  title?: string;
  text?: string;
  body?: string;
  label?: string;
  value?: string;
  note?: string;
  items?: string[];
  rows?: string[][];
}

interface IrElement {
  id: string;
  type: SkeletonElementType;
  role: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  editable: boolean;
  content: IrContent;
  style: NonNullable<SkeletonElement["style"]>;
}

interface IrDoc {
  version: "1.0";
  canvas: { width: 1280; height: 720 };
  title: string;
  layout: string;
  elements: IrElement[];
}

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

function contentForElement(el: SkeletonElement, slots: SkeletonSlotValues): IrContent {
  const raw = getByPath(slots, el.slot);
  const text = asText(raw);
  const items = asItems(raw);

  switch (el.type) {
    case "metric": {
      const label = asText(getByPath(slots, el.slot.replace(/Value$/, "Label")) || getByPath(slots, `${el.slot}Label`));
      const note = asText(getByPath(slots, `${el.slot}Note`));
      if (items.length >= 2) {
        return {
          value: softTrimCopy(items[0]!, copyBudgets.metric.maxChars),
          label: softTrimCopy(items[1]!, copyBudgets.metricLabel.maxChars),
          note: items[2] ? softTrimCopy(items[2], copyBudgets.bullet.maxChars) : note
        };
      }
      return {
        value: softTrimCopy(text || "—", copyBudgets.metric.maxChars),
        label: softTrimCopy(label || el.role, copyBudgets.metricLabel.maxChars),
        note: softTrimCopy(note, copyBudgets.bullet.maxChars)
      };
    }
    case "table": {
      const rows = Array.isArray(raw) && Array.isArray((raw as unknown[])[0])
        ? (raw as string[][])
        : items.map((item) => item.split("|").map((c) => c.trim()));
      return {
        title: softTrimCopy(asText(getByPath(slots, `${el.slot}Title`) || el.role), copyBudgets.cardTitle.maxChars),
        rows: rows.slice(0, 6).map((row) => row.map((cell) => softTrimCopy(cell, 24)))
      };
    }
    case "timeline":
    case "process":
      return {
        title: softTrimCopy(asText(getByPath(slots, `${el.slot}Title`) || el.role), copyBudgets.cardTitle.maxChars),
        items: (items.length ? items : text ? text.split(/[；;\n]/).map((s) => s.trim()).filter(Boolean) : []).slice(
          0,
          copyBudgets.bulletCount.max
        )
      };
    case "text":
      return {
        text: softTrimCopy(
          text,
          el.role.includes("title") || el.slot === "title" || el.slot === "pageTitle" || el.slot === "chapter"
            ? copyBudgets.title.maxChars
            : copyBudgets.keyMessage.maxChars
        )
      };
    case "callout":
    case "card":
    default:
      return {
        title: softTrimCopy(
          asText(getByPath(slots, `${el.slot}Title`) || (el.role === "key-message" ? "核心结论" : el.role)),
          copyBudgets.cardTitle.maxChars
        ),
        body: softTrimCopy(text || items.join("；"), copyBudgets.keyMessage.maxChars),
        items: items.slice(0, copyBudgets.blockItemCount.max)
      };
  }
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

export function fillSkeletonFrame(frame: LayoutSkeletonFrame, slots: SkeletonSlotValues, title?: string): IrDoc {
  const elements: IrElement[] = frame.elements.map((el) => ({
    id: el.id,
    type: el.type,
    role: el.role,
    x: el.x,
    y: el.y,
    w: el.w,
    h: el.h,
    z: el.z,
    editable: el.editable !== false && el.type !== "decor",
    content: contentForElement(el, slots),
    style: el.style ?? {}
  }));

  return {
    version: "1.0",
    canvas: { width: 1280, height: 720 },
    title: title || asText(slots.pageTitle || slots.title, frame.variantId),
    layout: frame.recommendedLayout,
    elements
  };
}

export function buildIrFromSkeleton(
  slide: SlideLikeForSkeleton,
  options?: {
    variantId?: string | null;
    themeFamily?: ThemePackMeta["family"];
    usedVariantIds?: string[];
  }
): IrDoc | null {
  const family = options?.themeFamily ?? "light";
  const layout = slide.planJson?.layoutType || slide.recommendedLayout;
  const variant =
    options?.variantId && getSkeletonFrame(options.variantId)
      ? { id: options.variantId }
      : pickDefaultVariant(layout, family, options?.usedVariantIds ?? [], `${slide.id ?? slide.title}-${layout}`);
  const frame = getSkeletonFrame(variant.id);
  if (!frame) return null;
  return fillSkeletonFrame(frame, slotsFromSlide(slide), slide.planJson?.title || slide.title);
}

/** 将 LLM IR 几何吸附到骨架（保留其文案，锁坐标） */
export function snapIrToSkeleton(ir: IrDoc, frame: LayoutSkeletonFrame): IrDoc {
  if (!frame.lockGeometry) return ir;
  const byRole = new Map(ir.elements.map((el) => [el.role, el]));
  const byId = new Map(ir.elements.map((el) => [el.id, el]));
  const byOrder = [...ir.elements];

  const elements: IrElement[] = frame.elements.map((slotEl, index) => {
    const matched =
      byId.get(slotEl.id) ||
      byRole.get(slotEl.role) ||
      byOrder[index] ||
      null;
    const content = matched?.content ?? contentForElement(slotEl, {});
    return {
      id: slotEl.id,
      type: slotEl.type,
      role: slotEl.role,
      x: slotEl.x,
      y: slotEl.y,
      w: slotEl.w,
      h: slotEl.h,
      z: slotEl.z,
      editable: slotEl.editable !== false && slotEl.type !== "decor",
      content,
      style: { ...(slotEl.style ?? {}), ...(matched?.style ?? {}) }
    };
  });

  return {
    version: "1.0",
    canvas: { width: 1280, height: 720 },
    title: ir.title,
    layout: frame.recommendedLayout,
    elements
  };
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
