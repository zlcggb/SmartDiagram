import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { isAdminSession } from '@/shared/lib/config/auth';
import { usePlatformAuth } from '@/shared/store/authStore';
import { fetchAuthMe, updateAuthProfile } from '../lib/api';

function fileToCompressedAvatarDataUrl(file: File, maxSide = 128): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('请选择图片文件'));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      reject(new Error('图片不能超过 8 MB'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('不支持的图片格式'));
      img.onload = () => {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) {
          reject(new Error('图片尺寸无效'));
          return;
        }
        const side = Math.min(w, h);
        const sx = Math.floor((w - side) / 2);
        const sy = Math.floor((h - side) / 2);
        const canvas = document.createElement('canvas');
        canvas.width = maxSide;
        canvas.height = maxSide;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('浏览器不支持图像处理'));
          return;
        }
        ctx.drawImage(img, sx, sy, side, side, 0, 0, maxSide, maxSide);
        let dataUrl = canvas.toDataURL('image/webp', 0.86);
        if (!dataUrl.startsWith('data:image/webp')) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.86);
        }
        resolve(dataUrl);
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

export const VideoShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const isCoachRoute = location.pathname.startsWith('/video/coach');
  const [searchParams] = useSearchParams();
  const isReadOnlyShare = Boolean(
    searchParams.get('s') || (searchParams.get('share') && searchParams.get('analysis')),
  );
  const session = usePlatformAuth((state) => state.session);
  const openLogin = usePlatformAuth((state) => state.openLogin);
  const logout = usePlatformAuth((state) => state.logout);
  const isAdmin = isAdminSession(session);

  const [videoProfile, setVideoProfile] = useState<{
    id: string;
    display_name?: string | null;
    avatar_url?: string | null;
  } | null>(null);

  const userName =
    videoProfile?.display_name ||
    session?.user?.display_name ||
    session?.user?.email?.split('@')[0] ||
    '';
  const userAvatar = videoProfile?.avatar_url || '';

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  const [profileDialogMode, setProfileDialogMode] = useState<'' | 'nickname' | 'avatar'>('');
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [avatarUrlDraft, setAvatarUrlDraft] = useState('');
  const [avatarPreview, setAvatarPreview] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');

  useEffect(() => {
    if (!session?.access_token) {
      setVideoProfile(null);
      return;
    }
    let cancelled = false;
    fetchAuthMe()
      .then((me) => {
        if (!cancelled && me) {
          setVideoProfile({
            id: me.id,
            display_name: me.display_name,
            avatar_url: me.avatar_url,
          });
        }
      })
      .catch(() => {
        // ignore
      });
    return () => {
      cancelled = true;
    };
  }, [session?.access_token]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [userMenuOpen]);

  const handleGoVideoHome = (e: React.MouseEvent) => {
    e.preventDefault();
    navigate('/video');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('vidgrab:reset-home'));
    }
  };

  const openNicknameDialog = () => {
    setUserMenuOpen(false);
    setProfileError('');
    setNicknameDraft(userName);
    setProfileDialogMode('nickname');
  };

  const openAvatarDialog = () => {
    setUserMenuOpen(false);
    setProfileError('');
    setAvatarPreview(userAvatar);
    setAvatarUrlDraft(userAvatar.startsWith('http') ? userAvatar : '');
    setProfileDialogMode('avatar');
  };

  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file) return;
    setProfileError('');
    try {
      const dataUrl = await fileToCompressedAvatarDataUrl(file, 128);
      setAvatarPreview(dataUrl);
      setAvatarUrlDraft('');
    } catch (err: any) {
      setProfileError(err?.message || '处理图片失败');
    }
  };

  const saveNickname = async () => {
    const name = nicknameDraft.trim();
    if (!name) {
      setProfileError('请输入昵称');
      return;
    }
    setProfileSaving(true);
    setProfileError('');
    try {
      const updated = await updateAuthProfile({ display_name: name });
      setVideoProfile({
        id: updated.id,
        display_name: updated.display_name,
        avatar_url: updated.avatar_url,
      });
      setProfileDialogMode('');
    } catch (err: any) {
      setProfileError(err?.message || '保存失败');
    } finally {
      setProfileSaving(false);
    }
  };

  const saveAvatar = async () => {
    setProfileSaving(true);
    setProfileError('');
    try {
      const nextUrl = avatarUrlDraft.trim() || avatarPreview || '';
      const updated = await updateAuthProfile({ avatar_url: nextUrl });
      setVideoProfile({
        id: updated.id,
        display_name: updated.display_name,
        avatar_url: updated.avatar_url,
      });
      setProfileDialogMode('');
    } catch (err: any) {
      setProfileError(err?.message || '保存失败');
    } finally {
      setProfileSaving(false);
    }
  };

  const clearAvatar = async () => {
    setProfileSaving(true);
    setProfileError('');
    try {
      const updated = await updateAuthProfile({ avatar_url: '' });
      setVideoProfile({
        id: updated.id,
        display_name: updated.display_name,
        avatar_url: updated.avatar_url,
      });
      setAvatarPreview('');
      setAvatarUrlDraft('');
      setProfileDialogMode('');
    } catch (err: any) {
      setProfileError(err?.message || '恢复默认头像失败');
    } finally {
      setProfileSaving(false);
    }
  };

  return (
    <div className="vidgrab-shell flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#f2f2f7] text-[#1d1d1f] lg:bg-[#f5f5f7]">
      {/* 视频学习专属 Apple 毛玻璃顶部导航栏（移动端进入视觉教练工作台时使用教练专属单行顶栏，避免双顶栏叠高） */}
      <header
        className={`ios-glass-header z-30 h-12 shrink-0 items-center justify-between gap-2 border-b border-black/[0.07] px-3 shadow-[0_1px_8px_-2px_rgba(15,23,42,0.04)] lg:flex lg:h-14 lg:gap-3 lg:border-slate-200/80 lg:px-6 ${
          isCoachRoute ? 'hidden' : 'flex'
        }`}
      >
        {/* 左侧：移动端返回主桌面按钮 + 品牌标识（点击直接返回视频学习助手首页） */}
        <div className="flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => navigate(isCoachRoute ? '/video' : '/')}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-600 transition active:scale-95 active:bg-slate-200/70 lg:hidden"
            title={isCoachRoute ? '返回视频学习助手首页' : '返回 SmartDiagram 桌面'}
            aria-label="返回"
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
              to="/video/community"
              className={({ isActive }) =>
                `inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition-all ${
                  isActive
                    ? 'bg-white font-semibold text-[#0071e3] shadow-2xs'
                    : 'font-medium text-slate-600 hover:text-slate-900'
                }`
              }
            >
              <span>🌐</span>
              <span>学习社区</span>
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
            <div ref={userMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setUserMenuOpen((v) => !v)}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-200/80 bg-white px-2.5 text-[12px] font-medium text-slate-700 shadow-2xs transition hover:border-[#0071e3]/40 active:scale-95 cursor-pointer"
                title={`已登录账号：${userName}`}
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-tr from-[#0071e3] to-indigo-500 text-[10.5px] font-bold text-white">
                  {userAvatar ? (
                    <img src={userAvatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    userName.slice(0, 1).toUpperCase()
                  )}
                </span>
                <span className="max-w-[72px] truncate sm:max-w-[96px]">{userName}</span>
              </button>

              {userMenuOpen && (
                <div className="absolute right-0 top-10 z-50 w-52 rounded-2xl border border-slate-200/90 bg-white/95 p-2 shadow-xl backdrop-blur-xl">
                  <div className="border-b border-slate-100 px-2.5 py-2">
                    <div className="truncate text-[12.5px] font-semibold text-slate-900">{userName}</div>
                    {session?.user?.email && (
                      <div className="truncate text-[11px] text-slate-500">{session.user.email}</div>
                    )}
                  </div>

                  {videoProfile?.id && (
                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        navigate(`/video/community/users/${encodeURIComponent(videoProfile.id)}`);
                      }}
                      className="mt-1 flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[12.5px] font-medium text-slate-700 transition hover:bg-slate-100 cursor-pointer"
                    >
                      <span>👤</span>
                      <span>我的社区主页</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={openNicknameDialog}
                    className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[12.5px] font-medium text-slate-700 transition hover:bg-slate-100 cursor-pointer"
                  >
                    <span>✏️</span>
                    <span>修改昵称</span>
                  </button>

                  <button
                    type="button"
                    onClick={openAvatarDialog}
                    className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[12.5px] font-medium text-slate-700 transition hover:bg-slate-100 cursor-pointer"
                  >
                    <span>🖼️</span>
                    <span>修改头像</span>
                  </button>

                  <div className="my-1 border-t border-slate-100" />

                  <button
                    type="button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      logout();
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[12.5px] font-medium text-rose-600 transition hover:bg-rose-50 cursor-pointer"
                  >
                    <span>退出登录</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => openLogin()}
              className="inline-flex h-8 items-center gap-1 rounded-full bg-[#0071e3]/12 px-3 text-[12.5px] font-semibold text-[#0071e3] transition hover:bg-[#0071e3] hover:text-white active:scale-95 cursor-pointer"
              title="登录账户以同步视频学习记录与评测进度"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                <circle cx="12" cy="8" r="4" />
                <path d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6" strokeLinecap="round" />
              </svg>
              <span>登录</span>
            </button>
          )}
        </div>
      </header>

      {/* 移动端专属：可展开/收起的视频源切换抽屉插槽 */}
      <div id="vidgrab-mobile-subheader-slot" className="z-20 shrink-0 lg:hidden" />

      {/* 主体内容区 */}
      <div
        className={`flex min-h-0 flex-1 flex-col ${
          isCoachRoute ? 'overflow-hidden' : 'overflow-y-auto lg:overflow-hidden'
        }`}
      >
        {children}
      </div>

      {/* 移动端专属：iOS 原生底部毛玻璃标签栏 (视觉教练页面使用专属底栏，隐藏通用学习底栏) */}
      <nav
        aria-label="视频学习移动端导航"
        className={`ios-glass-tabbar z-30 shrink-0 items-center justify-around border-t border-black/[0.08] px-1 pt-1.5 pb-[max(0.35rem,env(safe-area-inset-bottom))] lg:hidden ${
          isCoachRoute ? 'hidden' : 'flex'
        }`}
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
            `flex min-w-[56px] flex-col items-center justify-center gap-0.5 rounded-xl py-0.5 text-[10.5px] transition-transform active:scale-95 ${
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
          to="/video/community"
          className={({ isActive }) =>
            `flex min-w-[56px] flex-col items-center justify-center gap-0.5 rounded-xl py-0.5 text-[10.5px] transition-transform active:scale-95 ${
              isActive ? 'font-semibold text-[#0071e3]' : 'font-medium text-[#86868b]'
            }`
          }
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="9" />
            <path d="M3.6 9h16.8M3.6 15h16.8" strokeLinecap="round" />
            <path d="M12 3a14.5 14.5 0 0 0 0 18 14.5 14.5 0 0 0 0-18z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>学习社区</span>
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

      {/* 修改昵称 / 修改头像 弹窗 */}
      {profileDialogMode && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs"
          onClick={() => setProfileDialogMode('')}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {profileDialogMode === 'nickname' ? (
              <>
                <h3 className="text-[15px] font-bold text-slate-900">修改显示昵称</h3>
                <p className="mt-1 text-[12px] text-slate-500">
                  昵称将显示在顶栏、学习社区及评论中（最多 64 字）
                </p>
                <input
                  value={nicknameDraft}
                  onChange={(e) => setNicknameDraft(e.target.value)}
                  type="text"
                  maxLength={64}
                  placeholder="请输入新昵称"
                  className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-[13px] text-slate-900 outline-none focus:border-[#0071e3]"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveNickname();
                  }}
                />
                {profileError && (
                  <p className="mt-2 text-[12px] text-rose-600">{profileError}</p>
                )}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setProfileDialogMode('')}
                    className="rounded-xl border border-slate-200 px-3.5 py-1.5 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={profileSaving}
                    onClick={() => void saveNickname()}
                    className="rounded-xl bg-[#0071e3] px-4 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#0077ed] disabled:opacity-50"
                  >
                    {profileSaving ? '保存中…' : '保存'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-[15px] font-bold text-slate-900">修改个人头像</h3>
                <p className="mt-1 text-[12px] text-slate-500">
                  支持上传本地图片（自动裁剪压缩为 128×128）或填写图片链接
                </p>

                <div className="mt-3 flex items-center gap-3.5">
                  <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-tr from-[#0071e3] to-indigo-500 text-lg font-bold text-white shadow-xs">
                    {avatarPreview || avatarUrlDraft ? (
                      <img
                        src={avatarUrlDraft || avatarPreview}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span>{userName.slice(0, 1).toUpperCase()}</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] font-medium text-slate-700 transition hover:bg-slate-100">
                      <span>上传本地图片…</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => void handleAvatarFileChange(e)}
                      />
                    </label>
                    {(avatarPreview || avatarUrlDraft || userAvatar) && (
                      <button
                        type="button"
                        onClick={() => void clearAvatar()}
                        className="text-left text-[11.5px] text-rose-600 hover:underline"
                      >
                        恢复默认字母头像
                      </button>
                    )}
                  </div>
                </div>

                <input
                  value={avatarUrlDraft}
                  onChange={(e) => setAvatarUrlDraft(e.target.value)}
                  type="url"
                  placeholder="或粘贴图片 https:// 链接（可选）"
                  className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-1.5 text-[12.5px] text-slate-900 outline-none focus:border-[#0071e3]"
                />

                {profileError && (
                  <p className="mt-2 text-[12px] text-rose-600">{profileError}</p>
                )}

                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setProfileDialogMode('')}
                    className="rounded-xl border border-slate-200 px-3.5 py-1.5 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={profileSaving}
                    onClick={() => void saveAvatar()}
                    className="rounded-xl bg-[#0071e3] px-4 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#0077ed] disabled:opacity-50"
                  >
                    {profileSaving ? '保存中…' : '保存头像'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
