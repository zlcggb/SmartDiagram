/**
 * API 侧编排后端单例。
 * 默认 native；ORCHESTRATION_BACKEND=grok-sidecar 时启用 sidecar 骨架（map 仍回退 native）。
 */
import { createOrchestrationBackend } from "@ppt-agent/agents";
import type { OrchestrationBackend } from "@ppt-agent/agents";

let backend: OrchestrationBackend | null = null;

export function getOrchestrationBackend(): OrchestrationBackend {
  if (!backend) {
    backend = createOrchestrationBackend();
  }
  return backend;
}

/** 测试或热切换用 */
export function resetOrchestrationBackendForTests() {
  backend = null;
}
