const CODE_FENCE_RE = /^```(?:mermaid)?\s*|\s*```$/gi;
const FLOWCHART_HEADER_RE = /^(?:flowchart|graph)\s+/i;
const EDGE_PIPE_LABEL_RE = /([-.=ox<>]+\|)([^|\n]+)(\|)/g;
const EDGE_LABEL_IN_LINE_RE = /([-.=ox<>]{2,})\s*\|([^|\n]+)\|\s*/;
const INLINE_EDGE_TARGET_DECL_RE = /(\s+[-.=ox<>]{2,}\s+)([A-Za-z0-9_][A-Za-z0-9_-]*(?:\[[^\n\]]+\]|\([^\n)]+\)|\{[^\n}]+\}):::[A-Za-z0-9_-]+)\s*$/;
const NODE_ID_RE = /^([A-Za-z0-9_][A-Za-z0-9_-]*)/;
const RISKY_EDGE_LABEL_RE = /[()[\]{}（）;]/;

export function stripMermaidCodeFences(content: string): string {
  const unfenced = content
    .trim()
    .replace(/^\uFEFF/, '')
    .replace(CODE_FENCE_RE, '')
    .trim();
  const smartUnwrapped = unfenced.replace(/^[“”"']+/, '').replace(/[“”"']+$/, '').trim();
  return smartUnwrapped || unfenced;
}

function isFlowchart(code: string): boolean {
  for (const line of code.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    return FLOWCHART_HEADER_RE.test(trimmed);
  }
  return false;
}

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

export function normalizeMermaidCode(content: string): string {
  const cleaned = stripMermaidCodeFences(content)
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();

  if (!cleaned || !isFlowchart(cleaned)) {
    return cleaned;
  }

  return cleaned
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
