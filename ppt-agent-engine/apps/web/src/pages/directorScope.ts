export type DirectorScopeMode = "designed" | "custom" | "all";

type DirectorScopeSlide = {
  id: string;
  svgPreview?: string | null;
};

type DirectorScopeInput = {
  mode: DirectorScopeMode;
  startPage: number;
  endPage: number;
};

function hasDesign(slide: DirectorScopeSlide) {
  return Boolean(slide.svgPreview?.trim());
}

function pageSummary(pages: number[]) {
  if (!pages.length) return "尚无已完成设计稿";
  const isContinuous = pages.every((page, index) => index === 0 || page === pages[index - 1]! + 1);
  const pageLabel = isContinuous && pages.length > 1
    ? `第 ${pages[0]}–${pages.at(-1)} 页`
    : `第 ${pages.join("、")} 页`;
  return `${pageLabel} · 共 ${pages.length} 页`;
}

export function resolveDirectorScope(slides: DirectorScopeSlide[], input: DirectorScopeInput) {
  const maxPage = slides.length;
  const startPage = Math.max(1, Math.min(input.startPage, maxPage || 1));
  const endPage = Math.max(startPage, Math.min(input.endPage, maxPage || startPage));
  const indexed = slides.map((slide, index) => ({ slide, page: index + 1 }));
  const selected = input.mode === "designed"
    ? indexed.filter(({ slide }) => hasDesign(slide))
    : input.mode === "custom"
      ? indexed.filter(({ page }) => page >= startPage && page <= endPage)
      : indexed;
  const pages = selected.map(({ page }) => page);
  const missingDesignPages = selected.filter(({ slide }) => !hasDesign(slide)).map(({ page }) => page);

  return {
    slideIds: selected.map(({ slide }) => slide.id),
    pages,
    missingDesignPages,
    summary: pageSummary(pages),
    exportReady: selected.length > 0 && missingDesignPages.length === 0,
    exportBlockedReason: missingDesignPages.length
      ? `第 ${missingDesignPages.join("、")} 页尚未生成设计稿`
      : selected.length === 0
        ? "当前范围没有可处理页面"
        : null
  };
}
