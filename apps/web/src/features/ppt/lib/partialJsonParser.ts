export interface PartialContentBlock {
  title: string;
  type?: string;
  items: string[];
}

export interface PartialDesignGuide {
  composition?: string;
  background?: string;
  keyMessage?: string;
}

export interface PartialSlidePlan {
  title: string | null;
  pageGoal: string | null;
  keyMessage: string | null;
  layoutType: string | null;
  contentBlocks: PartialContentBlock[];
  designGuide: PartialDesignGuide | null;
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
  // 移除开头的非 JSON 字符
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

  // 清理末尾因截断遗留的悬挂符号，如逗号或冒号
  repaired = repaired.replace(/,\s*$/, "");
  if (/:\s*"?$/.test(repaired)) {
    repaired = repaired.replace(/:\s*"?$/, ': ""');
  }

  // 逆序闭合括号
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
 * 鲁棒提取半截字符串中的属性值（如未闭合的 "title": "xxx）
 */
function extractStringProperty(raw: string, key: string): string | null {
  // 匹配闭合字符串: "key": "value"
  const closedPattern = new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`, "i");
  const closedMatch = raw.match(closedPattern);
  if (closedMatch && closedMatch[1] != null) {
    try {
      return JSON.parse(`"${closedMatch[1]}"`) as string;
    } catch {
      return closedMatch[1];
    }
  }

  // 匹配尚未闭合的字符串: "key": "value...截断
  const openPattern = new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)$`, "i");
  const openMatch = raw.match(openPattern);
  if (openMatch && openMatch[1] != null) {
    return openMatch[1];
  }

  return null;
}

/**
 * 从流式输入文本中解析出初稿的部分结构
 */
export function parsePartialSlidePlan(rawText: string): PartialSlidePlan {
  const cleaned = cleanMarkdownCodeBlock(rawText);
  if (!cleaned || cleaned.length < 2) {
    return {
      title: null,
      pageGoal: null,
      keyMessage: null,
      layoutType: null,
      contentBlocks: [],
      designGuide: null,
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

  // 优先从修复后的 JSON 中提取
  let title = typeof parsedObj?.title === "string" ? parsedObj.title : null;
  let pageGoal = typeof parsedObj?.pageGoal === "string" ? parsedObj.pageGoal : null;
  let keyMessage = typeof parsedObj?.keyMessage === "string" ? parsedObj.keyMessage : null;
  let layoutType = typeof parsedObj?.layoutType === "string" ? parsedObj.layoutType : null;

  // 正则二次增量捕获（应对局部截断）
  if (!title) title = extractStringProperty(cleaned, "title");
  if (!pageGoal) pageGoal = extractStringProperty(cleaned, "pageGoal");
  if (!keyMessage) keyMessage = extractStringProperty(cleaned, "keyMessage");
  if (!layoutType) layoutType = extractStringProperty(cleaned, "layoutType");

  const contentBlocks: PartialContentBlock[] = [];
  if (Array.isArray(parsedObj?.contentBlocks)) {
    for (const block of parsedObj.contentBlocks) {
      if (block && typeof block === "object") {
        const blockTitle = typeof block.title === "string" ? block.title : "";
        const blockType = typeof block.type === "string" ? block.type : undefined;
        const items = Array.isArray(block.items)
          ? block.items.filter((item: unknown): item is string => typeof item === "string")
          : [];
        if (blockTitle || items.length > 0) {
          contentBlocks.push({
            title: blockTitle || "模块",
            type: blockType,
            items
          });
        }
      }
    }
  }

  // 如果 JSON 解析尚未捕获到 contentBlocks，尝试通过正则提取
  if (contentBlocks.length === 0 && cleaned.includes('"contentBlocks"')) {
    const blockMatches = [...cleaned.matchAll(/\{[^{}]*"title"\s*:\s*"([^"]+)"[^{}]*\}/g)];
    for (const m of blockMatches) {
      const snippet = m[0];
      const blockTitle = m[1];
      const itemMatches = [...snippet.matchAll(/"([^"]+)"/g)].map((im) => im[1]);
      // 过滤掉属性名
      const items = itemMatches.filter(
        (it) => it !== "title" && it !== "type" && it !== "items" && it !== blockTitle && it !== "block"
      );
      contentBlocks.push({
        title: blockTitle,
        items
      });
    }
  }

  let designGuide: PartialDesignGuide | null = null;
  if (parsedObj?.designGuide && typeof parsedObj.designGuide === "object") {
    designGuide = {
      composition: typeof parsedObj.designGuide.composition === "string" ? parsedObj.designGuide.composition : undefined,
      background: typeof parsedObj.designGuide.background === "string" ? parsedObj.designGuide.background : undefined,
      keyMessage: typeof parsedObj.designGuide.keyMessage === "string" ? parsedObj.designGuide.keyMessage : undefined
    };
  } else if (cleaned.includes('"designGuide"')) {
    const comp = extractStringProperty(cleaned, "composition");
    const bg = extractStringProperty(cleaned, "background");
    if (comp || bg) {
      designGuide = { composition: comp ?? undefined, background: bg ?? undefined };
    }
  }

  // 获取末尾正在打字的活跃片段（最后 60 字符，用于动态光标）
  const activeTail = cleaned.slice(-80).replace(/[\r\n\t]+/g, " ").trim();

  const hasContent = Boolean(
    (title && title.length > 0) ||
      (keyMessage && keyMessage.length > 0) ||
      contentBlocks.length > 0 ||
      designGuide != null
  );

  return {
    title,
    pageGoal,
    keyMessage,
    layoutType,
    contentBlocks,
    designGuide,
    activeStreamTail: activeTail,
    hasContent
  };
}
