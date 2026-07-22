/**
 * App — 思维导图模块（挂载于平台 /diagram 路由）。
 *
 * Desktop (≥768px): Canvas LEFT (65%) | Separator | Chat RIGHT (35%).
 * Mobile  (<768px): Full-screen tab switch (Chat / Canvas) + bottom tab bar.
 *
 * 登录态由平台统一维护（store/authStore.ts），本模块只消费不管理。
 * Guest mode: unauthenticated users enter the main UI directly.
 * ChatPanel handles quota enforcement and login prompts.
 */

import { useState, useCallback, useRef } from 'react';
import ChatPanel from './components/chat/ChatPanel';
import CanvasPanel from './components/layout/CanvasPanel';
import MobileTabBar from './components/layout/MobileTabBar';
import { useChatStore } from './store/chatStore';
import { usePlatformAuth } from './store/authStore';
import { useIsMobile } from './hooks/useIsMobile';

export default function App() {
  const { canvasMode, mobileActivePanel } = useChatStore();
  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement>(null);
  const [chatWidth, setChatWidth] = useState(420);
  const authSession = usePlatformAuth((state) => state.session);
  const authChecking = usePlatformAuth((state) => state.checking);
  const setSession = usePlatformAuth((state) => state.setSession);
  const logout = usePlatformAuth((state) => state.logout);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback(() => {
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const w = containerRef.current.offsetWidth;
      setChatWidth(Math.max(340, Math.min(600, w - e.clientX)));
    };
    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  // Session validation in progress — show loading state
  if (authChecking) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-950 text-sm font-medium text-slate-300">
        正在恢复登录态...
      </div>
    );
  }

  // ── Mobile layout ──
  if (isMobile) {
    return (
      <div
        className={`h-full w-full overflow-hidden flex flex-col transition-colors duration-300 ${canvasMode} ${
          canvasMode === 'light' ? 'bg-slate-50' : 'bg-slate-950'
        }`}
      >
        {/* Active panel — full screen */}
        <div className="flex-1 min-h-0 w-full">
          {mobileActivePanel === 'canvas' ? (
            <CanvasPanel />
          ) : (
            <ChatPanel authSession={authSession} onLogout={logout} onLogin={setSession} />
          )}
        </div>

        {/* Bottom tab bar */}
        <MobileTabBar />
      </div>
    );
  }

  // ── Desktop layout (unchanged) ──
  return (
    <div 
      ref={containerRef} 
      className={`h-full w-full overflow-hidden flex transition-colors duration-300 ${canvasMode} ${
        canvasMode === 'light' ? 'bg-slate-50' : 'bg-slate-950'
      }`}
    >
      {/* Canvas (hero, left, flex-1) */}
      <div className="flex-1 h-full min-w-0">
        <CanvasPanel />
      </div>

      {/* Separator */}
      <div 
        onMouseDown={handleMouseDown} 
        className="sd-separator"
        style={{
          background: canvasMode === 'light' ? '#e2e8f0' : '#1e293b',
        }}
      >
        <div className="sd-separator-dot" />
      </div>

      {/* Chat sidebar (right, fixed width) */}
      <div className="h-full shrink-0" style={{ width: chatWidth }}>
        <ChatPanel authSession={authSession} onLogout={logout} onLogin={setSession} />
      </div>
    </div>
  );
}
