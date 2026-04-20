/**
 * Zustand store for SmartDiagram chat state.
 */

import { create } from 'zustand';
import type { DiagramEngineType, DiagramTaskType } from '../types/diagram';

export type CanvasPhase = 'idle' | 'routing' | 'designing' | 'generating' | 'done';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  taskType?: DiagramTaskType;
  engineType?: DiagramEngineType;
  designConcept?: string;
  code?: string;
  images?: string[];
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
  clearMessages: () => void;

  // Streaming state
  isStreaming: boolean;
  setIsStreaming: (v: boolean) => void;
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
  clearMessages: () => set({ messages: [] }),

  isStreaming: false,
  setIsStreaming: (v) => set({ isStreaming: v }),
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
}));
