import { parallelMap } from "../parallelMap.js";
import type {
  OrchestrationBackend,
  OrchestrationHookListener,
  OrchestrationHookPayload
} from "./types.js";

function emit(
  listeners: Set<OrchestrationHookListener>,
  payload: OrchestrationHookPayload
) {
  for (const listener of listeners) {
    try {
      listener(payload);
    } catch {
      // hooks must not break pipeline
    }
  }
}

/** 默认编排：本仓 TS 阶段图 + parallelMap（wait_all） */
export function createNativeOrchestrationBackend(): OrchestrationBackend {
  const listeners = new Set<OrchestrationHookListener>();

  return {
    kind: "native",
    isAvailable: () => true,
    describe: () => "native: stageGraph + parallelMap (PPT product pipeline)",
    onHook(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async mapPages(items, worker, options = {}) {
      const stage = options.stage;
      const role = options.role;
      const total = items.length;
      emit(listeners, {
        event: "StageStart",
        stage,
        role,
        message: "fan-out start",
        total
      });

      const results = await parallelMap(items, worker, {
        concurrency: options.concurrency,
        onItemStart: (info) => {
          emit(listeners, {
            event: "SubagentStart",
            stage,
            role,
            message: `worker ${info.index + 1}/${info.total}`,
            current: info.index + 1,
            total: info.total
          });
          options.onItemStart?.(info);
        },
        onItemDone: (info) => {
          emit(listeners, {
            event: "SubagentStop",
            stage,
            role,
            message: info.ok ? "worker done" : "worker failed",
            current: info.index + 1,
            total: info.total
          });
          options.onItemDone?.(info);
        },
        onItemToken: options.onItemToken
      });

      emit(listeners, {
        event: "FanOutDone",
        stage,
        role,
        message: "wait_all complete",
        total
      });
      emit(listeners, {
        event: "StageEnd",
        stage,
        role,
        message: "fan-out end",
        total
      });
      return results;
    },
    async runExternalRole() {
      return {
        ok: false as const,
        reason: "native backend has no external role runner; use GeminiAdapter / pipeline routes"
      };
    }
  };
}
