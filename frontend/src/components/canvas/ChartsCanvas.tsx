/**
 * ChartsCanvas — renders ECharts visualizations from option JSON.
 */

import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { useChatStore } from '../../store/chatStore';

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
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize/resize chart with adaptive theme
  useEffect(() => {
    if (!chartRef.current) return;
    chartInstance.current = echarts.init(
      chartRef.current,
      canvasMode === 'light' ? undefined : 'dark',
      { renderer: 'canvas' }
    );

    const handleResize = () => chartInstance.current?.resize();
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(chartRef.current);

    return () => {
      resizeObserver.disconnect();
      chartInstance.current?.dispose();
      chartInstance.current = null;
    };
  }, [canvasMode]);

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

        chartInstance.current.setOption(parsed, true);
      }
    } catch (e: unknown) {
      if (!isStreaming) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(`Parse error: ${msg}`);
      }
    }
  }, [isStreaming, canvasCode, streamingCode]);

  if (error) {
    return (
      <div className={`w-full h-full flex items-center justify-center p-8 animate-fade-in transition-colors duration-300 ${canvasMode === 'light' ? 'bg-white' : 'bg-slate-950'}`}>
        <div className="text-red-400 text-sm bg-red-950/20 p-4 rounded-xl border border-red-900/30 max-w-md shadow-lg">
          <p className="font-medium mb-1 text-slate-200">Charts 渲染失败</p>
          <pre className="text-xs whitespace-pre-wrap text-red-400">{error}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className={`w-full h-full flex items-center justify-center p-6 animate-fade-in transition-colors duration-300 ${canvasMode === 'light' ? 'bg-white' : 'bg-slate-950'}`}>
      <div ref={chartRef} className="w-full h-full" style={{ background: 'transparent' }} />
    </div>
  );
}
