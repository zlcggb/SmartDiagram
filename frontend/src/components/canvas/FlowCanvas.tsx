/**
 * FlowCanvas — renders React Flow diagrams from JSON { nodes, edges }.
 *
 * Features:
 *  - Double-click a node to edit its label inline
 *  - Drag nodes to reposition
 *  - Export as PNG/SVG via 'flow-export' CustomEvent
 */

import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import ReactFlow, {
  Background, Controls, MiniMap,
  useNodesState, useEdgesState, MarkerType,
  useReactFlow, getNodesBounds, getViewportForBounds,
  Handle, Position,
} from 'reactflow';
import type { Node, Edge, NodeProps } from 'reactflow';
import 'reactflow/dist/style.css';
import { useChatStore } from '../../store/chatStore';
import dagre from 'dagre';

const EXPORT_PADDING = 80;
const EXPORT_SCALE = 2;

// ─── Streaming JSON Parser for Progressive Render ───

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
    // ignore and fallback
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

// ─── Dagre Automatic Layout Engine ───

function getLayoutedElements(nodes: Node[], edges: Edge[], direction = 'TB') {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  
  // TB: 从上到下; LR: 从左到右
  // 使用 longest-path ranker 算法确保流程主链对称在中心轴上，压缩循环链路带来的偏移
  dagreGraph.setGraph({ rankdir: direction, nodesep: 80, ranksep: 90, ranker: 'longest-path' });

  nodes.forEach((node) => {
    const label = node.data?.label || '';
    const width = Math.max(180, Math.min(320, label.length * 9 + 40));
    const height = Math.max(70, Math.min(160, Math.ceil(label.length / 15) * 22 + 30));
    dagreGraph.setNode(node.id, { width, height });
  });

  edges.forEach((edge) => {
    // 过滤自环边（source 等于 target），防止 Dagre 将其作为拓扑路径参与 rank 计算而歪斜节点
    if (edge.source !== edge.target) {
      dagreGraph.setEdge(edge.source, edge.target);
    }
  });

  dagre.layout(dagreGraph);

  return nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    if (!nodeWithPosition) return node;
    const label = node.data?.label || '';
    const width = Math.max(180, Math.min(320, label.length * 9 + 40));
    const height = Math.max(70, Math.min(160, Math.ceil(label.length / 15) * 22 + 30));
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - width / 2,
        y: nodeWithPosition.y - height / 2,
      },
    };
  });
}

// ─── Contrast Color Helper ───

function getContrastColor(hexColor: string): string {
  if (!hexColor) return '#f1f5f9';
  const hex = hexColor.replace('#', '').trim();
  if (hex.length !== 3 && hex.length !== 6) return '#f1f5f9';
  let r = 0, g = 0, b = 0;
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else {
    r = parseInt(hex.substring(0, 2), 16);
    g = parseInt(hex.substring(2, 4), 16);
    b = parseInt(hex.substring(4, 6), 16);
  }
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? '#0f172a' : '#f8fafc';
}

// ─── Editable Node Component ───

