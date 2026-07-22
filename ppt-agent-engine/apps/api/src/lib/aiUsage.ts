import type { GeminiAdapter } from "@ppt-agent/agents";
import type { AiExportUsageSummary, AiUsageCounts, AiUsageDto, EditableGrade } from "@ppt-agent/shared";

const counts: AiUsageCounts = {
  extractFacts: 0,
  outline: 0,
  plan: 0,
  ir: 0,
  svg: 0
};

let lastExportSummary: AiExportUsageSummary | null = null;

export type AiCallKind = keyof AiUsageCounts;

export function recordAiCall(kind: AiCallKind) {
  counts[kind] += 1;
}

export function recordExportUsageSummary(summary: AiExportUsageSummary) {
  lastExportSummary = summary;
}

export function getAiUsage(): AiUsageDto {
  return {
    counts: { ...counts },
    lastExportSummary
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

/** 包装适配器：对本进程 AI 调用做粗计数（非账单） */
export function wrapAdapterWithUsage(adapter: GeminiAdapter): GeminiAdapter {
  return {
    async extractFacts(text) {
      recordAiCall("extractFacts");
      return adapter.extractFacts(text);
    },
    async generateOutline(project, confirmedFacts, onToken) {
      recordAiCall("outline");
      return adapter.generateOutline(project, confirmedFacts, onToken);
    },
    async generateSlidePlan(slide, facts, theme, onToken) {
      recordAiCall("plan");
      return adapter.generateSlidePlan(slide, facts, theme, onToken);
    },
    async generateSlideIr(slide, facts, theme, onToken) {
      recordAiCall("ir");
      return adapter.generateSlideIr(slide, facts, theme, onToken);
    },
    async generateSvgPreview(slide, facts, theme, onToken, options) {
      recordAiCall("svg");
      return adapter.generateSvgPreview(slide, facts, theme, onToken, options);
    },
    async startBrief(topic) {
      recordAiCall("outline");
      return adapter.startBrief(topic);
    },
    async finalizeBrief(topic, answers, onToken) {
      recordAiCall("outline");
      return adapter.finalizeBrief(topic, answers, onToken);
    },
    async generateResearch(topic, briefSummary, onToken) {
      recordAiCall("extractFacts");
      return adapter.generateResearch(topic, briefSummary, onToken);
    },
    async generatePageSearch(slide, context, onToken) {
      recordAiCall("extractFacts");
      return adapter.generatePageSearch(slide, context, onToken);
    }
  };
}
