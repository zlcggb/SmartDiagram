import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { ChevronDown, ChevronUp, FileText, Palette, Plus, Search, Trash2 } from "lucide-react";
import type { SlideDto } from "@ppt-agent/shared";
import type { StudioPhase } from "../../store/workbenchStore";
import { resolveHorizontalDropHint } from "./stickyBoardDrag";

type BoardRow = {
  id: string;
  partTitle: string;
  sectionIndex: number;
  pageNum: number;
  anchorSlideId: string;
  slides: SlideDto[];
};

/** 顶栏「加一页」用的当前章/页上下文 */
export type BoardFocus = {
  kind: "slide" | "section";
  partTitle?: string;
  afterSlideId: string;
};

function rowPartTitleForApi(row: BoardRow): string | undefined {
  return row.slides[0]?.partTitle?.trim() || undefined;
}

type PhaseKey = StudioPhase;

type DropHint = {
  targetId: string;
  place: "before" | "after";
};

function phaseState(slide: SlideDto) {
  return {
    search: Boolean(slide.searchJson) || slide.generationStatus === "search-ready",
    draft:
      Boolean(slide.planJson) ||
      slide.generationStatus === "draft-ready" ||
      slide.generationStatus === "planned",
    design: Boolean(slide.svgPreview) || slide.generationStatus === "svg-ready"
  } as const;
}

function partKey(slide: SlideDto) {
  return slide.partTitle?.trim() || "未分章";
}

/** 按 partTitle 连续分组：一行 = 一章，行内 = 该章页面 */
function buildBoardRows(slides: SlideDto[]): BoardRow[] {
  const rows: BoardRow[] = [];
  let current: BoardRow | null = null;

  for (const slide of slides) {
    const part = partKey(slide);
    if (!current || current.partTitle !== part) {
      current = {
        id: `section:${part}:${rows.length + 1}`,
        partTitle: part,
        sectionIndex: rows.length + 1,
        pageNum: slide.sortOrder,
        anchorSlideId: slide.id,
        slides: [slide]
      };
      rows.push(current);
    } else {
      current.slides.push(slide);
    }
  }

  return rows;
}

function padNum(n: number) {
  return String(n).padStart(2, "0");
}

/** 同行内重排后拼接全局 slideIds */
function reorderWithinRow(
  slides: SlideDto[],
  dragId: string,
  targetId: string,
  place: "before" | "after"
): string[] | null {
  if (dragId === targetId) return null;

  const dragSlide = slides.find((s) => s.id === dragId);
  const targetSlide = slides.find((s) => s.id === targetId);
  if (!dragSlide || !targetSlide) return null;
  if (partKey(dragSlide) !== partKey(targetSlide)) return null;

  const rows = buildBoardRows(slides);
  const nextIds: string[] = [];

  for (const row of rows) {
    const ids = row.slides.map((s) => s.id);
    if (!ids.includes(dragId)) {
      nextIds.push(...ids);
      continue;
    }

    const from = ids.indexOf(dragId);
    ids.splice(from, 1);
    let to = ids.indexOf(targetId);
    if (to < 0) {
      nextIds.push(...ids, dragId);
      continue;
    }
    if (place === "after") to += 1;
    ids.splice(to, 0, dragId);
    nextIds.push(...ids);
  }

  return nextIds;
}

function captureFlipRects(root: HTMLElement | null) {
  const map = new Map<string, DOMRect>();
  if (!root) return map;
  root.querySelectorAll<HTMLElement>("[data-flip-id]").forEach((el) => {
    const id = el.dataset.flipId;
    if (id) map.set(id, el.getBoundingClientRect());
  });
  return map;
}

function playFlip(root: HTMLElement | null, prev: Map<string, DOMRect>) {
  if (!root || prev.size === 0) return;
  root.querySelectorAll<HTMLElement>("[data-flip-id]").forEach((el) => {
    const id = el.dataset.flipId;
    if (!id) return;
    const first = prev.get(id);
    if (!first) return;
    const last = el.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
      { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
    );
  });
}

