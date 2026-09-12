export interface PartialSearchResultItem {
  title: string;
  snippet: string;
  url?: string;
  sourceName?: string;
  score?: number;
}

export interface PartialSearchSynthesis {
  summary?: string;
  keyFindings?: Array<{
    statement: string;
    sourceIndexes?: number[];
  }>;
  draftReference?: string;
  caveats?: string[];
}

export interface PartialSlideSearch {
  mode?: "web" | "ai-knowledge" | "mock" | string;
  queries: string[];
  results: PartialSearchResultItem[];
  synthesis: PartialSearchSynthesis | null;
  /** 当前正在流式输出的末尾活跃文本片段 */
  activeStreamTail?: string;
  /** 是否至少成功解析出部分有效内容 */
  hasContent: boolean;
}

/**
 * 尝试修复未闭合的 JSON 字符串（补全未闭合的字符串引号、数组中括号与对象大括号）
 */
function repairIncompleteJson(input: string): string {
  let text = input.trim();
  const firstBrace = text.indexOf("{");
  if (firstBrace === -1) return "{}";
  if (firstBrace > 0) {
    text = text.slice(firstBrace);
  }

  let inString = false;
  let escaped = false;
  const stack: ("{" | "[")[] = [];

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
    } else {
      if (char === '"') {
        inString = true;
      } else if (char === "{") {
        stack.push("{");
      } else if (char === "[") {
        stack.push("[");
      } else if (char === "}") {
        if (stack.length > 0 && stack[stack.length - 1] === "{") {
          stack.pop();
        }
      } else if (char === "]") {
        if (stack.length > 0 && stack[stack.length - 1] === "[") {
          stack.pop();
        }
      }
    }
  }

  let repaired = text;
  if (inString) {
    repaired += '"';
  }

  // 清理末尾因截断遗留的悬挂逗号或冒号
  repaired = repaired.replace(/,\s*$/, "");
  if (/:\s*"?$/.test(repaired)) {
    repaired = repaired.replace(/:\s*"?$/, ': ""');
  }

  // 逆序补齐括号
  while (stack.length > 0) {
    const top = stack.pop();
    if (top === "{") repaired += "}";
    else if (top === "[") repaired += "]";
  }

  return repaired;
}

function cleanMarkdownCodeBlock(raw: string): string {
  let text = raw.trim();
  if (text.startsWith("```json")) {
    text = text.slice(7);
  } else if (text.startsWith("```")) {
    text = text.slice(3);
  }
  if (text.endsWith("```")) {
    text = text.slice(0, -3);
  }
  return text.trim();
}

/**
 * 鲁棒提取半截字符串中的属性值
 */
function extractStringProperty(raw: string, key: string): string | null {
  const closedPattern = new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`, "i");
  const closedMatch = raw.match(closedPattern);
  if (closedMatch && closedMatch[1] != null) {
    try {
      return JSON.parse(`"${closedMatch[1]}"`) as string;
    } catch {
      return closedMatch[1];
    }
  }

  const openPattern = new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)$`, "i");
  const openMatch = raw.match(openPattern);
  if (openMatch && openMatch[1] != null) {
    return openMatch[1];
  }

  return null;
}

/**
 * 从正在生成的流式文本中实时解析出部分检索结构
 */
export function parsePartialSlideSearch(rawText: string): PartialSlideSearch {
  const cleaned = cleanMarkdownCodeBlock(rawText);
  if (!cleaned || cleaned.length < 2) {
    return {
      queries: [],
      results: [],
      synthesis: null,
      hasContent: false
    };
  }

  let parsedObj: Record<string, any> | null = null;
  try {
    const repaired = repairIncompleteJson(cleaned);
    parsedObj = JSON.parse(repaired);
  } catch {
    parsedObj = null;
  }

  // 1. 提取 queries
  const queries: string[] = [];
  if (Array.isArray(parsedObj?.queries)) {
    for (const q of parsedObj.queries) {
      if (typeof q === "string" && q.trim()) {
        queries.push(q.trim());
      }
    }
  }

  // 正则二次保底提取 queries（应对解析未闭合数组时的中间态）
  if (queries.length === 0 && cleaned.includes('"queries"')) {
    const queriesSegmentMatch = cleaned.match(/"queries"\s*:\s*\[([\s\S]*?)(\]|$)/);
    if (queriesSegmentMatch && queriesSegmentMatch[1]) {
      const stringMatches = [...queriesSegmentMatch[1].matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)];
      for (const m of stringMatches) {
        if (m[1]?.trim()) queries.push(m[1].trim());
      }
    }
  }

  // 2. 提取 results 卡片
  const results: PartialSearchResultItem[] = [];
  if (Array.isArray(parsedObj?.results)) {
    for (const item of parsedObj.results) {
      if (item && typeof item === "object") {
        const title = typeof item.title === "string" ? item.title.trim() : "";
        const snippet = typeof item.snippet === "string" ? item.snippet.trim() : "";
        if (title || snippet) {
          results.push({
            title: title || "正在提炼考点依据…",
            snippet,
            url: typeof item.url === "string" ? item.url : undefined,
            sourceName: typeof item.sourceName === "string" ? item.sourceName : undefined,
            score: typeof item.score === "number" ? item.score : undefined
          });
        }
      }
    }
  }

  // 正则二次保底提取当前正在敲出的最新 result 卡片
  if (cleaned.includes('"results"')) {
    const lastItemMatch = cleaned.match(/\{\s*"title"\s*:\s*"([^"]*)"(?:\s*,\s*"snippet"\s*:\s*"([^"]*)")?/);
    if (lastItemMatch && results.length === 0) {
      results.push({
        title: lastItemMatch[1] || "正在提炼考点依据…",
        snippet: lastItemMatch[2] || ""
      });
    }
  }

  // 3. 提取 synthesis
  let synthesis: PartialSearchSynthesis | null = null;
  if (parsedObj?.synthesis && typeof parsedObj.synthesis === "object") {
    const s = parsedObj.synthesis;
    synthesis = {
      summary: typeof s.summary === "string" ? s.summary : undefined,
      keyFindings: Array.isArray(s.keyFindings)
        ? s.keyFindings.map((kf: any) => ({
            statement: typeof kf?.statement === "string" ? kf.statement : String(kf || ""),
            sourceIndexes: Array.isArray(kf?.sourceIndexes) ? kf.sourceIndexes : []
          }))
        : undefined,
      draftReference: typeof s.draftReference === "string" ? s.draftReference : undefined,
      caveats: Array.isArray(s.caveats) ? s.caveats.filter((c: unknown): c is string => typeof c === "string") : []
    };
  } else if (cleaned.includes('"synthesis"')) {
    const summary = extractStringProperty(cleaned, "summary");
    const draftRef = extractStringProperty(cleaned, "draftReference");
    if (summary || draftRef) {
      synthesis = {
        summary: summary ?? undefined,
        draftReference: draftRef ?? undefined
      };
    }
  }

  const activeTail = cleaned.slice(-80).replace(/[\r\n\t]+/g, " ").trim();
  const mode = typeof parsedObj?.mode === "string" ? parsedObj.mode : undefined;

  const hasContent = queries.length > 0 || results.length > 0 || synthesis != null;

  return {
    mode,
    queries,
    results,
    synthesis,
    activeStreamTail: activeTail,
    hasContent
  };
}
