/**
 * 平台统一登录态 — SmartDiagram 所有模块共用。
 *
 * 会话存储仍走 config/auth.ts 的 localStorage（与后端 /api/auth 契约一致），
 * 本 store 只是把它提升为全局响应式状态：
 *  - AppShell 的用户中心、登录弹窗读写它
 *  - 思维导图模块（App.tsx）消费它，不再各自维护一份
 */
import { create } from 'zustand';
import {
  clearAuthSession,
  consumeAuthExpiredNotice,
  readAuthSession,
  validateAuthSession,
  writeAuthSession,
  type AuthSession,
} from '@/shared/store/auth';
import { clearGuestSession, ensureGuestSession } from '@/shared/lib/config/guestSession';

interface PlatformAuthState {
  /** 当前登录会话；null = 访客模式（访客仍可使用基础功能） */
  session: AuthSession | null;
  /** 启动时校验本地会话是否仍有效（防止用过期 token 渲染） */
  checking: boolean;
  /** 统一登录弹窗开关（菜单栏、首页、模块内的登录入口共用） */
  loginOpen: boolean;
  /** 登录弹窗顶部提示信息（例如会话过期或需要登录访问） */
  loginNotice: string | null;
  /** 标记当前弹窗是否因会话过期或权限拦截而触发（关闭时若未登录则返回首页） */
  expiredPromptActive: boolean;

  /** 应用启动时调用一次：读取本地会话并向后端校验（含 7 天滑动续期） */
  bootstrapAuth: () => Promise<void>;
  /** 登录成功（LoginScreen 回调），会话已写入 localStorage */
  setSession: (session: AuthSession) => void;
  /** 退出登录并刷新，清空各模块的内存状态 */
  logout: () => void;
  /** 当接口返回 401 或检测到会话过期时主动唤起登录弹窗 */
  notifySessionExpired: (reason?: string) => void;
  openLogin: (notice?: unknown) => void;
  closeLogin: () => void;
}

const initialSession = readAuthSession();
const initialExpiredNotice = !initialSession && consumeAuthExpiredNotice();

export const usePlatformAuth = create<PlatformAuthState>((set, get) => ({
  session: initialSession,
  checking: Boolean(initialSession),
  loginOpen: initialExpiredNotice,
  loginNotice: initialExpiredNotice ? '您的登录状态已过期，请重新登录以继续访问您的数据' : null,
  expiredPromptActive: initialExpiredNotice,

  bootstrapAuth: async () => {
    const session = get().session;
    if (!session) {
      const expiredJustNow = consumeAuthExpiredNotice();
      if (expiredJustNow) {
        set({
          loginOpen: true,
          expiredPromptActive: true,
          loginNotice: '您的登录状态已过期，请重新登录以继续访问您的数据',
        });
      }
      try {
        await ensureGuestSession();
      } catch {
        // Guest bootstrap may fail when API is down; modules will retry on demand.
      }
      set({ checking: false });
      return;
    }
    try {
      const refreshed = await validateAuthSession(session);
      set({ session: refreshed, checking: false });
    } catch {
      clearAuthSession();
      try {
        await ensureGuestSession();
      } catch {
        // ignore
      }
      set({
        session: null,
        checking: false,
        loginOpen: true,
        expiredPromptActive: true,
        loginNotice: '您的登录状态已过期，请重新登录以继续访问您的数据',
      });
    }
  },

  setSession: (session) => {
    const wasExpiredOrInSubModule =
      get().expiredPromptActive ||
      (typeof window !== 'undefined' && window.location.pathname !== '/');
    writeAuthSession(session);
    clearGuestSession();
    set({
      session,
      loginOpen: false,
      loginNotice: null,
      expiredPromptActive: false,
    });
    if (wasExpiredOrInSubModule && typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.location.reload();
    }
  },

  logout: () => {
    clearAuthSession();
    clearGuestSession();
    set({
      session: null,
      loginOpen: false,
      loginNotice: null,
      expiredPromptActive: false,
    });
    // 退出登录直接返回首页并刷新清空内存状态
    if (typeof window !== 'undefined') {
      window.location.assign('/');
    }
  },

  notifySessionExpired: (reason) => {
    clearAuthSession();
    void ensureGuestSession().catch(() => undefined);
    set({
      session: null,
      checking: false,
      loginOpen: true,
      expiredPromptActive: true,
      loginNotice: reason || '您的登录状态已过期，请重新登录以继续操作',
    });
  },

  openLogin: (notice) =>
    set({
      loginOpen: true,
      loginNotice: typeof notice === 'string' && notice ? notice : null,
    }),

  closeLogin: () => {
    const shouldReturnHome =
      get().expiredPromptActive &&
      !get().session &&
      typeof window !== 'undefined' &&
      window.location.pathname !== '/';
    set({
      loginOpen: false,
      loginNotice: null,
      expiredPromptActive: false,
    });
    if (shouldReturnHome && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('smartdiagram:navigate-home'));
    }
  },
}));
