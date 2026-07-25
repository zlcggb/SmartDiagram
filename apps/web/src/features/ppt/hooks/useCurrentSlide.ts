import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useWorkbenchStore } from '@/features/ppt/store/workbenchStore';

/**
 * 从 URL ?slide= 读取当前页，并在缺失时回落到 slides[0]。
 * 这样当前选择既是 URL 真相源，又支持分享/刷新。
 */
export function useCurrentSlide() {
  const [searchParams] = useSearchParams();
  const slides = useWorkbenchStore((s) => s.slides);

  const currentSlideId = searchParams.get("slide") ?? slides[0]?.id ?? null;
  const currentSlide = useMemo(() => {
    return slides.find((s) => s.id === currentSlideId) ?? slides[0] ?? null;
  }, [slides, currentSlideId]);

  return { currentSlideId, currentSlide };
}
