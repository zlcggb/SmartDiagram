import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  adminWithdrawCommunityPost,
  deleteAdminVideo,
  fetchAdminCommentReports,
  fetchAdminCommunityPosts,
  fetchAdminStats,
  fetchAdminUsers,
  fetchAdminVideos,
  resolveAdminCommentReport,
  updateAdminUser,
} from '../lib/api';
import type { CommunityCommentReport, CommunityPost } from '../lib/types';
import { useVideoDialog } from '../components/VideoDialog';

export const VideoAdminPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'videos' | 'community'>('overview');
  const [loading, setLoading] = useState(false);
  const { confirm: confirmDialog, notify, dialogElement } = useVideoDialog();

  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [userSearch, setUserSearch] = useState('');

  const [videos, setVideos] = useState<any[]>([]);
  const [videosTotal, setVideosTotal] = useState(0);
  const [videoSearch, setVideoSearch] = useState('');

  const [communityPosts, setCommunityPosts] = useState<CommunityPost[]>([]);
  const [communityPostsTotal, setCommunityPostsTotal] = useState(0);
  const [communityStatusFilter, setCommunityStatusFilter] = useState('');

  const [commentReports, setCommentReports] = useState<CommunityCommentReport[]>([]);
  const [commentReportsTotal, setCommentReportsTotal] = useState(0);
  const [reportStatusFilter, setReportStatusFilter] = useState('open');

  const loadStats = async () => {
    try {
      const data = await fetchAdminStats();
      setStats(data);
    } catch (err) {
      console.error('加载统计失败:', err);
    }
  };

  const loadUsers = async (q = userSearch) => {
    setLoading(true);
    try {
      const res = await fetchAdminUsers({ q, page: 1, pageSize: 30 });
      setUsers(res.items || []);
      setUsersTotal(res.total || 0);
    } catch (err) {
      console.error('加载用户列表失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadVideos = async (q = videoSearch) => {
    setLoading(true);
    try {
      const res = await fetchAdminVideos({ q, page: 1, pageSize: 30 });
      setVideos(res.items || []);
      setVideosTotal(res.total || 0);
    } catch (err) {
      console.error('加载视频审计失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadCommunityGovernance = async (
    postStatus = communityStatusFilter,
    repStatus = reportStatusFilter,
  ) => {
    setLoading(true);
    try {
      const [pRes, rRes] = await Promise.all([
        fetchAdminCommunityPosts({
          status: postStatus || undefined,
          page: 1,
          pageSize: 30,
        }),
        fetchAdminCommentReports({
          status: repStatus,
          page: 1,
          pageSize: 30,
        }),
      ]);
      setCommunityPosts(pRes.items || []);
      setCommunityPostsTotal(pRes.total || 0);
      setCommentReports(rRes.items || []);
      setCommentReportsTotal(rRes.total || 0);
    } catch (err) {
      console.error('加载社区治理数据失败:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStats();
    void loadUsers('');
    void loadVideos('');
    void loadCommunityGovernance('', 'open');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleUserRole = async (u: any) => {
    const targetRole = u.role === 'admin' ? 'user' : 'admin';
    const actionName = targetRole === 'admin' ? '提权为管理员' : '降为普通用户';
    const ok = await confirmDialog({
      title: '修改用户角色',
      message: `确认将用户 ${u.email} ${actionName}吗？`,
      confirmText: '确认修改',
      danger: false,
    });
    if (!ok) return;
    try {
      await updateAdminUser(u.id, { role: targetRole });
      notify(`已将 ${u.email} ${actionName}`, 'success');
      await loadUsers();
      await loadStats();
    } catch (err: any) {
      notify(err?.message || '操作失败', 'error');
    }
  };

  const toggleUserStatus = async (u: any) => {
    const targetStatus = u.status === 'active' ? 'disabled' : 'active';
    const actionName = targetStatus === 'disabled' ? '禁用' : '解封恢复';
    const ok = await confirmDialog({
      title: '修改账号状态',
      message: `确认${actionName}用户 ${u.email} 账号吗？`,
      confirmText: `确认${actionName}`,
      danger: targetStatus === 'disabled',
    });
    if (!ok) return;
    try {
      await updateAdminUser(u.id, { status: targetStatus });
      notify(`已${actionName} ${u.email}`, 'success');
      await loadUsers();
    } catch (err: any) {
      notify(err?.message || '操作失败', 'error');
    }
  };

  const handleDeleteVideo = async (v: any) => {
    const ok = await confirmDialog({
      title: '删除视频与研报记录',
      message: `确认删除该视频记录及所有分析研报吗？若有本地归档文件也将物理清理。\n\n视频标题: ${v.title || '未命名'}`,
      confirmText: '确认删除',
      danger: true,
    });
    if (!ok) {
      return;
    }
    try {
      await deleteAdminVideo(v.id);
      notify('已删除视频及研报记录', 'info');
      await loadVideos();
      await loadStats();
    } catch (err: any) {
      notify(err?.message || '删除失败', 'error');
    }
  };

  const handleWithdrawCommunityPost = async (p: CommunityPost) => {
    const ok = await confirmDialog({
      title: '强制下架社区条目',
      message: `确认强制下架社区条目「${p.title}」吗？`,
      confirmText: '强制下架',
      danger: true,
    });
    if (!ok) return;
    try {
      await adminWithdrawCommunityPost(p.id);
      notify('已强制下架该社区条目', 'info');
      await loadCommunityGovernance();
    } catch (err: any) {
      notify(err?.message || '下架失败', 'error');
    }
  };

  const handleResolveReport = async (
    rep: CommunityCommentReport,
    action: 'hide' | 'dismiss',
  ) => {
    const label = action === 'hide' ? '屏蔽该违规评论' : '驳回该举报';
    const ok = await confirmDialog({
      title: '处理评论举报',
      message: `确认${label}吗？`,
      confirmText: action === 'hide' ? '确认屏蔽' : '确认驳回',
      danger: action === 'hide',
    });
    if (!ok) return;
    try {
      await resolveAdminCommentReport(rep.id, { action });
      notify(action === 'hide' ? '已屏蔽违规评论' : '已驳回该举报', 'success');
      await loadCommunityGovernance();
    } catch (err: any) {
      notify(err?.message || '处理失败', 'error');
    }
  };

  return (
    <div className="panel-scroll mx-auto w-full min-w-0 max-w-[1440px] flex-1 px-4 py-6 lg:px-8">
      <div className="flex flex-col gap-4 border-b border-slate-200/80 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-indigo-500/10 px-2 py-0.5 text-[11px] font-bold text-indigo-600">
              VIDEO ADMIN
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">视频学习管理后台</h1>
          </div>
          <p className="mt-1 text-[13px] text-slate-500">
            视频学习模块运营概览、账号同步状态、视频分析审计与存储治理。
          </p>
        </div>

        <div className="flex rounded-xl border border-slate-200 bg-slate-100/80 p-1">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition ${
              activeTab === 'overview' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            全站概览
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('users');
              void loadUsers();
            }}
            className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition ${
              activeTab === 'users' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            用户列表 ({usersTotal})
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('videos');
              void loadVideos();
            }}
            className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition ${
              activeTab === 'videos' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            视频审计 ({videosTotal})
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('community');
              void loadCommunityGovernance();
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition ${
              activeTab === 'community' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            <span>社区治理</span>
            {commentReportsTotal > 0 && reportStatusFilter === 'open' && (
              <span className="rounded-full bg-rose-500 px-1.5 py-0.2 text-[10px] font-bold text-white">
                {commentReportsTotal}
              </span>
            )}
          </button>
        </div>
      </div>

      {activeTab === 'overview' && stats && (
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <span className="text-[12px] font-medium text-slate-500">已同步用户</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-slate-900">{stats.users?.total ?? 0}</span>
              <span className="text-[12px] text-slate-500">人</span>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] text-slate-500">
              <span>管理员: {stats.users?.admin ?? 0}</span>
              <span>成员: {stats.users?.regular ?? 0}</span>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <span className="text-[12px] font-medium text-slate-500">累计视频记录</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-[#0071e3]">{stats.videos?.total ?? 0}</span>
              <span className="text-[12px] text-slate-500">个</span>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] text-slate-500">
              <span>在线链接: {stats.videos?.url_count ?? 0}</span>
              <span>本地上传: {stats.videos?.upload_count ?? 0}</span>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <span className="text-[12px] font-medium text-slate-500">AI 认知研报</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-emerald-600">{stats.analyses?.completed ?? 0}</span>
              <span className="text-[12px] text-slate-500">篇已生成</span>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] text-slate-500">
              <span>
                成功率:{' '}
                {stats.analyses?.total
                  ? Math.round((stats.analyses.completed / stats.analyses.total) * 100)
                  : 100}
                %
              </span>
              <span>总任务: {stats.analyses?.total ?? 0}</span>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <span className="text-[12px] font-medium text-slate-500">Web 视频归档存储</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-indigo-600">{stats.storage?.used_gb ?? 0}</span>
              <span className="text-[12px] text-slate-500">/ {stats.storage?.max_gb ?? 50} GB</span>
            </div>
            <div className="mt-3">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${
                    (stats.storage?.percent ?? 0) > 80 ? 'bg-red-500' : 'bg-indigo-500'
                  }`}
                  style={{ width: `${Math.min(100, stats.storage?.percent ?? 0)}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                <span>已用 {stats.storage?.percent ?? 0}%</span>
                <span>自动归档池</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'users' && (
        <div className="mt-6">
          <div className="flex items-center justify-between gap-3">
            <input
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              type="text"
              placeholder="搜索邮箱或姓名…"
              className="w-full max-w-xs rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[13px] outline-none focus:border-[#0071e3]"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void loadUsers(userSearch);
              }}
            />
          </div>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <table className="w-full min-w-[760px] text-left text-[13px]">
              <thead className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                <tr>
                  <th className="px-5 py-3">账号信息</th>
                  <th className="px-4 py-3">角色权限</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">分析视频数</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/60">
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-slate-900">{u.email}</div>
                      <div className="text-[11px] text-slate-500">{u.display_name || '未设置昵称'}</div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                          u.role === 'admin' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {u.role === 'admin' ? '管理员' : '普通用户'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          u.status === 'active'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {u.status === 'active' ? '正常' : '已禁用'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-medium text-slate-900">{u.video_count ?? 0} 个</td>
                    <td className="space-x-3 px-4 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => void toggleUserRole(u)}
                        className="text-[12px] font-medium text-indigo-600 hover:underline"
                      >
                        {u.role === 'admin' ? '降为普通' : '设为管理'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleUserStatus(u)}
                        className={`text-[12px] font-medium hover:underline ${
                          u.status === 'active' ? 'text-amber-600' : 'text-emerald-600'
                        }`}
                      >
                        {u.status === 'active' ? '禁用' : '启用'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'videos' && (
        <div className="mt-6">
          <div className="flex items-center justify-between gap-3">
            <input
              value={videoSearch}
              onChange={(e) => setVideoSearch(e.target.value)}
              type="text"
              placeholder="搜索视频标题或用户邮箱…"
              className="w-full max-w-xs rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[13px] outline-none focus:border-[#0071e3]"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void loadVideos(videoSearch);
              }}
            />
          </div>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <table className="w-full min-w-[780px] text-left text-[13px]">
              <thead className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                <tr>
                  <th className="px-5 py-3">视频标题</th>
                  <th className="px-4 py-3">所属用户</th>
                  <th className="px-4 py-3">来源</th>
                  <th className="px-4 py-3">创建时间</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {videos.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50/60">
                    <td className="max-w-xs truncate px-5 py-3.5 font-medium text-slate-900">
                      {v.title || '未命名视频'}
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">{v.user_email || '访客'}</td>
                    <td className="px-4 py-3.5 text-slate-600">
                      {v.source_type === 'upload' ? '本地上传' : '在线链接'}
                    </td>
                    <td className="px-4 py-3.5 text-[12px] text-slate-500">
                      {String(v.created_at || '').slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void handleDeleteVideo(v)}
                        className="text-[12px] font-medium text-red-600 hover:underline"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'community' && (
        <div className="mt-6 space-y-8">
          {/* 1. 评论举报审核 */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  评论举报待办 ({commentReportsTotal})
                </h2>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  审核社区成员提交的不当评论举报，可一键屏蔽违规评论或驳回无依据举报
                </p>
              </div>
              <select
                value={reportStatusFilter}
                onChange={(e) => {
                  const v = e.target.value;
                  setReportStatusFilter(v);
                  void loadCommunityGovernance(communityStatusFilter, v);
                }}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] text-slate-700 outline-none focus:border-[#0071e3]"
              >
                <option value="open">待处理 (open)</option>
                <option value="reviewed">已屏蔽 (reviewed)</option>
                <option value="dismissed">已驳回 (dismissed)</option>
                <option value="all">全部状态</option>
              </select>
            </div>

            {commentReports.length === 0 ? (
              <div className="mt-4 rounded-xl bg-slate-50 py-8 text-center text-[12.5px] text-slate-500">
                当前筛选下暂无评论举报记录
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[780px] text-left text-[12.5px]">
                  <thead className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">被举报评论内容</th>
                      <th className="px-4 py-2.5">所属帖子</th>
                      <th className="px-4 py-2.5">举报原因 / 举报人</th>
                      <th className="px-4 py-2.5">状态</th>
                      <th className="px-4 py-2.5 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {commentReports.map((rep) => (
                      <tr key={rep.id} className="hover:bg-slate-50/60">
                        <td className="max-w-xs px-4 py-3">
                          <div className="line-clamp-2 font-medium text-slate-900">
                            {rep.comment_body}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-400">
                            作者: {rep.comment_author_email || rep.comment_author_id}
                          </div>
                        </td>
                        <td className="max-w-[200px] truncate px-4 py-3 text-slate-600">
                          {rep.post_title || rep.post_id}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-slate-700">{rep.reason || '未填写原因'}</div>
                          <div className="text-[11px] text-slate-400">
                            举报人: {rep.reporter_email || rep.reporter_id}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              rep.status === 'open'
                                ? 'bg-amber-50 text-amber-700'
                                : rep.status === 'reviewed' || rep.status === 'resolved_hidden'
                                  ? 'bg-rose-50 text-rose-700'
                                  : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {rep.status}
                          </span>
                        </td>
                        <td className="space-x-2 px-4 py-3 text-right">
                          {rep.status === 'open' && (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleResolveReport(rep, 'hide')}
                                className="rounded-lg bg-rose-600 px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-rose-700"
                              >
                                屏蔽评论
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleResolveReport(rep, 'dismiss')}
                                className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11.5px] font-medium text-slate-600 hover:bg-slate-100"
                              >
                                驳回
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 2. 社区发布条目治理 */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  社区发布条目 ({communityPostsTotal})
                </h2>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  管理全站成员发布的视频研报条目，支持按状态筛选与强制下架
                </p>
              </div>
              <select
                value={communityStatusFilter}
                onChange={(e) => {
                  const v = e.target.value;
                  setCommunityStatusFilter(v);
                  void loadCommunityGovernance(v, reportStatusFilter);
                }}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] text-slate-700 outline-none focus:border-[#0071e3]"
              >
                <option value="">全部状态</option>
                <option value="published">公开展示 (published)</option>
                <option value="outdated">有新版待同步 (outdated)</option>
                <option value="withdrawn">已下架 (withdrawn)</option>
                <option value="invalid">已失效 (invalid)</option>
              </select>
            </div>

            {communityPosts.length === 0 ? (
              <div className="mt-4 rounded-xl bg-slate-50 py-8 text-center text-[12.5px] text-slate-500">
                暂无社区发布条目
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[780px] text-left text-[12.5px]">
                  <thead className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">标题</th>
                      <th className="px-4 py-2.5">发布者</th>
                      <th className="px-4 py-2.5">状态</th>
                      <th className="px-4 py-2.5">互动数据</th>
                      <th className="px-4 py-2.5">发布时间</th>
                      <th className="px-4 py-2.5 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {communityPosts.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50/60">
                        <td className="max-w-xs truncate px-4 py-3 font-medium text-slate-900">
                          {p.title}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {p.author_display_name || p.author_email || p.author_id}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              p.status === 'published'
                                ? 'bg-emerald-50 text-emerald-700'
                                : p.status === 'outdated'
                                  ? 'bg-amber-50 text-amber-700'
                                  : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {p.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          ❤️ {p.like_count || 0} · ⭐ {p.favorite_count || 0} · 💬{' '}
                          {p.comment_count || 0}
                        </td>
                        <td className="px-4 py-3 text-[11.5px] text-slate-400">
                          {String(p.published_at || p.created_at || '')
                            .slice(0, 16)
                            .replace('T', ' ')}
                        </td>
                        <td className="space-x-3 px-4 py-3 text-right">
                          {(p.status === 'published' || p.status === 'outdated') && (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  navigate(`/video/community/${encodeURIComponent(p.id)}`)
                                }
                                className="text-[12px] font-medium text-[#0071e3] hover:underline"
                              >
                                查看
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleWithdrawCommunityPost(p)}
                                className="text-[12px] font-medium text-rose-600 hover:underline"
                              >
                                强制下架
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      {dialogElement}
    </div>
  );
};
