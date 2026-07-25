// ============================================================
// mermaidSanitizer.ts — Mermaid 代码清洗与修复工具
// 处理 LLM 生成代码中的常见语法问题，提升渲染鲁棒性
// ============================================================

// ---- 正则常量 ----
const CODE_FENCE_RE = /^```(?:mermaid)?\s*|\s*```$/gi;
const FLOWCHART_HEADER_RE = /^(?:flowchart|graph)\s+/i;
const EDGE_PIPE_LABEL_RE = /([-.=ox<>]+\|)([^|\n]+)(\|)/g;
const EDGE_LABEL_IN_LINE_RE = /([-.=ox<>]{2,})\s*\|([^|\n]+)\|\s*/;
const INLINE_EDGE_TARGET_DECL_RE = /(\s+[-.=ox<>]{2,}\s+)([A-Za-z0-9_][A-Za-z0-9_-]*(?:\[[^\n\]]+\]|\([^\n)]+\)|\{[^\n}]+\}):::[A-Za-z0-9_-]+)\s*$/;
const NODE_ID_RE = /^([A-Za-z0-9_][A-Za-z0-9_-]*)/;
const RISKY_EDGE_LABEL_RE = /[()[\]{}（）;]/;

// 块级关键字：打开一个需要 end 关闭的块
const BLOCK_OPEN_RE = /^(opt|alt|loop|par|critical|rect|break|subgraph)(\s|$)/;

// ---- 图表类型检测 ----

function isFlowchart(code: string): boolean {
  for (const line of code.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    return FLOWCHART_HEADER_RE.test(trimmed);
  }
  return false;
}

function isSequenceDiagram(code: string): boolean {
  for (const line of code.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    return trimmed.startsWith('sequenceDiagram');
  }
  return false;
}

/** 检测代码是否包含可能使用块级关键字的图表类型 */
function usesBlockKeywords(code: string): boolean {
  return /\b(sequenceDiagram|flowchart|graph)\b/.test(code);
}

// ---- 基础清洗 ----

