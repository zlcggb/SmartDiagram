/**
 * 复用 SmartDiagram 原生 MindmapCanvas (apps/web/src/features/diagram/ui/MindmapCanvas.tsx)
 * 的核心转换、HTML 实体解码与二阶自适应居中算法。
 */

export interface BranchColor {
  main: string;
  light: string;
  border: string;
}

export const BRANCH_PALETTE: BranchColor[] = [
  { main: '#6366f1', light: '#eef2ff', border: '#c7d2fe' },
  { main: '#0891b2', light: '#ecfeff', border: '#a5f3fc' },
  { main: '#059669', light: '#ecfdf5', border: '#a7f3d0' },
  { main: '#d97706', light: '#fffbeb', border: '#fde68a' },
  { main: '#e11d48', light: '#fff1f2', border: '#fecdd3' },
  { main: '#7c3aed', light: '#f5f3ff', border: '#ddd6fe' },
  { main: '#2563eb', light: '#eff6ff', border: '#bfdbfe' },
  { main: '#db2777', light: '#fdf2f8', border: '#fbcfe8' },
];

/**
 * 使用浏览器原生 DOMParser 彻底剥离 markmap-lib 生成的 HTML 标签并解码所有 &#x....; 实体
 * （与 SmartDiagram 原生 MindmapCanvas.tsx 完全一致）
 */
export function stripHtml(html = ''): string {
  if (!html) return '';
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.documentElement.textContent || '').trim();
  }
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export function normalizeMindmapMarkdown(raw = ''): string {
  let text = String(raw || '').trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```\w*\n?/, '');
    if (text.endsWith('```')) {
      text = text.slice(0, -3).trim();
    } else {
      text = text.trim();
    }
  }
  if (text.includes('\\n') && !text.includes('\n')) {
    text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  }
  if (!text) return '';

  const lines = text.split(/\r?\n/);
  const hasAtxHeading = lines.some((l) => /^\s*#{1,6}\s+\S/.test(l));
  if (hasAtxHeading) return text;

  const out: string[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = line.match(/^(\s*)(?:[-*+]|\d+\.)\s+(.*)$/);
    if (m) {
      const indent = m[1].replace(/\t/g, '  ').length;
      const depth = Math.min(6, Math.floor(indent / 2) + 1);
      out.push(`${'#'.repeat(depth)} ${m[2].trim()}`);
    } else if (out.length === 0) {
      out.push(`# ${line.trim()}`);
    } else {
      out.push(`## ${line.trim()}`);
    }
  }
  return out.join('\n');
}

/**
 * 将 markmap 树节点转换为 MindElixir 节点树（完全对齐 SmartDiagram 原生 MindmapCanvas.tsx）
 */
export function convertToMindElixir(node: any, pathId = 'root'): any {
  return {
    topic: stripHtml(node.content || '') || '主题',
    id: pathId,
    children:
      node.children?.map((c: any, index: number) =>
        convertToMindElixir(c, `${pathId}-${index}`),
      ) || [],
  };
}

/**
 * 将 MindElixir 节点树反向同步为 Markdown
 */
export function convertToMarkdown(node: any, level = 1): string {
  let md = '';
  if (level === 1) {
    md += `# ${node.topic}\n`;
  } else if (level === 2) {
    md += `## ${node.topic}\n`;
  } else if (level === 3) {
    md += `### ${node.topic}\n`;
  } else {
    md += `${'  '.repeat(level - 3)}- ${node.topic}\n`;
  }
  if (node.children) {
    node.children.forEach((child: any) => {
      md += convertToMarkdown(child, level + 1);
    });
  }
  return md;
}

/**
 * SmartDiagram 原生二阶自适应缩放与居中算法（防 NaN 强化版）
 */
export function fitWithPadding(me: any) {
  if (!me || !me.container) return;

  const container = me.container as HTMLElement;
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;
  if (!containerWidth || !containerHeight || containerWidth <= 0 || containerHeight <= 0) {
    return;
  }

  const mapContainer = container.querySelector('.map-container') as HTMLElement;
  if (!mapContainer) {
    return;
  }

  // First pass: reset to safe finite scale=1 and center so node rects can be measured accurately without NaN
  if (!Number.isFinite(me.scaleVal) || me.scaleVal <= 0) {
    me.scaleVal = 1;
  }
  try {
    me.scale(1);
    me.toCenter();
  } catch {
    // ignore
  }

  // Second pass: measure actual topic positions and compute exact fit scale + center offset
  requestAnimationFrame(() => {
    const topics = mapContainer.querySelectorAll('.topic, me-tpc');
    if (!topics.length) return;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw <= 0 || ch <= 0) return;

    const containerRect = container.getBoundingClientRect();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    topics.forEach((topic) => {
      const rect = topic.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      const left = rect.left - containerRect.left;
      const top = rect.top - containerRect.top;
      if (Number.isFinite(left) && Number.isFinite(top)) {
        minX = Math.min(minX, left);
        maxX = Math.max(maxX, left + rect.width);
        minY = Math.min(minY, top);
        maxY = Math.max(maxY, top + rect.height);
      }
    });

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
      return;
    }

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    if (contentWidth <= 0 || contentHeight <= 0) return;

    const currentScale = Number.isFinite(me.scaleVal) && me.scaleVal > 0 ? me.scaleVal : 1;
    const isMobile = cw < 640;
    const paddingRatio = isMobile ? 0.88 : 0.8;
    const requiredScaleX = (cw * paddingRatio) / contentWidth;
    const requiredScaleY = (ch * paddingRatio) / contentHeight;
    const rawScale = Math.min(requiredScaleX, requiredScaleY, 1.05) * currentScale;
    const newScale = Number.isFinite(rawScale) ? Math.max(0.2, Math.min(1.15, rawScale)) : 1;

    try {
      me.scale(newScale);
    } catch {
      // ignore
    }

    requestAnimationFrame(() => {
      const newContainerRect = container.getBoundingClientRect();
      let nMinX = Infinity;
      let nMaxX = -Infinity;
      let nMinY = Infinity;
      let nMaxY = -Infinity;

      topics.forEach((topic) => {
        const rect = topic.getBoundingClientRect();
        if (!rect.width && !rect.height) return;
        const left = rect.left - newContainerRect.left;
        const top = rect.top - newContainerRect.top;
        if (Number.isFinite(left) && Number.isFinite(top)) {
          nMinX = Math.min(nMinX, left);
          nMaxX = Math.max(nMaxX, left + rect.width);
          nMinY = Math.min(nMinY, top);
          nMaxY = Math.max(nMaxY, top + rect.height);
        }
      });

      if (!Number.isFinite(nMinX) || !Number.isFinite(nMinY)) return;

      const contentCenterX = (nMinX + nMaxX) / 2;
      const contentCenterY = (nMinY + nMaxY) / 2;
      const dx = cw / 2 - contentCenterX;
      const dy = ch / 2 - contentCenterY;

      if (Number.isFinite(dx) && Number.isFinite(dy) && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        try {
          me.move(dx, dy);
        } catch {
          // ignore
        }
      }
    });
  });
}
