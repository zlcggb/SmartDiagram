import React, { useEffect, useState } from 'react';
import {
  deleteAdminVideo,
  fetchAdminStats,
  fetchAdminUsers,
  fetchAdminVideos,
  updateAdminUser,
} from '../lib/api';

export const VideoAdminPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'videos'>('overview');
  const [loading, setLoading] = useState(false);

  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [userSearch, setUserSearch] = useState('');

  const [videos, setVideos] = useState<any[]>([]);
  const [videosTotal, setVideosTotal] = useState(0);
  const [videoSearch, setVideoSearch] = useState('');

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

  useEffect(() => {
    void loadStats();
    void loadUsers('');
    void loadVideos('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleUserRole = async (u: any) => {
    const targetRole = u.role === 'admin' ? 'user' : 'admin';
    const actionName = targetRole === 'admin' ? '提权为管理员' : '降为普通用户';
    if (!window.confirm(`确认将用户 ${u.email} ${actionName}吗？`)) return;
    try {
      await updateAdminUser(u.id, { role: targetRole });
      await loadUsers();
      await loadStats();
    } catch (err: any) {
      window.alert(err?.message || '操作失败');
    }
  };

  const toggleUserStatus = async (u: any) => {
    const targetStatus = u.status === 'active' ? 'disabled' : 'active';
    const actionName = targetStatus === 'disabled' ? '禁用' : '解封恢复';
    if (!window.confirm(`确认${actionName}用户 ${u.email} 账号吗？`)) return;
    try {
      await updateAdminUser(u.id, { status: targetStatus });
      await loadUsers();
    } catch (err: any) {
      window.alert(err?.message || '操作失败');
    }
  };

  const handleDeleteVideo = async (v: any) => {
    if (
      !window.confirm(
        `确认删除该视频记录及所有分析研报吗？若有本地归档文件也将物理清理。\n\n视频标题: ${v.title || '未命名'}`,
      )
    ) {
      return;
    }
    try {
      await deleteAdminVideo(v.id);
      await loadVideos();
      await loadStats();
    } catch (err: any) {
      window.alert(err?.message || '删除失败');
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
    </div>
  );
};
