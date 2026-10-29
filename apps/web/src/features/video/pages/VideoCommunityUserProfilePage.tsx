import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { usePlatformAuth } from '@/shared/store/authStore';
import {
  fetchCommunityUserActivity,
  fetchCommunityUserPosts,
  fetchCommunityUserProfile,
} from '../lib/api';
import type {
  CommunityActivityResponse,
  CommunityPost,
  CommunityUserProfile,
} from '../lib/types';
import { ActivityHeatmap } from '../components/ActivityHeatmap';
import { VideoCoverThumb } from '../components/VideoCoverThumb';

export const VideoCommunityUserProfilePage: React.FC = () => {
  const { userId = '' } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const session = usePlatformAuth((state) => state.session);
  const openLogin = usePlatformAuth((state) => state.openLogin);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [profile, setProfile] = useState<CommunityUserProfile | null>(null);
  const [activity, setActivity] = useState<CommunityActivityResponse>({
    days: [],
    start_date: '',
    end_date: '',
    weeks: 52,
  });
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [postsTotal, setPostsTotal] = useState(0);

  const loadAll = async () => {
    if (!userId || !session) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMsg('');
    try {
      const [p, act, postList] = await Promise.all([
        fetchCommunityUserProfile(userId),
        fetchCommunityUserActivity(userId, 52),
        fetchCommunityUserPosts(userId, { page: 1, pageSize: 30 }),
      ]);
      setProfile(p);
      setActivity(
        act || { days: [], start_date: '', end_date: '', weeks: 52 },
      );
      setPosts(postList.items || []);
      setPostsTotal(postList.total || 0);
    } catch (e: any) {
      setErrorMsg(e?.message || '用户主页加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, session?.access_token]);

  if (!session) {
    return (
      <div className="panel-scroll mx-auto flex w-full max-w-[1300px] flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-3xl border border-slate-200/80 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#0071e3]/10 text-2xl">
            👤
          </div>
          <h2 className="mt-4 text-lg font-bold text-slate-900">登录以查看成员学习主页</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-500">
            请先登录平台账号以查看成员的学习贡献热力图与公开发布记录。
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
    <div className="panel-scroll mx-auto w-full min-w-0 max-w-[1300px] flex-1 px-4 py-6 lg:px-8">
      <div className="mb-4">
        <button
          type="button"
          onClick={() => navigate('/video/community')}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-[12px] font-medium text-slate-700 hover:border-[#0071e3]/40 hover:text-[#0071e3]"
        >
          ← 返回学习社区
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-[13px] text-slate-500">
          正在加载用户学习主页…
        </div>
      ) : errorMsg ? (
        <div className="py-16 text-center">
          <p className="text-base font-semibold text-slate-800">{errorMsg}</p>
        </div>
      ) : profile ? (
        <div className="space-y-6">
          {/* Header Card */}
          <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm sm:flex-row sm:items-center">
            <div className="flex items-center gap-4">
              <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-tr from-[#0071e3] to-indigo-500 text-xl font-bold text-white shadow-sm">
                {profile.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt={profile.label || '头像'}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span>{(profile.label || '?').slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-slate-900">
                    {profile.label}
                  </h1>
                  {profile.is_self && (
                    <span className="rounded-full bg-[#0071e3]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#0071e3]">
                      我自己
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[12.5px] text-slate-500">
                  {profile.email}
                </p>
                <p className="mt-1 text-[11.5px] text-slate-400">
                  加入时间：{String(profile.member_since || '').slice(0, 10)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-6 border-t border-slate-100 pt-3 sm:border-t-0 sm:pt-0">
              <div className="text-center">
                <div className="text-2xl font-bold text-[#0071e3]">
                  {profile.stats?.public_posts ?? 0}
                </div>
                <div className="text-[11.5px] text-slate-500">公开学习发布</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-emerald-600">
                  {profile.stats?.comments ?? 0}
                </div>
                <div className="text-[11.5px] text-slate-500">社区评论</div>
              </div>
            </div>
          </div>

          {/* 52-week Activity Heatmap */}
          <ActivityHeatmap
            days={activity.days}
            startDate={activity.start_date}
            endDate={activity.end_date}
          />

          {/* Public Posts List */}
          <div>
            <h2 className="text-base font-bold text-slate-900">
              公开发布的学习条目 ({postsTotal})
            </h2>

            {posts.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-slate-200/80 bg-white p-10 text-center text-[13px] text-slate-500">
                该用户暂未发布公开学习内容
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {posts.map((item) => (
                  <div
                    key={item.id}
                    onClick={() =>
                      navigate(`/video/community/${encodeURIComponent(item.id)}`)
                    }
                    className="group flex cursor-pointer flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#0071e3]/40 hover:shadow-md"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="rounded-md bg-blue-50 px-2 py-0.5 font-medium text-blue-700">
                          {item.source_type === 'upload'
                            ? '📁 上传归档'
                            : `🔗 ${item.platform || '在线视频'}`}
                        </span>
                        <span className="text-slate-400">
                          {String(item.published_at || item.created_at || '').slice(
                            0,
                            10,
                          )}
                        </span>
                      </div>
                      <div className="mt-2.5 flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="line-clamp-2 text-[14px] font-semibold leading-snug text-slate-900 group-hover:text-[#0071e3]">
                            {item.title}
                          </h3>
                          {item.tldr && (
                            <p className="mt-1.5 line-clamp-2 text-[12px] text-slate-500">
                              {item.tldr}
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
                    <div className="mt-3 flex items-center justify-end gap-3 border-t border-slate-100 pt-2.5 text-[11.5px] text-slate-500">
                      <span>❤️ {item.like_count || 0}</span>
                      <span>💬 {item.comment_count || 0}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};
