/**
 * 编排后端端口 —— 把「谁在跑 Primary / Subagent / wait_all」从业务路由解耦。
 *
 * - native：本仓 stageGraph + parallelMap（默认，产品主路径）
 * - grok-sidecar：进程外 grok headless/ACP 的适配位（骨架；默认不可用）
 *
 * 对照：references/grok-build（xai-grok-shell / subagent / hooks）
 */

import type { ParallelMapOptions, ParallelMapResult } from "../parallelMap.js";
import type { PipelineStageId, StageAgentRole } from "../stageGraph.js";

/** 与 grok hooks / Cursor 兼容事件名对齐的精简子集 */
export type OrchestrationHookEvent =
  | "SessionStart"
  | "SessionEnd"
  | "StageStart"
  | "StageEnd"
  | "SubagentStart"
  | "SubagentStop"
  | "FanOutDone";

export type OrchestrationBackendKind = "native" | "grok-sidecar";

export type OrchestrationHookPayload = {
  event: OrchestrationHookEvent;
  stage?: PipelineStageId;
  role?: StageAgentRole;
  message?: string;
  current?: number;
  total?: number;
  slideId?: string;
};

export type OrchestrationHookListener = (payload: OrchestrationHookPayload) => void;

export type PageFanOutOptions<T> = ParallelMapOptions<T> & {
  /** 阶段 id，用于 hook / 进度类比 SubagentStart/Stop */
  stage?: PipelineStageId;
  role?: StageAgentRole;
};

/**
 * 编排后端契约。
 * 业务层（run-pipeline / search-all）应依赖本接口，而非直接绑死某种运行时。
 */
export interface OrchestrationBackend {
  readonly kind: OrchestrationBackendKind;
  /** 是否可真正执行（sidecar 未配置二进制时为 false） */
  isAvailable(): boolean;
  /** 人类可读说明（运维 / 调试） */
  describe(): string;
  /**
   * 有限并发 fan-out + wait_all（类 grok 多子代理并行后汇总）。
   * native 委托 parallelMap；sidecar 骨架阶段同样走 native 语义或抛错。
   */
  mapPages<T, R>(
    items: readonly T[],
    worker: (item: T, index: number, emitToken: (token: string) => void) => Promise<R>,
    options?: PageFanOutOptions<T>
  ): Promise<Array<ParallelMapResult<T, R>>>;
  /** 订阅生命周期（类 SubagentStart/Stop；可选） */
  onHook?(listener: OrchestrationHookListener): () => void;
  /**
   * 进程外执行单次角色任务（仅 sidecar 有意义；native 返回 unsupported）。
   * 不在产品默认路径调用。
   */
  runExternalRole?(input: {
    role: StageAgentRole;
    prompt: string;
    cwd?: string;
  }): Promise<{ ok: false; reason: string } | { ok: true; text: string }>;
}
