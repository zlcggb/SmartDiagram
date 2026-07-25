import { API_BASE, enterpriseHeaders } from '@/shared/lib/config/enterpriseContext.ts';
import type { DiagramEngineType, DiagramTaskType } from '@/types/diagram';

export type HistoryAgentProcess = {
  run_id?: string;
  status?: string;
  duration_ms?: number;
  duration_seconds?: number;
  step_count?: number;
  assistant_content?: string;
  token_usage?: {
    estimated_total_tokens?: number;
    stream_event_count?: number;
  };
  steps?: Array<{
    id?: string;
    label?: string;
    status?: string;
    duration_ms?: number;
    duration_seconds?: number;
  }>;
} | null;

export interface DiagramHistoryItem {
  diagram_id: string;
  title: string;
  engine_type?: DiagramEngineType;
  task_type?: DiagramTaskType;
  current_version_id?: string;
  updated_at?: string;
  conversation?: {
    summary?: string;
  };
  current_version?: {
    diagram_version_id: string;
    version_number?: number;
    engine_type?: DiagramEngineType;
    task_type?: DiagramTaskType;
    design_concept?: string;
    code?: string;
    code_preview?: string;
    code_hash?: string;
    created_at?: string;
    agent_process?: HistoryAgentProcess;
  } | null;
}

export interface ConversationHistoryMessage {
  id: string;
  role: string;
  content?: string;
  engine_type?: string;
  task_type?: string;
  diagram_version_id?: string;
  code?: string;
  design_concept?: string;
  diagram_id?: string;
  created_at?: string;
  agent_process?: HistoryAgentProcess;
}

export interface ConversationHistoryDiagram {
  diagram_id: string;
  diagram_version_id: string;
  version_number?: number;
  title?: string;
  engine_type?: DiagramEngineType;
  task_type?: DiagramTaskType;
  design_concept?: string;
  code?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ConversationHistoryItem {
  conversation_id: string;
  title?: string;
  status?: string;
  summary?: string;
  current_diagram_version_id?: string;
  message_count?: number;
  updated_at?: string;
  context?: {
    last_engine_type?: string;
    last_task_type?: string;
    short_term_memory?: {
      turn_count?: number;
      last_user_message?: string;
      last_assistant_outcome?: string;
    };
  };
  messages?: ConversationHistoryMessage[];
  current_diagram?: ConversationHistoryDiagram | null;
}

async function readHistoryResponse<T>(
  path: string,
  key: "diagrams" | "conversations"
): Promise<T[]> {
  const response = await fetch(API_BASE + path, {
    method: "GET",
    headers: enterpriseHeaders()
  });
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(detail || "历史记录加载失败（HTTP " + response.status + "）");
  }
  const payload = await response.json() as Record<string, unknown>;
  const records = payload[key];
  return Array.isArray(records) ? records as T[] : [];
}

function appendSearchQuery(params: URLSearchParams, query?: string) {
  const trimmedQuery = query?.trim();
  if (trimmedQuery) params.set("query", trimmedQuery);
}

export function listDiagramHistory(query?: string): Promise<DiagramHistoryItem[]> {
  const params = new URLSearchParams({
    include_code: "true",
    limit: "20"
  });
  appendSearchQuery(params, query);
  return readHistoryResponse<DiagramHistoryItem>(
    "/api/diagrams/history?" + params.toString(),
    "diagrams"
  );
}

export function listConversationHistory(query?: string): Promise<ConversationHistoryItem[]> {
  const params = new URLSearchParams({
    include_messages: "true",
    include_current_diagram: "true",
    limit: "20"
  });
  appendSearchQuery(params, query);
  return readHistoryResponse<ConversationHistoryItem>(
    "/api/conversations/history?" + params.toString(),
    "conversations"
  );
}
