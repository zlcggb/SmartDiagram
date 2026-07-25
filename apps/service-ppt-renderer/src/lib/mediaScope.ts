export class MediaScopeError extends Error {
  readonly statusCode = 400;
}

type ScopedSlide = {
  id: string;
  svgPreview?: string | null;
};

export function selectScopedSlides<T extends ScopedSlide>(slides: T[], slideIds?: string[]): T[] {
  if (!slideIds) return slides;

  const requested = new Set(slideIds);
  const selected = slides.filter((slide) => requested.has(slide.id));
  if (selected.length !== requested.size) {
    const projectIds = new Set(slides.map((slide) => slide.id));
    const unknown = slideIds.filter((slideId) => !projectIds.has(slideId));
    throw new MediaScopeError(`页面 ${unknown.join("、")} 不属于当前项目`);
  }
  return selected;
}

export function assertDesignedSlides<T extends ScopedSlide>(projectSlides: T[], selectedSlides: T[] = projectSlides) {
  const pageById = new Map(projectSlides.map((slide, index) => [slide.id, index + 1]));
  const missingPages = selectedSlides
    .filter((slide) => !slide.svgPreview?.trim())
    .map((slide) => pageById.get(slide.id))
    .filter((page): page is number => page !== undefined);

  if (missingPages.length) {
    throw new MediaScopeError(`第 ${missingPages.join("、")} 页尚未生成设计稿，请调整范围或先生成设计稿`);
  }
}
