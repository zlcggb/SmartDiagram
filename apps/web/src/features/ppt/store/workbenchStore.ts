import { create } from "zustand";
import type {
  CreateBlankSlideInput,
  CreateProjectInput,
  ExportDto,
  ExportMode,
  FactDto,
  PptExportTheme,
  PresentationStyleId,
  ProjectMaterialDto,
  ProjectDto,
  RenderStrategy,
  SlideDesignVersionDto,
  SlideDto,
  SourceTextDto,
  SvgQualityFailureDto,
  UpdateFactInput,
  UpdateSlideInput
} from '@ppt-agent/shared';
import {
  demoSourceText,
  getPresentationStylePreset,
  getThemePack,
  getThemeSurfacePreset,
  inferRenderStrategy,
  normalizeAccentPresetId,
  normalizePptExportTheme,
  normalizePresentationStyleId,
  normalizeThemeSurfaceId,
  renderStrategies,
  resolvePresentationStyleId,
  type ThemeSurfaceId
} from '@ppt-agent/shared';
import type { AiUsageSummary } from "../lib/api";
import { api, collectExportPageGrades, collectExportWarnings, getApiBase, triggerBrowserDownload } from "../lib/api";
import type { EditableGrade } from "../lib/exportMode";
import { upsertProjectMaterial } from "../components/materials/materialUploadModel";
import { guestProjectRepository } from "../lib/guestProjectStore";
import { classifyProjectLoadFailure, type ProjectLoadFailure } from "../lib/projectLoadError";
import { currentPptIdentityHeaders, isPptGuest } from "../lib/pptRequestContext";
import { streamProjectProgress, type PptProgressEvent } from "../lib/progressStream";
import { createLatestAsyncCommit } from "../lib/usageRefresh";
import { normalizeSlideDesignHistory } from "../lib/designVersionState";
import { createPendingMutationBarrier } from "../lib/pendingMutationBarrier";
import { getSvgQualityFailure } from "../lib/pptApiError";

type Step = 1 | 2 | 3 | 4 | 5;
type Direction = "up" | "down";
export type StudioPhase = "search" | "draft" | "design";

export type ExportPageGrade = {
  slideId: string;
  grade: EditableGrade;
  hint: string;
};

export type DesignQualityFailureState = SvgQualityFailureDto & {
  slideId: string;
  slideTitle: string;
};

export type AgentLogEntry = {
  id: string;
  at: string;
  message: string;
  stage?: string;
};

export type StageLogEntry = {
  id: string;
  at: string;
  message: string;
  level?: "info" | "warning" | "error" | "success";
  slideId?: string;
  slideTitle?: string;
};

export type DeltaChunk = {
  id: string;
  at: string;
  text: string;
  subStage?: string;
};

export type ProgressStageState = {
  status: "idle" | "running" | "done" | "error" | "skip";
  message: string;
  current?: number;
  total?: number;
  /** 兼容旧数据的完整 delta 字符串 */
  delta?: string;
  /** 流式片段列表 */
  deltaChunks: DeltaChunk[];
  /** 阶段内日志 */
  logs: StageLogEntry[];
  /** 是否展开 */
  expanded?: boolean;
  /** 阶段开始时间 */
  startedAt?: string;
  /** 阶段结束时间 */
  endedAt?: string;
  /** 当前流式输出所属页面 id（用于跨页归属判断） */
  slideId?: string;
};

interface WorkbenchState {
  currentStep: Step;
  project: ProjectDto | null;
  latestSourceText: SourceTextDto | null;
  sourceText: string;
  materials: ProjectMaterialDto[];
  facts: FactDto[];
  slides: SlideDto[];
  exports: ExportDto[];
  exportWarnings: string[];
  exportPageGrades: ExportPageGrade[];
  aiUsageSummary: AiUsageSummary | null;
  /** 导演页 TTS 配音模型（来自 /api/media/status），用于顶部 chip 展示 */
  ttsModel: string | null;
  selectedSlideId: string | null;
  designVersions: SlideDesignVersionDto[];
  designVersionsSlideId: string | null;
  designVersionsLoading: boolean;
  designQualityFailure: DesignQualityFailureState | null;
  exportTheme: PptExportTheme;
  /** 主题包内 accent 预设 id（会话级；换色预览/导出前应用到 SVG） */
  themeAccentId: string;
  /** 质感预设（会话级；预览 CSS 滤镜 + 重生提示） */
  themeSurfaceId: ThemeSurfaceId;
  exportMode: ExportMode;
  studioPhase: StudioPhase;
  agentLogs: AgentLogEntry[];
  /** 流水线步骤进度（由 SSE 推送更新） */
  progressStages: Record<string, ProgressStageState>;
  /** Agent 执行面板是否展开 */
  progressPanelOpen: boolean;
  busy: string | null;
  error: string | null;
  /** 项目页加载失败时的结构化原因，用于 404 引导页 */
  projectLoadFailure: ProjectLoadFailure | null;
  setStep: (step: Step) => void;
  setSourceText: (text: string) => void;
  loadDemoSource: () => void;
  clearError: () => void;
  clearDesignQualityFailure: () => void;
  clearExportWarnings: () => void;
  setExportTheme: (theme: PptExportTheme) => Promise<void>;
  setProjectPresentationStyle: (style: PresentationStyleId | string) => Promise<void>;
  setThemeAccentId: (accentId: string) => void;
  setThemeSurfaceId: (surfaceId: ThemeSurfaceId | string) => void;
  setExportMode: (mode: ExportMode) => void;
  setStudioPhase: (phase: StudioPhase) => void;
  pushAgentLog: (message: string, stage?: string) => void;
  clearAgentLogs: () => void;
  setProgressPanelOpen: (open: boolean) => void;
  toggleStageExpanded: (stage: string) => void;
  refreshAiUsage: () => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<ProjectDto | null>;
  loadProject: (projectId: string) => Promise<void>;
  loadMaterials: (projectId?: string) => Promise<void>;
  uploadMaterial: (file: File, projectId?: string) => Promise<ProjectMaterialDto>;
  deleteMaterial: (materialId: string, projectId?: string) => Promise<void>;
  saveSourceText: () => Promise<void>;
  extractFacts: () => Promise<void>;
  updateFact: (factId: string, input: UpdateFactInput) => Promise<void>;
  deleteFact: (factId: string) => Promise<void>;
  generateOutline: () => Promise<void>;
  updateSlide: (slideId: string, input: UpdateSlideInput) => Promise<void>;
  setSlideRenderStrategy: (slideId: string, strategy: RenderStrategy) => Promise<void>;
  reorderSlides: (slideIds: string[]) => Promise<void>;
  moveSlide: (slideId: string, direction: Direction) => Promise<void>;
  deleteSlide: (slideId: string) => Promise<void>;
  createBlankSlide: (input?: Partial<CreateBlankSlideInput>) => Promise<SlideDto | null>;
  selectSlide: (slideId: string) => void;
  resolveRenderStrategy: (slideId: string) => { strategy: RenderStrategy; fromServer: boolean };
  generateSlidePlan: (slideId: string) => Promise<void>;
  generateAllPlans: () => Promise<void>;
  saveSlideSvg: (slideId: string, svgPreview: string) => Promise<void>;
  loadSlideDesignVersions: (slideId: string) => Promise<void>;
  activateSlideDesignVersion: (slideId: string, versionId: string) => Promise<void>;
  generateSlideIr: (slideId: string) => Promise<void>;
  generateAllIr: () => Promise<void>;
  generateSlideDesign: (
    slideId: string,
    options?: { presentationStyle: PresentationStyleId | null }
  ) => Promise<boolean>;
  generateAllDesigns: () => Promise<void>;
  generateSvgPreview: (slideId: string) => Promise<void>;
  exportPptx: (
    modeOrDraft?: ExportMode | boolean,
    options?: { slideIds?: string[]; fillMissing?: boolean; svgExportMode?: "fidelity" | "editable" }
  ) => Promise<void>;
  startBrief: () => Promise<void>;
  answerBrief: (answers: Record<string, string>) => Promise<void>;
  runResearch: () => Promise<void>;
  searchSlide: (slideId: string) => Promise<void>;
  searchAllSlides: () => Promise<void>;
  runPipeline: (opts?: { skipDesign?: boolean }) => Promise<void>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败";
}

