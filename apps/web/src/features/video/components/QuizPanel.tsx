import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { generateQuiz, submitQuiz, syncQuizState } from '../lib/api';
import { updateGuestVideoQuiz } from '../lib/guestHistory';
import type { QuizData, QuizQuestion, QuizSavedState, QuizScoreResult } from '../lib/types';

interface QuizPanelProps {
  summaryTaskId: string;
  webpageUrl?: string;
  initialQuiz?: QuizData | null;
  initialQuizState?: QuizSavedState | null;
  readOnly?: boolean;
  onSeek: (seconds: number) => void;
}

const TYPE_LABELS: Record<string, string> = {
  single_choice: '单选题',
  multiple_choice: '多选题',
  true_false: '认知辨析',
  fill_blank: '填空题',
};

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function fmtTime(seconds?: number): string {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = String(value % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function timeLink(webpageUrl: string, seconds?: number): string {
  const url = webpageUrl || '';
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  if (!url) return '';
  if (/youtube\.com|youtu\.be/.test(url)) {
    return `${url}${url.includes('?') ? '&' : '?'}t=${value}s`;
  }
  if (/bilibili\.com/.test(url)) {
    return `${url}${url.includes('?') ? '&' : '?'}t=${value}`;
  }
  return '';
}

function normalizeCompareText(val: unknown): string {
  return String(val ?? '')
    .replace(/[\s，。！？；：、,.!?;:'"“”‘’（）()\[\]]+/g, '')
    .toLowerCase();
}

function evaluateQuestionLocal(
  question: QuizQuestion,
  userAnswer: string | string[] | boolean | undefined,
): boolean {
  if (userAnswer === undefined || userAnswer === '') return false;
  const expected = question.correct_answer;

  if (question.type === 'true_false') {
    const parseBool = (v: unknown): boolean | null => {
      if (typeof v === 'boolean') return v;
      const s = normalizeCompareText(v);
      if (['true', '正确', '对', '是', '√'].includes(s)) return true;
      if (['false', '错误', '错', '否', '×', 'x'].includes(s)) return false;
      return null;
    };
    const u = parseBool(userAnswer);
    const e = parseBool(expected);
    return u !== null && u === e;
  }

  if (question.type === 'multiple_choice') {
    const uArr = (Array.isArray(userAnswer) ? userAnswer : [userAnswer])
      .map(normalizeCompareText)
      .filter(Boolean)
      .sort();
    const eArr = (Array.isArray(expected) ? expected : [expected])
      .map(normalizeCompareText)
      .filter(Boolean)
      .sort();
    if (uArr.length === 0 || uArr.length !== eArr.length) return false;
    return uArr.every((v, i) => v === eArr[i]);
  }

  if (question.type === 'single_choice') {
    return normalizeCompareText(userAnswer) === normalizeCompareText(expected);
  }

  // fill_blank
  const accepted =
    question.accepted_answers && question.accepted_answers.length > 0
      ? question.accepted_answers
      : [expected];
  const uNorm = normalizeCompareText(userAnswer);
  return Boolean(uNorm) && accepted.some((item) => normalizeCompareText(item) === uNorm);
}

function answerText(answer: string | string[] | boolean | undefined): string {
  if (Array.isArray(answer)) return answer.join('、');
  if (answer === true) return '正确';
  if (answer === false) return '错误';
  return String(answer ?? '');
}

export const QuizPanel: React.FC<QuizPanelProps> = ({
  summaryTaskId,
  webpageUrl = '',
  initialQuiz = null,
  initialQuizState = null,
  readOnly = false,
  onSeek,
}) => {
  const [fullQuiz, setFullQuiz] = useState<QuizData | null>(null);
  const [activeQuestions, setActiveQuestions] = useState<QuizQuestion[]>([]);
  const [targetCount, setTargetCount] = useState<6 | 10>(6);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'deck' | 'list' | 'summary'>('deck');

  const [answers, setAnswers] = useState<Record<string, string | string[] | boolean>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [scoreResult, setScoreResult] = useState<QuizScoreResult | null>(null);

  const [generating, setGenerating] = useState(false);
  const [genElapsedMs, setGenElapsedMs] = useState(0);
  const [error, setError] = useState('');
  const [isRetryWrongMode, setIsRetryWrongMode] = useState(false);
  const [paperFilter, setPaperFilter] = useState<'all' | 'wrong'>('all');
  const [isSandboxPractice, setIsSandboxPractice] = useState(false);

  const hydratedTaskRef = useRef<string>('');
  const storageKey = summaryTaskId ? `vidgrab_quiz_v2_${summaryTaskId}` : '';

  const applyOwnerSnapshot = useCallback(
    (quiz: QuizData, state?: QuizSavedState | null) => {
      const qs = quiz.questions || [];
      setFullQuiz(quiz);
      setActiveQuestions(qs);
      const mergedAns: Record<string, string | string[] | boolean> = Object.fromEntries(
        qs.map((q) => [q.id, q.type === 'multiple_choice' ? [] : '']),
      );
      if (Array.isArray(state?.score_result?.details)) {
        for (const d of state!.score_result!.details) {
          if (d?.question_id && d.user_answer !== undefined) {
            mergedAns[d.question_id] = d.user_answer;
          }
        }
      }
      Object.assign(mergedAns, state?.answers || {});
      setAnswers(mergedAns);

      // 只读分享下默认展开所有题目的评测结果与 AI 深度解析
      const allRev: Record<string, boolean> = {};
      for (const q of qs) {
        allRev[q.id] = true;
      }
      setRevealed({ ...(state?.revealed || {}), ...allRev });
      setCurrentIndex(0);
      setViewMode(state?.view_mode === 'list' ? 'list' : 'deck');
      setScoreResult(state?.score_result || null);
      setIsRetryWrongMode(false);
      setIsSandboxPractice(false);
    },
    [],
  );

  const handleStartSandboxPractice = useCallback(() => {
    if (!fullQuiz?.questions?.length) return;
    const qs = fullQuiz.questions;
    setActiveQuestions(qs);
    setAnswers(
      Object.fromEntries(qs.map((q) => [q.id, q.type === 'multiple_choice' ? [] : ''])),
    );
    setRevealed({});
    setScoreResult(null);
    setCurrentIndex(0);
    setViewMode('deck');
    setIsRetryWrongMode(false);
    setPaperFilter('all');
    setIsSandboxPractice(true);
  }, [fullQuiz]);

  const handleRestoreOwnerResult = useCallback(() => {
    if (!initialQuiz && !fullQuiz) return;
    applyOwnerSnapshot((initialQuiz || fullQuiz)!, initialQuizState);
  }, [applyOwnerSnapshot, fullQuiz, initialQuiz, initialQuizState]);

  const resetAll = useCallback(() => {
    setFullQuiz(null);
    setActiveQuestions([]);
    setCurrentIndex(0);
    setViewMode('deck');
    setAnswers({});
    setRevealed({});
    setScoreResult(null);
    setGenerating(false);
    setGenElapsedMs(0);
    setError('');
    setIsRetryWrongMode(false);
    setPaperFilter('all');
    setIsSandboxPractice(false);
  }, []);

  // 切换视频或服务端返回已保存测验时，自动从 localStorage 或服务端恢复评测题目与成绩
  useEffect(() => {
    if (!summaryTaskId) {
      hydratedTaskRef.current = '';
      resetAll();
      return;
    }

    // 只读分享模式：优先直接展示服务端保存的分享者评测结果与解析，不读取访客本地缓存
    if (readOnly) {
      if (initialQuiz && Array.isArray(initialQuiz.questions) && initialQuiz.questions.length > 0) {
        applyOwnerSnapshot(initialQuiz, initialQuizState);
        hydratedTaskRef.current = summaryTaskId;
      } else if (hydratedTaskRef.current !== summaryTaskId) {
        hydratedTaskRef.current = summaryTaskId;
        resetAll();
      }
      return;
    }

    // 1. 尝试从 localStorage 读取最新本地快照
    let restoredFromLocal = false;
    if (typeof window !== 'undefined' && storageKey) {
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.fullQuiz && Array.isArray(parsed.fullQuiz.questions) && parsed.fullQuiz.questions.length > 0) {
            const allQs: QuizQuestion[] = parsed.fullQuiz.questions;
            setFullQuiz(parsed.fullQuiz);
            // 始终恢复完整全卷题目，避免因之前处于错题重练模式导致只剩 1 道题
            setActiveQuestions(allQs);

            const mergedAnswers: Record<string, string | string[] | boolean> = Object.fromEntries(
              allQs.map((q) => [q.id, q.type === 'multiple_choice' ? [] : '']),
            );
            const mergedRevealed: Record<string, boolean> = {};

            // 如果 scoreResult.details 中有全卷历史作答详情，优先回填全卷答案
            if (Array.isArray(parsed.scoreResult?.details)) {
              for (const d of parsed.scoreResult.details) {
                if (d?.question_id) {
                  mergedAnswers[d.question_id] = d.user_answer;
                  mergedRevealed[d.question_id] = true;
                }
              }
            }
            Object.assign(mergedAnswers, parsed.answers || {});
            Object.assign(mergedRevealed, parsed.revealed || {});

            setAnswers(mergedAnswers);
            setRevealed(mergedRevealed);
            setCurrentIndex(Math.min(Number(parsed.currentIndex) || 0, Math.max(0, allQs.length - 1)));
            setViewMode(parsed.viewMode || 'deck');
            setScoreResult(parsed.scoreResult || null);
            setIsRetryWrongMode(false);
            hydratedTaskRef.current = summaryTaskId;
            restoredFromLocal = true;
          }
        }
      } catch {
        // ignore localStorage parse error
      }
    }

    if (restoredFromLocal) return;

    // 2. 若本地无快照，但服务端 summary.result.quiz 已有保存记录，则从服务端恢复
    if (initialQuiz && Array.isArray(initialQuiz.questions) && initialQuiz.questions.length > 0) {
      const qs = initialQuiz.questions;
      setFullQuiz(initialQuiz);
      setActiveQuestions(qs);
      const defaultAns = Object.fromEntries(
        qs.map((q) => [q.id, q.type === 'multiple_choice' ? [] : '']),
      );
      setAnswers({ ...defaultAns, ...(initialQuizState?.answers || {}) });
      setRevealed(initialQuizState?.revealed || {});
      setCurrentIndex(Number(initialQuizState?.current_index) || 0);
      setViewMode(initialQuizState?.view_mode || 'deck');
      setScoreResult(initialQuizState?.score_result || null);
      setIsRetryWrongMode(false);
      hydratedTaskRef.current = summaryTaskId;
      return;
    }

    // 3. 若切换到了一个全新的 summaryTaskId 且尚无测验，才重置
    if (hydratedTaskRef.current !== summaryTaskId) {
      hydratedTaskRef.current = summaryTaskId;
      resetAll();
    }
  }, [summaryTaskId, storageKey, initialQuiz, initialQuizState, readOnly, applyOwnerSnapshot, resetAll]);

  // 实时保存测验题目、作答进度与评测结果到 localStorage + guestHistory + 服务端 PostgreSQL（只读分享模式下严格禁止写入）
  useEffect(() => {
    if (readOnly || !summaryTaskId || !fullQuiz || !storageKey || isRetryWrongMode) return;
    const savedState: QuizSavedState = {
      quiz_id: fullQuiz.quiz_id,
      answers,
      revealed,
      current_index: currentIndex,
      view_mode: viewMode,
      score_result: scoreResult,
    };
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({
            fullQuiz,
            activeQuestions: fullQuiz.questions,
            answers,
            revealed,
            currentIndex,
            viewMode,
            scoreResult,
            isRetryWrongMode: false,
          }),
        );
      } catch {
        // ignore quota error
      }
    }
    updateGuestVideoQuiz(summaryTaskId, fullQuiz, savedState);

    const timer = setTimeout(() => {
      void syncQuizState({
        summary_task_id: summaryTaskId,
        quiz_id: fullQuiz.quiz_id,
        answers,
        revealed,
        current_index: currentIndex,
        view_mode: viewMode,
        score_result: scoreResult,
      }).catch(() => {
        // ignore background sync failure
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [readOnly, summaryTaskId, storageKey, fullQuiz, answers, revealed, currentIndex, viewMode, scoreResult, isRetryWrongMode]);

  useEffect(() => {
    if (!generating) {
      setGenElapsedMs(0);
      return;
    }
    const t0 = Date.now();
    const timer = setInterval(() => setGenElapsedMs(Date.now() - t0), 150);
    return () => clearInterval(timer);
  }, [generating]);

  const initSession = (questions: QuizQuestion[], retryMode = false) => {
    setActiveQuestions(questions);
    setCurrentIndex(0);
    setViewMode('deck');
    setIsRetryWrongMode(retryMode);
    setAnswers(
      Object.fromEntries(questions.map((q) => [q.id, q.type === 'multiple_choice' ? [] : ''])),
    );
    setRevealed({});
  };

  const onGenerateQuiz = async (countOverride?: number) => {
    if (!summaryTaskId || generating) return;
    const countToUse = countOverride || targetCount;
    setGenerating(true);
    setError('');
    setScoreResult(null);
    try {
      const data = await generateQuiz(summaryTaskId, countToUse);
      setFullQuiz(data);
      initSession(data.questions || [], false);
    } catch (e: any) {
      setError(e?.message || '生成测验失败，请重试');
    } finally {
      setGenerating(false);
    }
  };

  // 计算每道题的对错状态
  const correctnessMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const q of activeQuestions) {
      if (!revealed[q.id]) continue;
      const serverDetail = scoreResult?.details?.find((d) => d.question_id === q.id);
      if (serverDetail && q.correct_answer === undefined) {
        map[q.id] = serverDetail.correct;
      } else {
        map[q.id] = evaluateQuestionLocal(q, answers[q.id]);
      }
    }
    return map;
  }, [activeQuestions, answers, revealed, scoreResult]);

  // 统计数据：已揭晓数、答对数、当前连击、最高连击
  const stats = useMemo(() => {
    let revealedCount = 0;
    let correctCount = 0;
    let currentStreak = 0;
    let maxStreak = 0;

    for (const q of activeQuestions) {
      if (revealed[q.id]) {
        revealedCount++;
        if (correctnessMap[q.id]) {
          correctCount++;
          currentStreak++;
          if (currentStreak > maxStreak) maxStreak = currentStreak;
        } else {
          currentStreak = 0;
        }
      }
    }
    const total = activeQuestions.length || 1;
    const accuracy = Math.round((correctCount / total) * 100);
    return {
      revealedCount,
      correctCount,
      wrongCount: revealedCount - correctCount,
      currentStreak,
      maxStreak,
      accuracy,
      allRevealed: activeQuestions.length > 0 && revealedCount === activeQuestions.length,
    };
  }, [activeQuestions, correctnessMap, revealed]);

  // 当全部题目揭晓后，后台静默同步一次成绩到服务端（只读模式下不提交覆盖）
  useEffect(() => {
    if (readOnly || !stats.allRevealed || !fullQuiz || isRetryWrongMode || scoreResult) return;
    let cancelled = false;
    void submitQuiz(
      fullQuiz.quiz_id,
      fullQuiz.questions.map((q) => ({
        question_id: q.id,
        answer: answers[q.id],
      })),
      summaryTaskId,
    )
      .then((res) => {
        if (!cancelled) setScoreResult(res);
      })
      .catch(() => {
        // 忽略静默同步异常，前端本地判题已完整就绪
      });
    return () => {
      cancelled = true;
    };
  }, [readOnly, stats.allRevealed, fullQuiz, isRetryWrongMode, scoreResult, answers, summaryTaskId]);

  const currentQuestion = activeQuestions[currentIndex] || null;

  // 单选 / 判断：点击即刻揭晓
  const handleSelectInstant = useCallback(
    (question: QuizQuestion, val: string | boolean) => {
      if (revealed[question.id]) return;
      setAnswers((prev) => ({ ...prev, [question.id]: val }));
      setRevealed((prev) => ({ ...prev, [question.id]: true }));
    },
    [revealed],
  );

  // 多选切换选项
  const handleToggleMulti = (question: QuizQuestion, option: string) => {
    if (revealed[question.id]) return;
    const curr = Array.isArray(answers[question.id]) ? (answers[question.id] as string[]) : [];
    const next = curr.includes(option) ? curr.filter((x) => x !== option) : [...curr, option];
    setAnswers((prev) => ({ ...prev, [question.id]: next }));
  };

  // 确认多选或填空题答案
  const handleConfirmQuestion = (question: QuizQuestion) => {
    if (revealed[question.id]) return;
    setRevealed((prev) => ({ ...prev, [question.id]: true }));
  };

  // 键盘快捷键支持（卡片模式下：1-4 选选项，← → 切题，Enter 下一题）
  useEffect(() => {
    if (!fullQuiz || viewMode !== 'deck' || !currentQuestion) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        e.preventDefault();
        setCurrentIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'ArrowRight' && currentIndex < activeQuestions.length - 1) {
        e.preventDefault();
        setCurrentIndex((i) => Math.min(activeQuestions.length - 1, i + 1));
      } else if (['1', '2', '3', '4'].includes(e.key) && !revealed[currentQuestion.id]) {
        const idx = Number(e.key) - 1;
        if (currentQuestion.type === 'single_choice' && currentQuestion.options?.[idx]) {
          e.preventDefault();
          handleSelectInstant(currentQuestion, currentQuestion.options[idx]);
        } else if (currentQuestion.type === 'true_false' && (idx === 0 || idx === 1)) {
          e.preventDefault();
          handleSelectInstant(currentQuestion, idx === 0);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullQuiz, viewMode, currentQuestion, currentIndex, activeQuestions.length, revealed, handleSelectInstant]);

  // 仅重练错题（保留已答对题目的记录，仅重置错题本身）
  const handleRetryWrong = () => {
    const allQs = fullQuiz?.questions || activeQuestions;
    const wrongList = allQs.filter((q) => revealed[q.id] && !evaluateQuestionLocal(q, answers[q.id]));
    if (wrongList.length === 0) return;
    setActiveQuestions(wrongList);
    setCurrentIndex(0);
    setViewMode('deck');
    setIsRetryWrongMode(true);
    setAnswers((prev) => {
      const next = { ...prev };
      for (const wq of wrongList) {
        next[wq.id] = wq.type === 'multiple_choice' ? [] : '';
      }
      return next;
    });
    setRevealed((prev) => {
      const next = { ...prev };
      for (const wq of wrongList) {
        delete next[wq.id];
      }
      return next;
    });
  };

  // 打开全卷模式（始终恢复完整的全套 6/10 题，绝不只展示 1 道错题）
  const handleOpenFullPaper = (expandAll = false) => {
    if (fullQuiz?.questions?.length) {
      setActiveQuestions(fullQuiz.questions);
      if (expandAll) {
        const allRev: Record<string, boolean> = {};
        for (const q of fullQuiz.questions) allRev[q.id] = true;
        setRevealed((prev) => ({ ...prev, ...allRev }));
      }
    }
    setIsRetryWrongMode(false);
    setPaperFilter('all');
    setViewMode('list');
  };

  // 渲染单道题目的选项与解析（供卡片模式和列表模式复用）
  const renderQuestionInteractive = (question: QuizQuestion) => {
    const isRev = Boolean(revealed[question.id]);
    const isCorrect = Boolean(correctnessMap[question.id]);
    const userAns = answers[question.id];
    const serverDetail = scoreResult?.details?.find((d) => d.question_id === question.id);

    const explanationText = question.explanation || serverDetail?.explanation || '';
    const refTime =
      question.reference_time !== undefined
        ? question.reference_time
        : serverDetail?.reference_time;
    const refText = question.reference_text || serverDetail?.reference_text || '';
    const expectedAns =
      question.correct_answer !== undefined
        ? question.correct_answer
        : serverDetail?.correct_answer;

    return (
      <div className="mt-3">
        {/* 单选题：Apple 大圆角字母徽章卡片 */}
        {question.type === 'single_choice' && (
          <div className="space-y-2">
            {(question.options || []).map((option, optIdx) => {
              const isSelected = userAns === option;
              const isExpected =
                expectedAns !== undefined &&
                normalizeCompareText(expectedAns) === normalizeCompareText(option);

              let cardStyle =
                'border-slate-200/90 bg-white text-slate-800 hover:border-[#0071e3]/50 hover:bg-[#0071e3]/[0.02]';
              let badgeStyle = 'bg-slate-100 text-slate-600 group-hover:bg-[#0071e3]/10 group-hover:text-[#0071e3]';

              if (isRev) {
                if (isExpected) {
                  cardStyle =
                    'border-emerald-500/60 bg-gradient-to-r from-emerald-500/10 via-emerald-500/[0.04] to-white text-emerald-950 shadow-2xs';
                  badgeStyle = 'bg-emerald-500 text-white';
                } else if (isSelected && !isExpected) {
                  cardStyle =
                    'border-rose-400/60 bg-gradient-to-r from-rose-500/10 via-rose-500/[0.04] to-white text-rose-950';
                  badgeStyle = 'bg-rose-500 text-white';
                } else {
                  cardStyle = 'border-slate-200/60 bg-slate-50/50 text-slate-400 opacity-75';
                  badgeStyle = 'bg-slate-100 text-slate-400';
                }
              } else if (isSelected) {
                cardStyle = 'border-[#0071e3] bg-[#0071e3]/[0.06] text-slate-900 shadow-2xs';
                badgeStyle = 'bg-[#0071e3] text-white';
              }

              return (
                <button
                  key={option}
                  type="button"
                  disabled={isRev}
                  onClick={() => handleSelectInstant(question, option)}
                  className={`group flex w-full items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-[13px] leading-snug transition-all duration-200 ${cardStyle} ${
                    !isRev ? 'active:scale-[0.99]' : 'cursor-default'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-md font-mono text-[11.5px] font-bold transition-colors ${badgeStyle}`}
                  >
                    {isRev && isExpected ? '✓' : isRev && isSelected && !isExpected ? '✕' : LETTERS[optIdx] || optIdx + 1}
                  </span>
                  <span className="flex-1 font-medium">{option}</span>
                  {isRev && isExpected && (
                    <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                      正确答案
                    </span>
                  )}
                  {isRev && isSelected && !isExpected && (
                    <span className="shrink-0 rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-bold text-rose-600">
                      你的选择
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* 判断题：左右并排双大卡 */}
        {question.type === 'true_false' && (
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: '认知正确', sub: '符合视频核心观点', value: true, icon: '✓' },
              { label: '存在误区', sub: '与视频观点相悖', value: false, icon: '✕' },
            ].map((item) => {
              const isSelected = userAns === item.value;
              const isExpected = expectedAns === item.value;

              let cardStyle =
                'border-slate-200/90 bg-white text-slate-800 hover:border-[#0071e3]/50 hover:bg-[#0071e3]/[0.02]';
              let iconStyle = 'bg-slate-100 text-slate-600';

              if (isRev) {
                if (isExpected) {
                  cardStyle =
                    'border-emerald-500/60 bg-gradient-to-br from-emerald-500/12 to-white text-emerald-950 shadow-2xs';
                  iconStyle = 'bg-emerald-500 text-white';
                } else if (isSelected && !isExpected) {
                  cardStyle =
                    'border-rose-400/60 bg-gradient-to-br from-rose-500/12 to-white text-rose-950';
                  iconStyle = 'bg-rose-500 text-white';
                } else {
                  cardStyle = 'border-slate-200/60 bg-slate-50/50 text-slate-400 opacity-70';
                }
              }

              return (
                <button
                  key={item.label}
                  type="button"
                  disabled={isRev}
                  onClick={() => handleSelectInstant(question, item.value)}
                  className={`flex flex-col items-center justify-center rounded-2xl border p-4 text-center transition-all duration-200 ${cardStyle} ${
                    !isRev ? 'active:scale-[0.98]' : 'cursor-default'
                  }`}
                >
                  <span className={`mb-2 flex h-9 w-9 items-center justify-center rounded-full text-[15px] font-bold ${iconStyle}`}>
                    {item.icon}
                  </span>
                  <span className="text-[14px] font-bold">{item.label}</span>
                  <span className="mt-0.5 text-[11.5px] opacity-70">{item.sub}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* 多选题 */}
        {question.type === 'multiple_choice' && (
          <div className="space-y-2.5">
            {(question.options || []).map((option, optIdx) => {
              const currArr = Array.isArray(userAns) ? (userAns as string[]) : [];
              const isSelected = currArr.includes(option);
              const expArr = Array.isArray(expectedAns)
                ? expectedAns.map(normalizeCompareText)
                : [];
              const isExpected = expArr.includes(normalizeCompareText(option));

              let cardStyle =
                'border-slate-200/90 bg-white text-slate-800 hover:border-[#0071e3]/50';
              let badgeStyle = 'bg-slate-100 text-slate-600';

              if (isRev) {
                if (isExpected) {
                  cardStyle =
                    'border-emerald-500/60 bg-gradient-to-r from-emerald-500/10 to-white text-emerald-950';
                  badgeStyle = 'bg-emerald-500 text-white';
                } else if (isSelected && !isExpected) {
                  cardStyle = 'border-rose-400/60 bg-rose-50/60 text-rose-950';
                  badgeStyle = 'bg-rose-500 text-white';
                } else {
                  cardStyle = 'border-slate-200/60 bg-slate-50/50 text-slate-400 opacity-70';
                }
              } else if (isSelected) {
                cardStyle = 'border-[#0071e3] bg-[#0071e3]/[0.06] text-slate-900 shadow-2xs';
                badgeStyle = 'bg-[#0071e3] text-white';
              }

              return (
                <button
                  key={option}
                  type="button"
                  disabled={isRev}
                  onClick={() => handleToggleMulti(question, option)}
                  className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left text-[13.5px] leading-relaxed transition-all ${cardStyle}`}
                >
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg font-mono text-[12px] font-bold ${badgeStyle}`}
                  >
                    {isRev && isExpected ? '✓' : LETTERS[optIdx] || optIdx + 1}
                  </span>
                  <span className="flex-1 font-medium">{option}</span>
                  {isRev && isExpected && (
                    <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                      应选
                    </span>
                  )}
                </button>
              );
            })}
            {!isRev && (
              <div className="pt-1">
                <button
                  type="button"
                  disabled={!Array.isArray(userAns) || userAns.length === 0}
                  onClick={() => handleConfirmQuestion(question)}
                  className="btn-pill w-full !py-2.5 !text-[13px] disabled:opacity-40"
                >
                  确认多选答案（已选 {Array.isArray(userAns) ? userAns.length : 0} 项）
                </button>
              </div>
            )}
          </div>
        )}

        {/* 兼容旧版填空题 */}
        {question.type === 'fill_blank' && (
          <div className="flex gap-2">
            <input
              type="text"
              value={String(userAns || '')}
              disabled={isRev}
              placeholder="输入关键词答案…"
              onChange={(e) => setAnswers((prev) => ({ ...prev, [question.id]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && String(userAns || '').trim()) {
                  handleConfirmQuestion(question);
                }
              }}
              className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-[13.5px] outline-none focus:border-[#0071e3]"
            />
            {!isRev && (
              <button
                type="button"
                disabled={!String(userAns || '').trim()}
                onClick={() => handleConfirmQuestion(question)}
                className="btn-pill shrink-0 !px-4 !py-2 !text-[13px] disabled:opacity-40"
              >
                核对答案
              </button>
            )}
          </div>
        )}

        {/* 即时深度解析与视频原声溯源抽屉 */}
        {isRev && (
          <div
            className={`mt-3 overflow-hidden rounded-2xl border p-3.5 transition-all duration-300 ${
              isCorrect
                ? 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.07] via-emerald-500/[0.03] to-white'
                : 'border-amber-500/35 bg-gradient-to-br from-amber-500/[0.08] via-amber-500/[0.03] to-white'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex h-5.5 w-5.5 items-center justify-center rounded-full text-[12px] font-bold text-white ${
                    isCorrect ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                >
                  {isCorrect ? '✓' : '💡'}
                </span>
                <span className={`text-[13px] font-bold ${isCorrect ? 'text-emerald-900' : 'text-amber-900'}`}>
                  {isCorrect ? '回答正确 · 认知锚定成功！' : '差一点点 · 来看看核心逻辑'}
                </span>
              </div>
              {!isCorrect && expectedAns !== undefined && (
                <span className="rounded-lg bg-white/90 px-2.5 py-0.5 text-[11.5px] font-semibold text-slate-800 shadow-2xs">
                  正确答案：{answerText(expectedAns)}
                </span>
              )}
            </div>

            {explanationText && (
              <p className="mt-2 text-[12.5px] leading-relaxed text-slate-700">
                <span className="font-semibold text-slate-900">深度解析：</span>
                {explanationText}
              </p>
            )}

            {(refText || (refTime !== undefined && refTime >= 0)) && (
              <div className="mt-2.5 flex flex-col justify-between gap-2 rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2 sm:flex-row sm:items-center">
                {refText ? (
                  <p className="flex-1 text-[12px] italic leading-relaxed text-slate-600">
                    “{refText}”
                  </p>
                ) : (
                  <span className="text-[12px] text-slate-500">原视频对应知识点片段</span>
                )}
                <div className="flex shrink-0 items-center gap-2">
                  {refTime !== undefined && (
                    <button
                      type="button"
                      onClick={() => onSeek(Number(refTime) || 0)}
                      className="inline-flex items-center gap-1 rounded-full bg-[#0071e3]/10 px-2.5 py-1 text-[11.5px] font-semibold text-[#0071e3] transition hover:bg-[#0071e3] hover:text-white"
                    >
                      <span>▶</span>
                      <span>跳至 {fmtTime(refTime)} 听原声</span>
                    </button>
                  )}
                  {timeLink(webpageUrl, refTime) && (
                    <a
                      href={timeLink(webpageUrl, refTime)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[12px] text-slate-400 hover:text-[#0071e3]"
                      title="在原站打开"
                    >
                      ↗
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ============================================================================
  // 视图 1：初始引导与极速生成态
  // ============================================================================
  if (!fullQuiz) {
    if (readOnly) {
      return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 py-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h4 className="mt-3 text-[15px] font-bold text-slate-800">分享者暂未生成本视频的互动评测</h4>
          <p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-slate-500">
            当前为只读分享模式，您可以浏览左侧「AI 总结」、「思维导图」、「逐字稿」或「AI 问答」内容。
          </p>
        </div>
      );
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 py-6 text-center">
        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0071e3] to-[#409cff] text-white shadow-md shadow-[#0071e3]/20">
          <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <h4 className="mt-4 text-[17px] font-bold tracking-tight text-slate-900">
          动态卡片闯关 · 巩固核心认知
        </h4>
        <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-slate-500">
          AI 基于视频核心方法论与实战案例生成互动卡片。即点即判、0 延迟展开原理解析，并支持一键跳回原视频对应秒数复盘。
        </p>

        {/* 特性徽章 */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[11.5px] font-medium text-slate-600">
          <span className="rounded-full bg-slate-100 px-3 py-1">✨ 即点即判零等待</span>
          <span className="rounded-full bg-slate-100 px-3 py-1">🎯 实战情景单选 & 认知辨析</span>
          <span className="rounded-full bg-slate-100 px-3 py-1">▶ 原片时间戳精准溯源</span>
        </div>

        {/* 题量档位选择器 */}
        <div className="mt-5 inline-flex rounded-full bg-slate-100 p-1 text-[12.5px]">
          <button
            type="button"
            disabled={generating}
            onClick={() => setTargetCount(6)}
            className={`rounded-full px-4 py-1.5 transition ${
              targetCount === 6 ? 'bg-white font-semibold text-slate-900 shadow-2xs' : 'text-slate-600'
            }`}
          >
            ⚡ 6 题快刷（约 3 分钟 · 极速）
          </button>
          <button
            type="button"
            disabled={generating}
            onClick={() => setTargetCount(10)}
            className={`rounded-full px-4 py-1.5 transition ${
              targetCount === 10 ? 'bg-white font-semibold text-slate-900 shadow-2xs' : 'text-slate-600'
            }`}
          >
            🏆 10 题深度挑战
          </button>
        </div>

        <button
          type="button"
          className="btn-pill mt-5 !px-7 !py-2.5 !text-[13.5px] shadow-sm shadow-[#0071e3]/20"
          disabled={generating}
          onClick={() => void onGenerateQuiz(targetCount)}
        >
          {generating ? `正在构建学习卡片 (${(genElapsedMs / 1000).toFixed(1)}s)…` : '开始卡片闯关'}
        </button>

        {generating && (
          <div className="mt-4 flex items-center gap-2 text-[12px] text-[#0071e3]">
            <span className="h-2 w-2 animate-ping rounded-full bg-[#0071e3]" />
            <span>
              {genElapsedMs < 2500
                ? '正在提炼视频核心考点与实战场景…'
                : '正在生成干扰项解析并锚定原片时间戳…'}
            </span>
          </div>
        )}
        {error && <p className="mt-3 text-[13px] text-red-500">{error}</p>}
      </div>
    );
  }

  // ============================================================================
  // 视图 2：Apple 通关奖章总结卡 (Summary View)
  // ============================================================================
  if (viewMode === 'summary') {
    const badgeInfo =
      stats.accuracy >= 85
        ? { title: '炉火纯青 · 核心逻辑完全掌握！', sub: '你已精准吃透本视频的方法论与关键细节。', emoji: '🏆' }
        : stats.accuracy >= 60
          ? { title: '融会贯通 · 整体框架已建立！', sub: '建议针对少量错题回看原视频片段加深印象。', emoji: '🌟' }
          : { title: '渐入佳境 · 值得二次复盘！', sub: '点击下方「仅重练错题」或回看对应时间戳即可快速突破。', emoji: '💪' };

    return (
      <div className="panel-scroll flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-5 py-6 text-center">
        <div className="w-full max-w-md rounded-3xl border border-slate-200/90 bg-gradient-to-b from-[#0071e3]/[0.05] via-white to-white p-6 shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#0071e3]/10 text-[32px]">
            {badgeInfo.emoji}
          </div>
          <div className="mt-3 font-mono text-[34px] font-extrabold tracking-tight text-slate-900">
            {stats.accuracy}
            <span className="text-[18px] font-semibold text-slate-400">%</span>
          </div>
          <h4 className="mt-1 text-[16px] font-bold text-slate-900">{badgeInfo.title}</h4>
          <p className="mt-1 text-[12.5px] text-slate-500">{badgeInfo.sub}</p>

          {/* 三宫格统计 */}
          <div className="mt-5 grid grid-cols-3 gap-2.5">
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-3">
              <div className="font-mono text-[18px] font-bold text-emerald-700">
                {stats.correctCount} / {activeQuestions.length}
              </div>
              <div className="mt-0.5 text-[11px] font-medium text-emerald-800/80">答对题数</div>
            </div>
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-3">
              <div className="font-mono text-[18px] font-bold text-amber-700">🔥 {stats.maxStreak}</div>
              <div className="mt-0.5 text-[11px] font-medium text-amber-800/80">最高连对</div>
            </div>
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.05] p-3">
              <div className="font-mono text-[18px] font-bold text-rose-600">{stats.wrongCount}</div>
              <div className="mt-0.5 text-[11px] font-medium text-rose-800/80">待攻克错题</div>
            </div>
          </div>

          {/* 动作按钮组 */}
          <div className="mt-6 flex flex-col gap-2.5">
            {stats.wrongCount > 0 && (
              <button
                type="button"
                onClick={handleRetryWrong}
                className="btn-pill w-full !py-2.5 !text-[13.5px]"
              >
                🎯 仅重练错题（{stats.wrongCount} 题专项突破）
              </button>
            )}
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => handleOpenFullPaper(true)}
                className="flex-1 rounded-full border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                📋 展开全卷复盘
              </button>
              {readOnly ? (
                <button
                  type="button"
                  onClick={isSandboxPractice ? handleRestoreOwnerResult : handleStartSandboxPractice}
                  className="flex-1 rounded-full border border-[#0071e3]/30 bg-[#0071e3]/10 px-4 py-2 text-[13px] font-semibold text-[#0071e3] transition hover:bg-[#0071e3] hover:text-white"
                >
                  {isSandboxPractice ? '👁 查看原分享结果' : '🎮 本地试做一遍'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void onGenerateQuiz(targetCount)}
                  className="flex-1 rounded-full border border-[#0071e3]/30 bg-[#0071e3]/10 px-4 py-2 text-[13px] font-semibold text-[#0071e3] transition hover:bg-[#0071e3] hover:text-white"
                >
                  🔄 再出一套新题
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // 视图 3：Apple 动态闯关卡片模式 (Deck View) 与 全卷速览模式 (List View)
  // ============================================================================
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* 顶部控制栏 */}
      <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2 lg:mb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h4 className="truncate text-[13.5px] font-bold text-slate-900 lg:text-[14.5px]">
            <span className="sm:hidden">{isRetryWrongMode ? '🎯 错题突破' : '随堂测验'}</span>
            <span className="hidden sm:inline">{isRetryWrongMode ? '🎯 错题专项突破' : fullQuiz.title}</span>
          </h4>
          {stats.currentStreak >= 2 && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-700 lg:px-2.5 lg:text-[11.5px]">
              🔥 {stats.currentStreak} 连对
            </span>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5 lg:gap-2">
          {readOnly ? (
            !isSandboxPractice ? (
              <button
                type="button"
                onClick={handleStartSandboxPractice}
                className="inline-flex items-center gap-1 rounded-full bg-[#0071e3]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#0071e3] transition hover:bg-[#0071e3] hover:text-white"
                title="在本地独立试做一遍（不修改分享者原记录）"
              >
                🎮 本地试做
              </button>
            ) : (
              <button
                type="button"
                onClick={handleRestoreOwnerResult}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50"
                title="恢复查看分享者的原始作答结果"
              >
                👁 恢复原结果
              </button>
            )
          ) : (
            <span
              className="hidden items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 lg:inline-flex"
              title="测验题目与您的作答进度已自动保存，重新打开本视频随时恢复"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              已保存
            </span>
          )}
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-[11.5px] font-semibold text-slate-700">
            ✓ {stats.correctCount} / {activeQuestions.length}
          </span>
          <div className="inline-flex rounded-full bg-slate-100 p-0.5 text-[11.5px]">
            <button
              type="button"
              onClick={() => setViewMode('deck')}
              className={`rounded-full px-2.5 py-1 transition ${
                viewMode === 'deck' ? 'bg-white font-semibold text-slate-900 shadow-2xs' : 'text-slate-600'
              }`}
            >
              🗂 卡片
            </button>
            <button
              type="button"
              onClick={() => handleOpenFullPaper(false)}
              className={`rounded-full px-2.5 py-1 transition ${
                viewMode === 'list' ? 'bg-white font-semibold text-slate-900 shadow-2xs' : 'text-slate-600'
              }`}
            >
              📋 全卷 ({fullQuiz.questions.length})
            </button>
          </div>
        </div>
      </div>

      {/* Apple Fitness 风格分段胶囊进度条（点击任意一格直接跳题） */}
      <div className="mb-3 flex shrink-0 items-center gap-1.5">
        {activeQuestions.map((q, idx) => {
          const isRev = Boolean(revealed[q.id]);
          const isOk = Boolean(correctnessMap[q.id]);
          const isCurrent = viewMode === 'deck' && idx === currentIndex;

          let barColor = 'bg-slate-200 hover:bg-slate-300';
          if (isRev) {
            barColor = isOk ? 'bg-emerald-500' : 'bg-rose-500';
          } else if (isCurrent) {
            barColor = 'bg-[#0071e3]';
          }

          return (
            <button
              key={q.id}
              type="button"
              onClick={() => {
                setViewMode('deck');
                setCurrentIndex(idx);
              }}
              title={`第 ${idx + 1} 题${isRev ? (isOk ? '（已答对）' : '（答错）') : ''}`}
              className={`h-2 flex-1 rounded-full transition-all duration-200 ${barColor} ${
                isCurrent ? 'ring-2 ring-[#0071e3]/35 ring-offset-1' : ''
              }`}
            />
          );
        })}
      </div>

      {/* 主体内容区：卡片闯关模式 vs 全卷列表模式 */}
      {viewMode === 'deck' && currentQuestion ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* 1. 中央独立可滚动卡片区 */}
          <div className="panel-scroll min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
              {/* 卡片顶部元信息栏 + 顶部快捷切题按钮 */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-lg bg-slate-900 px-2 py-0.5 font-mono text-[11px] font-bold text-white">
                    {String(currentIndex + 1).padStart(2, '0')} / {String(activeQuestions.length).padStart(2, '0')}
                  </span>
                  <span className="rounded-lg bg-[#0071e3]/10 px-2 py-0.5 text-[11px] font-semibold text-[#0071e3]">
                    {TYPE_LABELS[currentQuestion.type] || '互动题'}
                  </span>
                  {currentQuestion.dimension && (
                    <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                      🎯 {currentQuestion.dimension}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  {currentQuestion.reference_time !== undefined && currentQuestion.reference_time > 0 && (
                    <button
                      type="button"
                      onClick={() => onSeek(Number(currentQuestion.reference_time) || 0)}
                      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 font-mono text-[11px] font-medium text-slate-600 transition hover:bg-[#0071e3]/10 hover:text-[#0071e3]"
                      title="跳转到视频对应片段"
                    >
                      <span>▶</span>
                      <span>{fmtTime(currentQuestion.reference_time)}</span>
                    </button>
                  )}
                  <div className="inline-flex items-center rounded-full border border-slate-200/90 bg-slate-50/80 p-0.5 text-[11px]">
                    <button
                      type="button"
                      disabled={currentIndex === 0}
                      onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                      className="rounded-full px-2 py-0.5 font-medium text-slate-600 hover:bg-white hover:text-slate-900 disabled:opacity-35"
                      title="上一题 (←)"
                    >
                      ‹ 上一题
                    </button>
                    <button
                      type="button"
                      disabled={currentIndex >= activeQuestions.length - 1}
                      onClick={() => setCurrentIndex((i) => Math.min(activeQuestions.length - 1, i + 1))}
                      className="rounded-full px-2 py-0.5 font-medium text-slate-600 hover:bg-white hover:text-slate-900 disabled:opacity-35"
                      title="下一题 (→)"
                    >
                      下一题 ›
                    </button>
                  </div>
                </div>
              </div>

              {/* 题干 */}
              <h5 className="mt-3 text-[15px] font-bold leading-relaxed text-slate-900">
                {currentQuestion.stem}
              </h5>

              {/* 选项与即时解析区 */}
              {renderQuestionInteractive(currentQuestion)}
            </div>
          </div>

          {/* 2. 底部永远固定的翻页控制栏（脱离滚动容器，无需下滑即可点击） */}
          <div className="mt-2.5 flex shrink-0 items-center justify-between border-t border-slate-200/80 bg-white pt-2.5 text-[12.5px]">
            <button
              type="button"
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
              className="rounded-full border border-slate-200 px-3.5 py-1.5 font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
            >
              ← 上一题
            </button>

            <div className="flex items-center gap-3">
              {!revealed[currentQuestion.id] ? (
                <button
                  type="button"
                  onClick={() => setRevealed((prev) => ({ ...prev, [currentQuestion.id]: true }))}
                  className="text-[12px] font-medium text-slate-400 hover:text-[#0071e3]"
                >
                  直接看解析
                </button>
              ) : (
                <span className="hidden text-[11.5px] text-slate-400 sm:inline">
                  支持键盘 ← → 切题 · 数字键 1-4 快选
                </span>
              )}
            </div>

            {currentIndex < activeQuestions.length - 1 ? (
              <button
                type="button"
                onClick={() => setCurrentIndex((i) => Math.min(activeQuestions.length - 1, i + 1))}
                className={`rounded-full px-4 py-1.5 font-semibold transition ${
                  revealed[currentQuestion.id]
                    ? 'bg-[#0071e3] text-white shadow-2xs hover:bg-[#0077ed]'
                    : 'border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                下一题 →
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setViewMode('summary')}
                className="rounded-full bg-[#0071e3] px-4 py-1.5 font-semibold text-white shadow-2xs transition hover:bg-[#0077ed]"
              >
                查看奖章 🏆
              </button>
            )}
          </div>
        </div>
      ) : (
        /* 全卷全景试卷视图 (Compact Paper Sheet View —— 始终展示完整题库，紧凑排版，一屏多题顺畅滚动) */
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* 试卷顶部筛选与概览条 */}
          <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/90 px-3 py-1.5 text-[12px]">
            <div className="flex items-center gap-2 text-slate-600">
              <span className="font-semibold text-slate-800">
                📄 完整考卷（共 {fullQuiz.questions.length} 题）
              </span>
              <span>·</span>
              <span>
                已答 {fullQuiz.questions.filter((q) => revealed[q.id]).length} 题 / 答对{' '}
                <strong className="text-emerald-600">
                  {fullQuiz.questions.filter((q) => revealed[q.id] && evaluateQuestionLocal(q, answers[q.id])).length}
                </strong>{' '}
                题
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPaperFilter('all')}
                className={`rounded-full px-2.5 py-0.5 text-[11.5px] transition ${
                  paperFilter === 'all'
                    ? 'bg-slate-900 font-semibold text-white'
                    : 'text-slate-600 hover:bg-slate-200/70'
                }`}
              >
                全部题目 ({fullQuiz.questions.length})
              </button>
              <button
                type="button"
                onClick={() => setPaperFilter('wrong')}
                className={`rounded-full px-2.5 py-0.5 text-[11.5px] transition ${
                  paperFilter === 'wrong'
                    ? 'bg-rose-600 font-semibold text-white'
                    : 'text-slate-600 hover:bg-slate-200/70'
                }`}
              >
                仅看错题 (
                {
                  fullQuiz.questions.filter(
                    (q) => revealed[q.id] && !evaluateQuestionLocal(q, answers[q.id]),
                  ).length
                }
                )
              </button>
            </div>
          </div>

          {/* 试卷连贯滚动区（一整张紧凑长卷，上下顺滑滚动） */}
          <div className="panel-scroll min-h-0 flex-1 overflow-y-auto rounded-2xl border border-slate-200/90 bg-white px-4 divide-y divide-slate-100">
            {fullQuiz.questions
              .map((q, idx) => ({ q, idx }))
              .filter(({ q }) =>
                paperFilter === 'wrong'
                  ? revealed[q.id] && !evaluateQuestionLocal(q, answers[q.id])
                  : true,
              )
              .map(({ q, idx }) => {
                const isRev = Boolean(revealed[q.id]);
                const isOk = isRev && evaluateQuestionLocal(q, answers[q.id]);
                const userAns = answers[q.id];
                const expectedAns = q.correct_answer;

                return (
                  <div key={q.id} className="py-3.5 first:pt-3 last:pb-4">
                    {/* 题干与状态行 */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 text-[13.5px] font-bold leading-snug text-slate-900">
                        <span className="mr-1.5 inline-flex items-center rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-white">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <span className="mr-1.5 inline-flex items-center rounded bg-[#0071e3]/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-[#0071e3]">
                          {TYPE_LABELS[q.type]}
                        </span>
                        {q.dimension && (
                          <span className="mr-1.5 inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-medium text-slate-500">
                            {q.dimension}
                          </span>
                        )}
                        <span>{q.stem}</span>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        {isRev ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                              isOk
                                ? 'bg-emerald-500/12 text-emerald-700'
                                : 'bg-rose-500/12 text-rose-600'
                            }`}
                          >
                            {isOk ? '✓ 答对' : '✕ 答错'}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setRevealed((prev) => ({ ...prev, [q.id]: true }))}
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-[#0071e3]/10 hover:text-[#0071e3]"
                          >
                            看答案
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 紧凑选项列表（比单卡模式省一半高度，方便整卷速览与直接作答） */}
                    {q.type === 'single_choice' || q.type === 'multiple_choice' ? (
                      <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        {(q.options || []).map((opt, oIdx) => {
                          const isSelected =
                            q.type === 'multiple_choice'
                              ? Array.isArray(userAns) && userAns.includes(opt)
                              : userAns === opt;
                          const isExpected =
                            q.type === 'multiple_choice'
                              ? Array.isArray(expectedAns) &&
                                expectedAns.some((e) => normalizeCompareText(e) === normalizeCompareText(opt))
                              : normalizeCompareText(expectedAns) === normalizeCompareText(opt);

                          let rowStyle =
                            'border-slate-200/80 bg-slate-50/60 text-slate-700 hover:border-[#0071e3]/40';
                          if (isRev) {
                            if (isExpected) {
                              rowStyle = 'border-emerald-500/60 bg-emerald-500/10 font-semibold text-emerald-950';
                            } else if (isSelected && !isExpected) {
                              rowStyle = 'border-rose-400/60 bg-rose-500/10 text-rose-900 line-through';
                            } else {
                              rowStyle = 'border-slate-100 bg-slate-50/40 text-slate-400';
                            }
                          } else if (isSelected) {
                            rowStyle = 'border-[#0071e3] bg-[#0071e3]/10 font-semibold text-[#0071e3]';
                          }

                          return (
                            <button
                              key={oIdx}
                              type="button"
                              disabled={isRev}
                              onClick={() => {
                                if (q.type === 'single_choice') handleSelectInstant(q, opt);
                                else handleToggleMulti(q, opt);
                              }}
                              className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left text-[12.5px] leading-snug transition ${rowStyle}`}
                            >
                              <span className="font-mono text-[11px] font-bold opacity-75">
                                {LETTERS[oIdx]}.
                              </span>
                              <span className="min-w-0 flex-1">{opt}</span>
                            </button>
                          );
                        })}
                        {q.type === 'multiple_choice' && !isRev && (
                          <button
                            type="button"
                            onClick={() => handleConfirmQuestion(q)}
                            className="col-span-full mt-0.5 self-start rounded-full bg-[#0071e3] px-3 py-1 text-[11.5px] font-semibold text-white"
                          >
                            确认多选答案
                          </button>
                        )}
                      </div>
                    ) : q.type === 'true_false' ? (
                      <div className="mt-2 flex gap-2">
                        {[
                          { val: true, label: '✓ 正确' },
                          { val: false, label: '✕ 错误' },
                        ].map((item) => {
                          const isSelected = userAns === item.val;
                          const isExpected = expectedAns === item.val;
                          let btnStyle = 'border-slate-200 bg-slate-50 text-slate-700';
                          if (isRev) {
                            if (isExpected) btnStyle = 'border-emerald-500 bg-emerald-500/10 font-bold text-emerald-800';
                            else if (isSelected) btnStyle = 'border-rose-400 bg-rose-500/10 text-rose-700';
                            else btnStyle = 'border-slate-100 text-slate-400';
                          }
                          return (
                            <button
                              key={String(item.val)}
                              type="button"
                              disabled={isRev}
                              onClick={() => handleSelectInstant(q, item.val)}
                              className={`rounded-xl border px-4 py-1 text-[12.5px] transition ${btnStyle}`}
                            >
                              {item.label}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}

                    {/* 紧凑版解析条 */}
                    {isRev && (
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
                        <div className="min-w-0 flex-1 leading-relaxed">
                          <span className="font-semibold text-slate-800">
                            正确答案：{answerText(expectedAns)}
                          </span>
                          {q.explanation && <span className="ml-2 text-slate-600">｜ {q.explanation}</span>}
                        </div>
                        {q.reference_time !== undefined && q.reference_time > 0 && (
                          <button
                            type="button"
                            onClick={() => onSeek(Number(q.reference_time) || 0)}
                            className="shrink-0 rounded-full bg-[#0071e3]/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-[#0071e3] hover:bg-[#0071e3] hover:text-white"
                          >
                            ▶ {fmtTime(q.reference_time)} 听原声
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>

          {/* 底部固定操作栏（脱离滚动区，固定在最底部） */}
          <div className="mt-2.5 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 bg-white pt-2.5 text-[12px]">
            <button
              type="button"
              onClick={() => {
                const allRev: Record<string, boolean> = {};
                for (const q of fullQuiz.questions) allRev[q.id] = true;
                setRevealed(allRev);
              }}
              className="font-semibold text-[#0071e3] hover:underline"
            >
              ✨ 一键展开全卷答案与解析
            </button>

            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={() => {
                  setActiveQuestions(fullQuiz.questions);
                  setIsRetryWrongMode(false);
                  setViewMode('deck');
                }}
                className="rounded-full border border-slate-200 px-3.5 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
              >
                🗂 切回卡片闯关
              </button>
              <button
                type="button"
                onClick={() => setViewMode('summary')}
                className="rounded-full bg-slate-900 px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-slate-800"
              >
                🏆 成绩奖章
              </button>
              {readOnly ? (
                <button
                  type="button"
                  onClick={isSandboxPractice ? handleRestoreOwnerResult : handleStartSandboxPractice}
                  className="rounded-full border border-[#0071e3]/30 bg-[#0071e3]/10 px-3.5 py-1.5 text-[12px] font-semibold text-[#0071e3] hover:bg-[#0071e3] hover:text-white"
                >
                  {isSandboxPractice ? '👁 查看原分享结果' : '🎮 本地试做一遍'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void onGenerateQuiz(targetCount)}
                  className="rounded-full border border-[#0071e3]/30 bg-[#0071e3]/10 px-3.5 py-1.5 text-[12px] font-semibold text-[#0071e3] hover:bg-[#0071e3] hover:text-white"
                >
                  🔄 重新生成新题
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
