import React, { useState } from 'react';

export function formatVideoDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return '';
  const total = Math.floor(Number(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  }
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

interface VideoCoverThumbProps {
  coverUrl?: string | null;
  durationSec?: number | null;
  title?: string;
}

export const VideoCoverThumb: React.FC<VideoCoverThumbProps> = ({
  coverUrl,
  durationSec,
  title,
}) => {
  const [imgError, setImgError] = useState(false);

  if (!coverUrl || imgError) {
    return null;
  }

  const durationLabel = formatVideoDuration(durationSec);

  return (
    <div className="relative h-[96px] w-[76px] shrink-0 overflow-hidden rounded-xl border border-slate-200/80 bg-slate-900 shadow-2xs sm:h-[106px] sm:w-[84px]">
      {/* Blurred ambient backdrop so both 9:16 portrait and 16:9 landscape covers look full */}
      <img
        src={coverUrl}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-55 blur-md"
      />
      {/* Crisp foreground cover */}
      <img
        src={coverUrl}
        alt={title || '视频封面'}
        loading="lazy"
        onError={() => setImgError(true)}
        className="relative z-10 h-full w-full object-contain transition-transform duration-300 group-hover:scale-105"
      />
      {/* Subtle play indicator on card hover */}
      <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/0 transition-colors duration-200 group-hover:bg-black/20">
        <span className="grid h-6 w-6 scale-90 place-items-center rounded-full bg-white/85 text-[#0071e3] opacity-0 shadow-xs backdrop-blur-xs transition-all duration-200 group-hover:scale-100 group-hover:opacity-100">
          <svg className="ml-0.5 h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
          </svg>
        </span>
      </div>
      {/* Duration badge */}
      {durationLabel && (
        <span className="pointer-events-none absolute right-1 bottom-1 z-20 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white backdrop-blur-xs">
          {durationLabel}
        </span>
      )}
    </div>
  );
};
