/**
 * 文案质量校验器（dashi validate:goal-copy 启发）。
 *
 * 检测 AI 生成内容中的常见质量问题：
 * 1. 模板默认文案残留
 * 2. AI 幻觉（虚构的公司名、数字、日期）
 * 3. 与项目主题无关的填充文案
 * 4. dashi 风格的默认文案泄漏
 */

import type { SlideDto } from "./index.js";

export interface CopyIssue {
  slideId: string;
  slideTitle: string;
  field: string;
  level: "error" | "warning";
  code: string;
  message: string;
  snippet?: string;
}

export interface CopyValidationResult {
  clean: boolean;
  issues: CopyIssue[];
  summary: string;
}

// ── 默认文案检测模式 ──

/** 通用模板占位文案 */
const TEMPLATE_PLACEHOLDERS = [
  "请输入文本",
  "请输入标题",
  "请输入内容",
  "示例文本",
  "示例标题",
  "示例内容",
  "placeholder",
  "lorem ipsum",
  "todo",
  "待填写",
  "在此输入"
];

/** dashi 默认主题文案泄漏（SKILL.md 第 99 行规则） */
const DASHI_DEFAULT_COPY = [
  "AI Capital",
  "SoundWave",
  "声浪",
  "Key Metrics",
  "Roadmap",
  "End of Report",
  "投融资",
  "感谢阅读",
  "DASHI",
  "PPT example",
  "示例封面",
  "示例页面"
];

/** AI 幻觉高频模式：虚构的编号/版本/倒计时 */
const HALLUCINATION_PATTERNS = [
  /版本\s*[vV]?\d+\.\d+/,
  /VOL\.\d+/i,
  /第\s*\d+\s*版/,
  /倒计时\s*\d+\s*天/,
  /截止\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}/,
  /\bVer\s*\d/i,
  /\bRev\s*\d/i,
  /编号\s*[:：]\s*\w+-\d+/
];

function matchesAny(text: string, patterns: string[]): string | null {
  const lower = text.toLowerCase();
  for (const pattern of patterns) {
    if (lower.includes(pattern.toLowerCase())) {
      return pattern;
    }
  }
  return null;
}

function matchesRegex(text: string, patterns: RegExp[]): RegExpMatchArray | null {
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) return m;
  }
  return null;
}

/** 从单页提取所有可见文案字段 */
function extractCopyFields(slide: SlideDto): Array<{ field: string; text: string }> {
  const fields: Array<{ field: string; text: string }> = [];

  if (slide.title) fields.push({ field: "title", text: slide.title });
  if (slide.slideGoal) fields.push({ field: "slideGoal", text: slide.slideGoal });
  if (slide.keyMessage) fields.push({ field: "keyMessage", text: slide.keyMessage });

  if (slide.contentPoints) {
    slide.contentPoints.forEach((point, i) => {
      if (point) fields.push({ field: `contentPoints[${i}]`, text: point });
    });
  }

  // 策划稿内容
  if (slide.planJson) {
    const plan = slide.planJson;
    if (plan.title) fields.push({ field: "plan.title", text: plan.title });
    if (plan.pageGoal) fields.push({ field: "plan.pageGoal", text: plan.pageGoal });
    if (plan.keyMessage) fields.push({ field: "plan.keyMessage", text: plan.keyMessage });
    if (plan.contentBlocks) {
      plan.contentBlocks.forEach((block, bi) => {
        if (block.title) fields.push({ field: `plan.blocks[${bi}].title`, text: block.title });
        block.items?.forEach((item, ii) => {
          if (item) fields.push({ field: `plan.blocks[${bi}].items[${ii}]`, text: item });
        });
      });
    }
  }

  // SVG 中的文本（简单提取）
  if (slide.svgPreview) {
    const textMatches = slide.svgPreview.match(/>([^<]{4,})</g);
    if (textMatches) {
      textMatches.slice(0, 20).forEach((m, i) => {
        const text = m.replace(/^>|<$/g, "").trim();
        if (text.length > 3) fields.push({ field: `svg.text[${i}]`, text });
      });
    }
  }

  return fields;
}

