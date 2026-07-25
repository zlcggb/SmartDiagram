import type {
  BriefJson,
  BriefQuestion,
  BriefQuestionSource,
  ExtractFactsResult,
  FactDto,
  OutlineSlideDraft,
  ProjectDto,
  ResearchJson,
  SlideDto,
  SlidePlanDto,
  SlideSearchJson,
  PptExportTheme,
  ThemeSurfaceId
} from "@ppt-agent/shared";

export interface SvgGenerationOptions {
  revisionNotes?: string[];
  accentId?: string | null;
  surfaceId?: ThemeSurfaceId | string | null;
}

export interface BriefQuestionResult {
  questions: BriefQuestion[];
  source: BriefQuestionSource;
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
  startBrief(topic: string): Promise<BriefQuestionResult>;
  finalizeBrief(topic: string, answers: Record<string, string>, onToken?: (token: string) => void): Promise<BriefJson>;
  generateResearch(topic: string, briefSummary: string, onToken?: (token: string) => void): Promise<ResearchJson>;
  generatePageSearch(slide: SlideDto, context: { topic?: string; researchSummary?: string }, onToken?: (token: string) => void): Promise<SlideSearchJson>;
}