function replaceSlide(slides: SlideDto[], updated: SlideDto) {
  return slides.map((slide) => (slide.id === updated.id ? updated : slide));
}

function firstSlideId(slides: SlideDto[]) {
  return slides[0]?.id ?? null;
}

function normalizeExportTheme(theme: string | null | undefined): PptExportTheme {
  return normalizePptExportTheme(theme);
}

function makeLog(message: string, stage?: string): AgentLogEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toLocaleTimeString(),
    message,
    stage
  };
}

// SSE 进度连接管理（旁路：失败不影响主 AI 请求）
let progressAbortController: AbortController | null = null;
let progressReconnectTimer: ReturnType<typeof setTimeout> | null = null;

const commitLatestAiUsage = createLatestAsyncCommit<AiUsageSummary | null>(
  (aiUsageSummary) => useWorkbenchStore.setState({ aiUsageSummary }),
  () => useWorkbenchStore.setState({ aiUsageSummary: null }),
);

function handleProgressEvent(data: PptProgressEvent) {
  const { stage, status, message, current, total, delta, subStage, clearDelta, timestamp, slideId, slideTitle } = data;
  const at = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();

  // API 事件语义是 start/progress/done/error，界面状态统一为 running/done/error。
  const normalizedStatus: ProgressStageState["status"] =
    status === "start" || status === "progress"
      ? "running"
      : status === "done" || status === "error" || status === "skip"
        ? status
        : "idle";

  useWorkbenchStore.setState((prev) => {
    const pipelineRunning = prev.progressStages.pipeline?.status === "running";
    // 单独执行一个任务时，右侧只保留本次执行；全流程运行时才累计各阶段。
    const isStandaloneStart = status === "start" && clearDelta && stage !== "pipeline" && !pipelineRunning;
    const next = isStandaloneStart ? {} : { ...prev.progressStages };
    const existing = next[stage];
    const isStart = status === "start";
    const shouldClear = isStart || clearDelta;
    const deltaChunks = shouldClear ? [] : [...(existing?.deltaChunks ?? [])];
    const logs = shouldClear ? [] : [...(existing?.logs ?? [])];
    let accumulatedDelta = shouldClear ? "" : (existing?.delta ?? "");

    if (delta) {
      accumulatedDelta += delta;
      deltaChunks.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        at,
        text: delta,
        subStage
      });
    }

    if (message && status !== "progress") {
      logs.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        at,
        message,
        level: status === "error" ? "error" : status === "done" ? "success" : "info",
        slideId,
        slideTitle
      });
    }

    // 自动展开运行中阶段，折叠已完成阶段（只保留当前 running 展开）
    const isRunning = normalizedStatus === "running";
    const expanded = isRunning
      ? true
      : normalizedStatus === "done" || normalizedStatus === "error" || normalizedStatus === "skip"
        ? false
        : existing?.expanded;

    next[stage] = {
      status: normalizedStatus,
      message,
      current,
      total,
      delta: accumulatedDelta,
      deltaChunks: deltaChunks.slice(-500),
      logs: logs.slice(-200),
      expanded,
      startedAt: isStart ? timestamp : existing?.startedAt,
      endedAt: status === "done" || status === "error" || status === "skip" ? timestamp : existing?.endedAt,
      slideId: slideId ?? existing?.slideId
    };

    return {
      progressStages: next,
      // 用户即使手动折叠过，新任务开始时也要自动展开并展示流。
      progressPanelOpen: isStart ? true : prev.progressPanelOpen
    };
  });

  if (status === "done" || status === "error") {
    useWorkbenchStore.getState().pushAgentLog(message, stage);
    void useWorkbenchStore.getState().refreshAiUsage();
  }
}

