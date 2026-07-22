import { useCallback, useRef, useState } from "react";
import {
  isStudioStageComplete,
  requiredStudioPipelineStages,
  studioStageLabel,
  type StudioPipelineStage
} from "../shared";
import type { StudioPhase } from "../store/workbenchStore";
import { useWorkbenchStore } from "../store/workbenchStore";
import { useCountdown } from "./useCountdown";

const WAIT_SECONDS = 5;

export type WizardStateKind =
  | "idle"
  | "runningSearch"
  | "waitingAfterSearch"
  | "runningDraft"
  | "waitingAfterDraft"
  | "runningDesign";

export interface WizardState {
  kind: WizardStateKind;
  message: string;
}

interface UseStudioWizardOptions {
  setPhaseInUrl: (phase: StudioPhase) => void;
  flushMetaSave: () => Promise<void>;
  flushPlanSave: () => Promise<void>;
}

function currentUrlState() {
  if (typeof window === "undefined") {
    return { slideId: null as string | null, phase: null as StudioPhase | null };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    slideId: params.get("slide"),
    phase: params.get("phase") as StudioPhase | null
  };
}

export function useStudioWizard(options: UseStudioWizardOptions) {
  const { setPhaseInUrl, flushMetaSave, flushPlanSave } = options;
  const [wizardState, setWizardState] = useState<WizardState>({ kind: "idle", message: "" });
  const { secondsLeft, start, skip } = useCountdown();
  const runningRef = useRef(false);
  const abortRef = useRef(false);

  const isWizardRunning = wizardState.kind !== "idle";

  const checkAbort = useCallback((expectedSlideId: string) => {
    if (abortRef.current) {
      throw new Error("向导已被用户中断");
    }
    const { slideId } = currentUrlState();
    if (slideId && slideId !== expectedSlideId) {
      throw new Error("已切换页面，向导中止");
    }
  }, []);

  const waitWithCountdown = useCallback(
    async (expectedSlideId: string) => {
      checkAbort(expectedSlideId);
      await start(WAIT_SECONDS);
      checkAbort(expectedSlideId);
    },
    [checkAbort, start]
  );

  const assertStageComplete = useCallback((slideId: string, stage: StudioPipelineStage) => {
    const state = useWorkbenchStore.getState();
    const slide = state.slides.find((item) => item.id === slideId);
    if (isStudioStageComplete(slide, stage)) return;
    const message = state.error || `${studioStageLabel(stage)}未完成，流水线已停止。`;
    if (!state.error) useWorkbenchStore.setState({ error: message });
    throw new Error(message);
  }, []);

  const runWizard = useCallback(
    async (slideId: string) => {
      const store = useWorkbenchStore.getState();
      if (store.busy) return;
      if (runningRef.current) return;

      runningRef.current = true;
      abortRef.current = false;
      const startSlideId = slideId;

      try {
        setWizardState({ kind: "idle", message: "" });
        const startingSlide = useWorkbenchStore.getState().slides.find((s) => s.id === startSlideId);
        if (!startingSlide) {
          useWorkbenchStore.setState({ error: "未找到当前页面，无法启动设计流水线。" });
          return;
        }

        const stages = requiredStudioPipelineStages(startingSlide);
        for (const [index, stage] of stages.entries()) {
          checkAbort(startSlideId);
          setPhaseInUrl(stage);

          if (stage === "search") {
            setWizardState({ kind: "runningSearch", message: "正在检索素材…" });
            await flushMetaSave();
            await useWorkbenchStore.getState().searchSlide(startSlideId);
            assertStageComplete(startSlideId, stage);
            checkAbort(startSlideId);
            if (index < stages.length - 1) {
              setWizardState({ kind: "waitingAfterSearch", message: "检索完成，可编辑后进入下一步" });
              await waitWithCountdown(startSlideId);
            }
            continue;
          }

          if (stage === "draft") {
            setWizardState({ kind: "runningDraft", message: "正在生成初稿…" });
            await flushMetaSave();
            await useWorkbenchStore.getState().generateSlidePlan(startSlideId);
            assertStageComplete(startSlideId, stage);
            checkAbort(startSlideId);
            if (index < stages.length - 1) {
              setWizardState({ kind: "waitingAfterDraft", message: "初稿完成，可编辑后进入设计" });
              await waitWithCountdown(startSlideId);
            }
            continue;
          }

          setWizardState({ kind: "runningDesign", message: "正在生成设计稿…" });
          await flushMetaSave();
          await flushPlanSave();
          await useWorkbenchStore.getState().generateSlideDesign(startSlideId);
          assertStageComplete(startSlideId, stage);
        }
      } catch (error) {
        // 用户中断无需报错；阶段失败由 Store 或产物校验写入统一错误栏。
        if (!(error instanceof Error && error.message.includes("中断"))) {
          const state = useWorkbenchStore.getState();
          if (!state.error) {
            useWorkbenchStore.setState({
              error: error instanceof Error ? error.message : "设计流水线执行失败。"
            });
          }
        }
      } finally {
        runningRef.current = false;
        setWizardState({ kind: "idle", message: "" });
      }
    },
    [assertStageComplete, checkAbort, flushMetaSave, flushPlanSave, setPhaseInUrl, waitWithCountdown]
  );

  const cancelWizard = useCallback(() => {
    abortRef.current = true;
    skip();
  }, [skip]);

  const continueWizard = useCallback(() => {
    skip();
  }, [skip]);

  return {
    runWizard,
    cancelWizard,
    continueWizard,
    wizardState,
    secondsLeft,
    isWizardRunning
  };
}
