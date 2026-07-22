import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, ClipboardPaste, LockKeyhole, MessageSquareText, Palette } from "lucide-react";
import { useWorkbenchStore } from "../store/workbenchStore";
import { BriefTab } from "../components/intent/BriefTab";
import { SourceTab } from "../components/intent/SourceTab";
import { VisualTab } from "../components/intent/VisualTab";
import { canContinueFromSource, hasCompletedBrief, type IntentTab } from "../components/intent/intentFlow";

interface TabItem {
  id: IntentTab;
  label: string;
  icon: typeof MessageSquareText;
  description: string;
}

const tabs: TabItem[] = [
  { id: "brief", label: "确认需求", icon: MessageSquareText, description: "明确受众与目标" },
  { id: "source", label: "补充资料", icon: ClipboardPaste, description: "提取并确认事实" },
  { id: "visual", label: "选择视觉", icon: Palette, description: "选模板并生成结构" }
];

export function IntentSpace() {
  const [searchParams, setSearchParams] = useSearchParams();
  const project = useWorkbenchStore((state) => state.project);
  const facts = useWorkbenchStore((state) => state.facts);
  const requestedTab = searchParams.get("tab");
  const activeTab: IntentTab = requestedTab === "source" || requestedTab === "visual" ? requestedTab : "brief";
  const briefComplete = hasCompletedBrief(project);
  const sourceComplete = canContinueFromSource(facts);

  useEffect(() => {
    if (!project) return;
    if (activeTab === "visual" && !sourceComplete) {
      setSearchParams({ tab: briefComplete ? "source" : "brief" }, { replace: true });
      return;
    }
    if (activeTab === "source" && !briefComplete) {
      setSearchParams({ tab: "brief" }, { replace: true });
    }
  }, [activeTab, briefComplete, project, setSearchParams, sourceComplete]);

  function setTab(tab: IntentTab) {
    if (tab === "source" && !briefComplete) return;
    if (tab === "visual" && !sourceComplete) return;
    setSearchParams({ tab });
  }

  return (
    <div className="intent-space">
      <div className="intent-space__header">
        <div className="intent-space__heading-row">
          <div>
            <h1 className="text-2xl font-bold text-title">确认创作意图</h1>
            <p className="mt-1 text-sm text-muted">
              先把内容依据确认清楚，再选择视觉模板并生成结构。
            </p>
          </div>

          <nav className="intent-stepper" aria-label="意图创作步骤">
            {tabs.map((tab, index) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const isDone = tab.id === "brief" ? briefComplete : tab.id === "source" ? sourceComplete : false;
              const isLocked = tab.id === "source" ? !briefComplete : tab.id === "visual" ? !sourceComplete : false;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`intent-step ${isActive ? "is-active" : ""} ${isDone ? "is-done" : ""}`}
                  onClick={() => setTab(tab.id)}
                  disabled={isLocked}
                  aria-current={isActive ? "step" : undefined}
                >
                  <span className="intent-step__number">
                    {isLocked ? <LockKeyhole /> : isDone && !isActive ? <Check /> : <Icon />}
                  </span>
                  <span className="intent-step__copy">
                    <strong>{index + 1}. {tab.label}</strong>
                    <small>{tab.description}</small>
                  </span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      <div className="intent-space__content">
        {activeTab === "brief" && <BriefTab />}
        {activeTab === "source" && <SourceTab />}
        {activeTab === "visual" && <VisualTab />}
      </div>
    </div>
  );
}
