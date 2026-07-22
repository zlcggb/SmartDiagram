import type { BriefQuestion, BriefQuestionSource, FactDto, ProjectDto } from "../../shared";

export type IntentTab = "brief" | "source" | "visual";

export const intentSteps = [
  { id: "brief", label: "需求", number: 1 },
  { id: "source", label: "资料", number: 2 },
  { id: "visual", label: "视觉", number: 3 }
] as const satisfies ReadonlyArray<{ id: IntentTab; label: string; number: number }>;

const legacyGenericQuestionIds = ["audience", "purpose", "pages", "must", "avoid"];

export function inferBriefQuestionSource(
  source: BriefQuestionSource | undefined,
  questions: BriefQuestion[] | undefined
): BriefQuestionSource | undefined {
  if (source) return source;
  const ids = new Set((questions ?? []).map((question) => question.id));
  return legacyGenericQuestionIds.every((id) => ids.has(id)) ? "fallback" : undefined;
}

export function nextIntentTab(tab: IntentTab): IntentTab {
  if (tab === "brief") return "source";
  return "visual";
}

export function canContinueFromSource(facts: FactDto[]): boolean {
  return facts.some((fact) => fact.canUseInPpt);
}

export function hasCompletedBrief(
  project: Pick<ProjectDto, "mode" | "audience" | "purpose" | "briefJson"> | null | undefined
): boolean {
  if (!project) return false;
  if (project.briefJson?.summary?.trim()) return true;
  return project.mode === "paste" && Boolean(project.audience.trim() && project.purpose.trim());
}
