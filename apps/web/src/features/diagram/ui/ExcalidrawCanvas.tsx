/**
 * ExcalidrawCanvas — renders Excalidraw as the core diagram canvas.
 * LLM generates complete ExcalidrawElement[] JSON with styling, binding, and layout.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useChatStore } from '@/features/diagram/model/chatStore';

// Import Excalidraw's CSS — required for toolbar icons, UI panels, shortcuts
import '@excalidraw/excalidraw/index.css';

// Lazy imports for Excalidraw (large bundle)
let ExcalidrawComponent: any = null;
let exportToBlobFn: any = null;

async function loadExcalidraw() {
  if (!ExcalidrawComponent) {
    const mod = await import('@excalidraw/excalidraw');
    ExcalidrawComponent = mod.Excalidraw;
    exportToBlobFn = mod.exportToBlob;
  }
  return { Excalidraw: ExcalidrawComponent, exportToBlob: exportToBlobFn };
}

/**
 * Ensure each element has ALL required Excalidraw properties.
 *
 * Excalidraw internally calls `isTransparent(el.strokeColor)` and
 * `isTransparent(el.backgroundColor)` which does `.length` on the value.
 * If any color is undefined → crash.
 *
 * Every element MUST have at minimum:
 *   strokeColor, backgroundColor, fillStyle, strokeWidth, roughness,
 *   opacity, angle, groupIds, width, height, x, y
 *
 * Text elements additionally need:
 *   fontSize, fontFamily, textAlign, verticalAlign, lineHeight,
 *   originalText, containerId, baseline
 */
function normalizeElement(el: any, idx: number): any {
  const id = el.id || `el_${idx}`;
  const type = el.type || 'rectangle';

  // Universal defaults — EVERY element must have these
  const base: Record<string, any> = {
    id,
    type,
    x: el.x ?? 0,
    y: el.y ?? 0,
    width: el.width ?? 100,
    height: el.height ?? 50,
    strokeColor: el.strokeColor ?? '#1e1e1e',
    backgroundColor: el.backgroundColor ?? 'transparent',
    fillStyle: el.fillStyle ?? 'solid',
    strokeWidth: el.strokeWidth ?? 2,
    roughness: el.roughness ?? 0,
    opacity: el.opacity ?? 100,
    angle: el.angle ?? 0,
    groupIds: el.groupIds ?? [],
    boundElements: el.boundElements ?? null,
    updated: Date.now(),
    version: 1,
    versionNonce: Math.floor(Math.random() * 1000000),
    seed: Math.floor(Math.random() * 1000000),
    isDeleted: false,
    locked: false,
    link: el.link ?? null,
    frameId: el.frameId ?? null,
  };

  if (type === 'text') {
    const text = el.text || '';
    // Estimate width/height from text content if not provided
    const fontSize = el.fontSize ?? 20;
    const lines = text.split('\n');
    const estimatedWidth = el.width ?? Math.max(10, Math.max(...lines.map((l: string) => l.length)) * fontSize * 0.6);
    const estimatedHeight = el.height ?? Math.max(fontSize, lines.length * fontSize * 1.35);

    return {
      ...base,
      width: estimatedWidth,
      height: estimatedHeight,
      text,
      originalText: el.originalText ?? text,
      fontSize,
      fontFamily: el.fontFamily ?? 1,           // 1=Virgil (hand-drawn)
      textAlign: el.textAlign ?? 'center',
      verticalAlign: el.verticalAlign ?? 'middle',
      baseline: el.baseline ?? Math.floor(fontSize * 0.9),
      lineHeight: el.lineHeight ?? 1.25,
      containerId: el.containerId ?? null,
      autoResize: el.autoResize ?? true,
      // Text elements should not have hachure fill
      fillStyle: 'solid',
      backgroundColor: 'transparent',
    };
  }

  if (type === 'arrow' || type === 'line') {
    return {
      ...base,
      points: el.points ?? [[0, 0], [base.width, 0]],
      lastCommittedPoint: el.lastCommittedPoint ?? null,
      startBinding: el.startBinding ?? null,
      endBinding: el.endBinding ?? null,
      startArrowhead: el.startArrowhead ?? null,
      endArrowhead: el.endArrowhead ?? (type === 'arrow' ? 'arrow' : null),
      // Curved arrows look much better than straight lines
      roundness: el.roundness ?? { type: 2 },
      // Arrows don't typically have background fill
      fillStyle: 'solid',
      backgroundColor: 'transparent',
    };
  }

  // Shape elements: rectangle, ellipse, diamond, freedraw, image, etc.
  return {
    ...base,
    // Rounded corners by default
    roundness: el.roundness ?? { type: 3 },
    // Spread user-provided values to override defaults
    ...el,
    // But always ensure critical color fields are strings, not undefined
    id,
    strokeColor: el.strokeColor ?? base.strokeColor,
    backgroundColor: el.backgroundColor ?? base.backgroundColor,
    fillStyle: el.fillStyle ?? base.fillStyle,
  };
}

/**
 * Attempt to recover valid elements from truncated/malformed JSON.
 * Uses brace-counting to extract complete {...} objects even if the
 * overall array is truncated (missing trailing ] or has partial object at end).
 */
function attemptJSONRecovery(raw: string): any[] | null {
  // If it starts with [, try to extract complete objects from it
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return null;

  const objects: any[] = [];
  let braceDepth = 0;
  let inString = false;
  let escapeNext = false;
  let objStart = -1;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];

    if (escapeNext) { escapeNext = false; continue; }
    if (ch === '\\' && inString) { escapeNext = true; continue; }
    if (ch === '"' && !escapeNext) { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{') {
      if (braceDepth === 0) objStart = i;
      braceDepth++;
    } else if (ch === '}') {
      braceDepth--;
      if (braceDepth === 0 && objStart >= 0) {
        const objStr = trimmed.slice(objStart, i + 1);
        try {
          objects.push(JSON.parse(objStr));
        } catch { /* skip malformed */ }
        objStart = -1;
      }
    }
  }

  return objects.length > 0 ? objects : null;
}

