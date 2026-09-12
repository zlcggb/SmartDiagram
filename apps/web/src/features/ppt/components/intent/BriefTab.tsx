import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowRight, Info, RefreshCw, Sparkles } from "lucide-react";
import { useWorkbenchStore } from '@/features/ppt/store/workbenchStore';
import { inferBriefQuestionSource } from "./intentFlow";

export function BriefTab() {
  const [, setSearchParams] = useSearchParams();
  const project = useWorkbenchStore((s) => s.project);
  const busy = useWorkbenchStore((s) => s.busy);
  const answerBrief = useWorkbenchStore((s) => s.answerBrief);

  const questions = project?.briefJson?.questions;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const autoStartedRef = useRef(false);
  const startBrief = useWorkbenchStore((s) => s.startBrief);

  useEffect(() => {
    if (autoStartedRef.current) return;
    if (questions && questions.length > 0) return;
    autoStartedRef.current = true;
    void startBrief();
  }, [questions, startBrief]);

  useEffect(() => {
    const list = questions ?? [];
    const next: Record<string, string> = { ...(project?.briefJson?.answers ?? {}) };
    for (const question of list) {
      if (next[question.id] === undefined) next[question.id] = "";
    }
    setAnswers(next);
  }, [project?.briefJson?.answers, questions]);

  const answeredCount = useMemo(() => {
    const list = questions ?? [];
    return list.filter((question) => (answers[question.id] || "").trim()).length;
  }, [answers, questions]);
  const canConfirm = Boolean(questions?.length) && answeredCount >= Math.min(3, questions?.length ?? 0);

  async function confirmRequirements() {
    if (!canConfirm) return;
    await answerBrief(answers);
    if (useWorkbenchStore.getState().error) return;
    setSearchParams({ tab: "source" });
  }

  const questionSource = inferBriefQuestionSource(project?.briefJson?.questionSource, questions);

  return (
    <div className="brief-tab">
      <section className="brief-dialog-card">
        {/* 轻量顶部状态条：极简占位，直接释放屏幕高度给核心问答列表 */}
        <div className="brief-compact-status">
          <span className="brief-compact-status__title">
            <Sparkles className="h-3.5 w-3.5 text-blue-600" />
            <span>核心需求诊断</span>
            <small>· 回答越具体，大纲越贴近真实场景</small>
          </span>
          <span className="brief-compact-status__count">
            已回答 {answeredCount} / {questions?.length ?? 0}
          </span>
        </div>

        {questionSource === "fallback" ? (
          <div className="brief-origin-notice is-fallback">
            <Info className="h-3.5 w-3.5" />
            <span>AI 未连接或生成失败，已回退为通用问题模板。</span>
          </div>
        ) : null}

        {(questions?.length ?? 0) === 0 ? (
          <div className="brief-loading-state">
            <Sparkles className="h-5 w-5" />
            <span>{busy || "正在根据你的描述准备问题…"}</span>
          </div>
        ) : (
          <div className="brief-question-list">
            {(questions ?? []).map((question, index) => (
              <label key={question.id} className="brief-question">
                <span className="brief-question__number">{String(index + 1).padStart(2, "0")}</span>
                <span className="brief-question__body">
                  <strong>{question.question}</strong>
                  <textarea
                    placeholder={question.placeholder || "请简要回答"}
                    value={answers[question.id] ?? ""}
                    onChange={(event) =>
                      setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                    }
                  />
                </span>
              </label>
            ))}
          </div>
        )}

        <div className="brief-dialog-card__footer">
          <button
            type="button"
            className="brief-secondary-action"
            disabled={Boolean(busy)}
            onClick={() => void startBrief()}
          >
            <RefreshCw className="h-4 w-4" />
            重新生成问题
          </button>
          <button
            type="button"
            className="brief-primary-action"
            disabled={Boolean(busy) || !canConfirm}
            onClick={() => void confirmRequirements()}
          >
            确认需求，补充资料
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </section>
    </div>
  );
}
