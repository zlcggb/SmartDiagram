import type { WizardState } from "../../hooks/useStudioWizard";

interface WizardWaitBannerProps {
  wizardState: WizardState;
  secondsLeft: number;
  onCancel: () => void;
  onSkip: () => void;
}

export function WizardWaitBanner({ wizardState, secondsLeft, onCancel, onSkip }: WizardWaitBannerProps) {
  const isWaiting = wizardState.kind === "waitingAfterSearch" || wizardState.kind === "waitingAfterDraft";
  const isRunning = wizardState.kind === "runningSearch" || wizardState.kind === "runningDraft" || wizardState.kind === "runningDesign";

  if (!isWaiting && !isRunning) return null;

  if (isWaiting) {
    return (
      <div className="mb-4 flex items-center justify-between rounded-xl border border-[rgba(0,0,0,0.13)] bg-[rgba(23,131,255,0.08)] px-4 py-3">
        <div>
          <p className="text-sm font-medium text-[rgba(0,0,0,0.9)]">{wizardState.message}</p>
          <p className="mt-0.5 text-xs text-[rgba(0,0,0,0.45)]">
            {secondsLeft} 秒后自动进入下一步；可直接编辑当前内容
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(23,131,255,0.15)] text-xs font-medium text-[rgba(23,131,255,0.9)]">
            {secondsLeft}
          </span>
          <button
            type="button"
            className="secondary-button rounded-[10px] text-xs"
            onClick={onCancel}
          >
            取消流程
          </button>
          <button
            type="button"
            className="primary-button rounded-[10px] text-xs"
            onClick={onSkip}
          >
            立即继续
          </button>
        </div>
      </div>
    );
  }

  // running 阶段显示轻量状态条，不阻塞编辑
  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-[rgba(0,0,0,0.13)] bg-[rgba(0,0,0,0.03)] px-4 py-2">
      <span className="inline-flex h-2 w-2 rounded-full bg-[rgba(23,131,255,0.8)] animate-pulse" />
      <p className="text-sm text-[rgba(0,0,0,0.6)]">{wizardState.message}</p>
    </div>
  );
}
