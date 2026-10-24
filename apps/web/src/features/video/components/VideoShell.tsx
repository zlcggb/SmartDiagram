import React from 'react';
import { NavLink, useNavigate, useSearchParams } from 'react-router-dom';
import { isAdminSession, readAuthSession } from '@/shared/lib/config/auth';

export const VideoShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isReadOnlyShare = Boolean(
    searchParams.get('s') || (searchParams.get('share') && searchParams.get('analysis')),
  );
  const session = readAuthSession();
  const isAdmin = isAdminSession(session);
  const userName =
    session?.user?.display_name ||
    session?.user?.email?.split('@')[0] ||
    '';

  const handleGoVideoHome = (e: React.MouseEvent) => {
    e.preventDefault();
    navigate('/video');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('vidgrab:reset-home'));
    }
  };

  return (
    <div className="vidgrab-shell flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#f5f5f7] text-[#1d1d1f]">
      {/* 视频学习专属 Apple 毛玻璃顶部导航栏 */}
      <header className="z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 bg-white/88 px-4 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)] backdrop-blur-xl lg:px-6">
        {/* 左侧：品牌标识（点击直接返回视频学习助手首页） */}
        <div className="flex shrink-0 items-center">
          <a
            href="/video"
            onClick={handleGoVideoHome}
            className="group flex items-center gap-2.5 rounded-xl py-1 pr-2 transition hover:opacity-90"
            title="点击返回视频学习助手首页"
          >
            <div className="relative grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-[#0071e3] via-[#2563eb] to-[#4f46e5] text-white shadow-sm shadow-[#0071e3]/25 transition-transform group-hover:scale-[1.04]">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18c.62-.39.62-1.29 0-1.69L9.54 5.98C8.87 5.55 8 6.03 8 6.82z" />
              </svg>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-bold tracking-tight text-slate-900 group-hover:text-[#0071e3] transition-colors">
                视频学习助手
              </span>
              <span className="hidden rounded-md bg-[#0071e3]/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-[#0071e3] sm:inline-block">
                AI STUDIO
              </span>
            </div>
          </a>
          {isReadOnlyShare && (
            <span
              className="ml-1 inline-flex items-center gap-1 rounded-full border border-[#0071e3]/25 bg-[#0071e3]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#0071e3]"
              title="当前为免登录只读分享模式（可自由播放跳播与本地试做评测，不会修改分享者原数据）"
            >
              <span>👀</span>
              <span>只读分享模式</span>
            </span>
          )}
        </div>

        {/* 中部：动态插槽（当视频解析进入工作台后，紧凑版「本地上传/在线链接」切换器将直接内嵌在此处正中央） */}
        <div
          id="vidgrab-navbar-center-slot"
          className="flex min-w-0 flex-1 items-center justify-center px-1"
        />

        {/* 右侧：分段胶囊导航 + 账号状态 */}
        <div className="flex shrink-0 items-center gap-2.5">
          <nav className="inline-flex items-center gap-1 rounded-full border border-slate-200/80 bg-slate-100/90 p-1 text-[12px]">
            <NavLink
              to="/video"
              end
              className={({ isActive }) =>
                `inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition-all ${
                  isActive
                    ? 'bg-white font-semibold text-[#0071e3] shadow-2xs'
                    : 'font-medium text-slate-600 hover:text-slate-900'
                }`
              }
            >
              <span>✨</span>
              <span>学习工作台</span>
            </NavLink>

            <NavLink
              to="/video/history"
              className={({ isActive }) =>
                `inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition-all ${
                  isActive
                    ? 'bg-white font-semibold text-[#0071e3] shadow-2xs'
                    : 'font-medium text-slate-600 hover:text-slate-900'
                }`
              }
            >
              <span>📚</span>
              <span>学习记录</span>
            </NavLink>

            <NavLink
              to="/video/docs"
              className={({ isActive }) =>
                `inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition-all ${
                  isActive
                    ? 'bg-white font-semibold text-[#0071e3] shadow-2xs'
                    : 'font-medium text-slate-600 hover:text-slate-900'
                }`
              }
            >
              <span>📖</span>
              <span>文档中心</span>
            </NavLink>

            <NavLink
              to="/video/changelog"
              className={({ isActive }) =>
                `inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition-all ${
                  isActive
                    ? 'bg-white font-semibold text-[#0071e3] shadow-2xs'
                    : 'font-medium text-slate-600 hover:text-slate-900'
                }`
              }
            >
              <span>🚀</span>
              <span>更新记录</span>
            </NavLink>

            {isAdmin && (
              <NavLink
                to="/video/admin"
                className={({ isActive }) =>
                  `inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition-all ${
                    isActive
                      ? 'bg-white font-semibold text-[#0071e3] shadow-2xs'
                      : 'font-medium text-slate-600 hover:text-slate-900'
                  }`
                }
              >
                <span>⚙️</span>
                <span className="hidden sm:inline">管理</span>
              </NavLink>
            )}
          </nav>

          {userName ? (
            <div
              className="hidden items-center gap-1.5 rounded-full border border-slate-200/80 bg-white px-2.5 py-1 text-[11.5px] font-medium text-slate-700 shadow-2xs sm:inline-flex"
              title={`已登录账号：${userName}`}
            >
              <span className="grid h-4 w-4 place-items-center rounded-full bg-gradient-to-tr from-[#0071e3] to-indigo-500 text-[10px] font-bold text-white">
                {userName.slice(0, 1).toUpperCase()}
              </span>
              <span className="max-w-[84px] truncate">{userName}</span>
            </div>
          ) : (
            <span
              className="hidden items-center gap-1 rounded-full border border-slate-200/70 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500 md:inline-flex"
              title="游客模式（本地与服务端双重保存学习进度）"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              游客模式
            </span>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </div>
  );
};
