const TEXT_OPEN_TAG_RE = /<text\b([^>]*)>/gi;

function referencedTextIndexes(issues: string[]) {
  const indexes = new Set<number>();
  for (const issue of issues) {
    for (const match of issue.matchAll(/第\s*(\d+)\s*个\s*text/gu)) {
      const index = Number(match[1]);
      if (Number.isInteger(index) && index > 0) indexes.add(index);
    }
  }
  return indexes;
}

export function highlightRejectedSvg(svg: string, issues: string[]) {
  const highlighted = referencedTextIndexes(issues);
  let index = 0;
  return svg.replace(TEXT_OPEN_TAG_RE, (full, attrs: string) => {
    index += 1;
    if (!highlighted.has(index) || /\bdata-quality-issue=/iu.test(attrs)) {
      return full;
    }
    return `<text${attrs} data-quality-issue="true">`;
  });
}
