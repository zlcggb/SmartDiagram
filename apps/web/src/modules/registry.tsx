/**
 * 模块注册表 — SmartDiagram 平台的统一模块声明。
 *
 * 导航栏（AppShell）和首页（HomePage）都从这里渲染模块入口。
 * 接入新模块：在这里加一条记录 + 在路由里挂它的组件，无需改动导航与首页。
 */
import type { LucideIcon } from 'lucide-react';
import { BrainCircuit, Presentation } from 'lucide-react';

export interface ModuleRegistration {
  /** 路由路径（如 /diagram），导航高亮以此为前缀匹配 */
  path: string;
  /** 导航栏显示名 */
  navLabel: string;
  /** 首页卡片标题 */
  title: string;
  /** 一句话定位 */
  tagline: string;
  /** 首页卡片描述 */
  description: string;
  /** 核心能力点（首页展示 3~4 条） */
  highlights: string[];
  icon: LucideIcon;
  /** 主题色（用于图标底色与 CTA 渐变） */
  accent: {
    gradientFrom: string;
    gradientTo: string;
    glowColor: string;
  };
}

export const moduleRegistry: ModuleRegistration[] = [
  {
    path: '/diagram',
    navLabel: '智能图表',
    title: '智能图表',
    tagline: '对话即绘图',
    description:
      '独立业务模块：用自然语言生成思维导图、流程图、架构图、时序图与数据可视化，生成后可在画布继续编辑、版本管理与导出。',
    highlights: ['自然语言生成图表', '多引擎智能路由', '画布实时编辑与导出'],
    icon: BrainCircuit,
    accent: {
      gradientFrom: '#6366f1',
      gradientTo: '#22d3ee',
      glowColor: 'rgba(99, 102, 241, 0.35)',
    },
  },
  {
    path: '/ppt',
    navLabel: 'PPT 制作',
    title: 'PPT Agent 制作引擎',
    tagline: '资料进，演示出',
    description:
      '把项目资料变成一份演示文稿。事实确认、大纲便利贴、单页策划、AI 页面设计五步成稿，导出的 PPTX 是原生可编辑对象，文字和卡片都能继续改。',
    highlights: ['资料驱动的五步工作流', 'AI 页面设计与预览', '导出可编辑 PPTX'],
    icon: Presentation,
    accent: {
      gradientFrom: '#f59e0b',
      gradientTo: '#f43f5e',
      glowColor: 'rgba(245, 158, 11, 0.3)',
    },
  },
];