function EditableNode({ id, data, selected }: NodeProps) {
  const [editing, setEditing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const nodeRef = useRef<HTMLDivElement>(null);

  const commitEdit = useCallback(() => {
    if (!editing) return;
    setEditing(false);
    const newText = contentRef.current?.innerText?.trim() || '';
    if (newText && newText !== data.label) {
      window.dispatchEvent(new CustomEvent('flow-node-edit', {
        detail: { nodeId: id, newLabel: newText },
      }));
    } else if (contentRef.current) {
      // Revert if empty or unchanged
      contentRef.current.innerText = data.label || '';
    }
  }, [editing, id, data.label]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setEditing(false);
      if (contentRef.current) contentRef.current.innerText = data.label || '';
    }
  }, [data.label]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(true);
  }, []);

  // When entering edit mode, make contentEditable and place cursor at click position
  useEffect(() => {
    if (editing && contentRef.current) {
      contentRef.current.contentEditable = 'true';
      contentRef.current.focus();
      // Don't select all — let the cursor land where the user double-clicked
    } else if (!editing && contentRef.current) {
      contentRef.current.contentEditable = 'false';
    }
  }, [editing]);

  // Sync text from outside data changes
  useEffect(() => {
    if (!editing && contentRef.current) {
      contentRef.current.innerText = data.label || '';
    }
  }, [data.label, editing]);

  const origStyle = data._style || {};
  const resolvedBg = origStyle.background || '#0f172a';
  const autoContrastColor = getContrastColor(resolvedBg);

  // 过滤掉任何可能导致节点倾斜的 transform 或 rotate 属性，确保文字永远端正可读
  const cleanedStyle = { ...origStyle };
  delete cleanedStyle.transform;
  delete cleanedStyle.rotate;

  const nodeStyle: React.CSSProperties = {
    background: resolvedBg,
    border: origStyle.border ?? '1px solid #1e293b',
    ...cleanedStyle,
    color: origStyle.color ?? autoContrastColor,
    minWidth: origStyle.minWidth ?? 120,
    padding: origStyle.padding ?? '10px 16px',
    borderRadius: origStyle.borderRadius ?? 10,
    fontSize: origStyle.fontSize ?? 13,
    lineHeight: '1.5',
    cursor: editing ? 'text' : 'grab',
    boxShadow: selected
      ? '0 0 0 2px #3b82f6'
      : editing
        ? '0 0 0 2px #3b82f6, 0 2px 8px rgba(59,130,246,0.15)'
        : '0 1px 3px rgba(0,0,0,0.3)',
    transition: 'box-shadow 0.15s',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    maxWidth: origStyle.maxWidth ?? 360,
    textAlign: (origStyle.textAlign as any) ?? 'left',
  };

  return (
    <div
      ref={nodeRef}
      style={nodeStyle}
      onDoubleClick={handleDoubleClick}
      title="双击编辑文字"
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div
        ref={contentRef}
        className={editing ? 'nodrag nowheel' : ''}
        onBlur={commitEdit}
        onKeyDown={editing ? handleKeyDown : undefined}
        onMouseDown={editing ? (e) => e.stopPropagation() : undefined}
        onClick={editing ? (e) => e.stopPropagation() : undefined}
        style={{
          outline: 'none',
          minHeight: '1em',
          cursor: editing ? 'text' : 'inherit',
        }}
        suppressContentEditableWarning
      />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

// ─── Main Component ───

export default function FlowCanvas() {
  const { canvasCode, streamingCode, isStreaming, setCanvasCode, setSelectedNode, canvasMode } = useChatStore();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [error, setError] = useState<string | null>(null);
  const { getNodes, fitView } = useReactFlow();

  // ─── 自动跟踪并平滑缩放视图，确保流式长出的节点永远居中可见 ───
  useEffect(() => {
    if (nodes.length > 0) {
      if (isStreaming) {
        fitView({ duration: 200, padding: 0.2 });
      } else {
        fitView({ duration: 300, padding: 0.25 });
      }
    }
  }, [nodes.length, isStreaming, fitView]);

  // Cleanup selected node on unmount
  useEffect(() => {
    return () => {
      setSelectedNode(null);
    };
  }, [setSelectedNode]);

  // Flag to skip re-parse when we ourselves wrote canvasCode
  const selfSyncRef = useRef(false);

  // Register custom node type
  const nodeTypes = useMemo(() => ({ editableNode: EditableNode }), []);

  // Parse canvasCode/streamingCode → nodes/edges
  useEffect(() => {
    const activeCode = (isStreaming && streamingCode) ? streamingCode : canvasCode;
    if (!activeCode) return;

    // Skip if this canvasCode change came from our own sync
    if (selfSyncRef.current) {
      selfSyncRef.current = false;
      return;
    }

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

      if (!parsed) return;

      const rawNodes: Node[] = (parsed.nodes || []).map((n: any) => ({
        ...n,
        type: 'editableNode',
        data: { ...n.data, _style: n.style || {} },
        style: undefined,
      }));
      const rawEdges: Edge[] = (parsed.edges || []).map((e: any) => ({
        ...e,
        markerEnd: e.markerEnd || { type: MarkerType.ArrowClosed },
      }));

      // Only set error if not streaming (streaming errors are transient)
      if (rawNodes.length === 0 && !isStreaming) {
        setError('No nodes found in the flow data');
        return;
      }

      // 用 dagre 对图表做论文级的纵向自动排版，避免大模型杂乱无序的坐标
      let layoutedNodes = rawNodes;
      if (rawNodes.length > 0) {
        layoutedNodes = getLayoutedElements(rawNodes, rawEdges, 'TB');
      }

      setError(null);
      setNodes(layoutedNodes);
      setEdges(rawEdges);
    } catch (e: unknown) {
      if (!isStreaming) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(`Parse error: ${msg}`);
      }
    }
  }, [isStreaming, canvasCode, streamingCode]);

  // Build a full snapshot from current ReactFlow state (live positions + labels)
  const buildSnapshot = useCallback(() => {
    try {
      let code = (canvasCode || '').trim();
      if (code.startsWith('```')) {
        code = code.replace(/^```\w*\n?/, '').replace(/```$/, '').trim();
      }
      const parsed = JSON.parse(code);

      // Use current nodes from ReactFlow for position + data
      const currentNodes = getNodes();
      const nodeMap = new Map(currentNodes.map((n) => [n.id, n]));

      const snapshotNodes = (parsed.nodes || []).map((origNode: any) => {
        const live = nodeMap.get(origNode.id);
        if (live) {
          return {
            ...origNode,
            position: live.position,
            data: { ...origNode.data, label: live.data?.label ?? origNode.data?.label },
          };
        }
        return origNode;
      });

      return { ...parsed, nodes: snapshotNodes };
    } catch {
      return null;
    }
  }, [canvasCode, getNodes]);

  // Handle node label edit events from EditableNode
  useEffect(() => {
    const handleNodeEdit = (e: Event) => {
      const { nodeId, newLabel } = (e as CustomEvent).detail;
      // Update ReactFlow state in-place (no re-render from canvasCode)
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, label: newLabel } }
            : n
        )
      );
      // Sync snapshot (with live positions) back to canvasCode
      requestAnimationFrame(() => {
        const snapshot = buildSnapshot();
        if (snapshot) {
          // Also apply the just-edited label in case getNodes hasn't updated yet
          snapshot.nodes = snapshot.nodes.map((n: any) =>
            n.id === nodeId ? { ...n, data: { ...n.data, label: newLabel } } : n
          );
          selfSyncRef.current = true;
          setCanvasCode(JSON.stringify(snapshot, null, 2));
        }
      });
    };

    window.addEventListener('flow-node-edit', handleNodeEdit);
    return () => window.removeEventListener('flow-node-edit', handleNodeEdit);
  }, [setNodes, buildSnapshot, setCanvasCode]);

  // Listen for export event
  useEffect(() => {
    const handleExport = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const format = detail?.format || 'png';

      try {
        const { toPng, toSvg } = await import('html-to-image');
        const currentNodes = getNodes();
        if (currentNodes.length === 0) { alert('没有可导出的节点'); return; }

        const nodesBounds = getNodesBounds(currentNodes);
        const imageWidth = Math.max(nodesBounds.width + EXPORT_PADDING * 2, 800);
        const imageHeight = Math.max(nodesBounds.height + EXPORT_PADDING * 2, 600);
        const viewport = getViewportForBounds(nodesBounds, imageWidth, imageHeight, 0.5, 2, 0.1);
        const viewportEl = document.querySelector('.react-flow__viewport') as HTMLElement;
        if (!viewportEl) { alert('找不到 ReactFlow 视口'); return; }

        const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
        const styleOpts = {
          width: `${imageWidth}px`,
          height: `${imageHeight}px`,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        };

        if (format === 'svg') {
          const svgDataUrl = await toSvg(viewportEl, { backgroundColor: '#090d16', width: imageWidth, height: imageHeight, style: styleOpts });
          const res = await fetch(svgDataUrl);
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = `Flow_${timestamp}.svg`; a.click();
          URL.revokeObjectURL(url);
        } else {
          const dataUrl = await toPng(viewportEl, { backgroundColor: '#090d16', width: imageWidth, height: imageHeight, style: styleOpts, pixelRatio: EXPORT_SCALE });
          const a = document.createElement('a'); a.href = dataUrl; a.download = `Flow_${timestamp}.png`; a.click();
        }
      } catch (err) {
        console.error('[FlowCanvas] Export failed:', err);
        alert(`Flow 导出失败: ${(err as Error).message}`);
      }
    };

    window.addEventListener('flow-export', handleExport);
    return () => window.removeEventListener('flow-export', handleExport);
  }, [getNodes]);

  if (error) {
    return (
      <div className={`w-full h-full flex items-center justify-center p-8 transition-colors duration-300 ${canvasMode === 'light' ? 'bg-slate-50' : 'bg-slate-950'}`}>
        <div className={`text-sm p-4 rounded-xl border max-w-md shadow-lg ${
          canvasMode === 'light'
            ? 'text-red-600 bg-red-50 border-red-200'
            : 'text-red-400 bg-red-950/20 border-red-900/30'
        }`}>
          <p className={`font-semibold mb-1 ${canvasMode === 'light' ? 'text-red-700' : 'text-slate-200'}`}>Flow 渲染失败</p>
          <pre className="text-xs whitespace-pre-wrap">{error}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className={`w-full h-full transition-colors duration-300 ${canvasMode === 'light' ? 'bg-slate-50' : 'bg-slate-950'}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_event, node) => {
          if (node && node.data && node.data.label) {
            setSelectedNode({
              id: node.id,
              text: node.data.label,
              type: 'flow',
            });
          }
        }}
        onPaneClick={() => {
          setSelectedNode(null);
        }}
      >
        <Background gap={20} color={canvasMode === 'light' ? '#cbd5e1' : '#1e293b'} size={1} />
        <Controls
          style={{
            background: canvasMode === 'light' ? '#f8fafc' : '#0f172a',
            border: canvasMode === 'light' ? '1px solid #cbd5e1' : '1px solid #1e293b',
            color: canvasMode === 'light' ? '#334155' : '#f1f5f9',
          }}
        />
        <MiniMap
          nodeStrokeWidth={3}
          pannable
          zoomable
          style={{
            border: canvasMode === 'light' ? '1px solid #cbd5e1' : '1px solid #1e293b',
            borderRadius: 8,
            background: canvasMode === 'light' ? '#f8fafc' : '#0b0f19',
            transition: 'all 0.3s ease',
          }}
          nodeColor={canvasMode === 'light' ? '#3b82f6' : '#60a5fa'}
          maskColor={canvasMode === 'light' ? 'rgba(241, 245, 249, 0.6)' : 'rgba(15, 23, 42, 0.6)'}
        />
      </ReactFlow>
    </div>
  );
}
