import { useCallback, useEffect, useState } from "react";
import {
  listConversationHistory,
  listDiagramHistory,
  type ConversationHistoryItem,
  type DiagramHistoryItem
} from "../../lib/diagramHistory";
import { api } from "../../ppt/lib/api";
import type { ProjectDto } from "../../ppt/shared";

export interface RecentWorkErrors {
  projects?: string;
  diagrams?: string;
  conversations?: string;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "暂时无法加载";
}

export function useRecentWork(enabled: boolean) {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [diagrams, setDiagrams] = useState<DiagramHistoryItem[]>([]);
  const [conversations, setConversations] = useState<ConversationHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<RecentWorkErrors>({});

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setErrors({});

    const [projectResult, diagramResult, conversationResult] = await Promise.allSettled([
      api.listProjects(),
      listDiagramHistory(),
      listConversationHistory()
    ]);

    const nextErrors: RecentWorkErrors = {};
    if (projectResult.status === "fulfilled") setProjects(projectResult.value);
    else nextErrors.projects = errorMessage(projectResult.reason);

    if (diagramResult.status === "fulfilled") setDiagrams(diagramResult.value);
    else nextErrors.diagrams = errorMessage(diagramResult.reason);

    if (conversationResult.status === "fulfilled") setConversations(conversationResult.value);
    else nextErrors.conversations = errorMessage(conversationResult.reason);

    setErrors(nextErrors);
    setLoading(false);
  }, [enabled]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  return {
    projects,
    diagrams,
    conversations,
    loading,
    errors,
    refresh
  };
}