function connectProgressSSE(projectId: string) {
  disconnectProgressSSE();
  const controller = new AbortController();
  progressAbortController = controller;

  const open = async () => {
    try {
      await streamProjectProgress({
        apiBase: getApiBase(),
        projectId,
        identityHeaders: currentPptIdentityHeaders(),
        signal: controller.signal,
        onEvent: handleProgressEvent,
      });
    } catch {
      // 进度流是旁路；主生成请求仍按原路径返回错误。
    }

    if (
      !controller.signal.aborted &&
      progressAbortController === controller &&
      useWorkbenchStore.getState().busy
    ) {
      progressReconnectTimer = setTimeout(() => void open(), 1_000);
    }
  };

  void open();
}

function disconnectProgressSSE() {
  progressAbortController?.abort();
  progressAbortController = null;
  if (progressReconnectTimer) clearTimeout(progressReconnectTimer);
  progressReconnectTimer = null;
}

const pendingDesignInputMutations = createPendingMutationBarrier();
const projectMutationKey = (projectId: string) => `project:${projectId}`;
const slideMutationKey = (slideId: string) => `slide:${slideId}`;

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  currentStep: 1,
  project: null,
  latestSourceText: null,
  sourceText: "",
  materials: [],
  facts: [],
  slides: [],
  exports: [],
  exportWarnings: [],
  exportPageGrades: [],
  aiUsageSummary: null,
  ttsModel: null,
  selectedSlideId: null,
  designVersions: [],
  designVersionsSlideId: null,
  designVersionsLoading: false,
  designQualityFailure: null,
  exportTheme: "white-blue",
  themeAccentId: "primary",
  themeSurfaceId: "flat",
  exportMode: "standard",
  studioPhase: "search",
  agentLogs: [],
  progressStages: {},
  progressPanelOpen: true,
  busy: null,
  error: null,
  projectLoadFailure: null,
  setStep: (step) => {
    if (!get().project && step !== 1) {
      set({
        currentStep: 1,
        error: "请先创建项目，再进入后续步骤。"
      });
      return;
    }
    set({ currentStep: step });
  },
  setSourceText: (sourceText) => set({ sourceText }),
  loadDemoSource: () => set({ sourceText: demoSourceText }),
  clearError: () => set({ error: null }),
  clearDesignQualityFailure: () => set({ designQualityFailure: null }),
  clearExportWarnings: () => set({ exportWarnings: [], exportPageGrades: [] }),
  setThemeAccentId(accentId) {
    const theme = get().exportTheme;
    const next = normalizeAccentPresetId(theme, accentId);
    set({ themeAccentId: next });
    const label = getThemePack(theme).accentPresets.find((p) => p.id === next)?.label ?? next;
    get().pushAgentLog(`强调色已切换为「${label}」`);
  },
  setThemeSurfaceId(surfaceId) {
    const next = normalizeThemeSurfaceId(surfaceId);
    if (next === get().themeSurfaceId) return;
    set({ themeSurfaceId: next });
    get().pushAgentLog(`质感已切换为「${getThemeSurfacePreset(next).label}」`);
  },
  async setExportTheme(exportTheme) {
    const project = get().project;
    const prev = get().exportTheme;
    const prevAccent = get().themeAccentId;
    if (prev === exportTheme && (!project || project.theme === exportTheme)) {
      set({ exportTheme });
      return;
    }
    const nextAccent = normalizeAccentPresetId(exportTheme, prevAccent);
    // 乐观更新：预览即时换色，不占 busy，避免像「重新生成」
    set({ exportTheme, themeAccentId: nextAccent, error: null });
    if (!project) return;

    try {
      const updated = await api.updateProject(project.id, { theme: exportTheme });
      set({
        project: updated,
        exportTheme: normalizeExportTheme(updated.theme),
        themeAccentId: normalizeAccentPresetId(updated.theme, nextAccent)
      });
      get().pushAgentLog(`主题已切换为「${getThemePack(exportTheme).label}」（即时换色）`);
    } catch (error) {
      set({ exportTheme: prev, themeAccentId: prevAccent, error: errorMessage(error) });
    }
  },
  async setProjectPresentationStyle(style) {
    const project = get().project;
    if (!project) return;
    const next = normalizePresentationStyleId(style);
    if (project.presentationStyle === next) return;
    const previous = project;
    set({
      project: { ...project, presentationStyle: next },
      error: null
    });
    try {
      const updated = await pendingDesignInputMutations.track(
        projectMutationKey(project.id),
        api.updateProject(project.id, {
          presentationStyle: next
        })
      );
      set({ project: updated });
      get().pushAgentLog(
        `整套默认风格已切换为「${getPresentationStylePreset(next).label}」（下次生成生效）`
      );
    } catch (error) {
      set({ project: previous, error: errorMessage(error) });
    }
  },
  setExportMode: (exportMode) => set({ exportMode }),
  setStudioPhase: (studioPhase) => set({ studioPhase }),
  pushAgentLog: (message, stage) => set({ agentLogs: [...get().agentLogs, makeLog(message, stage)].slice(-80) }),
  clearAgentLogs: () => set({ agentLogs: [] }),
  setProgressPanelOpen: (progressPanelOpen) => set({ progressPanelOpen }),
  toggleStageExpanded: (stage) =>
    set({
      progressStages: {
        ...get().progressStages,
        [stage]: {
          ...(get().progressStages[stage] ?? {
            status: "idle",
            message: "",
            deltaChunks: [],
            logs: []
          }),
          expanded: !(get().progressStages[stage]?.expanded ?? false)
        }
      }
    }),
  async refreshAiUsage() {
    const projectId = get().project?.id;
    await commitLatestAiUsage(() => api.getAiUsageSummary(projectId));
  },
  async createProject(input) {
    set({ busy: "创建项目中", error: null });
    try {
      const project = await api.createProject(input);
      set({
        project,
        currentStep: 2,
        latestSourceText: null,
        sourceText: "",
        materials: [],
        facts: [],
        slides: [],
        exports: [],
        exportWarnings: [],
        exportPageGrades: [],
        exportTheme: normalizeExportTheme(project.theme),
        themeAccentId: normalizeAccentPresetId(project.theme, "primary"),
        exportMode: "standard",
        selectedSlideId: null,
        designVersions: [],
        designVersionsSlideId: null,
        designVersionsLoading: false,
        designQualityFailure: null,
        agentLogs: [
          makeLog(`已创建 AI 顾问项目：${project.name}`)
        ]
      });
      void get().refreshAiUsage();
      return project;
    } catch (error) {
      set({
        error: errorMessage(error) || "项目创建失败：数据库未初始化或无法打开，请检查后端数据库配置。"
      });
      return null;
    } finally {
      set({ busy: null });
    }
  },
  async loadProject(projectId) {
    set({ busy: "加载项目中", error: null, projectLoadFailure: null });
    try {
      const detail = await api.getProject(projectId);
      const prevSelected = get().selectedSlideId;
      const keepSelected =
        prevSelected && detail.slides.some((slide) => slide.id === prevSelected)
          ? prevSelected
          : firstSlideId(detail.slides);
      set({
        project: detail.project,
        latestSourceText: detail.latestSourceText,
        sourceText: detail.latestSourceText?.content ?? "",
        materials: detail.materials ?? [],
        facts: detail.facts,
        slides: detail.slides,
        exports: detail.exports,
        exportWarnings: [],
        exportPageGrades: [],
        exportTheme: normalizeExportTheme(detail.project.theme),
        themeAccentId: normalizeAccentPresetId(detail.project.theme, get().themeAccentId),
        selectedSlideId: keepSelected,
        designVersions: [],
        designVersionsSlideId: null,
        designVersionsLoading: false,
        designQualityFailure: null,
        currentStep: detail.slides.length > 0 ? 5 : detail.facts.length > 0 ? 4 : detail.latestSourceText ? 3 : 2
      });
      void get().refreshAiUsage();
    } catch (error) {
      const failure = classifyProjectLoadFailure(error, { isGuest: isPptGuest() });
      set({
        project: null,
        materials: [],
        slides: [],
        facts: [],
        exports: [],
        designVersions: [],
        designVersionsSlideId: null,
        designVersionsLoading: false,
        designQualityFailure: null,
        currentStep: 1,
        projectLoadFailure: failure
      });
    } finally {
      set({ busy: null });
    }
  },
  async loadMaterials(projectId) {
    const targetProjectId = projectId ?? get().project?.id;
    if (!targetProjectId) return;
    try {
      const materials = await api.listMaterials(targetProjectId);
      set({ materials });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  async uploadMaterial(file, projectId) {
    const targetProjectId = projectId ?? get().project?.id;
    if (!targetProjectId) throw new Error("请先创建项目，再上传资料。");
    const material = await api.uploadMaterial(targetProjectId, file);
    set({ materials: upsertProjectMaterial(get().materials, material) });
    return material;
  },
  async deleteMaterial(materialId, projectId) {
    const targetProjectId = projectId ?? get().project?.id;
    if (!targetProjectId) throw new Error("请先创建项目，再移除资料。");
    await api.deleteMaterial(targetProjectId, materialId);
    set({ materials: get().materials.filter((material) => material.id !== materialId) });
  },
  async saveSourceText() {
    const project = get().project;
    if (!project) {
      set({ currentStep: 1, error: "请先创建项目，再保存资料。" });
      return;
    }
    set({ busy: "保存资料中", error: null });
    try {
      const latestSourceText = await api.saveSourceText(project.id, get().sourceText);
      set({ latestSourceText });
      get().pushAgentLog("资料已保存");
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ busy: null });
    }
  },
  async extractFacts() {
    const project = get().project;
    if (!project) {
      set({ currentStep: 1, error: "请先创建项目，再提取事实。" });
      return;
    }
    set({ busy: "提取事实中", error: null });
    try {
      const sourceText = get().sourceText.trim();
      const materialIds = get().materials.map((material) => material.id);
      if (sourceText.length >= 20) await api.saveSourceText(project.id, sourceText);
      const facts = await api.extractFacts(project.id, materialIds);
      set({ facts, currentStep: 3 });
      get().pushAgentLog(`已提取 ${facts.length} 条事实`);
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ busy: null });
    }
  },
  async updateFact(factId, input) {
    const project = get().project;
    if (!project) return;
    set({ busy: "更新事实中", error: null });
    try {
      const fact = await api.updateFact(project.id, factId, input);
      set({ facts: get().facts.map((item) => (item.id === fact.id ? fact : item)) });
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ busy: null });
    }
  },
  async deleteFact(factId) {
    const project = get().project;
    if (!project) return;
    set({ busy: "删除事实中", error: null });
    try {
      await api.deleteFact(project.id, factId);
      set({ facts: get().facts.filter((fact) => fact.id !== factId) });
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ busy: null });
    }
  },
  async generateOutline() {
    const project = get().project;
    if (!project) {
      set({ currentStep: 1, error: "请先创建项目，再生成便利贴大纲。" });
      return;
    }
    set({ busy: "生成大纲中", error: null });
    try {
      const slides = await api.generateOutline(project.id);
      set({
        slides,
        selectedSlideId: firstSlideId(slides),
        currentStep: 4,
        designVersions: [],
        designVersionsSlideId: null
      });
      get().pushAgentLog(`大纲架构完成：${slides.length} 页便利贴`);
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ busy: null });
    }
  },
  async updateSlide(slideId, input) {
    const project = get().project;
    if (!project) return;
    const previous = get().slides.find((slide) => slide.id === slideId);
    const previousDesignVersions = get().designVersions;
    const previousDesignVersionsSlideId = get().designVersionsSlideId;
    const designInvalidated =
      input.planJson !== undefined ||
      input.title !== undefined ||
      input.slideGoal !== undefined ||
      input.keyMessage !== undefined ||
      input.contentPoints !== undefined ||
      input.recommendedLayout !== undefined;
    // 字段编辑走乐观更新、不占 busy，避免搜索/生成按钮被输入打断
    if (previous) {
      set({
        error: null,
        slides: replaceSlide(get().slides, {
          ...previous,
          title: input.title ?? previous.title,
          slideGoal: input.slideGoal ?? previous.slideGoal,
          keyMessage: input.keyMessage ?? previous.keyMessage,
          contentPoints: input.contentPoints ?? previous.contentPoints,
          recommendedLayout: input.recommendedLayout ?? previous.recommendedLayout,
          partTitle: input.partTitle !== undefined ? input.partTitle : previous.partTitle,
          status: input.status ?? previous.status,
          isContentLocked: input.isContentLocked ?? previous.isContentLocked,
          isLayoutLocked: input.isLayoutLocked ?? previous.isLayoutLocked,
          presentationStyle:
            input.presentationStyle !== undefined
              ? input.presentationStyle
              : previous.presentationStyle,
          renderStrategy: input.renderStrategy ?? previous.renderStrategy,
          strategyLocked: input.strategyLocked ?? previous.strategyLocked,
          searchJson: input.searchJson !== undefined ? input.searchJson : previous.searchJson,
          planJson: input.planJson !== undefined ? input.planJson : previous.planJson,
          // 改初稿/页意图时本地先清设计预览，与 API 失效策略一致
          irJson: designInvalidated ? null : previous.irJson,
          svgPreview: designInvalidated ? null : previous.svgPreview,
          activeDesignVersionId: designInvalidated
            ? null
            : previous.activeDesignVersionId
        }),
        ...(designInvalidated && previousDesignVersionsSlideId === slideId
          ? { designVersions: [] }
          : {})
      });
    } else {
      set({ error: null });
    }
    try {
      const slide = await pendingDesignInputMutations.track(
        slideMutationKey(slideId),
        api.updateSlide(project.id, slideId, input)
      );
      set({ slides: replaceSlide(get().slides, slide) });
    } catch (error) {
      if (previous) {
        set({
          slides: replaceSlide(get().slides, previous),
          designVersions: previousDesignVersions,
          designVersionsSlideId: previousDesignVersionsSlideId,
          error: errorMessage(error)
        });
      } else {
        set({ error: errorMessage(error) });
      }
    }
  },
  async setSlideRenderStrategy(slideId, strategy) {
    const project = get().project;
    if (!project) return;
    const current = get().slides.find((slide) => slide.id === slideId);
    if (current?.renderStrategy === strategy) return;

    // 乐观更新，避免切换 IR/SVG/混合时整页按钮被 busy 卡住
    if (current) {
      set({
        error: null,
        slides: replaceSlide(get().slides, {
          ...current,
          renderStrategy: strategy,
          strategyLocked: true
        })
      });
    }
    try {
      const slide = await api.updateSlideRenderStrategy(project.id, slideId, strategy);
      set({ slides: replaceSlide(get().slides, slide) });
      get().pushAgentLog(`本页策略已切换为 ${strategy === "ir" ? "IR 优先" : strategy === "svg" ? "SVG 优先" : "混合"}`);
    } catch (error) {
      if (current) {
        set({ slides: replaceSlide(get().slides, current), error: errorMessage(error) });
      } else {
        set({ error: errorMessage(error) });
      }
    }
  },
  async reorderSlides(slideIds) {
    const project = get().project;
    if (!project) return;
    set({ busy: "保存页面顺序中", error: null });
    try {
      const reordered = await api.reorderSlides(project.id, slideIds);
      set({ slides: reordered, selectedSlideId: get().selectedSlideId ?? firstSlideId(reordered) });
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ busy: null });
    }
  },
  async moveSlide(slideId, direction) {
    const project = get().project;
    if (!project) return;

    const slides = [...get().slides];
    const index = slides.findIndex((slide) => slide.id === slideId);
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= slides.length) return;

    const current = slides[index];
    const target = slides[nextIndex];
    if (!current || !target) return;
    slides[index] = target;
    slides[nextIndex] = current;

    set({ busy: "调整页面顺序中", error: null });
    try {
      const reordered = await api.reorderSlides(
        project.id,
        slides.map((slide) => slide.id)
      );
      set({ slides: reordered });
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ busy: null });
    }
  },
  async deleteSlide(slideId) {
    const project = get().project;
    if (!project) return;
    set({ busy: "删除页面中", error: null });
    try {
      const slides = await api.deleteSlide(project.id, slideId);
      set({
        slides,
        selectedSlideId: get().selectedSlideId === slideId ? firstSlideId(slides) : get().selectedSlideId
      });
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ busy: null });
    }
  },
  async createBlankSlide(input) {
    const project = get().project;
    if (!project) return null;
    set({ busy: "新增页面中", error: null });
    try {
      const slide = await api.createBlankSlide(project.id, input ?? {});
      const prev = get().slides;
      let next: SlideDto[];
      if (input?.afterSlideId) {
        const idx = prev.findIndex((item) => item.id === input.afterSlideId);
        next = [...prev];
        next.splice(idx >= 0 ? idx + 1 : next.length, 0, slide);
      } else {
        next = [...prev, slide];
      }
      set({
        slides: next.map((item, index) => ({ ...item, sortOrder: index + 1 })),
        selectedSlideId: slide.id
      });
      return slide;
    } catch (error) {
      set({ error: errorMessage(error) });
      return null;
    } finally {
      set({ busy: null });
    }
  },
  selectSlide: (selectedSlideId) => {
    if (!get().project) {
      set({ currentStep: 1, error: "请先创建项目，再进入页面策划。" });
      return;
    }
    set({ selectedSlideId, currentStep: 5 });
  },
  resolveRenderStrategy: (slideId) => {
    const slide = get().slides.find((s) => s.id === slideId);
    if (!slide) return { strategy: "svg", fromServer: false };
    const server = slide.renderStrategy;
    if (server && (renderStrategies as readonly string[]).includes(server)) {
      return { strategy: server, fromServer: true };
    }
    return { strategy: inferRenderStrategy(slide), fromServer: false };
  },
  async generateSlidePlan(slideId) {
    const project = get().project;
    if (!project) return;
    set({ busy: "生成初稿中", error: null });
    try {
      const result = await api.generateSlidePlan(project.id, slideId);
      set({
        slides: replaceSlide(get().slides, result.slide),
        selectedSlideId: slideId,
        studioPhase: "draft",
        designVersions: [],
        designVersionsSlideId: slideId
      });
      get().pushAgentLog(`初稿已生成：${result.slide.title}`);
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ busy: null });
    }
  },
  async generateAllPlans() {
    const project = get().project;
    if (!project) return;
    if (get().slides.length === 0) {
      set({ error: "请先生成便利贴大纲，再生成策划稿。" });
      return;
    }
    set({ busy: "批量生成初稿中", error: null });
    try {
      const slides = await api.generateAllPlans(project.id);
      set({
        slides,
        selectedSlideId: get().selectedSlideId ?? firstSlideId(slides),
        studioPhase: "draft",
        designVersions: [],
        designVersionsSlideId: null
      });
      get().pushAgentLog(`全部初稿完成：${slides.length} 页`);
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ busy: null });
    }
  },
  async saveSlideSvg(slideId, svgPreview) {
    const project = get().project;
    if (!project) return;
    const existingSlide = get().slides.find((item) => item.id === slideId);
    set({ busy: "保存 SVG 代码中", error: null });
    try {
      const updatedSlide = await api.updateSlide(project.id, slideId, {
        svgPreview,
        designVersionMeta: {
          theme: get().exportTheme,
          accentId: get().themeAccentId,
          surfaceId: get().themeSurfaceId,
          presentationStyle: resolvePresentationStyleId(
            project.presentationStyle,
            existingSlide?.presentationStyle
          )
        }
      });
      set({ slides: replaceSlide(get().slides, updatedSlide), selectedSlideId: slideId });
      await get().loadSlideDesignVersions(slideId);
      get().pushAgentLog(`SVG 代码已保存：${updatedSlide.title}`);
    } catch (error) {
      set({ error: errorMessage(error) });
      throw error;
    } finally {
      set({ busy: null });
    }
  },
  async loadSlideDesignVersions(slideId) {
    const project = get().project;
    if (!project) return;
    set({
      designVersionsLoading: true,
      designVersionsSlideId: slideId
    });
    try {
      const history = normalizeSlideDesignHistory(
        await api.listSlideDesignVersions(project.id, slideId),
        slideId
      );
      if (get().designVersionsSlideId !== slideId) return;
      set({
        designVersions: history.versions,
        designVersionsLoading: false
      });
    } catch (error) {
      if (get().designVersionsSlideId !== slideId) return;
      set({
        designVersions: [],
        designVersionsLoading: false,
        error: errorMessage(error)
      });
    }
  },
  async activateSlideDesignVersion(slideId, versionId) {
    const project = get().project;
    if (!project) return;
    set({ busy: "切换设计版本中", error: null });
    try {
      const slide = await api.activateSlideDesignVersion(
        project.id,
        slideId,
        versionId
      );
      set({
        slides: replaceSlide(get().slides, slide),
        selectedSlideId: slideId
      });
      get().pushAgentLog(`已切换设计版本：${slide.title}`);
    } catch (error) {
      set({ error: errorMessage(error) });
      throw error;
    } finally {
      set({ busy: null });
    }
  },
  async generateSlideIr(slideId) {
    const project = get().project;
    if (!project) return;
    set({ busy: "生成页面 IR 中", error: null });
    try {
      const result = await api.generateSlideIr(project.id, slideId, get().exportTheme);
      set({ slides: replaceSlide(get().slides, result.slide), selectedSlideId: slideId });
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ busy: null });
    }
  },
  async generateAllIr() {
    const project = get().project;
    if (!project) return;
    if (get().slides.length === 0) {
      set({ error: "请先生成便利贴大纲，再生成页面设计。" });
      return;
    }
    set({ busy: "批量生成页面 IR 中", error: null });
    try {
      const slides = await api.generateAllIr(project.id, get().exportTheme);
      set({ slides, selectedSlideId: get().selectedSlideId ?? firstSlideId(slides) });
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ busy: null });
    }
  },
  async generateSlideDesign(slideId, options) {
    const projectId = get().project?.id;
    if (!projectId) return false;
    let previousConfiguredStyle: PresentationStyleId | null = null;
    let styleOverridePersisted = false;
    set({ busy: "生成本页设计稿中", error: null, designQualityFailure: null });
    try {
      await Promise.all([
        pendingDesignInputMutations.wait(projectMutationKey(projectId)),
        pendingDesignInputMutations.wait(slideMutationKey(slideId))
      ]);
      const project = get().project;
      if (!project) return false;
      let slide = get().slides.find((item) => item.id === slideId);
      previousConfiguredStyle = slide?.presentationStyle ?? null;
      if (
        options &&
        options.presentationStyle !== previousConfiguredStyle
      ) {
        const configuredSlide = await pendingDesignInputMutations.track(
          slideMutationKey(slideId),
          api.updateSlide(project.id, slideId, {
            presentationStyle: options.presentationStyle
          })
        );
        styleOverridePersisted = true;
        slide = configuredSlide;
        set({ slides: replaceSlide(get().slides, configuredSlide) });
      }
      // 设计出图固定生成 SVG；IR 仅作为后端内部的结构化降级数据。
      const result = await api.generateSlideDesign(project.id, slideId, get().exportTheme, "standard", {
        accentId: get().themeAccentId,
        surfaceId: get().themeSurfaceId,
        presentationStyle: resolvePresentationStyleId(
          project.presentationStyle,
          slide?.presentationStyle
        )
      });
      set({
        slides: replaceSlide(get().slides, result.slide),
        selectedSlideId: slideId,
        studioPhase: "design",
        designQualityFailure: null
      });
      await get().loadSlideDesignVersions(slideId);
      get().pushAgentLog(`设计稿已生成：${result.slide.title}`);
      return true;
    } catch (error) {
      const qualityFailure = getSvgQualityFailure(error);
      const slide = get().slides.find((item) => item.id === slideId);
      let rollbackWarning = "";
      if (styleOverridePersisted) {
        try {
          const restoredSlide = await pendingDesignInputMutations.track(
            slideMutationKey(slideId),
            api.updateSlide(projectId, slideId, {
              presentationStyle: previousConfiguredStyle
            })
          );
          set({ slides: replaceSlide(get().slides, restoredSlide) });
        } catch {
          rollbackWarning = "；页级风格配置回退失败，请刷新后再试";
        }
      }
      set({
        error: qualityFailure
          ? `新设计稿有 ${qualityFailure.issues.length} 处需要调整，上一版本已保留；失败稿与源码已显示在画布内${rollbackWarning}。`
          : `${errorMessage(error)}${rollbackWarning}`,
        designQualityFailure: qualityFailure
          ? {
              ...qualityFailure,
              slideId,
              slideTitle: slide?.title ?? "当前页"
            }
          : null
      });
      return false;
    } finally {
      set({ busy: null });
    }
  },
  async generateAllDesigns() {
    const projectId = get().project?.id;
    if (!projectId) return;
    if (get().slides.length === 0) {
      set({ error: "请先生成便利贴大纲，再生成 SVG 页面设计。" });
      return;
    }
    set({ busy: "全部设计稿生成中", error: null, designQualityFailure: null });
    try {
      await Promise.all([
        pendingDesignInputMutations.wait(projectMutationKey(projectId)),
        ...get().slides.map((slide) =>
          pendingDesignInputMutations.wait(slideMutationKey(slide.id))
        )
      ]);
      const project = get().project;
      if (!project) return;
      // 设计出图固定生成 SVG，不再按历史 renderStrategy 分流。
      const result = await api.generateAllDesigns(project.id, get().exportTheme, "standard", {
        accentId: get().themeAccentId,
        surfaceId: get().themeSurfaceId,
        presentationStyle: normalizePresentationStyleId(
          project.presentationStyle
        )
      });
      const firstFailure = result.failures[0];
      const qualityFailure = firstFailure?.qualityFailure;
      set({
        slides: result.slides,
        selectedSlideId: get().selectedSlideId ?? firstSlideId(result.slides),
        studioPhase: "design",
        error: firstFailure
          ? qualityFailure
            ? `「${firstFailure.title}」的新稿有 ${qualityFailure.issues.length} 处需要调整；失败稿与源码已显示在对应页面。`
            : `部分页面设计失败：${firstFailure.title} - ${firstFailure.message}`
          : null,
        designQualityFailure:
          firstFailure && qualityFailure
            ? {
                ...qualityFailure,
                slideId: firstFailure.slideId,
                slideTitle: firstFailure.title
              }
            : null
      });
      const selectedSlideId = get().selectedSlideId;
      if (selectedSlideId) await get().loadSlideDesignVersions(selectedSlideId);
      get().pushAgentLog(
        `全部设计稿生成完成（SVG ${result.generatedSvgCount ?? 0} 页 / 失败 ${result.failures.length} 页）`
      );
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ busy: null });
    }
  },
  async generateSvgPreview(slideId) {
    const projectId = get().project?.id;
    if (!projectId) return;
    set({ busy: "生成 SVG 预览中", error: null, designQualityFailure: null });
    try {
      await Promise.all([
        pendingDesignInputMutations.wait(projectMutationKey(projectId)),
        pendingDesignInputMutations.wait(slideMutationKey(slideId))
      ]);
      const project = get().project;
      if (!project) return;
      const slide = get().slides.find((item) => item.id === slideId);
      const result = await api.generateSvgPreview(project.id, slideId, get().exportTheme, {
        accentId: get().themeAccentId,
        surfaceId: get().themeSurfaceId,
        presentationStyle: resolvePresentationStyleId(
          project.presentationStyle,
          slide?.presentationStyle
        )
      });
      set({
        slides: replaceSlide(get().slides, result.slide),
        selectedSlideId: slideId,
        studioPhase: "design",
        designQualityFailure: null
      });
      await get().loadSlideDesignVersions(slideId);
    } catch (error) {
      const qualityFailure = getSvgQualityFailure(error);
      const slide = get().slides.find((item) => item.id === slideId);
      set({
        error: qualityFailure
          ? `新设计稿有 ${qualityFailure.issues.length} 处需要调整，上一版本已保留；失败稿与源码已显示在画布内。`
          : errorMessage(error),
        designQualityFailure: qualityFailure
          ? {
              ...qualityFailure,
              slideId,
              slideTitle: slide?.title ?? "当前页"
            }
          : null
      });
    } finally {
      set({ busy: null });
    }
  },
  async exportPptx(modeOrDraft, options) {
    const project = get().project;
    if (!project) return;

    // 产品决策：UI 不暴露 mode；默认固定 standard，按各页 renderStrategy 导出
    let mode: ExportMode = "standard";
    if (typeof modeOrDraft === "boolean") {
      mode = modeOrDraft ? "draft" : "standard";
    } else if (modeOrDraft) {
      mode = modeOrDraft;
    }

    const scopeLabel =
      options?.slideIds?.length === 1
        ? "导出当前页 PPTX 中"
        : options?.slideIds?.length
          ? `导出 ${options.slideIds.length} 页 PPTX 中`
          : "导出 PPTX 中";
    set({ busy: scopeLabel, error: null, exportWarnings: [], exportPageGrades: [] });
    try {
      const exportRecord = await api.exportPptx(project.id, get().exportTheme, mode, {
        accentId: get().themeAccentId,
        svgExportMode: options?.svgExportMode ?? "editable",
        slideIds: options?.slideIds,
        fillMissing: options?.fillMissing ?? false
      });
      set({
        project: { ...project, theme: get().exportTheme },
        exports: [exportRecord, ...get().exports],
        exportWarnings: collectExportWarnings(exportRecord),
        exportPageGrades: collectExportPageGrades(exportRecord)
      });
      if (exportRecord.downloadUrl) {
        void triggerBrowserDownload(exportRecord.downloadUrl, `${exportRecord.versionName || "export"}.pptx`).catch(
          (error) => useWorkbenchStore.setState({ error: errorMessage(error) })
        );
        get().pushAgentLog(
          options?.slideIds?.length === 1
            ? "已导出当前页并开始下载 PPTX"
            : options?.slideIds?.length
              ? `已导出 ${options.slideIds.length} 页并开始下载 PPTX`
              : "已导出全部页并开始下载 PPTX"
        );
      } else {
        get().pushAgentLog("已导出 PPTX，但未返回 downloadUrl");
      }
      void get().refreshAiUsage();
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ busy: null });
    }
  },
  async startBrief() {
    const project = get().project;
    if (!project) return;
    set({ busy: "生成顾问问题中", error: null });
    try {
      const result = await api.startBrief(project.id);
      set({ project: result.project });
      get().pushAgentLog(`需求对话：已生成 ${result.questions.length} 个问题`);
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ busy: null });
    }
  },
  async answerBrief(answers) {
    const project = get().project;
    if (!project) return;
    set({ busy: "确认需求中", error: null });
    try {
      const result = await api.answerBrief(project.id, answers);
      set({ project: result.project });
      get().pushAgentLog("需求摘要已确认");
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ busy: null });
    }
  },
  async runResearch() {
    const project = get().project;
    if (!project) return;
    set({ busy: "背景调研中", error: null });
    try {
      const result = await api.runResearch(project.id);
      set({ project: result.project });
      get().pushAgentLog("背景调研完成");
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ busy: null });
    }
  },
  async searchSlide(slideId) {
    const project = get().project;
    if (!project) return;
    set({ busy: "本页检索中", error: null });
    try {
      const result = await api.searchSlide(project.id, slideId);
      set({ slides: replaceSlide(get().slides, result.slide), selectedSlideId: slideId, studioPhase: "search" });
      get().pushAgentLog(`检索完成：${result.slide.title}`);
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ busy: null });
    }
  },
  async searchAllSlides() {
    const project = get().project;
    if (!project) return;
    set({ busy: "全部页面检索中", error: null });
    try {
      const result = await api.searchAllSlides(project.id);
      set({
        slides: result.slides,
        selectedSlideId: get().selectedSlideId ?? firstSlideId(result.slides),
        studioPhase: "search",
        error: result.failures[0]
          ? `部分检索失败：${result.failures[0].title} - ${result.failures[0].message}`
          : null
      });
      const conc = result.concurrency ? `，并发 ${result.concurrency}` : "";
      get().pushAgentLog(
        `全部检索完成：${result.slides.length} 页${conc}${result.failures.length ? `，失败 ${result.failures.length}` : ""}`
      );
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ busy: null });
    }
  },
  async runPipeline(opts) {
    const project = get().project;
    if (!project) return;
    set({ busy: "一键流水线运行中…", error: null });
    get().pushAgentLog("流水线启动");
    try {
      const result = await api.runPipeline(project.id, {
        theme: get().exportTheme,
        accentId: get().themeAccentId,
        surfaceId: get().themeSurfaceId,
        presentationStyle: normalizePresentationStyleId(
          project.presentationStyle
        ),
        mode: "standard",
        skipDesign: opts?.skipDesign
      });
      set({
        project: result.detail.project,
        facts: result.detail.facts,
        slides: result.detail.slides,
        exports: result.detail.exports,
        latestSourceText: result.detail.latestSourceText,
        sourceText: result.detail.latestSourceText?.content ?? get().sourceText,
        selectedSlideId: get().selectedSlideId ?? firstSlideId(result.detail.slides),
        studioPhase: opts?.skipDesign ? "draft" : "design",
        agentLogs: [
          ...get().agentLogs,
          ...result.logs.map((message) => makeLog(message)),
          makeLog("流水线结束")
        ].slice(-80)
      });
      void get().refreshAiUsage();
    } catch (error) {
      set({ error: errorMessage(error) });
      get().pushAgentLog(`流水线失败：${errorMessage(error)}`);
    } finally {
      set({ busy: null });
    }
  }
}));

