/**
 * ChartsCanvas — renders ECharts visualizations from option JSON.
 */

import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { useChatStore } from '../../store/chatStore';
import { useT } from '../../i18n';

// ─── Streaming JSON Parser for Charts ───

function tryParseStreamingJSON(rawStr: string) {
  let code = rawStr.trim();
  if (code.startsWith('```')) {
    code = code.replace(/^```\w*\n?/, '').replace(/```$/, '').trim();
  }

  let cleaned = code;
  let stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastValidIndex = 0;

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{' || char === '[') {
        stack.push(char);
      } else if (char === '}') {
        if (stack[stack.length - 1] === '{') {
          stack.pop();
          lastValidIndex = i + 1;
        }
      } else if (char === ']') {
        if (stack[stack.length - 1] === '[') {
          stack.pop();
          lastValidIndex = i + 1;
        }
      }
    }
  }

  try {
    if (lastValidIndex > 0) {
      let subStr = cleaned.slice(0, lastValidIndex).trim();
      if (subStr.endsWith(',')) {
        subStr = subStr.slice(0, -1).trim();
      }

      let tempStack: string[] = [];
      let tempInString = false;
      for (let i = 0; i < subStr.length; i++) {
        const char = subStr[i];
        if (char === '"' && (i === 0 || subStr[i - 1] !== '\\')) {
          tempInString = !tempInString;
        }
        if (!tempInString) {
          if (char === '{' || char === '[') tempStack.push(char);
          else if (char === '}') tempStack.pop();
          else if (char === ']') tempStack.pop();
        }
      }

      let suffix = '';
      while (tempStack.length > 0) {
        const top = tempStack.pop();
        if (top === '{') suffix += '}';
        if (top === '[') suffix += ']';
      }

      return JSON.parse(subStr + suffix);
    }
  } catch (e) {
    // ignore
  }

  try {
    let suffix = '';
    if (inString) {
      suffix += '"';
    }
    let tempStack = [...stack];
    while (tempStack.length > 0) {
      const top = tempStack.pop();
      if (top === '{') suffix += '}';
      if (top === '[') suffix += ']';
    }
    return JSON.parse(cleaned + suffix);
  } catch (e) {
    return null;
  }
}

