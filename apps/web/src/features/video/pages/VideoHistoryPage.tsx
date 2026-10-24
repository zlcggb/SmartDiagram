import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { readAuthSession } from '@/shared/lib/config/auth';
import { deleteMyVideo, fetchMyVideos } from '../lib/api';
import { listGuestVideos, removeGuestVideo } from '../lib/guestHistory';

function formatDuration(seconds?: number): string {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const VideoHistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [videos, setVideos] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isGuest = !readAuthSession();

  const loadVideos = async (q = searchQuery) => {
    if (!readAuthSession()) {
      const localList = listGuestVideos(q).map((r) => ({
        id: r.id,
        title: r.title,
        source_type: r.source_type,
        platform: r.source_url ? '在线链接' : '本地上传',
        created_at: r.created_at,
        duration_sec: r.duration_seconds,
        tldr: r.summary_result?.tldr || '',
        latest_analysis_id: r.summary_task_id || r.id,
        quiz_count: r.quiz_count || (r.summary_result?.quiz ? 1 : 0),
        last_score:
          r.last_score ??
          r.summary_result?.quiz_state?.score_result?.score ??
          null,
        storage_status: 'guest_local',
      }));
      setVideos(localList);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await fetchMyVideos({ q, page: 1, pageSize: 30 });
      setVideos(data.items || []);
    } catch (err) {
      console.error('加载历史记录失败:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadVideos('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = async (item: any) => {
    if (!window.confirm(`确认删除「${item.title || '此视频'}」及所有分析研报吗？此操作无法恢复。`)) {
      return;
    }
    setDeletingId(item.id);
    if (isGuest) {
      removeGuestVideo(item.id);
      await loadVideos(searchQuery);
      setDeletingId(null);
      return;
    }
    try {
      await deleteMyVideo(item.id);
      await loadVideos(searchQuery);
    } catch (err: any) {
      window.alert(err?.message || '删除失败，请重试');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="panel-scroll mx-auto w-full min-w-0 max-w-[1400px] flex-1 px-4 py-6 lg:px-8">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200/80 pb-5 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">我的学习记录</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            保存您分析过的所有视频、AI 认知研报与测验，随时回顾复习。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative w-full sm:w-72">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              type="text"
              placeholder="搜索视频标题或链接…"
              className="w-full rounded-xl border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-900 outline-none focus:border-[#0071e3]"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void loadVideos(searchQuery);
              }}
            />
            <svg
              className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <button
            type="button"
            onClick={() => void loadVideos(searchQuery)}
            className="rounded-xl bg-[#0071e3] px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-[#0077ed]"
          >
            搜索
          </button>
        </div>
      </div>

      {isGuest && (
        <div className="mt-4 rounded-2xl border border-amber-200/70 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          游客模式：分析记录仅保存在当前浏览器，清除缓存后会丢失；在右上角登录平台账号后可云端同步并长期保存。
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 py-12 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-2xl bg-slate-200/60" />
          ))}
        </div>
      ) : videos.length === 0 ? (
        <div className="py-20 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#0071e3]/10 text-[#0071e3]">
            <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
              />
            </svg>
          </div>
          <h3 className="mt-4 text-base font-semibold text-slate-900">暂无学习记录</h3>
          <p className="mt-1 text-[13px] text-slate-500">
            {searchQuery
              ? '未找到符合条件的视频，请尝试其他关键词。'
              : '您尚未分析过任何视频，快去工作台上传或粘贴链接体验吧！'}
          </p>
          <button
            type="button"
            onClick={() => navigate('/video')}
            className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-[#0071e3] px-4 py-2 text-[13px] font-medium text-white shadow-sm hover:bg-[#0077ed]"
          >
            <span>立即去分析视频</span>
          </button>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((item) => (
            <div
              key={item.id}
              className="group flex min-w-0 flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[#0071e3]/40 hover:shadow-md"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                      item.source_type === 'upload'
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-blue-50 text-blue-700'
                    }`}
                  >
                    {item.source_type === 'upload' ? '📁 本地上传' : `🔗 ${item.platform || '在线链接'}`}
                  </span>

                  {item.storage_status === 'ready' ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      已归档视频
                    </span>
                  ) : item.storage_status === 'guest_local' ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                      本机缓存
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                      云端研报
                    </span>
                  )}
                </div>

                {item.quiz_count > 0 && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#0071e3]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#0071e3]">
                      🎯 {item.last_score !== null && item.last_score !== undefined ? `学习测验 · ${Math.round(Number(item.last_score))}分` : '已保存学习测验'}
                    </span>
                  </div>
                )}

                <h2
                  className="mt-3 line-clamp-2 text-[14.5px] font-semibold tracking-tight text-slate-900 group-hover:text-[#0071e3]"
                  title={item.title}
                >
                  {item.title || item.original_filename || '未命名视频'}
                </h2>

                {item.tldr ? (
                  <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-slate-500">{item.tldr}</p>
                ) : (
                  <p className="mt-2 text-[12px] italic text-slate-400">暂无研报摘要</p>
                )}
              </div>

              <div className="mt-4 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>{String(item.created_at || '').slice(0, 16).replace('T', ' ')}</span>
                  {item.duration_sec ? <span>{formatDuration(item.duration_sec)}</span> : null}
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const analysisId = item.latest_analysis_id || item.id;
                      navigate(`/video?analysis=${encodeURIComponent(analysisId)}`);
                    }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#0071e3]/10 py-1.5 text-[12px] font-semibold text-[#0071e3] transition hover:bg-[#0071e3] hover:text-white"
                  >
                    <span>查看研报与回放</span>
                  </button>

                  <button
                    type="button"
                    disabled={deletingId === item.id}
                    onClick={() => void handleDelete(item)}
                    className="grid h-8 w-8 place-items-center rounded-xl text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                    title="删除记录"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
