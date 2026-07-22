import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Plus } from "lucide-react";
import type { SlideDto } from "../shared";
import { StickyBoard } from "../components/structure/StickyBoard";
import { useWorkbenchStore, type StudioPhase } from "../store/workbenchStore";

function lastChapterTarget(slides: SlideDto[]): { afterSlideId: string; partTitle?: string } | null {
  if (slides.length === 0) return null;
  const last = slides[slides.length - 1];
  if (!last) return null;
  const partTitle = last.partTitle?.trim() || undefined;
  return { afterSlideId: last.id, partTitle };
}

export function StructureSpace() {
  const { projectId } = useParams();
  const navigate = useNavigate();  const slides = useWorkbenchStore((s) => s.slides);
  const project = useWorkbenchStore((s) => s.project);
  const busy = useWorkbenchStore((s) => s.busy);
  const generateOutline = useWorkbenchStore((s) => s.generateOutline);
  const createBlankSlide = useWorkbenchStore((s) => s.createBlankSlide);
  const deleteSlide = useWorkbenchStore((s) => s.deleteSlide);
  const reorderSlides = useWorkbenchStore((s) => s.reorderSlides);
  const selectSlide = useWorkbenchStore((s) => s.selectSlide);
  const updateSlide = useWorkbenchStore((s) => s.updateSlide);
  const [boardFocus, setBoardFocus] = useState<
    { kind: "slide" | "section"; partTitle?: string; afterSlideId: string } | null
  >(null);

  function openStudio(slideId: string, phase?: StudioPhase) {
    selectSlide(slideId);
    const phaseParam = phase ? `&phase=${phase}` : "";
    if (projectId) navigate(`../studio?slide=${encodeURIComponent(slideId)}${phaseParam}`);
  }

  async function addContentPage(afterSlideId?: string, partTitle?: string) {
    const target =
      afterSlideId != null
        ? { afterSlideId, partTitle }
        : boardFocus
          ? { afterSlideId: boardFocus.afterSlideId, partTitle: boardFocus.partTitle }
          : lastChapterTarget(slides);
    if (!target) {
      await createBlankSlide({ title: "新增空白页" });
      return;
    }
    await createBlankSlide({
      title: "新增空白页",
      partTitle: target.partTitle,
      afterSlideId: target.afterSlideId
    });
  }

  async function addSection() {
    const name = window.prompt("新章节名称", "新章节")?.trim();
    if (!name) return;
    await createBlankSlide({
      title: "新增空白页",
      partTitle: name
    });
  }

  return (
    <div className="structure-space space-y-6 flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div>
          <h2 className="text-2xl font-bold text-title">结构工作台</h2>
          <p className="text-sm text-muted">一行一章 · 横向排页 · 同行拖拽排序 · 点标题进工作室</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="secondary-button rounded-xl"
            disabled={Boolean(busy)}
            onClick={() => void generateOutline()}
          >
            重新架构大纲
          </button>
          <button
            type="button"
            className="secondary-button rounded-xl"
            disabled={Boolean(busy) || slides.length === 0}
            title={boardFocus ? `加到「${boardFocus.partTitle || "未分章"}」` : "加到最后一章末尾"}
            onClick={() => void addContentPage()}
          >
            <Plus className="h-4 w-4" />
            加一页
          </button>
          <button
            type="button"
            className="secondary-button rounded-xl"
            disabled={Boolean(busy)}
            onClick={() => void addSection()}
          >
            <Plus className="h-4 w-4" />
            加章节
          </button>
          {projectId && slides[0] ? (
            <Link
              to={`../studio?slide=${encodeURIComponent(boardFocus?.afterSlideId ?? slides[0].id)}`}
              className="primary-button rounded-xl"
              onClick={() => selectSlide(boardFocus?.afterSlideId ?? slides[0]!.id)}
            >
              进入工作室
            </Link>
          ) : null}
        </div>
      </div>

      {slides.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-white px-6 py-16 text-center shadow-soft">
          <p className="text-muted">还没有页面。请先完成需求或粘贴事实，再生成大纲。</p>
          <button
            type="button"
            className="primary-button mx-auto mt-4 rounded-xl"
            disabled={Boolean(busy)}
            onClick={() => void generateOutline()}
          >
            生成大纲
          </button>
          {project?.researchJson ? (
            <p className="mt-3 text-xs text-muted">已有调研摘要，可直接架构大纲</p>
          ) : null}
        </div>
      ) : (
        <StickyBoard
          slides={slides}
          busy={Boolean(busy)}
          onReorder={(ids) => void reorderSlides(ids)}
          onDelete={(id) => void deleteSlide(id)}
          onAddPage={(afterId, partTitle) => void addContentPage(afterId, partTitle)}
          onFocusChange={setBoardFocus}
          onOpenStudio={openStudio}
          onUpdateSlide={(slideId, input) => void updateSlide(slideId, input)}
        />
      )}
    </div>
  );
}
