import { createGrokSidecarOrchestrationBackend } from "./grokSidecarBackend.js";
import { createNativeOrchestrationBackend } from "./nativeBackend.js";
import type { OrchestrationBackend, OrchestrationBackendKind } from "./types.js";

export function resolveOrchestrationBackendKind(
  raw = process.env.ORCHESTRATION_BACKEND
): OrchestrationBackendKind {
  const value = (raw || "native").trim().toLowerCase();
  if (value === "grok-sidecar" || value === "grok" || value === "sidecar") {
    return "grok-sidecar";
  }
  return "native";
}

/**
 * 工厂：按环境变量选择编排后端。
 * - ORCHESTRATION_BACKEND=native（默认）
 * - ORCHESTRATION_BACKEND=grok-sidecar + 可选 GROK_SIDECAR_BIN
 */
export function createOrchestrationBackend(
  kind: OrchestrationBackendKind = resolveOrchestrationBackendKind()
): OrchestrationBackend {
  if (kind === "grok-sidecar") {
    return createGrokSidecarOrchestrationBackend({
      bin: process.env.GROK_SIDECAR_BIN,
      fallBackToNativeMap: process.env.GROK_SIDECAR_STRICT_MAP !== "1"
    });
  }
  return createNativeOrchestrationBackend();
}
