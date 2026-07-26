import type { SlideDesignVersionDto } from "@ppt-agent/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { activeDesignVersionIndex } from "../../lib/designVersionState";

interface DesignVersionNavigatorProps {
  versions: SlideDesignVersionDto[];
  activeVersionId: string | null;
  disabled: boolean;
  onActivate: (versionId: string) => void;
}

export function DesignVersionNavigator({
  versions,
  activeVersionId,
  disabled,
  onActivate
}: DesignVersionNavigatorProps) {
  if (versions.length === 0) return null;

  const matchedIndex = activeDesignVersionIndex(versions, activeVersionId);
  const activeIndex = matchedIndex >= 0 ? matchedIndex : versions.length - 1;
  const previous = versions[activeIndex - 1];
  const next = versions[activeIndex + 1];

  return (
    <div
      className="inline-flex min-h-9 items-center overflow-hidden rounded-[10px] border border-[rgba(0,0,0,0.13)] bg-white"
      aria-label="设计稿版本历史"
    >
      <button
        type="button"
        aria-label="上一个设计版本"
        title={previous ? "切换到较早版本" : "已经是最早版本"}
        className="inline-flex h-9 w-9 items-center justify-center text-[rgba(0,0,0,0.65)] transition hover:bg-[rgba(0,0,0,0.04)] disabled:cursor-not-allowed disabled:opacity-30"
        disabled={disabled || !previous}
        onClick={() => previous && onActivate(previous.id)}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className="min-w-[64px] border-x border-[rgba(0,0,0,0.09)] px-2.5 text-center">
        <div className="text-[11px] font-medium tabular-nums text-[rgba(0,0,0,0.82)]">
          {activeIndex + 1} / {versions.length}
        </div>
      </div>
      <button
        type="button"
        aria-label="下一个设计版本"
        title={next ? "切换到较新版本" : "已经是最新版本"}
        className="inline-flex h-9 w-9 items-center justify-center text-[rgba(0,0,0,0.65)] transition hover:bg-[rgba(0,0,0,0.04)] disabled:cursor-not-allowed disabled:opacity-30"
        disabled={disabled || !next}
        onClick={() => next && onActivate(next.id)}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