export function StickyBoard({
  slides,
  busy,
  onReorder,
  onDelete,
  onAddPage,
  onFocusChange,
  onOpenStudio,
  onUpdateSlide
}: {
  slides: SlideDto[];
  busy: boolean;
  onReorder: (orderedIds: string[]) => void;
  onDelete: (slideId: string) => void;
  /** 同章加页：afterSlideId + 该章真实 partTitle（可空，由 API 继承锚点） */
  onAddPage: (afterSlideId: string, partTitle?: string) => void;
  onFocusChange?: (focus: BoardFocus | null) => void;
  onOpenStudio: (slideId: string, phase?: PhaseKey) => void;
  onUpdateSlide: (slideId: string, input: { title?: string; keyMessage?: string; slideGoal?: string }) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<DropHint | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [contentsOpen, setContentsOpen] = useState(true);
  const [editingSlide, setEditingSlide] = useState<SlideDto | null>(null);
  const [editDraft, setEditDraft] = useState({ title: "", keyMessage: "", slideGoal: "" });
  const canvasRef = useRef<HTMLDivElement>(null);
  const flipPrevRef = useRef<Map<string, DOMRect>>(new Map());
  const slideOrderKey = slides.map((s) => s.id).join("|");

  const rows = useMemo(() => buildBoardRows(slides), [slides]);

  useLayoutEffect(() => {
    playFlip(canvasRef.current, flipPrevRef.current);
    flipPrevRef.current = new Map();
  }, [slideOrderKey]);

  function beginFlipCapture() {
    flipPrevRef.current = captureFlipRects(canvasRef.current);
  }

  function onDragStart(e: DragEvent, id: string) {
    setDragId(id);
    setDropHint(null);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    const card = e.currentTarget as HTMLElement;
    card.classList.add("is-drag-source");
  }

  function onDragEnd(e: DragEvent) {
    (e.currentTarget as HTMLElement).classList.remove("is-drag-source");
    setDragId(null);
    setDropHint(null);
  }

  function onCardDragOver(e: DragEvent, targetId: string) {
    if (!dragId) return;
    e.stopPropagation();
    if (dragId === targetId) {
      e.preventDefault();
      setDropHint(null);
      return;
    }
    const dragSlide = slides.find((s) => s.id === dragId);
    const targetSlide = slides.find((s) => s.id === targetId);
    if (!dragSlide || !targetSlide || partKey(dragSlide) !== partKey(targetSlide)) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const place: "before" | "after" = e.clientX < rect.left + rect.width / 2 ? "before" : "after";
    setDropHint((prev) =>
      prev?.targetId === targetId && prev.place === place ? prev : { targetId, place }
    );
  }

  function resolveTrackDropHint(track: HTMLElement, clientX: number): DropHint | null {
    if (!dragId) return null;
    const targets = Array.from(track.querySelectorAll<HTMLElement>("[data-drop-slide-id]")).map(
      (element) => {
        const rect = element.getBoundingClientRect();
        return {
          id: element.dataset.dropSlideId ?? "",
          left: rect.left,
          right: rect.right
        };
      }
    );
    return resolveHorizontalDropHint(clientX, targets, dragId);
  }

  function commitCardDrop(targetId: string, place: "before" | "after") {
    if (!dragId) return;
    const next = reorderWithinRow(slides, dragId, targetId, place);
    setDragId(null);
    setDropHint(null);
    if (!next) return;
    const same = next.length === slides.length && next.every((id, i) => id === slides[i]?.id);
    if (same) return;
    beginFlipCapture();
    onReorder(next);
  }

  function onCardDrop(e: DragEvent, targetId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!dragId) return;
    const place =
      dropHint?.targetId === targetId
        ? dropHint.place
        : (() => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            return e.clientX < rect.left + rect.width / 2 ? "before" : "after";
          })();

    commitCardDrop(targetId, place);
  }

  function focusSection(row: BoardRow) {
    const afterSlideId = resolveAddAfter(row);
    setSelectedId(row.id);
    setActiveSectionId(row.id);
    onFocusChange?.({
      kind: "section",
      partTitle: rowPartTitleForApi(row),
      afterSlideId
    });
  }

  function focusSlide(row: BoardRow, slide: SlideDto) {
    setSelectedId(slide.id);
    setActiveSectionId(row.id);
    onFocusChange?.({
      kind: "slide",
      partTitle: slide.partTitle?.trim() || rowPartTitleForApi(row),
      afterSlideId: slide.id
    });
  }

  function scrollToSection(row: BoardRow) {
    const el = document.getElementById(row.id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      focusSection(row);
    }
  }

  function resolveAddAfter(row: BoardRow): string {
    return row.slides[row.slides.length - 1]?.id ?? row.anchorSlideId;
  }

  function openEditModal(slide: SlideDto) {
    setEditingSlide(slide);
    setEditDraft({
      title: slide.title || "",
      keyMessage: slide.keyMessage || "",
      slideGoal: slide.slideGoal || ""
    });
  }

  function closeEditModal() {
    setEditingSlide(null);
    setEditDraft({ title: "", keyMessage: "", slideGoal: "" });
  }

  function saveEdit() {
    if (!editingSlide) return;
    const patch: { title?: string; keyMessage?: string; slideGoal?: string } = {};
    if (editDraft.title.trim() !== (editingSlide.title || "")) patch.title = editDraft.title.trim();
    if (editDraft.keyMessage.trim() !== (editingSlide.keyMessage || "")) {
      patch.keyMessage = editDraft.keyMessage.trim();
    }
    if (editDraft.slideGoal.trim() !== (editingSlide.slideGoal || "")) {
      patch.slideGoal = editDraft.slideGoal.trim();
    }
    if (Object.keys(patch).length > 0) {
      onUpdateSlide(editingSlide.id, patch);
    }
    closeEditModal();
  }

  return (
    <div className="sticky-board-layout">
      {rows.length > 0 ? (
        <aside className={`sticky-board-contents ${contentsOpen ? "is-open" : ""}`}>
          <button
            type="button"
            className="sticky-board-contents-toggle"
            onClick={() => setContentsOpen((v) => !v)}
            aria-expanded={contentsOpen}
          >
            <span>Contents</span>
            {contentsOpen ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
          {contentsOpen ? (
            <nav className="sticky-board-contents-list" aria-label="章节目录">
              {rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`sticky-board-contents-item ${activeSectionId === row.id ? "is-active" : ""}`}
                  onClick={() => scrollToSection(row)}
                >
                  {row.partTitle}
                </button>
              ))}
            </nav>
          ) : null}
        </aside>
      ) : null}

      <div className="sticky-board-canvas" ref={canvasRef}>
        <div className="sticky-board-rows">
          {rows.map((row) => {
            const sectionSelected = selectedId === row.id;
            return (
              <section
                key={row.id}
                id={row.id}
                className={`sticky-board-row ${activeSectionId === row.id ? "is-active-row" : ""}`}
                data-part={row.partTitle}
              >
                <article
                  data-flip-id={row.id}
                  className={`sticky-board-card sticky-section-card animate-rise ${
                    sectionSelected ? "is-selected" : ""
                  }`}
                  onClick={() => focusSection(row)}
                >
                  <div className="sticky-section-card-top">
                    <span>章节</span>
                    <span className="sticky-section-num">{padNum(row.pageNum)}</span>
                  </div>
                  <h3 className="sticky-section-title">{row.partTitle}</h3>
                  <div className="sticky-section-footer">
                    <span>SECTION</span>
                    <span className="sticky-section-status">
                      <span className="sticky-section-dot" />
                      Draft
                    </span>
                  </div>
                  {sectionSelected ? (
                    <div className="sticky-card-toolbar" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onAddPage(resolveAddAfter(row), rowPartTitleForApi(row))}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        新建页面
                      </button>
                    </div>
                  ) : null}
                </article>

                <div
                  className={`sticky-board-row-track ${dragId ? "is-dragging" : ""}`}
                  onDragOver={(e) => {
                    if (!dragId) return;
                    const dragSlide = slides.find((s) => s.id === dragId);
                    if (!dragSlide || partKey(dragSlide) !== row.partTitle) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    const hint = resolveTrackDropHint(e.currentTarget, e.clientX);
                    if (hint) {
                      setDropHint((prev) =>
                        prev?.targetId === hint.targetId && prev.place === hint.place ? prev : hint
                      );
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const hint = resolveTrackDropHint(e.currentTarget, e.clientX);
                    if (hint) commitCardDrop(hint.targetId, hint.place);
                  }}
                >
                  {row.slides.map((slide) => {
                    const selected = selectedId === slide.id;
                    const phases = phaseState(slide);
                    const insertPartTitle = slide.partTitle?.trim() || rowPartTitleForApi(row);
                    return (
                      <div
                        key={`slot:${slide.id}`}
                        className={`sticky-board-slot ${
                          dragId && dragId !== slide.id ? "is-dragging-peer" : ""
                        } ${
                          dropHint?.targetId === slide.id ? `is-drop-${dropHint.place}` : ""
                        }`}
                      >
                        <article
                          key={slide.id}
                          data-flip-id={slide.id}
                          data-drop-slide-id={slide.id}
                          draggable
                          className={`sticky-board-card sticky-slide-card ${
                            selected ? "is-selected" : ""
                          } ${dropHint?.targetId === slide.id ? `drop-hint-${dropHint.place}` : ""}`}
                          onDragStart={(e) => onDragStart(e, slide.id)}
                          onDragEnd={onDragEnd}
                          onDragOver={(e) => onCardDragOver(e, slide.id)}
                          onDrop={(e) => onCardDrop(e, slide.id)}
                          onClick={() => focusSlide(row, slide)}
                          onDoubleClick={() => openEditModal(slide)}
                        >
                          <div className="sticky-slide-card-top">
                            <span className="sticky-slide-num">{padNum(slide.sortOrder)}</span>
                            <span className="sticky-slide-status">
                              {phases.design ? "Designed" : phases.draft ? "Draft" : "Idea"}
                            </span>
                          </div>
                          <h4 className="sticky-slide-title">{slide.title}</h4>
                          <p className="sticky-slide-key">{slide.keyMessage}</p>

                          <div className="sticky-card-toolbar" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => onOpenStudio(slide.id, "search")}
                              title="检索素材"
                            >
                              <Search className="h-3.5 w-3.5" />
                              检索
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => onOpenStudio(slide.id, "draft")}
                              title="生成初稿"
                            >
                              <FileText className="h-3.5 w-3.5" />
                              初稿
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => onOpenStudio(slide.id, "design")}
                              title="设计出图"
                            >
                              <Palette className="h-3.5 w-3.5" />
                              设计
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => onDelete(slide.id)}
                              title="删除该页"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </article>

                        <button
                          type="button"
                          className="sticky-insert-slot"
                          disabled={busy}
                          onClick={() => onAddPage(slide.id, insertPartTitle)}
                          title="在该页后新增一页"
                          aria-label="在该页后新增一页"
                        >
                          <span className="sticky-insert-slot-frame">
                            <Plus className="sticky-insert-slot-icon" />
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {editingSlide ? (
        <div
          className="sticky-edit-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeEditModal();
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="sticky-edit-title"
        >
          <div className="sticky-edit-modal">
            <div className="sticky-edit-modal-head">
              <h3 id="sticky-edit-title">编辑页面</h3>
              <button
                type="button"
                className="sticky-edit-modal-close"
                onClick={closeEditModal}
                aria-label="取消"
              >
                ×
              </button>
            </div>
            <div className="sticky-edit-modal-body">
              <label className="sticky-edit-field">
                <span>页面标题</span>
                <input
                  type="text"
                  value={editDraft.title}
                  onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      saveEdit();
                    }
                    if (e.key === "Escape") closeEditModal();
                  }}
                  placeholder="输入页面标题"
                  autoFocus
                />
              </label>
              <label className="sticky-edit-field">
                <span>核心结论</span>
                <textarea
                  value={editDraft.keyMessage}
                  onChange={(e) => setEditDraft((d) => ({ ...d, keyMessage: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") closeEditModal();
                  }}
                  placeholder="输入本页核心结论"
                  rows={3}
                />
              </label>
              <label className="sticky-edit-field">
                <span>页面目标（可选）</span>
                <input
                  type="text"
                  value={editDraft.slideGoal}
                  onChange={(e) => setEditDraft((d) => ({ ...d, slideGoal: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      saveEdit();
                    }
                    if (e.key === "Escape") closeEditModal();
                  }}
                  placeholder="输入本页目标"
                />
              </label>
            </div>
            <div className="sticky-edit-modal-foot">
              <button
                type="button"
                className="secondary-button"
                onClick={closeEditModal}
                disabled={busy}
              >
                取消
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={saveEdit}
                disabled={busy || !editDraft.title.trim()}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