/**
 * 文案质量校验。
 *
 * @param slides 要校验的幻灯片
 * @param projectContext 项目上下文（用于判断文案相关性）
 */
export function validateCopyQuality(
  slides: SlideDto[],
  projectContext?: {
    projectName?: string;
    topic?: string;
    audience?: string;
  }
): CopyValidationResult {
  const issues: CopyIssue[] = [];

  for (const slide of slides) {
    const fields = extractCopyFields(slide);
    const ctx = { slideId: slide.id, slideTitle: slide.title };

    for (const { field, text } of fields) {
      // 1. 模板占位文案
      const placeholder = matchesAny(text, TEMPLATE_PLACEHOLDERS);
      if (placeholder) {
        issues.push({
          ...ctx,
          field,
          level: "error",
          code: "TEMPLATE_PLACEHOLDER",
          message: `检测到模板占位文案 "${placeholder}"，必须替换为实际内容`,
          snippet: text.slice(0, 60)
        });
      }

      // 2. dashi 默认文案泄漏
      const dashiLeak = matchesAny(text, DASHI_DEFAULT_COPY);
      if (dashiLeak) {
        issues.push({
          ...ctx,
          field,
          level: "error",
          code: "DASHI_DEFAULT_COPY",
          message: `检测到默认主题文案 "${dashiLeak}"，与项目主题无关，必须重写`,
          snippet: text.slice(0, 60)
        });
      }

      // 3. AI 幻觉：虚构编号/版本/倒计时
      const hallucination = matchesRegex(text, HALLUCINATION_PATTERNS);
      if (hallucination) {
        issues.push({
          ...ctx,
          field,
          level: "warning",
          code: "POSSIBLE_HALLUCINATION",
          message: `检测到可能的 AI 幻觉："${hallucination[0]}"，请确认是否来自事实库`,
          snippet: text.slice(0, 60)
        });
      }

      // 4. 孤立标点/bullet（dashi SVG 硬规则）
      if (/^[•·\-。，、]+$/.test(text.trim())) {
        issues.push({
          ...ctx,
          field,
          level: "warning",
          code: "ORPHAN_PUNCTUATION",
          message: `孤立标点 "${text.trim()}"，bullet 必须写成完整短句`,
          snippet: text
        });
      }

      // 5. 空洞标题（dashi 内容质量约束）
      if (field.includes("title") && /^(概览|说明|内容[一二三四五六七八九十]|页面\s*\d)$/.test(text.trim())) {
        issues.push({
          ...ctx,
          field,
          level: "warning",
          code: "EMPTY_TITLE",
          message: `空洞标题 "${text.trim()}"，标题必须有明确业务语义`,
          snippet: text
        });
      }
    }

    // 6. 重复事实检查（同一页内）
    const seen = new Set<string>();
    for (const { text } of fields) {
      const normalized = text.trim().toLowerCase().replace(/\s+/g, "");
      if (normalized.length > 10 && seen.has(normalized)) {
        issues.push({
          ...ctx,
          field: "(duplicate)",
          level: "warning",
          code: "DUPLICATE_CONTENT",
          message: "同一页出现重复内容",
          snippet: text.slice(0, 60)
        });
      }
      if (normalized.length > 10) seen.add(normalized);
    }
  }

  const errorCount = issues.filter((i) => i.level === "error").length;
  const warnCount = issues.filter((i) => i.level === "warning").length;

  return {
    clean: errorCount === 0,
    issues,
    summary:
      errorCount === 0 && warnCount === 0
        ? `✅ 文案校验通过（${slides.length} 页）`
        : `${errorCount > 0 ? "❌" : "⚠️"} ${errorCount} 文案错误 / ${warnCount} 警告`
  };
}
