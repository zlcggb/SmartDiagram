/**
 * 进度事件发射器 — 按 projectId 分频道推送 AI 生成进度。
 *
 * 后端路由在每个 AI 调用关键节点调用 emitProgress()，
 * SSE 端点 subscribe/unsubscribe 实时转发给前端。
 */

import { EventEmitter } from "node:events";

export interface ProgressEvent {
  /** 阶段标识 */
  stage: "brief" | "research" | "outline" | "search" | "plan" | "design" | "ir" | "export" | "pipeline";
  /** 状态 */
  status: "start" | "progress" | "done" | "error" | "skip";
  /** 人类可读消息 */
  message: string;
  /** 当前进度 */
  current?: number;
  /** 总数 */
  total?: number;
  /** 关联页面 ID */
  slideId?: string;
  /** 关联页面标题 */
  slideTitle?: string;
  /** 流式 token 片段（用于长文本生成时实时展示） */
  delta?: string;
  /** 流式片段标识，供前端去重 */
  chunkId?: string;
  /** 子步骤/页面标识，例如 P2 标题 */
  subStage?: string;
  /** 阶段 start 时是否清空上一阶段累积的流式输出 */
  clearDelta?: boolean;
  /** 时间戳 */
  timestamp: string;
}

type ProgressListener = (event: ProgressEvent) => void;

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

function channelKey(projectId: string) {
  return `progress:${projectId}`;
}

/** 发射进度事件 */
export function emitProgress(
  projectId: string,
  event: Omit<ProgressEvent, "timestamp">
): void {
  const full: ProgressEvent = {
    ...event,
    timestamp: new Date().toISOString()
  };
  emitter.emit(channelKey(projectId), full);
}

/** 订阅进度事件 */
export function subscribeProgress(
  projectId: string,
  listener: ProgressListener
): () => void {
  const key = channelKey(projectId);
  emitter.on(key, listener);
  return () => {
    emitter.off(key, listener);
  };
}

/** 快捷方法：批量操作中推送按页进度 */
export function emitSlideProgress(
  projectId: string,
  stage: ProgressEvent["stage"],
  slideTitle: string,
  slideId: string,
  current: number,
  total: number
): void {
  emitProgress(projectId, {
    stage,
    status: "progress",
    message: `${slideTitle}（${current}/${total}）`,
    current,
    total,
    slideId,
    slideTitle
  });
}
