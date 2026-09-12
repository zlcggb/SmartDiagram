import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Download,
  MoreHorizontal,
  Search,
  WandSparkles,
  Sparkles,
  ChevronDown,
  Layers,
  CheckCircle2,
  FileText,
  History,
  Palette,
  Play
} from "lucide-react";
import { renderSlideIrToSvg, stringifySmartSlide } from "@ppt-agent/slide-ir";
import type { SlideIrDocument } from "@ppt-agent/slide-ir";
import type { PptExportTheme, PresentationStyleId, SlidePlanDto } from '@ppt-agent/shared';
import {
  getAccentPresetHex,
  getThemePack,
  normalizePresentationStyleId,
  resolvePresentationStyleId,
  searchReferenceForDraft
} from '@ppt-agent/shared';
import {
  exportThemeLabel,
  exportThemePreviewBg,
  isSlideDesignReady
} from "../lib/exportMode";
import {
  DesignConfigPanel,
  type DesignConfigTab
} from "../components/studio/DesignConfigPanel";
import { AgentExecutionPanel } from "../components/AgentExecutionPanel";
import { useWorkbenchStore, type StudioPhase } from '@/features/ppt/store/workbenchStore';
import { useStudioWizard } from '@/features/ppt/hooks/useStudioWizard';
import { WizardWaitBanner } from "../components/studio/WizardWaitBanner";
import { DesignVersionNavigator } from "../components/studio/DesignVersionNavigator";
import { DesignQualityFailurePanel } from "../components/studio/DesignQualityFailurePanel";
import {
  PageStyleChangePrompt,
  PageStyleControl
} from "../components/studio/PageStyleControl";
import {
  resolveAppliedPageStyle,
  styleSelectionNeedsRegeneration
} from "../lib/pageStyleState";
import { SlideThumbnail } from "../components/studio/SlideThumbnail";
import { SlideIrCanvas } from "../components/studio/SlideIrCanvas";
import { SlideSvgCanvas } from "../components/studio/SlideSvgCanvas";
import { StreamingDraftCanvas } from "../components/studio/StreamingDraftCanvas";
import { StreamingSearchCanvas } from "../components/studio/StreamingSearchCanvas";
import { SearchVisualCanvas } from "../components/studio/SearchVisualCanvas";
import { WorkspaceStudioPortal } from "../components/project-shell/WorkspaceStudioPortal";


const DEFAULT_BLANK_TITLE = "新增空白页";
const DEFAULT_BLANK_KEY = "请补充本页核心结论";
const SAVE_DEBOUNCE_MS = 450;

type SlideMetaDraft = {
  title: string;
  keyMessage: string;
  contentPointsText: string;
};

type PlanBlockDraft = {
  type: SlidePlanDto["contentBlocks"][number]["type"];
  title: string;
  itemsText: string;
};

type PlanDraft = {
  title: string;
  pageGoal: string;
  keyMessage: string;
  layoutType: string;
  contentBlocks: PlanBlockDraft[];
  sourceFactIds: string[];
};

type DesignViewMode = "preview" | "code";

function highlightSvgCode(source: string): ReactNode[] {
  const tokenPattern = /<!--[\s\S]*?-->|<\/?[A-Za-z][\w:.-]*|\/?>|[\w:.-]+(?=\s*=)|=|"[^"]*"|'[^']*'/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = 0;

  for (const match of source.matchAll(tokenPattern)) {
    const offset = match.index ?? 0;
    if (offset > cursor) nodes.push(source.slice(cursor, offset));
    const token = match[0];
    const className = token.startsWith("<!--")
      ? "svg-code-token-comment"
      : token.startsWith("<") || token === ">" || token === "/>"
        ? "svg-code-token-tag"
        : token.startsWith('"') || token.startsWith("'")
          ? "svg-code-token-value"
          : token === "="
            ? "svg-code-token-punctuation"
            : "svg-code-token-attribute";
    nodes.push(
      <span className={className} key={`${offset}-${index}`}>
        {token}
      </span>
    );
    cursor = offset + token.length;
    index += 1;
  }

  if (cursor < source.length) nodes.push(source.slice(cursor));
  return nodes;
}

