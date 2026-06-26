/**
 * Zustand store for SmartDiagram chat state.
 */

import { create } from 'zustand';
import type { DiagramEngineType, DiagramTaskType } from '../types/diagram';

const makeClientId = (prefix: string) => {
  const randomId = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${randomId}`;
};

export type CanvasPhase = 'idle' | 'routing' | 'designing' | 'generating' | 'done';

export interface SelectedNodeInfo {
  id: string;
  text: string;
  type: 'mindmap' | 'flow';
}

export interface ThinkingStep {
  id: string;
  label: string;
  startTime: number;
  duration?: number;
  status: 'running' | 'completed';
}

export interface ExecutionPlanStep {
  id: string;
  label: string;
  agent: string;
  phase: string;
  status: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface ConversationMemorySummary {
  status: string;
  reason?: string;
  summaryPresent: boolean;
  recentCount: number;
  turnCount?: number;
  currentDiagramVersionId?: string;
}

export interface LongTermPreferencesSummary {
  status: string;
  reason?: string;
  sources: Record<string, boolean>;
  keys: string[];
}

export interface ConversationResumeNotice {
  status: 'canvas_restored' | 'canvas_missing';
  conversationTitle: string;
  messageCount: number;
  currentDiagramVersionId?: string;
  reason?: string;
}

export interface KnowledgeContextSummary {
  status: string;
  count: number;
  citations: Record<string, unknown>[];
  selectedTemplate?: {
    templateId: string;
    name: string;
    engineType?: string;
    taskType?: string;
    matchScore?: number;
  };
  historicalDiagrams?: {
    diagramId: string;
    title: string;
    engineType?: string;
    taskType?: string;
    currentVersionId?: string;
  }[];
  note?: string;
}

export interface PlannerPlanSummary {
  status: string;
  mode?: string;
  complexity?: string;
  engineType?: string;
  knowledgeRequired: boolean;
  subtasks: Record<string, unknown>[];
  qualityGates: string[];
  assumptions: string[];
  note?: string;
}

export interface DesignAgentSummary {
  status: string;
  engineType?: string;
  changed: boolean;
  appliedRules: string[];
  note?: string;
}

export interface RepairAgentSummary {
  status: string;
  engineType?: string;
  repaired: boolean;
  appliedRules: string[];
  errors: string[];
  validationOk: boolean;
  note?: string;
}

export interface ConsistencyAgentSummary {
  status: string;
  ok: boolean;
  needsUserInput: boolean;
  checkedChunks: number;
  missingRequiredTerms: string[];
  forbiddenTermsPresent: string[];
  coverageRatio: number;
  note?: string;
}

export interface HumanApprovalSummary {
  approvalId: string;
  approvalType: string;
  status: string;
  requiredScope: string;
  reason: string;
  resource: Record<string, unknown>;
}

export interface ExportPlanSummary {
  status: string;
  engineType?: string;
  preferredFormat?: string;
  allowedFormats: Record<string, unknown>[];
  deniedFormats: Record<string, unknown>[];
  note?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  taskType?: DiagramTaskType;
  engineType?: DiagramEngineType;
  designConcept?: string;
  code?: string;
  diagramId?: string;
  diagramVersionId?: string;
  images?: string[];
  statusText?: string;
  steps?: ThinkingStep[];
  executionPlan?: ExecutionPlanStep[];
  conversationMemory?: ConversationMemorySummary;
  longTermPreferences?: LongTermPreferencesSummary;
  resumeNotice?: ConversationResumeNotice;
  plannerPlan?: PlannerPlanSummary;
  designAgent?: DesignAgentSummary;
  repairAgent?: RepairAgentSummary;
  consistencyAgent?: ConsistencyAgentSummary;
  approvalRequest?: HumanApprovalSummary;
  knowledgeContext?: KnowledgeContextSummary;
  exportPlan?: ExportPlanSummary;
  timestamp: number;
}

interface ModelConfig {
  model_id: string;
  api_key: string;
  base_url: string;
}

interface ChatStore {
  // Messages
  messages: Message[];
  addMessage: (msg: Message) => void;
  updateLastAssistantMessage: (updates: Partial<Message>) => void;
  updateMessageById: (id: string, updates: Partial<Message>) => void;
  clearMessages: () => void;

  // Enterprise persistence context
  conversationId: string;
  setConversationId: (v: string) => void;

  // Selected canvas node for precise editing
  selectedNode: SelectedNodeInfo | null;
  setSelectedNode: (v: SelectedNodeInfo | null) => void;

  // Streaming state
  isStreaming: boolean;
  setIsStreaming: (v: boolean) => void;
  streamStartTime: number | null;
  setStreamStartTime: (v: number | null) => void;
  currentTask: DiagramTaskType | null;
  setCurrentTask: (v: DiagramTaskType | null) => void;
  currentEngine: DiagramEngineType | null;
  setCurrentEngine: (v: DiagramEngineType | null) => void;

  // Active canvas content
  canvasCode: string;
  setCanvasCode: (v: string) => void;
  canvasTask: DiagramTaskType | null;
  setCanvasTask: (v: DiagramTaskType | null) => void;
  canvasEngine: DiagramEngineType | null;
  setCanvasEngine: (v: DiagramEngineType | null) => void;
  canvasDiagramId: string | null;
  setCanvasDiagramId: (v: string | null) => void;
  canvasDiagramVersionId: string | null;
  setCanvasDiagramVersionId: (v: string | null) => void;
  canvasRenderRevision: number;
  requestCanvasRenderRetry: () => void;

  // Design concept
  designConcept: string;
  setDesignConcept: (v: string) => void;

  // Canvas generation phase
  canvasPhase: CanvasPhase;
  setCanvasPhase: (v: CanvasPhase) => void;

  // Streaming code preview
  streamingCode: string;
  setStreamingCode: (v: string) => void;

  // Model config
  modelConfig: ModelConfig | null;
  setModelConfig: (v: ModelConfig | null) => void;

  // Excalidraw API ref (shared so toolbar can export)
  excalidrawAPI: any | null;
  setExcalidrawAPI: (v: any | null) => void;

  // Mind-elixir instance ref (shared so toolbar can use official export API)
  mindmapInstance: any | null;
  setMindmapInstance: (v: any | null) => void;

  // Streaming elements — individual elements added in real-time during generation
  pendingElements: any[];
  addPendingElement: (el: any) => void;
  clearPendingElements: () => void;

  // Image upload — base64 data URLs waiting to be sent
  inputImages: string[];
  addInputImage: (dataUrl: string) => void;
  removeInputImage: (index: number) => void;
  clearInputImages: () => void;

  // Generating length control ('short' | 'medium' | 'long')
  detailLevel: 'short' | 'medium' | 'long';
  setDetailLevel: (v: 'short' | 'medium' | 'long') => void;

  // Canvas background mode ('dark' | 'light')
  canvasMode: 'dark' | 'light';
  setCanvasMode: (v: 'dark' | 'light') => void;

  // Mobile active panel ('chat' | 'canvas')
  mobileActivePanel: 'chat' | 'canvas';
  setMobileActivePanel: (v: 'chat' | 'canvas') => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  updateLastAssistantMessage: (updates) =>
    set((s) => {
      const msgs = [...s.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') {
          msgs[i] = { ...msgs[i], ...updates };
          break;
        }
      }
      return { messages: msgs };
    }),
  updateMessageById: (id, updates) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    })),
  clearMessages: () => set({
    messages: [],
    conversationId: makeClientId('conv'),
    canvasDiagramId: null,
    canvasDiagramVersionId: null,
  }),

  conversationId: makeClientId('conv'),
  setConversationId: (v) => set({ conversationId: v }),

  selectedNode: null,
  setSelectedNode: (v) => set({ selectedNode: v }),

  isStreaming: false,
  setIsStreaming: (v) => set({ isStreaming: v }),
  streamStartTime: null,
  setStreamStartTime: (v) => set({ streamStartTime: v }),
  currentTask: null,
  setCurrentTask: (v) => set({ currentTask: v }),
  currentEngine: null,
  setCurrentEngine: (v) => set({ currentEngine: v }),

  canvasCode: '',
  setCanvasCode: (v) => set({ canvasCode: v }),
  canvasTask: null,
  setCanvasTask: (v) => set({ canvasTask: v }),
  canvasEngine: null,
  setCanvasEngine: (v) => set({ canvasEngine: v }),
  canvasDiagramId: null,
  setCanvasDiagramId: (v) => set({ canvasDiagramId: v }),
  canvasDiagramVersionId: null,
  setCanvasDiagramVersionId: (v) => set({ canvasDiagramVersionId: v }),
  canvasRenderRevision: 0,
  requestCanvasRenderRetry: () => set((s) => ({ canvasRenderRevision: s.canvasRenderRevision + 1 })),

  designConcept: '',
  setDesignConcept: (v) => set({ designConcept: v }),

  canvasPhase: 'idle',
  setCanvasPhase: (v) => set({ canvasPhase: v }),

  streamingCode: '',
  setStreamingCode: (v) => set({ streamingCode: v }),

  modelConfig: null,
  setModelConfig: (v) => set({ modelConfig: v }),

  excalidrawAPI: null,
  setExcalidrawAPI: (v) => set({ excalidrawAPI: v }),

  mindmapInstance: null,
  setMindmapInstance: (v) => set({ mindmapInstance: v }),

  pendingElements: [],
  addPendingElement: (el) => set((s) => ({ pendingElements: [...s.pendingElements, el] })),
  clearPendingElements: () => set({ pendingElements: [] }),

  inputImages: [],
  addInputImage: (dataUrl) => set((s) => ({ inputImages: [...s.inputImages, dataUrl] })),
  removeInputImage: (index) => set((s) => {
    const imgs = [...s.inputImages];
    imgs.splice(index, 1);
    return { inputImages: imgs };
  }),
  clearInputImages: () => set({ inputImages: [] }),

  detailLevel: 'medium',
  setDetailLevel: (v) => set({ detailLevel: v }),

  canvasMode: 'light',
  setCanvasMode: (v) => set({ canvasMode: v }),

  mobileActivePanel: 'chat',
  setMobileActivePanel: (v) => set({ mobileActivePanel: v }),
}));
