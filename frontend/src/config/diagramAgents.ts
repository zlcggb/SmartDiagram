import {
  BarChart3,
  Brain,
  Code2,
  Image,
  Layout,
  PenTool,
  Workflow,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { DiagramEngineType, DiagramTaskType } from '../types/diagram';

export type DiagramAgentId = Exclude<DiagramEngineType, 'general'>;

export interface DiagramAgentMeta {
  id: DiagramAgentId;
  taskType: Exclude<DiagramTaskType, 'general'>;
  label: string;
  desc: string;
  engineLabel: string;
  prefix: string;
  dotClass: string;
  color: string;
  Icon: LucideIcon;
}

export const DIAGRAM_AGENTS: DiagramAgentMeta[] = [
  {
    id: 'charts',
    taskType: 'data_chart',
    label: '数据图表',
    desc: '柱状图 / 折线图 / 仪表盘',
    engineLabel: 'ECharts',
    prefix: '@charts ',
    dotClass: 'bg-pink-400',
    color: '#f472b6',
    Icon: BarChart3,
  },
  {
    id: 'flow',
    taskType: 'flow',
    label: '流程与关系图',
    desc: '流程图 / DAG / 节点关系',
    engineLabel: 'React Flow',
    prefix: '@flow ',
    dotClass: 'bg-blue-400',
    color: '#60a5fa',
    Icon: Workflow,
  },
  {
    id: 'drawio',
    taskType: 'architecture',
    label: '架构图',
    desc: '系统架构 / 拓扑 / 云资源',
    engineLabel: 'Draw.io',
    prefix: '@drawio ',
    dotClass: 'bg-cyan-400',
    color: '#22d3ee',
    Icon: Layout,
  },
  {
    id: 'mermaid',
    taskType: 'document',
    label: '文档标准图',
    desc: '时序图 / 甘特图 / UML',
    engineLabel: 'Mermaid',
    prefix: '@mermaid ',
    dotClass: 'bg-emerald-400',
    color: '#34d399',
    Icon: Code2,
  },
  {
    id: 'mindmap',
    taskType: 'mindmap',
    label: '思维导图',
    desc: '层级梳理 / 主题脑暴',
    engineLabel: 'Mindmap',
    prefix: '@mindmap ',
    dotClass: 'bg-amber-400',
    color: '#fbbf24',
    Icon: Brain,
  },
  {
    id: 'excalidraw',
    taskType: 'sketch',
    label: '手绘草图',
    desc: '低保真白板 / 草图表达',
    engineLabel: 'Excalidraw',
    prefix: '@excalidraw ',
    dotClass: 'bg-purple-400',
    color: '#a78bfa',
    Icon: PenTool,
  },
  {
    id: 'infographic',
    taskType: 'infographic',
    label: '信息图模板',
    desc: '叙事卡片 / KPI 海报',
    engineLabel: 'AntV Infographic',
    prefix: '@infographic ',
    dotClass: 'bg-rose-400',
    color: '#fb7185',
    Icon: Image,
  },
];

export const DIAGRAM_AGENT_MAP = Object.fromEntries(
  DIAGRAM_AGENTS.map((agent) => [agent.id, agent]),
) as Record<DiagramAgentId, DiagramAgentMeta>;

export const TASK_TO_ENGINE = Object.fromEntries(
  DIAGRAM_AGENTS.map((agent) => [agent.taskType, agent.id]),
) as Record<Exclude<DiagramTaskType, 'general'>, DiagramAgentId>;

export const ENGINE_TO_TASK = Object.fromEntries(
  DIAGRAM_AGENTS.map((agent) => [agent.id, agent.taskType]),
) as Record<DiagramAgentId, Exclude<DiagramTaskType, 'general'>>;

export const DIAGRAM_TASK_MAP = Object.fromEntries(
  DIAGRAM_AGENTS.map((agent) => [agent.taskType, agent]),
) as Record<Exclude<DiagramTaskType, 'general'>, DiagramAgentMeta>;

export function getAgentMeta(agent: DiagramEngineType | null | undefined) {
  if (!agent || agent === 'general') return null;
  return DIAGRAM_AGENT_MAP[agent as DiagramAgentId];
}

export function getAgentDisplayName(agent: DiagramEngineType | null | undefined) {
  return getAgentMeta(agent)?.label || '通用助手';
}

export function getAgentEngineName(agent: DiagramEngineType | null | undefined) {
  return getAgentMeta(agent)?.engineLabel || '';
}

export function getTaskMeta(task: DiagramTaskType | null | undefined) {
  if (!task || task === 'general') return null;
  return DIAGRAM_TASK_MAP[task];
}

export function getTaskDisplayName(task: DiagramTaskType | null | undefined) {
  return getTaskMeta(task)?.label || '通用助手';
}

export function getTaskByEngine(engine: DiagramEngineType | null | undefined) {
  if (!engine || engine === 'general') return null;
  return ENGINE_TO_TASK[engine as DiagramAgentId] || null;
}