export default function ExcalidrawCanvas() {
  const { canvasCode, isStreaming, setExcalidrawAPI, pendingElements } = useChatStore();
  const [excalidrawAPI, setLocalAPI] = useState<any>(null);
  const [readyAPI, setReadyAPI] = useState<any>(null);
  const [ExcalidrawMod, setExcalidrawMod] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Track how many elements we've rendered so far (to detect new ones)
  const renderedCountRef = useRef(0);
  // Track all normalized elements currently on canvas
  const sceneElementsRef = useRef<any[]>([]);
  // Whether we've done initial scroll for this generation
  const hasScrolledRef = useRef(false);

  // Register excalidraw API to store for toolbar export access
  // Use requestAnimationFrame to ensure Excalidraw is fully initialized
  // before we consider the API "ready" for updateScene calls.
  const handleAPIReady = useCallback((api: any) => {
    setLocalAPI(api);
    setExcalidrawAPI(api);
    // Delay setting readyAPI to next animation frame so Excalidraw's
    // internal scene manager is fully initialized
    requestAnimationFrame(() => {
      setReadyAPI(api);
    });
  }, [setExcalidrawAPI]);

  // Load Excalidraw component asynchronously
  useEffect(() => {
    loadExcalidraw().then((mod) => {
      setExcalidrawMod(mod);
      setLoading(false);
    });
  }, []);

  // REAL-TIME RENDERING: watch pendingElements and add each one immediately
  useEffect(() => {
    if (!excalidrawAPI) return;

    const newCount = pendingElements.length;
    const prevCount = renderedCountRef.current;

    if (newCount === 0 && prevCount > 0) {
      // Reset — new generation starting
      sceneElementsRef.current = [];
      renderedCountRef.current = 0;
      hasScrolledRef.current = false;
      excalidrawAPI.updateScene({ elements: [] });
      return;
    }

    if (newCount > prevCount) {
      // New elements arrived! Normalize and add them
      const newElements = pendingElements.slice(prevCount);
      for (let i = 0; i < newElements.length; i++) {
        const normalized = normalizeElement(newElements[i], prevCount + i);
        sceneElementsRef.current.push(normalized);
      }

      // Update the scene with all elements so far
      excalidrawAPI.updateScene({ elements: [...sceneElementsRef.current] });
      renderedCountRef.current = newCount;

      // Scroll to content on first few elements
      if (!hasScrolledRef.current && sceneElementsRef.current.length >= 2) {
        hasScrolledRef.current = true;
        setTimeout(() => {
          excalidrawAPI.scrollToContent(sceneElementsRef.current, {
            fitToContent: true,
            viewportZoomFactor: 0.85,
          });
        }, 50);
      }
    }
  }, [pendingElements, excalidrawAPI]);

  // Re-scroll when streaming ends (final fit to all elements)
  useEffect(() => {
    if (!isStreaming && excalidrawAPI && sceneElementsRef.current.length > 0) {
      setTimeout(() => {
        excalidrawAPI.scrollToContent(sceneElementsRef.current, {
          fitToContent: true,
          viewportZoomFactor: 0.9,
        });
      }, 200);
    }
  }, [isStreaming, excalidrawAPI]);

  // Render canvasCode: parse ExcalidrawElement[] JSON
  // Uses readyAPI (not excalidrawAPI) to ensure Excalidraw is fully initialized
  useEffect(() => {
    if (!isStreaming && readyAPI && canvasCode && pendingElements.length === 0) {
      const trimmed = canvasCode.trim();
      try {
        let elements: any[];

        let parsed: any = null;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          console.warn('[ExcalidrawCanvas] Direct JSON.parse failed, attempting recovery...');
          parsed = attemptJSONRecovery(trimmed);
        }

        if (parsed === null) return;

        if (Array.isArray(parsed)) {
          elements = parsed;
        } else if (typeof parsed === 'object') {
          elements = parsed.elements || parsed.code || [];
          if (!Array.isArray(elements)) elements = [];
        } else {
          return;
        }

        if (Array.isArray(elements) && elements.length > 0) {
          const processed = elements.map((el, idx) => normalizeElement(el, idx));
          sceneElementsRef.current = processed;
          // Use setTimeout to ensure Excalidraw's scene is fully ready
          setTimeout(() => {
            readyAPI.updateScene({ elements: processed });
            setTimeout(() => {
              readyAPI.scrollToContent(processed, {
                fitToContent: true,
                viewportZoomFactor: 0.9,
              });
            }, 100);
          }, 50);
        }
      } catch (e) {
        console.error('[ExcalidrawCanvas] Failed to parse Excalidraw elements:', e);
      }
    }
  }, [isStreaming, canvasCode, readyAPI, pendingElements.length]);

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-50">
        <div className="text-gray-400 flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <span>加载画布引擎...</span>
        </div>
      </div>
    );
  }

  const { Excalidraw } = ExcalidrawMod;

  return (
    <div className="w-full h-full">
      <div className="excalidraw-wrapper">
        <Excalidraw
          excalidrawAPI={handleAPIReady}
          initialData={{
            appState: {
              theme: 'light',
              viewBackgroundColor: '#ffffff',
            },
          }}
        />
      </div>
    </div>
  );
}