/** 移除 Markdown 代码围栏、BOM、智能引号包裹 */
export function stripMermaidCodeFences(content: string): string {
  const unfenced = content
    .trim()
    .replace(/^\uFEFF/, '')
    .replace(CODE_FENCE_RE, '')
    .trim();
  const smartUnwrapped = unfenced.replace(/^[""\"']+/, '').replace(/[""\"']+$/, '').trim();
  return smartUnwrapped || unfenced;
}

// ---- Flowchart 边标签处理 ----

function quoteEdgeLabel(prefix: string, labelValue: string, suffix: string): string {
  const label = labelValue.trim();
  if (label.startsWith('"') && label.endsWith('"')) {
    return `${prefix}${labelValue}${suffix}`;
  }
  if (!RISKY_EDGE_LABEL_RE.test(label)) {
    return `${prefix}${labelValue}${suffix}`;
  }
  return `${prefix}"${label.replace(/"/g, '#quot;')}"${suffix}`;
}

function cleanRelationLabel(labelValue: string): string {
  const label = labelValue.trim();
  const unquoted = label.startsWith('"') && label.endsWith('"') ? label.slice(1, -1) : label;
  return unquoted.replace(/"/g, '#quot;');
}

// ============================================================
// balanceBlocks — 栈式块级平衡算法
// 同时处理：多余的 end / 缺失的 end / 孤立的 else
// ============================================================

export function balanceBlocks(code: string): string {
  if (!usesBlockKeywords(code)) return code;

  const lines = code.split('\n');
  const result: string[] = [];
  const stack: string[] = []; // 追踪打开的块关键字

  for (const line of lines) {
    const trimmed = line.trim();

    // 保留注释行
    if (trimmed.startsWith('%%')) {
      result.push(line);
      continue;
    }

    // 1. 检测块开启关键字
    const openMatch = trimmed.match(BLOCK_OPEN_RE);
    if (openMatch) {
      stack.push(openMatch[1]);
      result.push(line);
      continue;
    }

    // 2. 检测 else — 仅在 alt 块内有效
    if (trimmed === 'else' || trimmed.startsWith('else ')) {
      if (stack.length > 0 && stack[stack.length - 1] === 'alt') {
        result.push(line);
      }
      // 孤立的 else（不在 alt 内）→ 静默丢弃
      continue;
    }

    // 3. 检测 end — 仅在有打开的块时有效
    if (trimmed === 'end') {
      if (stack.length > 0) {
        stack.pop();
        result.push(line);
      }
      // 多余的 end（无对应开启块）→ 静默丢弃
      continue;
    }

    // 4. 普通行，直接保留
    result.push(line);
  }

  // 补全缺失的 end（流式生成时常见）
  while (stack.length > 0) {
    result.push('end');
    stack.pop();
  }

  return result.join('\n');
}

// ============================================================
// sanitizeSequenceDiagram — 序列图专用清洗
// 去重 autonumber / participant / actor，修复常见格式问题
// ============================================================

function sanitizeSequenceDiagram(code: string): string {
  const lines = code.split('\n');
  const result: string[] = [];
  let seenAutonumber = false;
  const declaredParticipants = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();

    // 1. 去重 autonumber
    if (trimmed === 'autonumber') {
      if (seenAutonumber) continue;
      seenAutonumber = true;
    }

    // 2. 去重 participant / actor 声明（按 ID 去重，保留首次）
    const partMatch = trimmed.match(/^(participant|actor)\s+(\S+)/);
    if (partMatch) {
      const key = `${partMatch[1]}:${partMatch[2]}`;
      if (declaredParticipants.has(key)) continue;
      declaredParticipants.add(key);
    }

    result.push(line);
  }

  return result.join('\n');
}

// ============================================================
// universalCleanup — 适用于所有图表类型的通用清洗
// ============================================================

function universalCleanup(code: string): string {
  return code
    // Windows 换行符 → Unix
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // 每行去除尾部空白
    .split('\n')
    .map((line) => {
      let cleaned = line.trimEnd();
      // 去除行尾分号（LLM 常见错误，Mermaid 不需要分号结尾）
      // 但保留 classDef 行中的分号（CSS 语法需要）和 HTML 实体中的分号
      if (
        cleaned.endsWith(';') &&
        !cleaned.trimStart().startsWith('classDef') &&
        !cleaned.trimStart().startsWith('style ')
      ) {
        cleaned = cleaned.slice(0, -1).trimEnd();
      }
      return cleaned;
    })
    .join('\n')
    // 折叠超过 2 行的连续空行为 1 行
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ============================================================
// normalizeMermaidCode — 主入口：通用清洗 + 类型特定修复 + 块平衡
// ============================================================

export function normalizeMermaidCode(content: string): string {
  const stripped = stripMermaidCodeFences(content);
  if (!stripped) return stripped;

  // 通用清洗
  let code = universalCleanup(stripped);

  // 序列图特定修复
  if (isSequenceDiagram(code)) {
    code = sanitizeSequenceDiagram(code);
  }

  // Flowchart 边标签引号修复
  if (isFlowchart(code)) {
    code = code
      .split('\n')
      .map((line) => {
        if (line.trimStart().startsWith('%%')) return line;
        return line.replace(EDGE_PIPE_LABEL_RE, (_match, prefix, labelValue, suffix) =>
          quoteEdgeLabel(String(prefix), String(labelValue), String(suffix)),
        );
      })
      .join('\n')
      .trim();
  }

  // 块级平衡（修复多余/缺失的 end，适用于所有使用块关键字的图表）
  code = balanceBlocks(code);

  return code;
}

// ============================================================
// stabilizeMermaidFlowchartEdgeLabels — Flowchart 边标签稳定化
// 将内联边标签拆分为独立关系节点，避免渲染抖动
// ============================================================

export function stabilizeMermaidFlowchartEdgeLabels(content: string): string {
  const normalized = normalizeMermaidCode(content);
  if (!normalized || !isFlowchart(normalized)) {
    return normalized;
  }

  let relationIndex = 0;
  let changed = false;
  const declaredInlineTargets = new Set<string>();
  const lines = normalized.split('\n');
  const stabilizedLines: string[] = [];

  for (const line of lines) {
    if (line.trimStart().startsWith('%%')) {
      stabilizedLines.push(line);
      continue;
    }
    const indent = line.match(/^\s*/)?.[0] || '';
    const body = line.slice(indent.length);

    const inlineTargetMatch = body.match(INLINE_EDGE_TARGET_DECL_RE);
    if (inlineTargetMatch) {
      const targetDecl = inlineTargetMatch[2];
      const targetId = targetDecl.match(NODE_ID_RE)?.[1];
      if (targetId) {
        if (!declaredInlineTargets.has(targetId)) {
          stabilizedLines.push(`${indent}${targetDecl}`);
          declaredInlineTargets.add(targetId);
        }
        const sourceAndConnector = `${body.slice(0, inlineTargetMatch.index)}${inlineTargetMatch[1]}`;
        stabilizedLines.push(`${indent}${sourceAndConnector}${targetId}`);
        changed = true;
        continue;
      }
    }

    const match = body.match(EDGE_LABEL_IN_LINE_RE);
    if (!match) {
      stabilizedLines.push(line);
      continue;
    }

    const source = body.slice(0, match.index).trimEnd();
    const connector = match[1];
    const labelValue = match[2];
    const target = body.slice((match.index || 0) + match[0].length).trimStart();
    if (!source || !target) {
      stabilizedLines.push(line);
      continue;
    }
    const relationId = `Rel_${relationIndex++}`;
    const relationLabel = cleanRelationLabel(labelValue);
    stabilizedLines.push(`${indent}${relationId}["${relationLabel}"]:::relation`);
    stabilizedLines.push(`${indent}${source} ${connector} ${relationId}`);
    stabilizedLines.push(`${indent}${relationId} ${connector} ${target}`);
    changed = true;
  }

  if (!changed) {
    return normalized;
  }

  const hasRelationClass = stabilizedLines.some((line) => /^\s*classDef\s+relation\b/.test(line));
  if (!hasRelationClass) {
    stabilizedLines.push('classDef relation fill:#eef2ff,stroke:#6366f1,stroke-width:1px,color:#312e81;');
  }
  return stabilizedLines.join('\n').trim();
}
