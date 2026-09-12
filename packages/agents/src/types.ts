import type {
  BriefJson,
  BriefQuestion,
  BriefQuestionSource,
  ConsultantProposal,
  ExtractFactsResult,
  FactDto,
  OutlineSlideDraft,
  ProjectDto,
  ResearchJson,
  SlideDto,
  SlidePlanDto,
  SlideSearchJson,
  PptExportTheme,
  PresentationStyleId,
  SpeechScriptPlan,
  SpeechWritingStyleId,
  ThemeSurfaceId
} from "@ppt-agent/shared";
import type { SlideIrDocument } from "@ppt-agent/slide-ir";

export interface SvgGenerationOptions {
  revisionNotes?: string[];
  previousSvg?: string;
  previousSlideIr?: string;
  accentId?: string | null;
  surfaceId?: ThemeSurfaceId | string | null;
  presentationStyle?: PresentationStyleId | string | null;
}

export interface BriefQuestionResult {
  questions: BriefQuestion[];
  source: BriefQuestionSource;
}

export type ModelUsageStage = "facts" | "brief" | "research" | "outline" | "search" | "plan" | "svg" | "ir" | "main";

export interface ModelUsageEvent {
  externalEventId: string;
  provider: string;
  model: string;
  stage: ModelUsageStage;
  status: "succeeded" | "failed";
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  usageAvailable: boolean;
  durationMs: number;
  httpStatus?: number;
  errorCode?: string;
  errorMessage?: string;
  startedAt: string;
  endedAt: string;
}

export type ModelUsageReporter = (event: ModelUsageEvent) => void | Promise<void>;

export interface VisibleTextCandidateRef {
  id: string;
  text: string;
}

export interface SpeechScriptContext {
  index: number;
  total: number;
  prevTitle?: string;
  nextTitle?: string;
  style: SpeechWritingStyleId;
  visibleTextCandidates?: VisibleTextCandidateRef[];
}

export interface GeminiAdapter {
  extractFacts(text: string): Promise<ExtractFactsResult>;
  generateOutline(
    project: Pick<ProjectDto, "name" | "audience" | "purpose" | "pageCount" | "theme">,
    confirmedFacts: FactDto[],
    onToken?: (token: string) => void
  ): Promise<OutlineSlideDraft[]>;
  generateSlidePlan(slide: SlideDto, facts: FactDto[], theme?: PptExportTheme, onToken?: (token: string) => void): Promise<SlidePlanDto>;

  generateSvgPreview(
    slide: SlideDto,
    facts: FactDto[],
    theme?: PptExportTheme,
    onToken?: (token: string) => void,
    options?: SvgGenerationOptions
  ): Promise<string>;
  generateSlideIr(
    slide: SlideDto,
    facts: FactDto[],
    theme?: PptExportTheme,
    onToken?: (token: string) => void,
    options?: SvgGenerationOptions
  ): Promise<SlideIrDocument>;
  startBrief(topic: string): Promise<BriefQuestionResult>;
  finalizeBrief(topic: string, answers: Record<string, string>, onToken?: (token: string) => void): Promise<BriefJson>;
  generateResearch(topic: string, briefSummary: string, onToken?: (token: string) => void): Promise<ResearchJson>;
  generatePageSearch(slide: SlideDto, context: { topic?: string; researchSummary?: string }, onToken?: (token: string) => void): Promise<SlideSearchJson>;
  /** 按指定写稿风格，把单页内容改写成口播稿（纯正文）。 */
  generateSpeechScript(
    slide: SlideDto,
    context: SpeechScriptContext,
    onToken?: (token: string) => void
  ): Promise<string>;
  generateSpeechScriptPlan(
    slide: SlideDto,
    context: SpeechScriptContext,
    onToken?: (token: string) => void
  ): Promise<SpeechScriptPlan>;
  editSlideWithCopilot?(
    slide: SlideDto,
    currentPlan: SlidePlanDto | null,
    instruction: string,
    onToken?: (token: string) => void
  ): Promise<SlideCopilotResult>;
  proposeConsultantStructure?(
    context: {
      project: Pick<ProjectDto, "name" | "audience" | "purpose" | "topic" | "reportType" | "pageCount">;
      sourceText: string;
      materialTexts?: string[];
    },
    onToken?: (token: string) => void
  ): Promise<ConsultantProposal>;
  adjustConsultantStructure?(
    context: {
      project: Pick<ProjectDto, "name" | "audience" | "purpose" | "topic">;
      currentProposal: ConsultantProposal;
      instruction: string;
    },
    onToken?: (token: string) => void
  ): Promise<ConsultantProposal>;
}

export interface SlideCopilotResult {
  plan: SlidePlanDto;
  replyMessage: string;
  suggestedAction?: string;
}

