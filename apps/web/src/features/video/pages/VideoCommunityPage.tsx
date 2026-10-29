import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlatformAuth } from '@/shared/store/authStore';
import {
  fetchCommunityFavorites,
  fetchCommunityFeed,
  fetchCommunityMine,
  publishCommunityPost,
  withdrawCommunityPost,
} from '../lib/api';
import type { CommunityPost } from '../lib/types';
import { AuthorChip } from '../components/AuthorChip';
import { VideoCoverThumb } from '../components/VideoCoverThumb';
import { useVideoDialog } from '../components/VideoDialog';

export const VideoCommunityPage: React.FC = () => {
  const navigate = useNavigate();
  const session = usePlatformAuth((state) => state.session);
  const openLogin = usePlatformAuth((state) => state.openLogin);

  const [tab, setTab] = useState<'feed' | 'mine' | 'favorites'>('feed');
  const [sort, setSort] = useState<'new' | 'hot'>('new');
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CommunityPost[]>([]);
  const [actionPostId, setActionPostId] = useState<string | null>(null);
  const { confirm: confirmDialog, notify, dialogElement } = useVideoDialog();

  const loadData = async (currentTab = tab, currentSort = sort) => {
    if (!session) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      if (currentTab === 'feed') {
        const res = await fetchCommunityFeed({
          sort: currentSort,
          page: 1,
          pageSize: 30,
        });
        setItems(res.items || []);
      } else if (currentTab === 'mine') {
        const res = await fetchCommunityMine({ page: 1, pageSize: 30 });
        setItems(res.items || []);
      } else {
        const res = await fetchCommunityFavorites({ page: 1, pageSize: 30 });
        setItems(res.items || []);
      }
    } catch (e) {
      console.error('加载社区列表失败:', e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData(tab, sort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token, tab, sort]);

  const handleWithdraw = async (item: CommunityPost, e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirmDialog({
      title: '下架社区内容',
      message: `确认从学习社区下架「${item.title}」吗？下架后您仍可在「我的发布」或工作台重新一键发布。`,
      confirmText: '确认下架',
      danger: true,
    });
    if (!ok) return;
    setActionPostId(item.id);
    try {
      await withdrawCommunityPost(item.id);
      notify('已从学习社区下架', 'info');
      await loadData();
    } catch (err: any) {
      notify(err?.message || '下架失败', 'error');
    } finally {
      setActionPostId(null);
    }
  };

  const handleRepublish = async (item: CommunityPost, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.analysis_id) return;
    setActionPostId(item.id);
    try {
      await publishCommunityPost(item.analysis_id, true);
      notify('已重新发布到学习社区', 'success');
      await loadData();
    } catch (err: any) {
      notify(err?.message || '重新发布失败', 'error');
    } finally {
      setActionPostId(null);
    }
  };

  if (!session) {
    return (
      <div className="panel-scroll mx-auto flex w-full max-w-[1400px] flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-3xl border border-slate-200/80 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#0071e3]/10 text-2xl">
            🌐
          </div>
          <h2 className="mt-4 text-lg font-bold text-slate-900">登录以访问学习社区</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-500">
            学习社区面向平台登录用户开放。登录后可浏览共享视频研报、一键分享你的总结成果、参与讨论与做题自测。
          </p>
          <button
            type="button"
            onClick={() => openLogin()}
            className="mt-6 inline-flex items-center justify-center rounded-full bg-[#0071e3] px-6 py-2.5 text-[13.5px] font-semibold text-white shadow-sm transition hover:bg-[#0077ed]"
          >
            立即登录账号
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-scroll mx-auto w-full min-w-0 max-w-[1400px] flex-1 px-4 py-6 lg:px-8">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200/80 pb-5 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-[#0071e3]/10 px-2 py-0.5 text-[11px] font-bold text-[#0071e3]">
              COMMUNITY
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">学习社区</h1>
          </div>
          <p className="mt-1 text-[13px] text-slate-500">
            共享团队优质视频的 AI 深度研报、章节导览、思维导图与自测题库。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="学习社区视图切换"
            className="flex rounded-xl border border-slate-200 bg-slate-100/80 p-1 text-[12.5px]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'feed'}
              onClick={() => setTab('feed')}
              className={`rounded-lg px-3 py-1.5 font-medium transition ${
                tab === 'feed'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              发现
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'mine'}
              onClick={() => setTab('mine')}
              className={`rounded-lg px-3 py-1.5 font-medium transition ${
                tab === 'mine'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              我的发布
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'favorites'}
              onClick={() => setTab('favorites')}
              className={`rounded-lg px-3 py-1.5 font-medium transition ${
                tab === 'favorites'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              我的收藏
            </button>
          </div>

          {tab === 'feed' && (
            <div className="flex rounded-xl border border-slate-200 bg-white p-1 text-[12px]">
              <button
                type="button"
                onClick={() => setSort('new')}
                className={`rounded-lg px-2.5 py-1 font-medium transition ${
                  sort === 'new'
                    ? 'bg-[#0071e3]/10 text-[#0071e3]'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                最新
              </button>
              <button
                type="button"
                onClick={() => setSort('hot')}
                className={`rounded-lg px-2.5 py-1 font-medium transition ${
                  sort === 'hot'
                    ? 'bg-[#0071e3]/10 text-[#0071e3]'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                热门
              </button>
            </div>
          )}
        </div>
      </div>

      <div role="tabpanel" className="mt-6">
        {loading ? (
          <div className="grid grid-cols-1 gap-4 py-6 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-48 animate-pulse rounded-2xl bg-slate-200/60" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#0071e3]/10 text-2xl">
              🌐
            </div>
            <h3 className="mt-4 text-base font-semibold text-slate-900">
              {tab === 'feed'
                ? '社区还没有已发布的学习条目'
                : tab === 'mine'
                  ? '您还没有发布任何视频研报'
                  : '您还没有收藏任何社区内容'}
            </h3>
            <p className="mt-1 text-[13px] text-slate-500">
              在工作台或「学习记录」中点击「🚀 发布到社区」，即可一键将视频与 AI 研报分享给团队。
            </p>
            <div className="mt-5 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => navigate('/video')}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#0071e3] px-4 py-2 text-[13px] font-medium text-white shadow-sm hover:bg-[#0077ed]"
              >
                前往工作台分析视频
              </button>
              <button
                type="button"
                onClick={() => navigate('/video/history')}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-[13px] font-medium text-slate-700 shadow-2xs hover:border-[#0071e3]/40 hover:text-[#0071e3]"
              >
                从学习记录一键发布
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  if (item.status === 'published' || item.status === 'outdated') {
                    navigate(`/video/community/${encodeURIComponent(item.id)}`);
                  }
                }}
                className={`group flex min-w-0 flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[#0071e3]/40 hover:shadow-md ${
                  item.status === 'published' || item.status === 'outdated'
                    ? 'cursor-pointer'
                    : 'cursor-default opacity-80'
                }`}
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
                      {item.source_type === 'upload'
                        ? '📁 上传归档'
                        : `🔗 ${item.platform || '在线视频'}`}
                    </span>

                    {item.status === 'outdated' ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                        有新版可同步
                      </span>
                    ) : item.status === 'withdrawn' ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                        已下架
                      </span>
                    ) : item.status === 'invalid' ? (
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-600">
                        源视频已删除
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                        公开展示
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex items-start justify-between gap-3.5">
                    <div className="min-w-0 flex-1">
                      <h2 className="line-clamp-2 text-[14.5px] font-semibold leading-snug tracking-tight text-slate-900 group-hover:text-[#0071e3]">
                        {item.title}
                      </h2>

                      {item.tldr ? (
                        <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-slate-500">
                          {item.tldr}
                        </p>
                      ) : (
                        <p className="mt-1.5 text-[12px] italic text-slate-400">
                          点击查看完整 AI 研报、导图与测验
                        </p>
                      )}
                    </div>

                    <VideoCoverThumb
                      coverUrl={item.cover_url}
                      durationSec={item.duration_sec}
                      title={item.title}
                    />
                  </div>
                </div>

                <div className="mt-4 border-t border-slate-100 pt-3">
                  <div className="flex items-center justify-between gap-2 text-[11.5px] text-slate-500">
                    <AuthorChip
                      author={item.author}
                      userId={item.author_id}
                      label={item.author_display_name}
                      email={item.author_email}
                      avatarUrl={item.author_avatar_url}
                      size="sm"
                    />
                    <div className="flex shrink-0 items-center gap-3">
                      <span>❤️ {item.like_count || 0}</span>
                      <span>💬 {item.comment_count || 0}</span>
                    </div>
                  </div>

                  {tab === 'mine' && (
                    <div className="mt-2.5 flex items-center justify-end gap-2">
                      {(item.status === 'published' || item.status === 'outdated') && (
                        <button
                          type="button"
                          disabled={actionPostId === item.id}
                          onClick={(e) => void handleWithdraw(item, e)}
                          className="rounded-lg border border-rose-200 px-2.5 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                        >
                          下架
                        </button>
                      )}
                      {item.status === 'withdrawn' && item.analysis_id && (
                        <button
                          type="button"
                          disabled={actionPostId === item.id}
                          onClick={(e) => void handleRepublish(item, e)}
                          className="rounded-lg border border-[#0071e3]/30 bg-[#0071e3]/10 px-2.5 py-1 text-[11px] font-semibold text-[#0071e3] hover:bg-[#0071e3] hover:text-white disabled:opacity-50"
                        >
                          重新一键发布
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {dialogElement}
    </div>
  );
};
