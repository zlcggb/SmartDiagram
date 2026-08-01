# Web Frontend — Directory Structure

## Layout

```
apps/web/src/
├── app/
│   └── main.tsx              # 路由入口：/ · /diagram/* · /ppt/*
├── features/
│   ├── diagram/              # 图表业务模块
│   │   ├── model/            # Zustand stores (chatStore, diagramHistory)
│   │   └── ui/               # UI components
│   │       ├── chat/         # ChatPanel and related
│   │       ├── layout/       # CanvasPanel, workspace layout
│   │       ├── *Canvas.tsx   # 各引擎画布 (Mermaid, Flow, Excalidraw...)
│   │       └── ExportButton.tsx, SaveButton.tsx
│   └── ppt/                  # PPT 业务模块
│       ├── store/            # workbenchStore.ts
│       ├── lib/              # api.ts, helpers
│       ├── components/       # 各步骤 UI 组件
│       └── pages/            # IntentSpace, StructureSpace, StudioSpace, ExportsSpace
├── pages/
│   ├── home/                 # HomePage — 模块入口卡片
│   └── diagram/              # DiagramWorkspace
├── shared/
│   ├── hooks/                # 通用 hooks
│   ├── lib/                  # config, auth, utilities
│   │   └── config/           # diagramAgents.ts, guestSession.ts
│   ├── store/                # 平台级 stores
│   └── ui/                   # 共享 UI 组件
│       └── shell/            # AppShell (macOS 风格菜单栏)
├── modules/
│   └── registry.tsx          # 模块注册表（导航 + 首页自动生成）
└── types/                    # TypeScript 类型定义
```

## Conventions

- **Feature isolation**: `features/diagram/` 和 `features/ppt/` 是平级业务模块，互不导入
- **Shared layer**: 跨模块复用的组件、hooks、config 放 `shared/`
- **Module registration**: 新增模块只改 `modules/registry.tsx` + `main.tsx` 挂 Route
- **Import alias**: 使用 `@/` 指向 `apps/web/src/`，不用深层相对路径

## Canvas Component Naming

每个绘图引擎一个 `*Canvas.tsx`，命名严格对应后端 `agents/catalog.py` 中的 engine：

| Engine | Canvas Component |
|--------|-----------------|
| excalidraw | `ExcalidrawCanvas.tsx` |
| mermaid | `MermaidCanvas.tsx` |
| flow | `FlowCanvas.tsx` |
| mindmap | `MindmapCanvas.tsx` |
| charts | `ChartsCanvas.tsx` |
| drawio | `DrawioCanvas.tsx` |
| infographic | `InfographicCanvas.tsx` |
| html_email / web_report_html | `ArtifactCanvas.tsx` |
