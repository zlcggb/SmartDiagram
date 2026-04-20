/**
 * ChartsCanvas — renders ECharts visualizations from option JSON.
 */

import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { useChatStore } from '../../store/chatStore';

export default function ChartsCanvas() {
  const { canvasCode, isStreaming } = useChatStore();
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize/resize chart
  useEffect(() => {
    if (!chartRef.current) return;
    chartInstance.current = echarts.init(chartRef.current, undefined, { renderer: 'canvas' });

    const handleResize = () => chartInstance.current?.resize();
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(chartRef.current);

    return () => {
      resizeObserver.disconnect();
      chartInstance.current?.dispose();
      chartInstance.current = null;
    };
  }, []);

  // Update chart data
  useEffect(() => {
    if (isStreaming || !canvasCode || !chartInstance.current) return;
    setError(null);

    try {
      let code = canvasCode.trim();
      // Remove markdown fences
      if (code.startsWith('```')) {
        code = code.replace(/^```\w*\n?/, '').replace(/```$/, '').trim();
      }

      const option = JSON.parse(code);
      chartInstance.current.setOption(option, true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Parse error: ${msg}`);
    }
  }, [isStreaming, canvasCode]);

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-white p-8">
        <div className="text-red-500 text-sm bg-red-50 p-4 rounded-xl border border-red-200 max-w-md">
          <p className="font-medium mb-1">Charts 渲染失败</p>
          <pre className="text-xs whitespace-pre-wrap text-red-400">{error}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-white flex items-center justify-center p-6">
      <div ref={chartRef} className="w-full h-full" />
    </div>
  );
}
