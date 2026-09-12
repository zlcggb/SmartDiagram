import { useSearchParams } from "react-router-dom";
import { Check, LockKeyhole } from "lucide-react";
import { useWorkbenchStore } from '@/features/ppt/store/workbenchStore';
import { canContinueFromSource, hasCompletedBrief, type IntentTab } from "../intent/intentFlow";

interface StepItem {
  id: IntentTab;
  indexLabel: string;
  label: string;
  title: string;
}

const STEPS: StepItem[] = [
  { id: "brief", indexLabel: "1", label: "确认需求", title: "步骤 1：确认受众与目标" },
  { id: "source", indexLabel: "2", label: "补充资料", title: "步骤 2：补充资料与顾问架构推导" },
  { id: "visual", indexLabel: "3", label: "选择视觉", title: "步骤 3：选择视觉模板并生成结构" }
];

export function IntentHeaderStepper() {
  const [searchParams, setSearchParams] = useSearchParams();
  const project = useWorkbenchStore((s) => s.project);
  const facts = useWorkbenchStore((s) => s.facts);

  const requestedTab = searchParams.get("tab");
  const activeTab: IntentTab =
    requestedTab === "source" || requestedTab === "visual" ? requestedTab : "brief";

  const briefComplete = hasCompletedBrief(project);
  const sourceComplete = canContinueFromSource(facts);

  function handleSelectTab(tabId: IntentTab) {
    if (tabId === "source" && !briefComplete) return;
    if (tabId === "visual" && !sourceComplete) return;
    setSearchParams({ tab: tabId });
  }

  return (
    <nav
      className="studio-phase-stepper intent-phase-stepper"
      role="tablist"
      aria-label="意图创作步骤"
    >
      {STEPS.map((step, index) => {
        const isActive = activeTab === step.id;
        const isDone =
          step.id === "brief" ? briefComplete : step.id === "source" ? sourceComplete : false;
        const isLocked =
          step.id === "source" ? !briefComplete : step.id === "visual" ? !sourceComplete : false;

        return (
          <div key={step.id} className="studio-phase-stepper__item">
            {index > 0 && <span className="studio-phase-stepper__line" aria-hidden="true" />}
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              disabled={isLocked}
              className={`studio-phase-stepper__btn intent-phase-stepper__btn ${
                isActive ? "is-active" : ""
              } ${isDone && !isActive ? "is-done" : ""} ${isLocked ? "is-locked" : ""}`}
              onClick={() => handleSelectTab(step.id)}
              title={step.title}
            >
              <span className="intent-stepper-icon">
                {isLocked ? (
                  <LockKeyhole className="h-3 w-3 opacity-60" />
                ) : isDone && !isActive ? (
                  <Check className="h-3 w-3 text-emerald-600" />
                ) : (
                  <span className="font-mono text-[10px]">{step.indexLabel}.</span>
                )}
              </span>
              <span>{step.label}</span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}
