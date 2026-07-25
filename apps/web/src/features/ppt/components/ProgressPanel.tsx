import { AgentExecutionPanel } from "./AgentExecutionPanel";

/**
 * 兼容旧入口：全局浮动执行面板。
 * 实际渲染已迁移到 AgentExecutionPanel，本组件仅作为 floating 变体的薄封装。
 */
export function ProgressPanel() {
  return <AgentExecutionPanel variant="floating" />;
}
