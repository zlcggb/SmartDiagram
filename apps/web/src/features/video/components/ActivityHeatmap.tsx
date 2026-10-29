import React, { useMemo } from 'react';
import type { CommunityActivityDay } from '../lib/types';

export interface ActivityHeatmapProps {
  days: CommunityActivityDay[];
  startDate?: string;
  endDate?: string;
}

function cellBg(level: number): string {
  switch (level) {
    case 1:
      return 'bg-emerald-200 border border-emerald-300/60';
    case 2:
      return 'bg-emerald-400 border border-emerald-500/50';
    case 3:
      return 'bg-emerald-500';
    case 4:
      return 'bg-emerald-700';
    default:
      return 'bg-slate-200/80';
  }
}

export const ActivityHeatmap: React.FC<ActivityHeatmapProps> = ({
  days,
  startDate = '',
  endDate = '',
}) => {
  const columns = useMemo(() => {
    const raw = Array.isArray(days) ? days : [];
    if (!raw.length) return [] as Array<Array<CommunityActivityDay & { pad?: boolean }>>;

    const first = new Date(`${raw[0].date}T00:00:00`);
    const padStart = first.getDay(); // 0=Sun..6=Sat
    const padded: Array<CommunityActivityDay & { pad?: boolean }> = [];
    for (let i = 0; i < padStart; i += 1) {
      padded.push({
        pad: true,
        date: `pad-${i}`,
        total: 0,
        analyses: 0,
        quizzes: 0,
        posts: 0,
        comments: 0,
        level: 0,
      });
    }
    for (const d of raw) {
      padded.push(d);
    }

    const out: Array<Array<CommunityActivityDay & { pad?: boolean }>> = [];
    for (let i = 0; i < padded.length; i += 7) {
      out.push(padded.slice(i, i + 7));
    }
    return out;
  }, [days]);

  const cellTitle = (cell: CommunityActivityDay & { pad?: boolean }) => {
    if (cell.pad) return '';
    return `${cell.date}：共 ${cell.total || 0} 次学习贡献（总结 ${cell.analyses || 0} · 测验 ${
      cell.quizzes || 0
    } · 发布 ${cell.posts || 0} · 评论 ${cell.comments || 0}）`;
  };

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[14px] font-semibold text-slate-900">学习贡献热力图</h3>
          <p className="mt-0.5 text-[11.5px] text-slate-500">
            完成总结、测验作答、社区发布与有效评论均计入每日贡献
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <span>少</span>
          <span className="h-2.5 w-2.5 rounded-[2px] bg-slate-200" />
          <span className="h-2.5 w-2.5 rounded-[2px] bg-emerald-200" />
          <span className="h-2.5 w-2.5 rounded-[2px] bg-emerald-400" />
          <span className="h-2.5 w-2.5 rounded-[2px] bg-emerald-500" />
          <span className="h-2.5 w-2.5 rounded-[2px] bg-emerald-700" />
          <span>多</span>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto pb-1">
        <div className="inline-flex gap-[3px]">
          {columns.map((col, ci) => (
            <div key={ci} className="flex flex-col gap-[3px]">
              {col.map((cell, ri) => (
                <div
                  key={`${ci}-${ri}-${cell.date}`}
                  className={`h-3 w-3 rounded-[2.5px] transition ${
                    cell.pad ? 'bg-transparent' : cellBg(cell.level)
                  }`}
                  title={cell.pad ? '' : cellTitle(cell)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {startDate && endDate && (
        <div className="mt-1 flex justify-between text-[10.5px] text-slate-400">
          <span>{startDate}</span>
          <span>{endDate}</span>
        </div>
      )}
    </div>
  );
};
