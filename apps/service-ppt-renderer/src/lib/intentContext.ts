import { PPT_MAX_PAGE_COUNT, type BriefJson, type BriefQuestion, type ProjectDto } from "@ppt-agent/shared";

type FactExtractionProject = Pick<
  ProjectDto,
  "name" | "topic" | "audience" | "purpose" | "pageCount" | "briefJson"
>;

function briefContext(project: FactExtractionProject): string {
  const summary = project.briefJson?.summary?.trim();
  if (summary) return summary;
  return [
    `受众：${project.briefJson?.audience || project.audience}`,
    `目标：${project.briefJson?.purpose || project.purpose}`,
    `建议页数：${project.briefJson?.pageCount || project.pageCount} 页`
  ].join("\n");
}

export function buildFactExtractionContext(project: FactExtractionProject, sourceText: string): string {
  return [
    "【创作主题】",
    (project.topic || project.name).trim(),
    "",
    "【已确认需求】",
    briefContext(project),
    "",
    "【用户补充资料】",
    sourceText.trim()
  ].join("\n");
}

export function selectAllExtractedFacts<T extends { canUseInPpt: boolean }>(drafts: T[]): T[] {
  return drafts.map((draft) => ({ ...draft, canUseInPpt: true }));
}

type BriefConfirmationProject = Pick<
  ProjectDto,
  "name" | "topic" | "audience" | "purpose" | "pageCount" | "briefJson"
>;

function matchingAnswer(
  questions: BriefQuestion[],
  answers: Record<string, string>,
  idPattern: RegExp,
  questionPattern: RegExp
): string | undefined {
  const question = questions.find(
    (item) => idPattern.test(item.id) || questionPattern.test(item.question)
  );
  return question ? answers[question.id]?.trim() || undefined : undefined;
}

function confirmedPageCount(
  project: BriefConfirmationProject,
  questions: BriefQuestion[],
  answers: Record<string, string>
): number {
  const raw = matchingAnswer(
    questions,
    answers,
    /page|pages|slide|length/i,
    /多少页|页数|总页数|页面数量/i
  );
  const values = raw?.match(/\d+/g)?.map(Number).filter((value) => value > 0) ?? [];
  return values.length > 0 ? Math.min(PPT_MAX_PAGE_COUNT, Math.max(...values)) : project.pageCount;
}

export function buildConfirmedBrief(
  project: BriefConfirmationProject,
  inputAnswers: Record<string, string>
): BriefJson {
  const questions = project.briefJson?.questions ?? [];
  const answers = Object.fromEntries(
    Object.entries(inputAnswers).map(([id, answer]) => [id, answer.trim()])
  );
  const summary = questions
    .map((question) => {
      const answer = answers[question.id];
      return answer ? `${question.question}：${answer}` : "";
    })
    .filter(Boolean)
    .join("\n");
  const audience = matchingAnswer(
    questions,
    answers,
    /audience|listener|recipient/i,
    /受众|讲给谁|听众|面向谁/i
  );
  const purpose = matchingAnswer(
    questions,
    answers,
    /purpose|goal|objective|outcome/i,
    /目的|目标|希望.*(?:获得|做到|掌握|理解)|听完后/i
  );
  const styleNotes = matchingAnswer(
    questions,
    answers,
    /style|visual|avoid|rule|taboo/i,
    /视觉|风格|禁忌|不要|避免/i
  );

  return {
    topic: project.topic || project.name,
    questions,
    answers,
    questionSource: project.briefJson?.questionSource,
    summary: summary || project.briefJson?.summary || "需求问答已确认",
    audience: audience || project.briefJson?.audience || project.audience,
    purpose: purpose || project.briefJson?.purpose || project.purpose,
    pageCount: confirmedPageCount(project, questions, answers),
    styleNotes: styleNotes || project.briefJson?.styleNotes
  };
}
