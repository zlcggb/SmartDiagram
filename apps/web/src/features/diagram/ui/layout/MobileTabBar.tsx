/**
 * MobileTabBar — 移动端底部导航栏
 * 两个 Tab：对话 / 画布，支持未读指示器和 safe-area 适配
 */

import { MessageSquare, LayoutDashboard } from 'lucide-react';
import { useChatStore } from '@/features/diagram/model/chatStore';
import { useT } from '@/app/i18n';

export default function MobileTabBar() {
  const { mobileActivePanel, setMobileActivePanel, canvasCode, canvasMode } = useChatStore();
  const { t } = useT();
  const isLight = canvasMode === 'light';

  // 当用户在 Chat 面板且画布已有内容时，显示未读指示器
  const showCanvasDot = mobileActivePanel === 'chat' && !!canvasCode;

  const tabs = [
    {
      id: 'chat' as const,
      label: t('mobile.chat'),
      Icon: MessageSquare,
      dot: false,
    },
    {
      id: 'canvas' as const,
      label: t('mobile.canvas'),
      Icon: LayoutDashboard,
      dot: showCanvasDot,
    },
  ];

  return (
    <div
      className={`sd-mobile-tab-bar ${isLight ? 'sd-mobile-tab-bar--light' : 'sd-mobile-tab-bar--dark'}`}
    >
      {tabs.map((tab) => {
        const isActive = mobileActivePanel === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => setMobileActivePanel(tab.id)}
            className={`sd-mobile-tab ${isActive ? 'sd-mobile-tab--active' : ''}`}
          >
            <div className="relative">
              <tab.Icon className="sd-mobile-tab-icon" />
              {tab.dot && (
                <span className="sd-mobile-tab-dot" />
              )}
            </div>
            <span className="sd-mobile-tab-label">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
