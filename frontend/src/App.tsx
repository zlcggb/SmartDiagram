/**
 * App — Root layout. Canvas LEFT (65%) | Separator | Chat RIGHT (35%).
 * All styles use pure Tailwind v4 utilities. Zero inline styles.
 */

import { useState, useCallback, useRef } from 'react';
import ChatPanel from './components/chat/ChatPanel';
import CanvasPanel from './components/layout/CanvasPanel';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [chatWidth, setChatWidth] = useState(420);
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

  return (
    <div ref={containerRef} className="h-screen w-screen overflow-hidden flex bg-white">
      {/* Canvas (hero, left, flex-1) */}
      <div className="flex-1 h-full min-w-0">
        <CanvasPanel />
      </div>

      {/* Separator */}
      <div onMouseDown={handleMouseDown} className="sd-separator">
        <div className="sd-separator-dot" />
      </div>

      {/* Chat sidebar (right, fixed width) */}
      <div className="h-full shrink-0" style={{ width: chatWidth }}>
        <ChatPanel />
      </div>
    </div>
  );
}
