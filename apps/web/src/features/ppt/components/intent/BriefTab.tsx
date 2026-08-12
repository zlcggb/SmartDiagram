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
    let cancelled = false;
    const list = questions ?? [];
    const next: Record<string, string> = { ...(project?.briefJson?.answers ?? {}) };
    for (const question of list) {
      if (next[question.id] === undefined) next[question.id] = "";
    }
    queueMicrotask(() => {
      if (!cancelled) setAnswers(next);
    });
    return () => {
      cancelled = true;
    };
  }, [project?.briefJson?.answers, questions]);

  const answeredCount = useMemo(() => {
    const list = questions ?? [];
    return list.filter((question) => (answers[question.id] || "").trim()).length;
  }, [answers, questions]);
  const progress = questions?.length ? Math.round((answeredCount / questions.length) * 100) : 0;
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
        <div className="brief-dialog-card__title">
          <span><Sparkles className="h-5 w-5" /></span>
          <div>
            <h2>顾问正在了解你的汇报</h2>
            <p>回答越具体，后续大纲越贴近真实场景。</p>
          </div>
        </div>

        <div className="brief-progress">
          <span style={{ width: `${progress}%` }} />
          <small>{progress}%</small>
        </div>

        {questionSource === "fallback" ? (
          <div className="brief-origin-notice is-fallback">
            <Info className="h-4 w-4" />
            <span>
              <strong>当前是通用问题</strong>
              <small>AI 未连接或本次生成失败，因此使用了基础问题模板；配置真实模型后可重新生成。</small>
            </span>
          </div>
        ) : questionSource === "ai" ? (
          <div className="brief-origin-notice">
            <Sparkles className="h-4 w-4" />
            <span>
              <strong>已根据主题生成针对性问题</strong>
              <small>这些问题由 AI 结合当前主题动态生成。</small>
            </span>
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
