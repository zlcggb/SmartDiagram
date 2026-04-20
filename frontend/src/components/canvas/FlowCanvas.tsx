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

const EXPORT_PADDING = 80;
const EXPORT_SCALE = 2;

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
  const nodeStyle: React.CSSProperties = {
    ...origStyle,
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
        : '0 1px 3px rgba(0,0,0,0.08)',
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
  const { canvasCode, isStreaming, setCanvasCode } = useChatStore();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [error, setError] = useState<string | null>(null);
  const { getNodes } = useReactFlow();

  // Flag to skip re-parse when we ourselves wrote canvasCode
  const selfSyncRef = useRef(false);

  // Register custom node type
  const nodeTypes = useMemo(() => ({ editableNode: EditableNode }), []);

  // Parse canvasCode → nodes/edges (only from AI generation, not self-sync)
  useEffect(() => {
    if (isStreaming || !canvasCode) return;

    // Skip if this canvasCode change came from our own sync
    if (selfSyncRef.current) {
      selfSyncRef.current = false;
      return;
    }

    setError(null);

    try {
      let code = canvasCode.trim();
      if (code.startsWith('```')) {
        code = code.replace(/^```\w*\n?/, '').replace(/```$/, '').trim();
      }

      const parsed = JSON.parse(code);
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

      if (rawNodes.length === 0) {
        setError('No nodes found in the flow data');
        return;
      }

      setNodes(rawNodes);
      setEdges(rawEdges);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Parse error: ${msg}`);
    }
  }, [isStreaming, canvasCode]);

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
          const svgDataUrl = await toSvg(viewportEl, { backgroundColor: '#ffffff', width: imageWidth, height: imageHeight, style: styleOpts });
          const res = await fetch(svgDataUrl);
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = `Flow_${timestamp}.svg`; a.click();
          URL.revokeObjectURL(url);
        } else {
          const dataUrl = await toPng(viewportEl, { backgroundColor: '#ffffff', width: imageWidth, height: imageHeight, style: styleOpts, pixelRatio: EXPORT_SCALE });
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
      <div className="w-full h-full flex items-center justify-center bg-white p-8">
        <div className="text-red-500 text-sm bg-red-50 p-4 rounded-xl border border-red-200 max-w-md">
          <p className="font-medium mb-1">Flow 渲染失败</p>
          <pre className="text-xs whitespace-pre-wrap text-red-400">{error}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-white">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} color="#e5e7eb" size={1} />
        <Controls />
        <MiniMap
          nodeStrokeWidth={3}
          pannable
          zoomable
          style={{ border: '1px solid #e5e7eb', borderRadius: 8 }}
        />
      </ReactFlow>
    </div>
  );
}
