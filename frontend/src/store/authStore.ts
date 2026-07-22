/**
 * 平台统一登录态 — DeepDiagram Pro 所有模块共用。
 *
 * 会话存储仍走 config/auth.ts 的 localStorage（与后端 /api/auth 契约一致），
 * 本 store 只是把它提升为全局响应式状态：
 *  - AppShell 的用户中心、登录弹窗读写它
 *  - 思维导图模块（App.tsx）消费它，不再各自维护一份
 */
import { create } from 'zustand';
import {
  clearAuthSession,
  readAuthSession,
  validateAuthSession,
  writeAuthSession,
  type AuthSession,
} from '../config/auth';

interface PlatformAuthState {
  /** 当前登录会话；null = 访客模式（访客仍可使用基础功能） */
  session: AuthSession | null;
  /** 启动时校验本地会话是否仍有效（防止用过期 token 渲染） */
  checking: boolean;
  /** 统一登录弹窗开关（菜单栏、首页、模块内的登录入口共用） */
  loginOpen: boolean;

  /** 应用启动时调用一次：读取本地会话并向后端校验 */
  bootstrapAuth: () => Promise<void>;
  /** 登录成功（LoginScreen 回调），会话已写入 localStorage */
  setSession: (session: AuthSession) => void;
  /** 退出登录并刷新，清空各模块的内存状态 */
  logout: () => void;
  openLogin: () => void;
  closeLogin: () => void;
}

export const usePlatformAuth = create<PlatformAuthState>((set, get) => ({
  session: readAuthSession(),
  checking: Boolean(readAuthSession()),
  loginOpen: false,

  bootstrapAuth: async () => {
    const session = get().session;
    if (!session) {
      set({ checking: false });
      return;
    }
    try {
      const refreshed = await validateAuthSession(session);
      set({ session: refreshed, checking: false });
    } catch {
      clearAuthSession();
      set({ session: null, checking: false });
    }
  },

  setSession: (session) => {
    writeAuthSession(session);
    set({ session, loginOpen: false });
  },

  logout: () => {
    clearAuthSession();
    set({ session: null });
    // 整页刷新：清空思维导图等模块内存中的图表/对话状态
    window.location.reload();
  },

  openLogin: () => set({ loginOpen: true }),
  closeLogin: () => set({ loginOpen: false }),
}));
