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
    <div className="vidgrab-shell flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#f2f2f7] text-[#1d1d1f] lg:bg-[#f5f5f7]">
      {/* 视频学习专属 Apple 毛玻璃顶部导航栏 */}
      <header className="ios-glass-header z-30 flex h-12 shrink-0 items-center justify-between gap-2 border-b border-black/[0.07] px-3 shadow-[0_1px_8px_-2px_rgba(15,23,42,0.04)] lg:h-14 lg:gap-3 lg:border-slate-200/80 lg:px-6">
        {/* 左侧：移动端返回主桌面按钮 + 品牌标识（点击直接返回视频学习助手首页） */}
        <div className="flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-600 transition active:scale-95 active:bg-slate-200/70 lg:hidden"
            title="返回 SmartDiagram 桌面"
            aria-label="返回桌面"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <a
            href="/video"
            onClick={handleGoVideoHome}
            className="group flex min-w-0 items-center gap-2 rounded-xl py-1 pr-1.5 transition hover:opacity-90 lg:gap-2.5 lg:pr-2"
            title="点击返回视频学习助手首页"
          >
            <div className="relative grid h-7 w-7 shrink-0 place-items-center rounded-[10px] bg-gradient-to-br from-[#0071e3] via-[#2563eb] to-[#4f46e5] text-white shadow-sm shadow-[#0071e3]/25 transition-transform group-hover:scale-[1.04] lg:h-8 lg:w-8 lg:rounded-xl">
              <svg className="h-3.5 w-3.5 lg:h-4 lg:w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18c.62-.39.62-1.29 0-1.69L9.54 5.98C8.87 5.55 8 6.03 8 6.82z" />
              </svg>
            </div>
            <div className="flex min-w-0 items-center gap-1.5 lg:gap-2">
              <span className="truncate text-[14.5px] font-bold tracking-tight text-slate-900 transition-colors group-hover:text-[#0071e3] lg:text-[15px]">
                视频学习助手
              </span>
              <span className="hidden rounded-md bg-[#0071e3]/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-[#0071e3] sm:inline-block">
                AI STUDIO
              </span>
            </div>
          </a>

          {isReadOnlyShare && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#0071e3]/25 bg-[#0071e3]/10 px-2 py-0.5 text-[10.5px] font-semibold text-[#0071e3] lg:ml-1 lg:px-2.5 lg:text-[11px]"
              title="当前为免登录只读分享模式（可自由播放跳播与本地试做评测，不会修改分享者原数据）"
            >
              <span>👀</span>
              <span className="hidden xs:inline sm:inline">只读分享模式</span>
              <span className="xs:hidden sm:hidden">只读分享</span>
            </span>
          )}
        </div>

        {/* 中部：桌面端动态插槽（当视频解析进入工作台后，紧凑版「本地上传/在线链接」切换器内嵌于正中央） */}
        <div
          id="vidgrab-navbar-center-slot"
          className="hidden min-w-0 flex-1 items-center justify-center px-1 lg:flex"
        />

        {/* 右侧：移动端快捷操作插槽 + 桌面端分段胶囊导航 + 账号状态 */}
        <div className="flex shrink-0 items-center gap-2 lg:gap-2.5">
          {/* 移动端专属：切换新视频触发插槽 */}
          <div id="vidgrab-navbar-mobile-action-slot" className="flex items-center lg:hidden" />

          {/* 桌面端分段胶囊导航（移动端下沉至底部 iOS Tab Bar） */}
          <nav className="hidden items-center gap-1 rounded-full border border-slate-200/80 bg-slate-100/90 p-1 text-[12px] lg:inline-flex">
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
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 shadow-2xs lg:px-2.5 lg:py-1 lg:text-[11.5px]"
              title={`已登录账号：${userName}`}
            >
              <span className="grid h-4 w-4 place-items-center rounded-full bg-gradient-to-tr from-[#0071e3] to-indigo-500 text-[10px] font-bold text-white">
                {userName.slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden max-w-[84px] truncate sm:inline">{userName}</span>
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

      {/* 移动端专属：可展开/收起的视频源切换抽屉插槽 */}
      <div id="vidgrab-mobile-subheader-slot" className="z-20 shrink-0 lg:hidden" />

      {/* 主体内容区 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">{children}</div>

      {/* 移动端专属：iOS 原生底部毛玻璃标签栏 (Bottom Tab Bar) */}
      <nav
        aria-label="视频学习移动端导航"
        className="ios-glass-tabbar z-30 flex shrink-0 items-center justify-around border-t border-black/[0.08] px-1 pt-1.5 pb-[max(0.35rem,env(safe-area-inset-bottom))] lg:hidden"
      >
        <NavLink
          to="/video"
          end
          className={({ isActive }) =>
            `flex min-w-[64px] flex-col items-center justify-center gap-0.5 rounded-xl py-0.5 text-[10.5px] transition-transform active:scale-95 ${
              isActive ? 'font-semibold text-[#0071e3]' : 'font-medium text-[#86868b]'
            }`
          }
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <rect x="3" y="4" width="18" height="12" rx="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10 8.5l4 2.5-4 2.5V8.5z" fill="currentColor" stroke="none" />
            <path d="M8 20h8" strokeLinecap="round" />
          </svg>
          <span>工作台</span>
        </NavLink>

        <NavLink
          to="/video/history"
          className={({ isActive }) =>
            `flex min-w-[64px] flex-col items-center justify-center gap-0.5 rounded-xl py-0.5 text-[10.5px] transition-transform active:scale-95 ${
              isActive ? 'font-semibold text-[#0071e3]' : 'font-medium text-[#86868b]'
            }`
          }
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 8v4l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>学习记录</span>
        </NavLink>

        <NavLink
          to="/video/docs"
          className={({ isActive }) =>
            `flex min-w-[64px] flex-col items-center justify-center gap-0.5 rounded-xl py-0.5 text-[10.5px] transition-transform active:scale-95 ${
              isActive ? 'font-semibold text-[#0071e3]' : 'font-medium text-[#86868b]'
            }`
          }
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path
              d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>文档中心</span>
        </NavLink>

        <NavLink
          to="/video/changelog"
          className={({ isActive }) =>
            `flex min-w-[64px] flex-col items-center justify-center gap-0.5 rounded-xl py-0.5 text-[10.5px] transition-transform active:scale-95 ${
              isActive ? 'font-semibold text-[#0071e3]' : 'font-medium text-[#86868b]'
            }`
          }
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path
              d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>更新记录</span>
        </NavLink>

        {isAdmin && (
          <NavLink
            to="/video/admin"
            className={({ isActive }) =>
              `flex min-w-[56px] flex-col items-center justify-center gap-0.5 rounded-xl py-0.5 text-[10.5px] transition-transform active:scale-95 ${
                isActive ? 'font-semibold text-[#0071e3]' : 'font-medium text-[#86868b]'
              }`
            }
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span>管理</span>
          </NavLink>
        )}
      </nav>
    </div>
  );
};