// ── SSE 进度自动连接 ──
// busy 从 null→有值时连接，从有值→null 时断开并清除进度
useWorkbenchStore.subscribe(
  (state, prev) => {
    if (state.busy && !prev.busy) {
      // 开始忙碌：连接 SSE，重置进度
      const projectId = state.project?.id;
      if (projectId) {
        useWorkbenchStore.setState({ progressStages: {} });
        connectProgressSSE(projectId);
      }
    } else if (!state.busy && prev.busy) {
      // 忙碌结束：延迟断开（等最后的 done 事件到达）
      setTimeout(() => {
        disconnectProgressSSE();
      }, 1500);
    }
  }
);

// 访客项目的持久副本只写入浏览器 IndexedDB。服务端项目仅作为短期生成运行态。
let guestSnapshotTimer: ReturnType<typeof setTimeout> | null = null;
useWorkbenchStore.subscribe((state, previous) => {
  if (!isPptGuest() || !state.project) return;
  const changed =
    state.project !== previous.project ||
    state.latestSourceText !== previous.latestSourceText ||
    state.facts !== previous.facts ||
    state.slides !== previous.slides ||
    state.exports !== previous.exports ||
    state.materials !== previous.materials;
  if (!changed) return;
  if (guestSnapshotTimer) clearTimeout(guestSnapshotTimer);
  guestSnapshotTimer = setTimeout(() => {
    guestSnapshotTimer = null;
    const current = useWorkbenchStore.getState();
    if (!current.project || !isPptGuest()) return;
    void guestProjectRepository
      .save({
        project: current.project,
        latestSourceText: current.latestSourceText,
        facts: current.facts,
        slides: current.slides,
        exports: current.exports,
        materials: current.materials
      })
      .catch(() => undefined);
  }, 250);
});
