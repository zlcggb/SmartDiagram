import type { GeminiAdapter, ModelUsageEvent } from "@ppt-agent/agents";
import type { AiExportUsageSummary, AiUsageCounts, AiUsageDto, EditableGrade } from "@ppt-agent/shared";
import { runWithModelUsageResource } from "./modelUsageContext.js";

const counts: AiUsageCounts = {
  extractFacts: 0,
  outline: 0,
  plan: 0,
  svg: 0,
  ir: 0
};

let lastExportSummary: AiExportUsageSummary | null = null;

/** 真实 Token 用量累加器 */
const tokenAccumulator = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  callCount: 0,
};

export type AiCallKind = keyof AiUsageCounts;

export function recordAiCall(kind: AiCallKind) {
  counts[kind] += 1;
}

/** 记录一次 API 调用的真实 Token 用量 */
export function recordTokenUsage(prompt: number, completion: number, total?: number) {
  tokenAccumulator.promptTokens += prompt;
  tokenAccumulator.completionTokens += completion;
  tokenAccumulator.totalTokens += (total ?? (prompt + completion));
  tokenAccumulator.callCount += 1;
}

export function recordModelUsageEvent(event: ModelUsageEvent) {
  tokenAccumulator.promptTokens += event.inputTokens;
  tokenAccumulator.completionTokens += event.outputTokens;
  tokenAccumulator.totalTokens += event.totalTokens;
  tokenAccumulator.callCount += 1;
}

export function recordExportUsageSummary(summary: AiExportUsageSummary) {
  lastExportSummary = summary;
}

export function getAiUsage(): AiUsageDto {
  return {
    counts: { ...counts },
    lastExportSummary,
    tokenUsage: { ...tokenAccumulator },
  };
}

export function buildExportUsageSummary(input: {
  projectId: string;
  mode: AiExportUsageSummary["mode"];
  pageResults: Array<{ editableGrade?: EditableGrade }>;
  warningCount: number;
}): AiExportUsageSummary {
  const gradeCounts: Record<EditableGrade, number> = { A: 0, B: 0, C: 0 };
  for (const page of input.pageResults) {
    const grade = page.editableGrade ?? "C";
    gradeCounts[grade] += 1;
  }
  return {
    projectId: input.projectId,
    mode: input.mode,
    pageCount: input.pageResults.length,
    gradeCounts,
    warningCount: input.warningCount,
    at: new Date().toISOString()
  };
}

/** 包装适配器：保留本进程粗计数，并为持久化事件补充项目/页面摘要。 */
export function wrapAdapterWithUsage(adapter: GeminiAdapter): GeminiAdapter {
  return {
    async extractFacts(text) {
      recordAiCall("extractFacts");
      return runWithModelUsageResource({ outputSummary: "提取项目事实" }, () => adapter.extractFacts(text));
    },
    async generateOutline(project, confirmedFacts, onToken) {
      recordAiCall("outline");
      return runWithModelUsageResource({ outputSummary: "生成项目大纲" }, () => adapter.generateOutline(project, confirmedFacts, onToken));
    },
    async generateSlidePlan(slide, facts, theme, onToken) {
      recordAiCall("plan");
      return runWithModelUsageResource(
        { slideId: slide.id, outputSummary: `生成初稿：${slide.title}` },
        () => adapter.generateSlidePlan(slide, facts, theme, onToken)
      );
    },
    async generateSvgPreview(slide, facts, theme, onToken, options) {
      recordAiCall("svg");
      return runWithModelUsageResource(
        { slideId: slide.id, outputSummary: `生成设计稿：${slide.title}` },
        () => adapter.generateSvgPreview(slide, facts, theme, onToken, options)
      );
    },
    async generateSlideIr(slide, facts, theme, onToken, options) {
      recordAiCall("ir");
      return runWithModelUsageResource(
        { slideId: slide.id, outputSummary: `生成 SmartSlide 设计稿：${slide.title}` },
        () => adapter.generateSlideIr(slide, facts, theme, onToken, options)
      );
    },
    async startBrief(topic) {
      recordAiCall("outline");
      return runWithModelUsageResource({ outputSummary: "生成顾问问题" }, () => adapter.startBrief(topic));
    },
    async finalizeBrief(topic, answers, onToken) {
      recordAiCall("outline");
      return runWithModelUsageResource({ outputSummary: "生成需求摘要" }, () => adapter.finalizeBrief(topic, answers, onToken));
    },
    async generateResearch(topic, briefSummary, onToken) {
      recordAiCall("extractFacts");
      return runWithModelUsageResource({ outputSummary: "生成背景调研" }, () => adapter.generateResearch(topic, briefSummary, onToken));
    },
    async generatePageSearch(slide, context, onToken) {
      recordAiCall("extractFacts");
      return runWithModelUsageResource(
        { slideId: slide.id, outputSummary: `检索素材：${slide.title}` },
        () => adapter.generatePageSearch(slide, context, onToken)
      );
    },
    async generateSpeechScript(slide, context, onToken) {
      recordAiCall("plan");
      return runWithModelUsageResource(
        { slideId: slide.id, outputSummary: `生成演讲稿：${slide.title}` },
        () => adapter.generateSpeechScript(slide, context, onToken)
      );
    },
    async generateSpeechScriptPlan(slide, context, onToken) {
      recordAiCall("plan");
      return runWithModelUsageResource(
        { slideId: slide.id, outputSummary: `生成演讲稿与聚焦计划：${slide.title}` },
        () => adapter.generateSpeechScriptPlan(slide, context, onToken)
      );
    }
  };
}
