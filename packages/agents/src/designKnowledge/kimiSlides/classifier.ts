import {
  normalizePresentationStyleId,
  normalizePptExportTheme
} from "@ppt-agent/shared";
import type {
  KimiDesignKnowledgeRequest,
  KimiKnowledgeCatalog,
  KimiKnowledgeCatalogEntry,
  KimiKnowledgeSelection
} from "./types.js";

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "academic-research": [
    "academic", "research", "paper", "论文", "学术", "研究", "实验", "方法论", "答辩", "文献", "假设"
  ],
  "analysis-decision": [
    "analysis", "decision", "risk", "compare", "分析", "决策", "风险", "评估", "诊断", "对比", "选择", "尽调"
  ],
  "brand-creative": [
    "brand", "creative", "launch", "品牌", "创意", "发布会", "品牌故事", "视觉", "海报", "形象"
  ],
  "business-plan": [
    "business", "proposal", "market", "growth", "商业", "方案", "提案", "路演", "市场", "销售", "增长", "融资", "产品"
  ],
  "education-training": [
    "education", "training", "course", "learning", "培训", "课程", "教学", "学习", "训练", "课件", "能力建设"
  ],
  "management-report": [
    "management", "report", "review", "管理", "汇报", "周报", "月报", "季度", "复盘", "经营", "进展", "项目状态"
  ],
  "tech-engineering": [
    "tech", "engineering", "architecture", "system", "api", "fastapi", "node.js", "技术", "工程", "架构", "系统", "接口", "算法", "平台", "组件", "开发", "安全"
  ]
};

const STYLE_HINTS: Record<string, string[]> = {
  "apple-minimal": [
    "apricot", "white", "paper", "moon", "silver", "brief", "imagery", "minimal", "clean", "pastel"
  ],
  consulting: [
    "consulting", "strategy", "brief", "memo", "due-diligence", "transformation", "research"
  ],
  "data-story": [
    "data", "annual", "report", "ledger", "market", "quarterly", "memo", "chart", "finance"
  ],
  "tech-architecture": [
    "tech", "engineering", "atlas", "wayfinding", "blue", "orange-tech", "system"
  ],
  editorial: [
    "magazine", "pictorial", "collage", "imagery", "documentary", "journal", "brand", "promotion"
  ]
};

const STYLE_PATH_HINTS: Record<string, string[]> = {
  "apple-minimal": ["apricot-white-brief", "moon-white-imagery", "paper-white", "silver-gray"],
  consulting: ["consulting", "strategy", "due-diligence", "transformation"],
  "data-story": ["finance", "annual", "quarterly", "ledger", "report"],
  "tech-architecture": ["orange-tech", "wayfinding", "atlas"],
  editorial: ["promotion", "magazine", "pictorial", "documentary"]
};

const THEME_HINTS: Record<string, string[]> = {
  "white-blue": ["white", "blue", "sky", "lake", "marine", "paper", "brief"],
  "soft-product": ["soft", "mist", "moon", "apricot", "pastel", "jade"],
  "blue-black": ["dark", "blue", "black", "atlas", "tech"],
  "code-surface": ["dark", "tech", "engineering", "black"],
  "glass-brand": ["fresh", "brand", "aqua", "imagery", "white"],
  "chart-report": ["report", "data", "memo", "annual", "quarterly"],
  "deep-strategy": ["strategy", "consulting", "dark", "indigo", "pine"],
  "cold-research": ["research", "academic", "paper", "white", "blue"],
  "black-gold": ["black", "gold", "luxury", "ledger"],
  "magazine-navy": ["magazine", "pictorial", "indigo", "navy", "documentary"],
  "gold-index": ["gold", "finance", "ledger", "annual"],
  "growth-energy": ["growth", "red", "orange", "business", "market"]
};

function requestText(request: KimiDesignKnowledgeRequest) {
  let blocks = "";
  try {
    blocks = JSON.stringify(request.contentBlocks ?? []);
  } catch {
    blocks = "";
  }
  return [
    request.topic,
    request.title,
    request.pageType,
    request.slideGoal,
    blocks
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function scoreKeywords(text: string, keywords: string[], weight: number) {
  return keywords.reduce(
    (score, keyword) => score + (text.includes(keyword.toLowerCase()) ? weight : 0),
    0
  );
}

function fallbackCategoryForStyle(style: string) {
  if (style === "tech-architecture") return "tech-engineering";
  if (style === "data-story") return "analysis-decision";
  if (style === "editorial") return "brand-creative";
  if (style === "apple-minimal") return "business-plan";
  return "management-report";
}

export function selectKimiCategory(
  request: KimiDesignKnowledgeRequest,
  catalog: KimiKnowledgeCatalog
): KimiKnowledgeSelection | null {
  if (catalog.categories.length === 0) return null;
  const text = requestText(request);
  const style = normalizePresentationStyleId(request.presentationStyle);
  const fallbackId = fallbackCategoryForStyle(style);
  const ranked = catalog.categories
    .map((entry) => {
      const id = entry.id.split(":").pop() ?? entry.id;
      const keywords = CATEGORY_KEYWORDS[id] ?? [];
      const matches = keywords.filter((keyword) => text.includes(keyword.toLowerCase()));
      const fallback = id === fallbackId;
      return {
        entry,
        score: matches.length * 12 + (fallback ? 4 : 0),
        signals: [
          ...matches.slice(0, 6).map((keyword) => `内容语义 ${keyword}`),
          ...(fallback ? [`风格回退 ${style}`] : [])
        ]
      };
    })
    .sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id));
  return ranked[0] ?? null;
}

function entrySearchText(entry: KimiKnowledgeCatalogEntry) {
  return `${entry.id} ${entry.title} ${entry.relativePath} ${entry.content.slice(0, 2_000)}`.toLowerCase();
}

export function selectKimiDesignSystem(
  request: KimiDesignKnowledgeRequest,
  catalog: KimiKnowledgeCatalog,
  _category: KimiKnowledgeSelection | null
): KimiKnowledgeSelection | null {
  if (catalog.designSystems.length === 0) return null;
  const style = normalizePresentationStyleId(request.presentationStyle);
  const theme = normalizePptExportTheme(request.theme);
  const styleHints = STYLE_HINTS[style] ?? [];
  const stylePathHints = STYLE_PATH_HINTS[style] ?? [];
  const themeHints = THEME_HINTS[theme] ?? [];

  const ranked = catalog.designSystems
    .map((entry) => {
      const text = entrySearchText(entry);
      const relativePath = entry.relativePath.toLowerCase();
      const styleMatches = styleHints.filter((keyword) => text.includes(keyword));
      const stylePathMatches = stylePathHints.filter((keyword) =>
        relativePath.includes(keyword)
      );
      const themeMatches = themeHints.filter((keyword) => text.includes(keyword));
      const curated = /^(?:consulting|finance|academic|promotion|work):/.test(entry.id);
      return {
        entry,
        score:
          styleMatches.length * 9 +
          stylePathMatches.length * 10 +
          themeMatches.length * 6 +
          (curated ? 2 : 0),
        signals: [
          ...styleMatches.slice(0, 3).map((keyword) => `风格 ${keyword}`),
          ...stylePathMatches.slice(0, 2).map((keyword) => `风格目录 ${keyword}`),
          ...themeMatches.slice(0, 3).map((keyword) => `主题 ${keyword}`),
          "整套固定：不随单页场景切换"
        ]
      };
    })
    .sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id));
  return ranked[0] ?? null;
}
