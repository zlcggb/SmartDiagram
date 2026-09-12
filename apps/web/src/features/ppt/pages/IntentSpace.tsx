import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useWorkbenchStore } from '@/features/ppt/store/workbenchStore';
import { BriefTab } from "../components/intent/BriefTab";
import { SourceTab } from "../components/intent/SourceTab";
import { VisualTab } from "../components/intent/VisualTab";
import { canContinueFromSource, hasCompletedBrief, type IntentTab } from "../components/intent/intentFlow";

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

  return (
    <div className="intent-space">
      <div className="intent-space__content">
        {activeTab === "brief" && <BriefTab />}
        {activeTab === "source" && <SourceTab />}
        {activeTab === "visual" && <VisualTab />}
      </div>
    </div>
  );
}