function parseContentPoints(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function needsMetaHint(title: string, keyMessage: string) {
  const t = title.trim();
  const k = keyMessage.trim();
  return !t || t === DEFAULT_BLANK_TITLE || !k || k === DEFAULT_BLANK_KEY;
}

function draftFromSlide(slide: { title: string; keyMessage: string; contentPoints: string[] }): SlideMetaDraft {
  return {
    title: slide.title,
    keyMessage: slide.keyMessage,
    contentPointsText: (slide.contentPoints ?? []).join("\n")
  };
}


function planDraftFromPlan(plan: SlidePlanDto): PlanDraft {
  return {
    title: plan.title,
    pageGoal: plan.pageGoal,
    keyMessage: plan.keyMessage,
    layoutType: plan.layoutType,
    contentBlocks: plan.contentBlocks
      .filter((block) => block.type !== "summary")
      .map((block) => ({
        type: block.type,
        title: block.title,
        itemsText: (block.items ?? []).join("\n")
      })),
    sourceFactIds: plan.sourceFactIds ?? []
  };
}

function planFromDraft(draft: PlanDraft, existing?: SlidePlanDto | null): SlidePlanDto {
  return {
    title: draft.title.trim() || "未命名页面",
    pageGoal: draft.pageGoal.trim(),
    keyMessage: draft.keyMessage.trim(),
    layoutType: draft.layoutType,
    contentBlocks: draft.contentBlocks.map((block) => ({
      type: block.type,
      title: block.title.trim() || block.type,
      items: parseContentPoints(block.itemsText)
    })),
    sourceFactIds: draft.sourceFactIds,
    // 内部设计交接数据不在界面展示，编辑文案时需原样保留。
    visualHint: existing?.visualHint ?? undefined,
    designGuide: existing?.designGuide ?? undefined
  };
}

function planFingerprint(plan: SlidePlanDto | null | undefined) {
  if (!plan) return "";
  return JSON.stringify({
    title: plan.title,
    pageGoal: plan.pageGoal,
    keyMessage: plan.keyMessage,
    layoutType: plan.layoutType,
    contentBlocks: plan.contentBlocks
  });
}

function SlideMetaEditor({
  draft,
  onChange,
  onBlurSave,
  showHint
}: {
  draft: SlideMetaDraft;
  onChange: (next: SlideMetaDraft) => void;
  onBlurSave: () => void;
  showHint: boolean;
}) {
  return (
    <div className="space-y-4">
      {showHint ? (
        <p className="rounded-xl border border-[rgba(0,0,0,0.13)] bg-[rgba(0,0,0,0.03)] px-3 py-2 text-sm text-[rgba(0,0,0,0.9)]">
          先填写标题与核心结论再检索
        </p>
      ) : null}
      <div>
        <label className="block text-xs font-medium text-[rgba(0,0,0,0.45)]">标题</label>
        <input
          className="control mt-2 rounded-[10px]"
          value={draft.title}
          placeholder="本页标题"
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
          onBlur={onBlurSave}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-[rgba(0,0,0,0.45)]">关键结论</label>
        <textarea
          className="control mt-2 min-h-24 rounded-[10px]"
          value={draft.keyMessage}
          placeholder="本页要讲清的核心结论"
          onChange={(e) => onChange({ ...draft, keyMessage: e.target.value })}
          onBlur={onBlurSave}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-[rgba(0,0,0,0.45)]">内容要点（每行一条，可选）</label>
        <textarea
          className="control mt-2 min-h-28 rounded-[10px]"
          value={draft.contentPointsText}
          placeholder={"例如：\n本周进度\n风险与依赖\n下周计划"}
          onChange={(e) => onChange({ ...draft, contentPointsText: e.target.value })}
          onBlur={onBlurSave}
        />
      </div>
    </div>
  );
}


function PlanDraftEditor({
  draft,
  onChange,
  onBlurSave
}: {
  draft: PlanDraft;
  onChange: (next: PlanDraft) => void;
  onBlurSave: () => void;
}) {
  const blockTypeLabels: Record<PlanBlockDraft["type"], string> = {
    summary: "摘要",
    bullets: "要点",
    timeline: "步骤",
    table: "表格",
    callout: "补充说明"
  };

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-xs font-medium text-[rgba(0,0,0,0.45)]">页面标题</label>
        <input
          className="control mt-2 rounded-[10px]"
          value={draft.title}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
          onBlur={onBlurSave}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-[rgba(0,0,0,0.45)]">核心结论</label>
        <textarea
          className="control mt-2 min-h-20 rounded-[10px]"
          value={draft.keyMessage}
          onChange={(e) => onChange({ ...draft, keyMessage: e.target.value })}
          onBlur={onBlurSave}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-[rgba(0,0,0,0.45)]">正文内容</label>
      </div>
      <div className="space-y-3">
        {draft.contentBlocks.map((block, index) => (
          <div key={`${block.type}-${index}`} className="draft-wire rounded-xl border border-[rgba(0,0,0,0.13)] bg-[rgba(0,0,0,0.03)] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-[rgba(0,0,0,0.9)]">模块 {index + 1}</p>
              <span className="rounded-full bg-white px-2 py-1 text-[10px] text-[rgba(0,0,0,0.45)]">{blockTypeLabels[block.type]}</span>
            </div>
            <label className="block text-xs text-[rgba(0,0,0,0.45)]">模块标题</label>
            <input
              className="control mt-2 rounded-lg bg-white text-sm font-medium"
              value={block.title}
              onChange={(e) => {
                const contentBlocks = draft.contentBlocks.map((item, i) =>
                  i === index ? { ...item, title: e.target.value } : item
                );
                onChange({ ...draft, contentBlocks });
              }}
              onBlur={onBlurSave}
            />
            <label className="mt-3 block text-xs text-[rgba(0,0,0,0.45)]">模块内容（每行一条）</label>
            <textarea
              className="control mt-2 min-h-24 rounded-lg bg-white text-sm"
              value={block.itemsText}
              placeholder="每行一条要点"
              onChange={(e) => {
                const contentBlocks = draft.contentBlocks.map((item, i) =>
                  i === index ? { ...item, itemsText: e.target.value } : item
                );
                onChange({ ...draft, contentBlocks });
              }}
              onBlur={onBlurSave}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function StudioSpace() {
  const [searchParams, setSearchParams] = useSearchParams();
  const slides = useWorkbenchStore((s) => s.slides);
  const project = useWorkbenchStore((s) => s.project);
  const busy = useWorkbenchStore((s) => s.busy);
  const searchSlide = useWorkbenchStore((s) => s.searchSlide);
  const searchAllSlides = useWorkbenchStore((s) => s.searchAllSlides);
  const generateSlidePlan = useWorkbenchStore((s) => s.generateSlidePlan);
  const generateAllPlans = useWorkbenchStore((s) => s.generateAllPlans);
  const generateSlideDesign = useWorkbenchStore((s) => s.generateSlideDesign);
  const generateAllDesigns = useWorkbenchStore((s) => s.generateAllDesigns);
  const runPipeline = useWorkbenchStore((s) => s.runPipeline);
  const saveSlideSvg = useWorkbenchStore((s) => s.saveSlideSvg);
  const updateSlide = useWorkbenchStore((s) => s.updateSlide);
  const exportTheme = useWorkbenchStore((s) => s.exportTheme);
  const designGenerationMode = useWorkbenchStore((s) => s.designGenerationMode);
  const setDesignGenerationMode = useWorkbenchStore((s) => s.setDesignGenerationMode);
  const themeAccentId = useWorkbenchStore((s) => s.themeAccentId);
  const themeSurfaceId = useWorkbenchStore((s) => s.themeSurfaceId);
  const setThemeAccentId = useWorkbenchStore((s) => s.setThemeAccentId);
  const setThemeSurfaceId = useWorkbenchStore((s) => s.setThemeSurfaceId);
  const setProjectPresentationStyle = useWorkbenchStore((s) => s.setProjectPresentationStyle);
  const setExportTheme = useWorkbenchStore((s) => s.setExportTheme);
  const exportPptx = useWorkbenchStore((s) => s.exportPptx);
  const exportWarnings = useWorkbenchStore((s) => s.exportWarnings);
  const progressStages = useWorkbenchStore((s) => s.progressStages);
  const designVersions = useWorkbenchStore((s) => s.designVersions);
  const designVersionsSlideId = useWorkbenchStore((s) => s.designVersionsSlideId);
  const designVersionsLoading = useWorkbenchStore((s) => s.designVersionsLoading);
  const loadSlideDesignVersions = useWorkbenchStore((s) => s.loadSlideDesignVersions);
  const activateSlideDesignVersion = useWorkbenchStore((s) => s.activateSlideDesignVersion);
  const designQualityFailure = useWorkbenchStore((s) => s.designQualityFailure);
  const clearDesignQualityFailure = useWorkbenchStore((s) => s.clearDesignQualityFailure);

  const currentSlideId = searchParams.get("slide") ?? slides[0]?.id ?? null;
  const targetSlide = slides.find((s) => s.id === currentSlideId);
  const defaultPhase: StudioPhase = targetSlide?.svgPreview || targetSlide?.irJson ? "design" : (targetSlide?.planJson ? "draft" : "design");
  const currentPhase = (searchParams.get("phase") as StudioPhase) ?? defaultPhase;

  function setSlideInUrl(slideId: string) {
    useWorkbenchStore.setState({ selectedSlideId: slideId });
    setSearchParams((prev) => {
      prev.set("slide", slideId);
      return prev;
    });
  }

  // 监听 URL 参数同步 store 中的 selectedSlideId
  useEffect(() => {
    if (currentSlideId && currentSlideId !== useWorkbenchStore.getState().selectedSlideId) {
      useWorkbenchStore.setState({ selectedSlideId: currentSlideId });
    }
  }, [currentSlideId]);

  function setPhaseInUrl(phase: StudioPhase) {
    setSearchParams((prev) => {
      prev.set("phase", phase);
      return prev;
    });
  }

  const navigate = useNavigate();
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!actionMenuOpen && !exportMenuOpen && !moreMenuOpen) return;
    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (actionMenuOpen && !actionMenuRef.current?.contains(target)) {
        setActionMenuOpen(false);
      }
      if (exportMenuOpen && !exportMenuRef.current?.contains(target)) {
        setExportMenuOpen(false);
      }
      if (moreMenuOpen && !moreMenuRef.current?.contains(target)) {
        setMoreMenuOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setActionMenuOpen(false);
        setExportMenuOpen(false);
        setMoreMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [actionMenuOpen, exportMenuOpen, moreMenuOpen]);

  const [metaDraft, setMetaDraft] = useState<SlideMetaDraft>({
    title: "",
    keyMessage: "",
    contentPointsText: ""
  });
  const [planDraft, setPlanDraft] = useState<PlanDraft | null>(null);
  const [draftEntryGenerating, setDraftEntryGenerating] = useState(false);
  const [designViewMode, setDesignViewMode] = useState<DesignViewMode>("preview");
  const [designConfigTab, setDesignConfigTab] = useState<DesignConfigTab>("theme");
  const [svgEditorValue, setSvgEditorValue] = useState("");
  const [svgEditorBaseline, setSvgEditorBaseline] = useState("");
  const [svgEditorSaving, setSvgEditorSaving] = useState(false);
  const [exportPromptOpen, setExportPromptOpen] = useState(false);
  const [exportScope, setExportScope] = useState<"current" | "ready" | "all">("all");
  const [pendingPageStyles, setPendingPageStyles] = useState<
    Record<string, { configuredStyle: PresentationStyleId | null }>
  >({});
  const metaSlideIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const planSaveTimerRef = useRef<number | null>(null);
  const designCodeViewportRef = useRef<HTMLTextAreaElement | null>(null);
  const designCodeHighlightRef = useRef<HTMLPreElement | null>(null);
  const wasDesignStreamingRef = useRef(false);
  const pendingSaveRef = useRef<{
    slideId: string;
    title: string;
    keyMessage: string;
    contentPoints: string[];
  } | null>(null);
  const pendingPlanSaveRef = useRef<{ slideId: string; plan: SlidePlanDto } | null>(null);

  const selected = useMemo(() => {
    return slides.find((s) => s.id === currentSlideId) ?? slides[0] ?? null;
  }, [slides, currentSlideId]);
  const projectPresentationStyle = normalizePresentationStyleId(
    project?.presentationStyle
  );
  const slidePresentationStyle = selected?.presentationStyle ?? null;
  const fallbackAppliedPageStyle = resolvePresentationStyleId(
    projectPresentationStyle,
    slidePresentationStyle
  );
  const appliedPageStyle = selected
    ? resolveAppliedPageStyle({
        slideId: selected.id,
        loadedSlideId: designVersionsSlideId,
        activeVersionId: selected.activeDesignVersionId ?? null,
        versions: designVersions,
        fallbackStyle: fallbackAppliedPageStyle
      })
    : projectPresentationStyle;
  const storedPendingPageStyleChange = selected
    ? pendingPageStyles[selected.id]
    : undefined;
  const pendingPageStyleChange =
    selected &&
    storedPendingPageStyleChange &&
    styleSelectionNeedsRegeneration(
      projectPresentationStyle,
      appliedPageStyle,
      storedPendingPageStyleChange.configuredStyle
    )
      ? storedPendingPageStyleChange
      : undefined;
  const selectedConfiguredPageStyle = pendingPageStyleChange
    ? pendingPageStyleChange.configuredStyle
    : slidePresentationStyle;
  const requestedPageStyle = resolvePresentationStyleId(
    projectPresentationStyle,
    selectedConfiguredPageStyle
  );

  const flushMetaSave = async () => {
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    if (!pending) return;
    pendingSaveRef.current = null;

    const current = useWorkbenchStore.getState().slides.find((slide) => slide.id === pending.slideId);
    if (!current) return;

    const title = pending.title.trim() || DEFAULT_BLANK_TITLE;
    const keyMessage = pending.keyMessage.trim() || DEFAULT_BLANK_KEY;
    const contentPoints = pending.contentPoints;
    const unchanged =
      current.title === title &&
      current.keyMessage === keyMessage &&
      JSON.stringify(current.contentPoints ?? []) === JSON.stringify(contentPoints);
    if (unchanged) return;

    await updateSlide(pending.slideId, { title, keyMessage, contentPoints });
  };

  const queueMetaSave = (slideId: string, draft: SlideMetaDraft) => {
    pendingSaveRef.current = {
      slideId,
      title: draft.title,
      keyMessage: draft.keyMessage,
      contentPoints: parseContentPoints(draft.contentPointsText)
    };
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      void flushMetaSave();
    }, SAVE_DEBOUNCE_MS);
  };

  const flushPlanSave = async () => {
    if (planSaveTimerRef.current != null) {
      window.clearTimeout(planSaveTimerRef.current);
      planSaveTimerRef.current = null;
    }
    const pending = pendingPlanSaveRef.current;
    if (!pending) return;
    pendingPlanSaveRef.current = null;
    const current = useWorkbenchStore.getState().slides.find((slide) => slide.id === pending.slideId);
    if (!current?.planJson) return;
    if (planFingerprint(current.planJson) === planFingerprint(pending.plan)) return;
    await updateSlide(pending.slideId, { planJson: pending.plan });
  };

  const queuePlanSave = (slideId: string, draft: PlanDraft) => {
    const existing = useWorkbenchStore.getState().slides.find((slide) => slide.id === slideId)?.planJson;
    pendingPlanSaveRef.current = { slideId, plan: planFromDraft(draft, existing) };
    if (planSaveTimerRef.current != null) {
      window.clearTimeout(planSaveTimerRef.current);
    }
    planSaveTimerRef.current = window.setTimeout(() => {
      void flushPlanSave();
    }, SAVE_DEBOUNCE_MS);
  };

  // 切页时先落盘上一页草稿，再载入当前页
  useEffect(() => {
    const slideId = selected?.id ?? null;
    if (metaSlideIdRef.current && metaSlideIdRef.current !== slideId) {
      void flushMetaSave();
      void flushPlanSave();
    }
    metaSlideIdRef.current = slideId;
    if (selected) {
      setMetaDraft(draftFromSlide(selected));
    } else {
      setMetaDraft({ title: "", keyMessage: "", contentPointsText: "" });
    }
    // 仅随选中页切换同步；避免乐观更新回写打断输入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // 切页时载入初稿；重新生成完成后（busy 落下）再覆盖本地编辑态
  const prevBusyRef = useRef(busy);
  useEffect(() => {
    if (selected?.planJson) {
      setPlanDraft(planDraftFromPlan(selected.planJson));
    } else {
      setPlanDraft(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  useEffect(() => {
    const wasBusy = prevBusyRef.current;
    prevBusyRef.current = busy;
    if (wasBusy && !busy && selected?.planJson && (wasBusy.includes("初稿") || wasBusy.includes("策划"))) {
      setPlanDraft(planDraftFromPlan(selected.planJson));
    }
  }, [busy, selected?.planJson]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
      }
      if (planSaveTimerRef.current != null) {
        window.clearTimeout(planSaveTimerRef.current);
      }
      void flushMetaSave();
      void flushPlanSave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { runWizard, cancelWizard, continueWizard, wizardState, secondsLeft, isWizardRunning } = useStudioWizard({
    setPhaseInUrl,
    flushMetaSave,
    flushPlanSave
  });
  const searchJson = selected?.searchJson;
  const plan = selected?.planJson;
  const draftResearch = searchReferenceForDraft(searchJson);

  // 关键单页沙箱隔离：若当前选中的页面已经拥有初稿策划，坚决不进入 isGeneratingDraft，直接呈现编辑界面！
  const planStage = progressStages.plan;
  const planIsRunning = planStage?.status === "running";
  const planIsForCurrentSlide = Boolean(selected && planStage?.slideId === selected.id);
  const isGeneratingDraft = Boolean(
    !plan && (
      draftEntryGenerating ||
      (busy && (busy.includes("初稿") || busy.includes("策划"))) ||
      (planIsRunning && planIsForCurrentSlide)
    )
  );

  // 单页专属流式 Delta：优先取 slideDeltas[selected.id]，避免多页并发时文本混杂
  const streamedPlanDelta = useMemo(() => {
    if (!selected) return "";
    const perSlide = planStage?.slideDeltas?.[selected.id];
    if (perSlide) return perSlide;
    if (planStage?.slideId === selected.id && planStage?.delta) {
      return planStage.delta;
    }
    return "";
  }, [selected, planStage?.slideDeltas, planStage?.slideId, planStage?.delta]);

  const searchStage = progressStages.search;
  const searchIsRunning = searchStage?.status === "running";
  const searchIsForCurrentSlide = Boolean(selected && searchStage?.slideId === selected.id);
  // 关键单页沙箱隔离：若当前选中的页面已拥有检索事实，不被全局 busy 遮蔽，直接展示检索卡片！
  const isSearching = Boolean(
    !searchJson && (
      (busy && (busy.includes("检索") || busy.includes("素材"))) ||
      (searchIsRunning && searchIsForCurrentSlide)
    )
  );
  const showMetaHint = needsMetaHint(metaDraft.title, metaDraft.keyMessage);

  const handleMetaChange = (next: SlideMetaDraft) => {
    setMetaDraft(next);
    if (selected) queueMetaSave(selected.id, next);
  };

  const handlePlanChange = (next: PlanDraft) => {
    setPlanDraft(next);
    if (selected) queuePlanSave(selected.id, next);
  };

  const runWithMetaFlush = async (action: () => Promise<void>) => {
    await flushMetaSave();
    await flushPlanSave();
    await action();
  };

  const clearPendingPageStyle = (slideId: string) => {
    setPendingPageStyles((current) => {
      if (!Object.hasOwn(current, slideId)) return current;
      const next = { ...current };
      delete next[slideId];
      return next;
    });
  };

  const handlePageStyleChange = (configuredStyle: PresentationStyleId | null) => {
    if (!selected) return;
    const needsRegeneration =
      Boolean(selected.svgPreview) &&
      styleSelectionNeedsRegeneration(
        projectPresentationStyle,
        appliedPageStyle,
        configuredStyle
      );

    if (!needsRegeneration) {
      clearPendingPageStyle(selected.id);
      if (configuredStyle !== slidePresentationStyle) {
        void updateSlide(selected.id, { presentationStyle: configuredStyle });
      }
      return;
    }

    setPendingPageStyles((current) => ({
      ...current,
      [selected.id]: { configuredStyle }
    }));
  };

  const regenerateWithPendingPageStyle = async () => {
    if (!selected || !pendingPageStyleChange || busy) return;
    const slideId = selected.id;
    const configuredStyle = pendingPageStyleChange.configuredStyle;
    await flushMetaSave();
    await flushPlanSave();
    const succeeded = await generateSlideDesign(slideId, {
      presentationStyle: configuredStyle
    });
    if (succeeded) clearPendingPageStyle(slideId);
  };

  const generateAndEnterDraft = () => {
    if (!selected || busy) return;
    const slideId = selected.id;
    setDraftEntryGenerating(true);
    setPhaseInUrl("draft");
    void runWithMetaFlush(() => generateSlidePlan(slideId)).finally(() => setDraftEntryGenerating(false));
  };

  const svgEditorSource =
    svgEditorBaseline === (selected?.svgPreview ?? "") ? svgEditorValue : selected?.svgPreview ?? "";
  const svgEditorDirty = Boolean(selected?.svgPreview) && svgEditorValue !== svgEditorBaseline;
  const selectedUsesSlideIr = Boolean(
    selected?.renderStrategy === "ir" && selected.irJson
  );
  const storedDesignSource =
    selectedUsesSlideIr && selected?.irJson
      ? stringifySmartSlide(selected.irJson)
      : svgEditorSource;

  const editorThemeStyle = useMemo(() => {
    const pack = getThemePack(exportTheme);
    const accent = getAccentPresetHex(exportTheme, themeAccentId);
    return {
      "--svg-stream-bg": pack.family === "dark" ? "#f3f6fb" : pack.tokens.bg,
      "--svg-stream-toolbar": "rgba(255,255,255,0.88)",
      "--svg-stream-line": pack.tokens.border,
      "--svg-stream-text": "#243447",
      "--svg-stream-muted": "#718096",
      "--svg-stream-accent": accent
    } as CSSProperties;
  }, [exportTheme, themeAccentId]);

  const designStage = progressStages.design;
  const designStreamMatchesSelected = Boolean(
    selected && (!designStage?.slideId || designStage.slideId === selected.id)
  );
  const designGenerationBusy = Boolean(
    busy && /生成本页设计稿|生成 SVG 预览|全部设计稿生成/u.test(busy)
  );
  const showDesignCodeStream = Boolean(
    currentPhase === "design" &&
      designStreamMatchesSelected &&
      (designStage?.status === "running" || (designGenerationBusy && !selected?.svgPreview))
  );
  const streamedDesignCode = designStage?.delta || "";
  const streamWaitingCopy = designStage?.message
    ? designGenerationMode === "slide-ir"
      ? `# ${designStage.message}\n# 已连接进度流，等待模型返回 SmartSlide JSON…`
      : `<!-- ${designStage.message} -->\n<!-- 已连接进度流，等待模型返回 SVG 源码… -->`
    : designGenerationMode === "slide-ir"
      ? [
          "# 正在准备 SmartSlide 设计上下文…",
          "# 模型开始返回后，结构化设计源码会在这里显示",
          "# 画布约束：1280 × 720"
        ].join("\n")
      : [
          "<!-- 正在准备 SVG 设计上下文… -->",
          "<!-- 模型开始返回后，SVG 源码会在这里逐块显示 -->",
          "<!-- 画布约束：1280 × 720 · 内容安全边距：32px -->"
        ].join("\n");
  const effectiveDesignViewMode: DesignViewMode = showDesignCodeStream ? "code" : designViewMode;
  const displayedDesignCode = showDesignCodeStream
    ? streamedDesignCode
    : storedDesignSource;
  const editorRenderedCode =
    displayedDesignCode ||
    (showDesignCodeStream
      ? streamWaitingCopy
      : designGenerationMode === "slide-ir"
        ? "# 尚未生成 SmartSlide 设计稿"
        : "<!-- 尚未生成 SVG 设计稿 -->");
  const highlightedDesignCode = useMemo(
    () =>
      selectedUsesSlideIr && !showDesignCodeStream
        ? [editorRenderedCode]
        : highlightSvgCode(editorRenderedCode),
    [editorRenderedCode, selectedUsesSlideIr, showDesignCodeStream]
  );

  useEffect(() => {
    const source = selected?.svgPreview ?? "";
    setSvgEditorValue(source);
    setSvgEditorBaseline(source);
    setSvgEditorSaving(false);
  }, [selected?.id, selected?.svgPreview]);

  useEffect(() => {
    setDesignViewMode("preview");
  }, [selected?.id]);

  useEffect(() => {
    if (
      currentPhase !== "design" ||
      !selected?.id ||
      designVersionsLoading ||
      designVersionsSlideId === selected.id
    ) {
      return;
    }
    void loadSlideDesignVersions(selected.id);
  }, [
    currentPhase,
    designVersionsLoading,
    designVersionsSlideId,
    loadSlideDesignVersions,
    selected?.id
  ]);

  useEffect(() => {
    if (showDesignCodeStream) {
      wasDesignStreamingRef.current = true;
      return;
    }
    if (wasDesignStreamingRef.current) {
      wasDesignStreamingRef.current = false;
      setDesignViewMode("preview");
    }
  }, [showDesignCodeStream]);

  useEffect(() => {
    if (!showDesignCodeStream) return;
    const viewport = designCodeViewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
    const highlight = designCodeHighlightRef.current;
    if (viewport && highlight) {
      highlight.scrollTop = viewport.scrollTop;
      highlight.scrollLeft = viewport.scrollLeft;
    }
  }, [displayedDesignCode, showDesignCodeStream]);

   const saveEditedSvg = async () => {
    if (!selected || !svgEditorDirty || svgEditorSaving || showDesignCodeStream) return;
    setSvgEditorSaving(true);
    try {
      await saveSlideSvg(selected.id, svgEditorValue.trim());
    } catch {
      // Store 已保留用户编辑并显示服务端校验错误；此处避免未处理的 Promise rejection。
    } finally {
      setSvgEditorSaving(false);
    }
  };

  /** 画布内文本编辑后，重新渲染 SVG 并保存 */
  const handleIrChange = useCallback(
    (updatedIr: SlideIrDocument) => {
      if (!selected) return;
      try {
        const newSvg = renderSlideIrToSvg(updatedIr);
        // 乐观更新：先更新本地 slides 的 irJson 和 svgPreview
        const updatedSlides = useWorkbenchStore.getState().slides.map((s) =>
          s.id === selected.id
            ? { ...s, irJson: updatedIr, svgPreview: newSvg }
            : s
        );
        useWorkbenchStore.setState({ slides: updatedSlides });
        // 异步保存到后端
        void saveSlideSvg(selected.id, newSvg);
      } catch {
        // 渲染失败时静默，不中断编辑体验
      }
    },
    [selected, saveSlideSvg]
  );

  /** 纯 SVG 画布文字编辑后保存 */
  const handleSvgChange = useCallback(
    (newSvg: string) => {
      if (!selected) return;
      // 乐观更新
      const updatedSlides = useWorkbenchStore.getState().slides.map((s) =>
        s.id === selected.id ? { ...s, svgPreview: newSvg } : s
      );
      useWorkbenchStore.setState({ slides: updatedSlides });
      void saveSlideSvg(selected.id, newSvg);
    },
    [selected, saveSlideSvg]
  );

  const activateDesignVersion = async (versionId: string) => {
    if (!selected || versionId === selected.activeDesignVersionId) return;
    if (
      svgEditorDirty &&
      !window.confirm("当前 SVG 修改尚未保存，切换版本将放弃这些修改。是否继续？")
    ) {
      return;
    }
    if (svgEditorDirty) {
      setSvgEditorValue(svgEditorBaseline);
    }
    try {
      await activateSlideDesignVersion(selected.id, versionId);
    } catch {
      // Store 已保留当前版本并展示错误；避免产生未处理的 Promise rejection。
    }
  };

  /** AI 按主题重排布局（深色/浅色构图差异大时用） */
  const regenerateCurrentForTheme = async () => {
    if (!selected) return;
    if (pendingPageStyleChange) {
      await regenerateWithPendingPageStyle();
      return;
    }
    await runWizard(selected.id);
  };

  const generateAndEnterDesign = () => {
    if (!selected || busy || isWizardRunning) return;
    void runWizard(selected.id);
  };

  const handleThemeChange = async (theme: PptExportTheme) => {
    if (theme === exportTheme || Boolean(busy)) return;
    await setExportTheme(theme);
  };

  const readySlides = useMemo(() => slides.filter((slide) => isSlideDesignReady(slide)), [slides]);
  const currentDesignReady = Boolean(selected && isSlideDesignReady(selected));
  const selectedDesignQualityFailure =
    selected && designQualityFailure?.slideId === selected.id
      ? designQualityFailure
      : null;

  const runExport = async (svgExportMode: "fidelity" | "editable") => {
    setExportPromptOpen(false);
    await flushPlanSave();
    const slideIds =
      exportScope === "current"
        ? selected
          ? [selected.id]
          : undefined
        : exportScope === "ready"
          ? readySlides.map((slide) => slide.id)
          : undefined;
    await exportPptx(undefined, { slideIds, fillMissing: false, svgExportMode });
  };

  const handleExportClick = () => {
    if (slides.length === 0) return;
    setExportScope(readySlides.length === slides.length ? "all" : "ready");
    setExportPromptOpen(true);
  };

  const handleExportCurrentClick = () => {
    if (!selected || !currentDesignReady) return;
    setExportScope("current");
    setExportPromptOpen(true);
  };

  return (
    <div className="space-y-6">
      <WorkspaceStudioPortal>
      <div className="studio-command-bar">
        {/* 3. 工作室流程：检索 —— 初稿 —— 视觉 */}
        <div
          className="studio-phase-stepper"
          role="tablist"
          aria-label="工作室工作阶段"
        >
          {[
            { id: "search" as const, label: "检索" },
            { id: "draft" as const, label: "初稿" },
            { id: "design" as const, label: "视觉" }
          ].map((item, index) => {
            const isActive = currentPhase === item.id;
            return (
              <div key={item.id} className="studio-phase-stepper__item">
                {index > 0 && <span className="studio-phase-stepper__line" aria-hidden="true" />}
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`studio-phase-stepper__btn ${isActive ? "is-active" : ""}`}
                  onClick={() => setPhaseInUrl(item.id)}
                >
                  {item.label}
                </button>
              </div>
            );
          })}
        </div>

        <div className="studio-toolbar-actions">
          {/* 4. 当前生成方式：SVG / SmartSlide */}
          <div
            className="studio-design-engine"
            role="group"
            aria-label="设计生成引擎"
          >
            {(
              [
                ["svg", "SVG"],
                ["slide-ir", "Smart"]
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                disabled={Boolean(busy)}
                className={`studio-design-engine__btn ${
                  designGenerationMode === mode ? "is-active" : ""
                }`}
                title={
                  mode === "slide-ir"
                    ? "SmartSlide：结构化对象模型，优先导出为原生可编辑 PPT 元素"
                    : "SVG：自由矢量画布，视觉表达更丰富"
                }
                onClick={() => setDesignGenerationMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 5. 页面主操作：拆分按钮（生成本页 + 下拉箭头） */}
          <div ref={actionMenuRef} className="studio-split-button studio-split-button--primary">
            <button
              type="button"
              className="studio-split-button__main"
              disabled={
                Boolean(busy) ||
                isWizardRunning ||
                (currentPhase === "draft" && !selected) ||
                (currentPhase === "design" && !selected)
              }
              onClick={() => {
                if (currentPhase === "search") {
                  void runWithMetaFlush(() => searchAllSlides());
                } else if (currentPhase === "draft") {
                  if (selected) void runWithMetaFlush(() => generateSlidePlan(selected.id));
                } else {
                  if (!selected) return;
                  if (pendingPageStyleChange) {
                    void regenerateWithPendingPageStyle();
                  } else {
                    void runWizard(selected.id);
                  }
                }
              }}
              title={
                currentPhase === "search"
                  ? "检索全部幻灯片所需资料"
                  : currentPhase === "draft"
                    ? "生成当前选中页的结构初稿"
                    : pendingPageStyleChange
                      ? "按已选择的新风格重新生成本页"
                      : `使用${designGenerationMode === "slide-ir" ? " SmartSlide" : " SVG"}生成本页设计稿`
              }
            >
              <WandSparkles className="h-4 w-4" />
              <span>
                {currentPhase === "search"
                  ? "全部检索"
                  : pendingPageStyleChange
                    ? "按新风格重新生成"
                    : "生成本页"}
              </span>
            </button>
            <button
              type="button"
              className={`studio-split-button__trigger ${actionMenuOpen ? "is-open" : ""}`}
              aria-haspopup="menu"
              aria-expanded={actionMenuOpen}
              onClick={() => setActionMenuOpen((v) => !v)}
              title="更多生成与自动化选项"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${actionMenuOpen ? "rotate-180" : ""}`} />
            </button>

            {actionMenuOpen ? (
              <div className="studio-dropdown-menu" role="menu">
                <button
                  type="button"
                  className="studio-dropdown-menu__item"
                  disabled={Boolean(busy) || isWizardRunning}
                  onClick={() => {
                    setActionMenuOpen(false);
                    void generateAllDesigns();
                  }}
                >
                  <Sparkles className="h-4 w-4 text-blue-600" />
                  <span>全部生成设计稿</span>
                </button>
                <button
                  type="button"
                  className="studio-dropdown-menu__item"
                  disabled={Boolean(busy) || !selected || isWizardRunning}
                  onClick={() => {
                    setActionMenuOpen(false);
                    void regenerateWithPendingPageStyle();
                  }}
                >
                  <Palette className="h-4 w-4 text-purple-600" />
                  <span>按新风格重新生成</span>
                </button>
                <button
                  type="button"
                  className="studio-dropdown-menu__item"
                  disabled={Boolean(busy) || !project}
                  onClick={() => {
                    setActionMenuOpen(false);
                    void runPipeline();
                  }}
                >
                  <Play className="h-4 w-4 text-emerald-600" />
                  <span>全部自动生成</span>
                </button>
                <div className="studio-dropdown-menu__divider" />
                <button
                  type="button"
                  className="studio-dropdown-menu__item"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setActionMenuOpen(false);
                    void runWithMetaFlush(() => generateAllPlans());
                  }}
                >
                  <FileText className="h-4 w-4 text-amber-600" />
                  <span>全部生成初稿</span>
                </button>
                <button
                  type="button"
                  className="studio-dropdown-menu__item"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setActionMenuOpen(false);
                    void runWithMetaFlush(() => searchAllSlides());
                  }}
                >
                  <Search className="h-4 w-4 text-sky-600" />
                  <span>全部重新检索</span>
                </button>
              </div>
            ) : null}
          </div>

          {/* 6. 导出 PPTX：拆分按钮（导出 PPTX + 下拉箭头） */}
          <div ref={exportMenuRef} className="studio-split-button studio-split-button--secondary">
            <button
              type="button"
              className="studio-split-button__main"
              disabled={Boolean(busy) || slides.length === 0}
              onClick={handleExportClick}
              title="导出 PPTX（默认弹出选择范围与画质）"
            >
              <Download className="h-4 w-4" />
              <span>{busy?.includes("导出") ? busy : "导出 PPTX"}</span>
            </button>
            <button
              type="button"
              className={`studio-split-button__trigger ${exportMenuOpen ? "is-open" : ""}`}
              aria-haspopup="menu"
              aria-expanded={exportMenuOpen}
              onClick={() => setExportMenuOpen((v) => !v)}
              title="更多导出选项"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${exportMenuOpen ? "rotate-180" : ""}`} />
            </button>

            {exportMenuOpen ? (
              <div className="studio-dropdown-menu" role="menu">
                <button
                  type="button"
                  className="studio-dropdown-menu__item"
                  disabled={Boolean(busy) || !selected || !currentDesignReady}
                  onClick={() => {
                    setExportMenuOpen(false);
                    handleExportCurrentClick();
                  }}
                  title={currentDesignReady ? "只导出当前选中页" : "当前页尚未生成设计稿"}
                >
                  <FileText className="h-4 w-4 text-neutral-600" />
                  <span>仅导出当前页</span>
                </button>
                <button
                  type="button"
                  className="studio-dropdown-menu__item"
                  disabled={Boolean(busy) || readySlides.length === 0}
                  onClick={() => {
                    setExportMenuOpen(false);
                    setExportScope("ready");
                    setExportPromptOpen(true);
                  }}
                >
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>导出已完成页面 ({readySlides.length} 页)</span>
                </button>
                <button
                  type="button"
                  className="studio-dropdown-menu__item"
                  disabled={Boolean(busy) || slides.length === 0}
                  onClick={() => {
                    setExportMenuOpen(false);
                    setExportScope("all");
                    setExportPromptOpen(true);
                  }}
                >
                  <Layers className="h-4 w-4 text-blue-600" />
                  <span>导出全部页面 ({slides.length} 页)</span>
                </button>
                <div className="studio-dropdown-menu__divider" />
                <button
                  type="button"
                  className="studio-dropdown-menu__item"
                  onClick={() => {
                    setExportMenuOpen(false);
                    navigate("../director");
                  }}
                >
                  <History className="h-4 w-4 text-neutral-500" />
                  <span>查看导出记录</span>
                </button>
              </div>
            ) : null}
          </div>

          {/* 7. 更多操作：··· 按钮 */}
          <div ref={moreMenuRef} className="studio-more-container">
            <button
              type="button"
              className={`studio-more-button ${moreMenuOpen ? "is-open" : ""}`}
              onClick={() => setMoreMenuOpen((v) => !v)}
              aria-label="更多操作"
              title="更多操作"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
            {moreMenuOpen ? (
              <div className="studio-dropdown-menu studio-dropdown-menu--right" role="menu">
                <button
                  type="button"
                  className="studio-dropdown-menu__item"
                  disabled={Boolean(busy) || !project}
                  onClick={() => {
                    setMoreMenuOpen(false);
                    void runPipeline();
                  }}
                >
                  <WandSparkles className="h-4 w-4 text-amber-600" />
                  <span>全部自动生成</span>
                </button>
                <button
                  type="button"
                  className="studio-dropdown-menu__item"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setMoreMenuOpen(false);
                    void runWithMetaFlush(() => searchAllSlides());
                  }}
                >
                  <Search className="h-4 w-4 text-blue-600" />
                  <span>重新检索全部</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      </WorkspaceStudioPortal>

      <WizardWaitBanner
        wizardState={wizardState}
        secondsLeft={secondsLeft}
        onCancel={cancelWizard}
        onSkip={continueWizard}
      />

      {/* 大屏三列锁定视口高度：长内容只在栏内滚，避免整页被撑开 */}
      <div className="studio-columns grid gap-4 lg:h-[calc(100dvh-12.5rem)] lg:grid-cols-[220px_minmax(0,1fr)_280px] lg:items-stretch">
        <aside className="studio-slide-rail max-h-[50vh] space-y-2 overflow-y-auto rounded-2xl border border-[rgba(0,0,0,0.13)] bg-white p-3 shadow-[0_5px_16px_-4px_rgba(0,0,0,0.07)] lg:min-h-0 lg:max-h-none lg:h-full">
          {slides.map((slide) => (
            <button
              key={slide.id}
              type="button"
              onClick={() => {
                void flushMetaSave();
                setSlideInUrl(slide.id);
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev);
                  next.set("slide", slide.id);
                  return next;
                }, { replace: true });
              }}
              className={`group w-full rounded-xl border p-1.5 text-left transition ${
                selected?.id === slide.id
                  ? "border-[rgba(0,0,0,0.9)] bg-[rgba(0,0,0,0.03)] ring-2 ring-[rgba(0,0,0,0.12)]"
                  : "border-[rgba(0,0,0,0.10)] bg-[rgba(0,0,0,0.02)] hover:border-[rgba(0,0,0,0.35)]"
              }`}
            >
              <SlideThumbnail
                svgPreview={slide.svgPreview}
                exportTheme={exportTheme}
                themeAccentId={themeAccentId}
                themeSurfaceId={themeSurfaceId}
              />
              <div className="mt-1 flex items-center gap-1.5 px-1 pb-0.5">
                <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-bold ${
                  selected?.id === slide.id
                    ? "bg-[rgba(0,0,0,0.9)] text-white"
                    : "bg-[rgba(0,0,0,0.06)] text-[rgba(0,0,0,0.5)]"
                }`}>
                  {slide.sortOrder}
                </span>
                <span className="min-w-0 truncate text-[11px] font-medium text-[rgba(0,0,0,0.7)]">
                  {slide.title}
                </span>
              </div>
            </button>
          ))}
        </aside>

        <section className="studio-stage-panel max-h-[70vh] overflow-y-auto rounded-2xl border border-[rgba(0,0,0,0.13)] bg-white p-5 shadow-[0_5px_16px_-4px_rgba(0,0,0,0.07)] lg:min-h-0 lg:max-h-none lg:h-full">
          {!selected ? (
            <p className="py-20 text-center text-[rgba(0,0,0,0.45)]">请先在便利贴墙生成页面</p>
          ) : currentPhase === "search" ? (
            <div>
              <div className="mb-4 flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(0,0,0,0.06)] text-xs font-medium text-[rgba(0,0,0,0.9)]">1</span>
                <h2 className="text-xl font-medium text-[rgba(0,0,0,0.9)]">检索素材</h2>
                {draftResearch ? <span className="rounded-full bg-[rgba(0,0,0,0.06)] px-2 py-0.5 text-[10px] font-medium text-[rgba(0,0,0,0.9)]">已完成</span> : <span className="rounded-full bg-[rgba(0,0,0,0.03)] px-2 py-0.5 text-[10px] font-medium text-[rgba(0,0,0,0.45)]">待检索</span>}
              </div>
              <div className="mt-5 rounded-xl border border-[rgba(0,0,0,0.13)] bg-white p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-medium text-[rgba(0,0,0,0.9)]">检索前</h3>
                  </div>
                  <button
                    type="button"
                    className="primary-button rounded-[10px]"
                    disabled={Boolean(busy) || !selected}
                    onClick={() => selected && void runWithMetaFlush(() => searchSlide(selected.id))}
                  >
                    <Search className="h-4 w-4" />
                    {searchJson ? "重新检索本页" : "检索本页"}
                  </button>
                </div>
                <SlideMetaEditor
                  draft={metaDraft}
                  onChange={handleMetaChange}
                  onBlurSave={() => void flushMetaSave()}
                  showHint={showMetaHint}
                />
              </div>

              {isSearching ? (
                <StreamingSearchCanvas
                  delta={searchStage?.delta}
                  message={searchStage?.message}
                />
              ) : (
                <SearchVisualCanvas
                  searchJson={searchJson}
                  draftResearch={draftResearch}
                />
              )}

              {draftResearch ? (
                <div className="sticky bottom-0 z-10 mt-8 -mx-5 -mb-5 flex items-center justify-between border-t border-[rgba(0,0,0,0.13)] bg-white/95 px-5 py-4 backdrop-blur">
                  <div>
                    <p className="text-sm font-medium text-[rgba(0,0,0,0.9)]">检索内容已整理 ✓</p>
                  </div>
                  <button
                    type="button"
                    className="primary-button rounded-[10px]"
                    disabled={Boolean(busy)}
                    onClick={generateAndEnterDraft}
                  >
                    生成并进入初稿 →
                  </button>
                </div>
              ) : null}
            </div>
          ) : currentPhase === "draft" ? (
            <div>
              <div className="mb-4 flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(0,0,0,0.06)] text-xs font-medium text-[rgba(0,0,0,0.9)]">2</span>
                <h2 className="text-xl font-medium text-[rgba(0,0,0,0.9)]">生成初稿</h2>
                {isGeneratingDraft ? <span className="rounded-full bg-[rgba(0,0,0,0.06)] px-2 py-0.5 text-[10px] font-medium text-[rgba(0,0,0,0.9)]">生成中</span> : plan ? <span className="rounded-full bg-[rgba(0,0,0,0.06)] px-2 py-0.5 text-[10px] font-medium text-[rgba(0,0,0,0.9)]">已完成</span> : <span className="rounded-full bg-[rgba(0,0,0,0.03)] px-2 py-0.5 text-[10px] font-medium text-[rgba(0,0,0,0.45)]">待生成</span>}
              </div>
              {isGeneratingDraft ? (
                <StreamingDraftCanvas
                  delta={streamedPlanDelta}
                  message={planStage?.message}
                  fallbackTitle={selected?.title}
                />
              ) : plan && planDraft ? (
                <>
                  <div className="mt-5">
                    <PlanDraftEditor
                      draft={planDraft}
                      onChange={handlePlanChange}
                      onBlurSave={() => void flushPlanSave()}
                    />
                  </div>
                  <div className="sticky bottom-0 z-10 mt-8 -mx-5 -mb-5 flex items-center justify-between border-t border-[rgba(0,0,0,0.13)] bg-white/95 px-5 py-4 backdrop-blur">
                    <div>
                      <p className="text-sm font-medium text-[rgba(0,0,0,0.9)]">初稿可编辑 ✓</p>
                    </div>
                    <button
                      type="button"
                      className="primary-button rounded-[10px]"
                      disabled={Boolean(busy) || isWizardRunning}
                      onClick={generateAndEnterDesign}
                    >
                      生成并进入设计稿 →
                    </button>
                  </div>
                </>
              ) : (
                <div className="mt-8 rounded-xl border border-dashed border-[rgba(0,0,0,0.2)] bg-[rgba(0,0,0,0.03)] px-5 py-10 text-center">
                  <p className="text-lg font-medium text-[rgba(0,0,0,0.9)]">尚未生成初稿</p>
                  <p className="mt-2 text-sm text-[rgba(0,0,0,0.6)]">请先完成检索，或点击右上角「生成本页初稿」。</p>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(0,0,0,0.06)] text-xs font-medium text-[rgba(0,0,0,0.9)]">3</span>
                  <div>
                    <h2 className="text-xl font-medium text-[rgba(0,0,0,0.9)]">设计出图</h2>
                    <p className="text-sm text-[rgba(0,0,0,0.45)]">
                      主题 {exportThemeLabel(exportTheme)} · {selectedUsesSlideIr ? "SmartSlide" : "SVG"}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <PageStyleControl
                    busy={Boolean(busy)}
                    projectStyle={projectPresentationStyle}
                    configuredStyle={slidePresentationStyle}
                    appliedStyle={appliedPageStyle}
                    pendingStyle={pendingPageStyleChange?.configuredStyle}
                    hasPendingChange={Boolean(pendingPageStyleChange)}
                    onChange={handlePageStyleChange}
                  />
                  <DesignVersionNavigator
                    versions={
                      designVersionsSlideId === selected.id
                        ? designVersions
                        : []
                    }
                    activeVersionId={selected.activeDesignVersionId ?? null}
                    disabled={
                      Boolean(busy) ||
                      designVersionsLoading ||
                      showDesignCodeStream
                    }
                    onActivate={(versionId) =>
                      void activateDesignVersion(versionId)
                    }
                  />
                  <div
                    className="inline-flex rounded-full border border-[rgba(0,0,0,0.13)] bg-[rgba(0,0,0,0.03)] p-1"
                    role="tablist"
                    aria-label="设计稿查看方式"
                  >
                    {(
                      [
                        ["preview", "预览"],
                        ["code", "代码"]
                      ] as const
                    ).map(([mode, label]) => {
                      const active = effectiveDesignViewMode === mode;
                      return (
                        <button
                          key={mode}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          disabled={mode === "preview" && showDesignCodeStream}
                          title={
                            mode === "preview"
                              ? showDesignCodeStream
                                ? "设计稿生成完成后自动返回预览"
                                : "查看设计稿预览"
                              : selectedUsesSlideIr
                                ? "查看当前 SmartSlide 源码"
                                : "查看当前 SVG 源码"
                          }
                          className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                            active ? "bg-[rgba(0,0,0,0.9)] text-white" : "text-[rgba(0,0,0,0.9)] hover:bg-[rgba(0,0,0,0.06)]"
                          } disabled:cursor-not-allowed disabled:opacity-45`}
                          onClick={() => setDesignViewMode(mode)}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              {pendingPageStyleChange ? (
                <PageStyleChangePrompt
                  appliedStyle={appliedPageStyle}
                  requestedStyle={requestedPageStyle}
                  busy={Boolean(busy)}
                  onRegenerate={() => void regenerateWithPendingPageStyle()}
                  onIgnore={() => selected && clearPendingPageStyle(selected.id)}
                />
              ) : null}
              {selectedDesignQualityFailure ? (
                <DesignQualityFailurePanel
                  failure={selectedDesignQualityFailure}
                  onDismiss={clearDesignQualityFailure}
                />
              ) : null}
              {effectiveDesignViewMode === "code" ? (
                <div
                  className="svg-stream-canvas h-[420px] overflow-hidden rounded-xl border"
                  style={editorThemeStyle}
                >
                  <div className="svg-stream-toolbar flex h-11 items-center justify-between px-4">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          showDesignCodeStream ? "svg-stream-live-dot" : "bg-cyan-500"
                        }`}
                      />
                      <span className="truncate font-mono text-[11px] font-medium tracking-[0.08em]">
                        {showDesignCodeStream
                          ? `${designGenerationMode === "slide-ir" ? "SMARTSLIDE" : "SVG"} · LIVE`
                          : `${selectedUsesSlideIr ? "SMARTSLIDE" : "SVG"} · SOURCE`}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      {svgEditorDirty && !showDesignCodeStream && !selectedUsesSlideIr ? (
                        <button
                          type="button"
                          className="svg-code-save-button rounded-md px-2.5 py-1 text-[11px] font-medium"
                          disabled={svgEditorSaving || Boolean(busy)}
                          onClick={() => void saveEditedSvg()}
                        >
                          {svgEditorSaving ? "保存中…" : "保存"}
                        </button>
                      ) : null}
                      <span className="font-mono text-[10px] tabular-nums">
                        {displayedDesignCode.length.toLocaleString()} chars
                      </span>
                    </div>
                  </div>
                  <div className="svg-code-editor relative h-[calc(100%-2.75rem)] overflow-hidden">
                    <pre
                      ref={designCodeHighlightRef}
                      aria-hidden="true"
                      className="svg-code-highlight pointer-events-none absolute inset-0 overflow-auto whitespace-pre px-4 py-3 font-mono text-[11px] leading-[1.65]"
                    >
                      {highlightedDesignCode}
                      {showDesignCodeStream ? <span className="svg-stream-caret" /> : null}
                    </pre>
                    <textarea
                      ref={designCodeViewportRef}
                      aria-label={
                        showDesignCodeStream
                          ? "设计生成代码流"
                          : selectedUsesSlideIr
                            ? "SmartSlide 源码"
                            : "可编辑 SVG 源码"
                      }
                      className="svg-code-input absolute inset-0 h-full w-full resize-none overflow-auto whitespace-pre px-4 py-3 font-mono text-[11px] leading-[1.65] outline-none"
                      value={editorRenderedCode}
                      readOnly={showDesignCodeStream || selectedUsesSlideIr || !selected?.svgPreview}
                      spellCheck={false}
                      wrap="off"
                      onChange={(event) => {
                        if (!selectedUsesSlideIr) setSvgEditorValue(event.target.value);
                      }}
                      onScroll={(event) => {
                        const highlight = designCodeHighlightRef.current;
                        if (!highlight) return;
                        highlight.scrollTop = event.currentTarget.scrollTop;
                        highlight.scrollLeft = event.currentTarget.scrollLeft;
                      }}
                    />
                  </div>
                </div>
              ) : selectedUsesSlideIr && selected.irJson ? (
                <div
                  className="svg-preview-ready overflow-hidden rounded-xl border border-[rgba(0,0,0,0.13)]"
                  style={{ background: exportThemePreviewBg(exportTheme) }}
                >
                  <SlideIrCanvas
                    irDoc={selected.irJson as SlideIrDocument}
                    readOnly={Boolean(busy) || showDesignCodeStream}
                    onIrChange={handleIrChange}
                    className="h-[420px] w-full"
                  />
                </div>
              ) : selected?.svgPreview ? (
                <div
                  className="svg-preview-ready overflow-hidden rounded-xl border border-[rgba(0,0,0,0.13)]"
                  style={{ background: exportThemePreviewBg(exportTheme) }}
                >
                  <SlideSvgCanvas
                    key={`${selected.id}-${exportTheme}-${themeAccentId}-${themeSurfaceId}`}
                    svgPreview={selected.svgPreview}
                    exportTheme={exportTheme}
                    themeAccentId={themeAccentId}
                    themeSurfaceId={themeSurfaceId}
                    onSvgChange={handleSvgChange}
                    readOnly={Boolean(busy) || showDesignCodeStream}
                    className="h-[420px] w-full"
                  />
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[rgba(0,0,0,0.18)] bg-[rgba(0,0,0,0.02)] px-6 py-16 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-xs border border-[rgba(0,0,0,0.08)] mb-3">
                    <span className="text-2xl">🎨</span>
                  </div>
                  <h3 className="text-base font-semibold text-[rgba(0,0,0,0.85)]">本页尚未生成设计稿</h3>
                  <p className="mt-1 text-xs text-[rgba(0,0,0,0.5)] max-w-md mx-auto">
                    无需手动分步执行，点击下方一键成稿，系统将全自动联动「检索素材 → 策划初稿 → 绘制视觉」，完成精准设计闭环。
                  </p>
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      className="primary-button rounded-xl px-5 py-2.5 shadow-sm"
                      disabled={Boolean(busy) || !selected || isWizardRunning}
                      onClick={() => selected && void runWizard(selected.id)}
                    >
                      <WandSparkles className="h-4 w-4 mr-1.5" />
                      ⚡ 一键生成本页设计稿
                    </button>
                    <button
                      type="button"
                      className="secondary-button rounded-xl px-4 py-2.5"
                      onClick={() => setPhaseInUrl("draft")}
                    >
                      📝 手动编辑初稿
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        <div className="flex h-full min-h-0 flex-col gap-4">
          {currentPhase === "design" ? (
            <DesignConfigPanel
              busy={busy}
              activeTab={designConfigTab}
              projectStyle={projectPresentationStyle}
              slideStyle={slidePresentationStyle}
              exportTheme={exportTheme}
              themeAccentId={themeAccentId}
              themeSurfaceId={themeSurfaceId}
              exportWarnings={exportWarnings}
              slidesEmpty={slides.length === 0}
              hasSelected={Boolean(selected)}
              onTabChange={setDesignConfigTab}
              onProjectStyleChange={(style) => void setProjectPresentationStyle(style)}
              onSlideStyleChange={(style) => {
                if (!selected) return;
                void updateSlide(selected.id, { presentationStyle: style });
              }}
              onThemeChange={(theme) => void handleThemeChange(theme)}
              onAccentChange={setThemeAccentId}
              onSurfaceChange={setThemeSurfaceId}
              onRegenerateCurrent={() => void regenerateCurrentForTheme()}
              onRegenerateAll={() => void generateAllDesigns()}
            />
          ) : (
            <AgentExecutionPanel variant="embedded" />
          )}
        </div>
      </div>

      {exportPromptOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[rgba(0,0,0,0.13)] bg-white p-5 shadow-[0_20px_48px_rgba(0,0,0,0.1)]">
            <h3 className="text-lg font-medium text-[rgba(0,0,0,0.9)]">选择 PPT 导出方式</h3>
            <p className="mt-2 text-sm text-[rgba(0,0,0,0.6)]">
              {exportScope === "current"
                ? "导出当前 1 页"
                : exportScope === "ready"
                  ? `导出已完成的 ${readySlides.length} 页（共 ${slides.length} 页）`
                  : `导出全部 ${slides.length} 页`}
            </p>

            {readySlides.length < slides.length && exportScope !== "current" ? (
              <div className="mt-3 rounded-xl border border-[rgba(0,0,0,0.13)] bg-[rgba(0,0,0,0.03)] px-3 py-2 text-sm text-[rgba(0,0,0,0.9)]">
                还有 {slides.length - readySlides.length} 页未生成设计稿，本次只导出已完成页，不会自动补稿。
              </div>
            ) : null}

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                className="rounded-xl border-2 border-[rgba(0,0,0,0.9)] bg-[rgba(0,0,0,0.03)] p-4 text-left transition hover:bg-[rgba(0,0,0,0.06)] disabled:opacity-50"
                disabled={Boolean(busy) || (exportScope === "ready" && readySlides.length === 0)}
                onClick={() => void runExport("fidelity")}
              >
                <span className="block text-base font-medium text-[rgba(0,0,0,0.9)]">图片保真版</span>
                <span className="mt-1 block text-xs leading-5 text-[rgba(0,0,0,0.6)]">
                  整页嵌入 SVG，最接近网页预览；不支持拆分编辑。
                </span>
                <span className="mt-2 inline-flex rounded-full bg-[rgba(0,0,0,0.9)] px-2 py-0.5 text-[11px] font-medium text-white">
                  效果最佳
                </span>
              </button>
              <button
                type="button"
                className="rounded-xl border border-[rgba(0,0,0,0.13)] bg-white p-4 text-left transition hover:border-[rgba(0,0,0,0.35)] hover:bg-[rgba(0,0,0,0.03)] disabled:opacity-50"
                disabled={Boolean(busy) || (exportScope === "ready" && readySlides.length === 0)}
                onClick={() => void runExport("editable")}
              >
                <span className="block text-base font-medium text-[rgba(0,0,0,0.9)]">元素可编辑版</span>
                <span className="mt-1 block text-xs leading-5 text-[rgba(0,0,0,0.6)]">
                  拆成 PPT 文本、形状和线条；尽量对齐 SVG，但 WPS/Office 字体度量可能有轻微差异。
                </span>
              </button>
            </div>

            {readySlides.length < slides.length && currentDesignReady ? (
              <button
                type="button"
                className="text-button mt-4 justify-center"
                onClick={() => setExportScope(exportScope === "current" ? "ready" : "current")}
              >
                {exportScope === "current" ? `改为导出已完成的 ${readySlides.length} 页` : "改为仅导出当前页"}
              </button>
            ) : null}

            <div className="mt-3 flex justify-center">
              <button type="button" className="text-button justify-center" onClick={() => setExportPromptOpen(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
