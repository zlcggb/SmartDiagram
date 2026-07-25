/**
 * PPT 流水线「阶段图」——对照 grok-build 的 Primary / Subagent 编排，用 TS 轻量表达。
 *
 * grok-build（references/grok-build）：
 * - Primary agent：主会话，可 spawn_subagent
 * - Subagent：独立上下文、按 type/persona/capability 限权
 * - 并行：多子代理 + wait_all / wait_any
 *
 * 本仓库不引入 Rust 运行时；用「阶段角色 + 按页 fan-out」同构：
 * - Orchestrator = run-pipeline / Studio 按钮
 * - Researcher / Planner / Designer = 不同阶段 + 不同模型角色
 * - 每页 worker = 类 subagent（独立 slide 上下文，parallelMap 限并发）
 */

export type StageAgentRole = "orchestrator" | "researcher" | "planner" | "designer" | "exporter";

export type PipelineStageId =
  | "brief"
  | "research"
  | "outline"
  | "search"
  | "plan"
  | "design"
  | "ir"
  | "export";

export type PipelineStageDef = {
  id: PipelineStageId;
  role: StageAgentRole;
  /** 人类可读 */
  label: string;
  /** 对应 grok-build 概念 */
  grokAnalogy: string;
  /** 是否适合按页 fan-out */
  pageFanOut: boolean;
  /** 模型角色：main=OPENAI_COMPATIBLE_MODEL；design=DESIGN_MODEL */
  modelRole: "main" | "design" | "none";
};

/** 固定阶段图（产品流水线，非通用 chat agent） */
export const PIPELINE_STAGES: PipelineStageDef[] = [
  {
    id: "brief",
    role: "orchestrator",
    label: "需求澄清",
    grokAnalogy: "Primary 开场 / plan 模式收意图",
    pageFanOut: false,
    modelRole: "main"
  },
  {
    id: "research",
    role: "researcher",
    label: "背景调研",
    grokAnalogy: "explore / researcher persona 子代理",
    pageFanOut: false,
    modelRole: "main"
  },
  {
    id: "outline",
    role: "planner",
    label: "大纲架构",
    grokAnalogy: "plan 子代理（只规划不改稿）",
    pageFanOut: false,
    modelRole: "main"
  },
  {
    id: "search",
    role: "researcher",
    label: "按页检索",
    grokAnalogy: "多 explore 子代理 fan-out + wait_all",
    pageFanOut: true,
    modelRole: "main"
  },
  {
    id: "plan",
    role: "planner",
    label: "按页初稿",
    grokAnalogy: "多 plan 子代理 fan-out",
    pageFanOut: true,
    modelRole: "main"
  },
  {
    id: "design",
    role: "designer",
    label: "按页设计稿",
    grokAnalogy: "实现型子代理（更强模型 / 限工具）",
    pageFanOut: true,
    modelRole: "design"
  },
  {
    id: "ir",
    role: "designer",
    label: "按页 IR",
    grokAnalogy: "能力受限子代理（稳妥可编辑）",
    pageFanOut: true,
    modelRole: "main"
  },
  {
    id: "export",
    role: "exporter",
    label: "导出 PPTX",
    grokAnalogy: "无 LLM 的工具步骤 / background task 收尾",
    pageFanOut: false,
    modelRole: "none"
  }
];

export function stageDef(id: PipelineStageId): PipelineStageDef | undefined {
  return PIPELINE_STAGES.find((stage) => stage.id === id);
}

export function roleLabel(role: StageAgentRole): string {
  switch (role) {
    case "orchestrator":
      return "编排器";
    case "researcher":
      return "检索员";
    case "planner":
      return "策划";
    case "designer":
      return "设计师";
    case "exporter":
      return "渲染器";
    default:
      return role;
  }
}
