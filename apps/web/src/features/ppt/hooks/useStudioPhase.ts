import { useSearchParams } from "react-router-dom";
import type { StudioPhase } from '@/features/ppt/store/workbenchStore';

/**
 * 从 URL ?phase= 读取 Studio 当前阶段，默认 search。
 * 阶段切换不再由 store 持有，刷新/分享都不会丢失。
 */
export function useStudioPhase(): StudioPhase {
  const [searchParams] = useSearchParams();
  return (searchParams.get("phase") as StudioPhase) ?? "search";
}