export default function ChartsCanvas() {
  const { canvasCode, streamingCode, isStreaming, canvasMode } = useChatStore();
  const { t } = useT();
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Background state for the chart canvas, default synchronized to global canvasMode but user override wins
  const [chartBg, setChartBg] = useState<'dark' | 'light' | 'warm'>(() => {
    const stored = localStorage.getItem('smartdiagram_chart_bg');
    if (stored === 'light' || stored === 'dark' || stored === 'warm') {
      return stored as 'dark' | 'light' | 'warm';
    }
    return canvasMode === 'light' ? 'light' : 'dark';
  });

  const [initCounter, setInitCounter] = useState(0);

  // Follow global theme toggling unless user has set their local preference
  useEffect(() => {
    const stored = localStorage.getItem('smartdiagram_chart_bg');
    if (!stored) {
      setChartBg(canvasMode === 'light' ? 'light' : 'dark');
    }
  }, [canvasMode]);

  // Initialize/resize chart with adaptive theme
  useEffect(() => {
    if (!chartRef.current) return;

    // Use dark theme for dark background, default (undefined) light theme for light & warm backgrounds
    const theme = chartBg === 'dark' ? 'dark' : undefined;
    
    chartInstance.current = echarts.init(
      chartRef.current,
      theme,
      { renderer: 'canvas' }
    );

    // Notify option rendering Effect that the fresh instance is fully mounted
    setInitCounter(prev => prev + 1);

    const handleResize = () => {
      // 用 rAF 推迟 resize，避免在 ECharts 主流程中被 ResizeObserver 同步触发
      requestAnimationFrame(() => chartInstance.current?.resize());
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(chartRef.current);

    return () => {
      resizeObserver.disconnect();
      chartInstance.current?.dispose();
      chartInstance.current = null;
    };
  }, [chartBg]);

  // Update chart data progressively
  useEffect(() => {
    const activeCode = (isStreaming && streamingCode) ? streamingCode : canvasCode;
    if (!activeCode || !chartInstance.current) return;

    try {
      let parsed: any = null;
      if (isStreaming) {
        parsed = tryParseStreamingJSON(activeCode);
      } else {
        let code = activeCode.trim();
        if (code.startsWith('```')) {
          code = code.replace(/^```\w*\n?/, '').replace(/```$/, '').trim();
        }
        parsed = JSON.parse(code);
      }

      if (parsed) {
        setError(null);

        // ─── 规避 ECharts 渐进式流渲染中的 series mismatch 警告 ───
        if (isStreaming && parsed.legend) {
          // 在流式输出期间，series 数组尚未长全，legend 内的数据与 series 名字不吻合
          // 通过在流式中临时剔除 legend 可完全阻止 ECharts 抛出 series not exists 的警告
          delete parsed.legend;
        }

        // 推迟 setOption 到下一帧，避免在 ECharts init 主流程中同步调用
        const instance = chartInstance.current;
        setTimeout(() => instance?.setOption(parsed, true), 0);
      }
    } catch (e: unknown) {
      if (!isStreaming) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(t('charts.parseError', { message: msg }));
      }
    }
  }, [isStreaming, canvasCode, streamingCode, initCounter, t]);

  const handleBgChange = (bg: 'dark' | 'light' | 'warm') => {
    setChartBg(bg);
    localStorage.setItem('smartdiagram_chart_bg', bg);
  };

  // Shared switcher element for both regular view and error state
  const renderSwitcher = () => (
    <div className="absolute top-4 right-4 z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border shadow-md backdrop-blur-md transition-all bg-white/70 dark:bg-slate-900/70 border-slate-200 dark:border-slate-800/80 hover:bg-white/90 dark:hover:bg-slate-900/90">
      <button
        onClick={() => handleBgChange('dark')}
        title={t('charts.themeDark')}
        className={`w-3.5 h-3.5 rounded-full bg-slate-950 border transition-all cursor-pointer hover:scale-125 active:scale-95 ${
          chartBg === 'dark' ? 'border-indigo-500 ring-2 ring-indigo-500/30 scale-110' : 'border-slate-300 dark:border-slate-600'
        }`}
      />
      <button
        onClick={() => handleBgChange('light')}
        title={t('charts.themeLight')}
        className={`w-3.5 h-3.5 rounded-full bg-white border transition-all cursor-pointer hover:scale-125 active:scale-95 ${
          chartBg === 'light' ? 'border-indigo-500 ring-2 ring-indigo-500/30 scale-110' : 'border-slate-300 dark:border-slate-600'
        }`}
      />
      <button
        onClick={() => handleBgChange('warm')}
        title={t('charts.themeWarm')}
        className={`w-3.5 h-3.5 rounded-full bg-[#faf9f6] border transition-all cursor-pointer hover:scale-125 active:scale-95 ${
          chartBg === 'warm' ? 'border-indigo-500 ring-2 ring-indigo-500/30 scale-110' : 'border-slate-300 dark:border-slate-600'
        }`}
      />
    </div>
  );

  if (error) {
    return (
      <div className={`w-full h-full flex items-center justify-center p-8 relative animate-fade-in transition-colors duration-300 ${
        chartBg === 'dark' ? 'bg-slate-950' : chartBg === 'light' ? 'bg-slate-50' : 'bg-[#faf9f6]'
      }`}>
        {renderSwitcher()}
        <div className="text-red-400 text-sm bg-red-950/20 p-4 rounded-xl border border-red-900/30 max-w-md shadow-lg">
          <p className="font-medium mb-1 text-slate-200">{t('charts.renderFailed')}</p>
          <pre className="text-xs whitespace-pre-wrap text-red-400">{error}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className={`w-full h-full flex items-center justify-center p-6 relative animate-fade-in transition-colors duration-300 ${
      chartBg === 'dark' ? 'bg-slate-950' : chartBg === 'light' ? 'bg-slate-50' : 'bg-[#faf9f6]'
    }`}>
      {renderSwitcher()}
      <div ref={chartRef} className="w-full h-full" style={{ background: 'transparent' }} />
    </div>
  );
}
