# @ppt-agent/agents — Backend Development Guidelines

> PPT Agent 逻辑包：TypeScript，包含设计知识、提示词、生成管线

---

## Pre-Development Checklist

1. [ ] Read the design knowledge system: `src/designKnowledge/`
2. [ ] Check prompt templates: `src/prompts.ts`
3. [ ] Understand IR vs SVG generation: `src/slideIrGeneration.ts`
4. [ ] Shared types from `@ppt-agent/shared`

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | To fill |
| [Database Guidelines](./database-guidelines.md) | ORM patterns, queries, migrations | N/A |
| [Error Handling](./error-handling.md) | Error types, handling strategies | To fill |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | Filled |
| [Logging Guidelines](./logging-guidelines.md) | Structured logging, log levels | To fill |

---

## Key Architecture

### Design Knowledge Pipeline

```
designKnowledge/
├── kimiSlides/          # 外置设计知识适配层
│   ├── scenarioContract  # 场景规范
│   └── designSystem     # 设计系统契约
├── visualRecipes.ts     # 视觉配方库
└── qualityGates.ts      # 质量门禁（字号/溢出/截断/空文本框）
```

### Quality Gates (Post-generation)

- 字号检测
- 文字溢出检测
- 可见截断检测
- 空文本框检测
- 等分文字栏检测
- 关系图元门禁

### Conventions

- 模型接收编译后的短契约 (`SCENARIO_CONTRACT`, `DESIGN_SYSTEM_CONTRACT`, `DESIGN_BLUEPRINT`)，不注入整篇原始 Markdown
- 第二轮修复携带上一候选源码和精确问题
- `PPT_KIMI_KNOWLEDGE_MODE=off` 关闭外置资料检索，但不改变输出协议

---

## Quality Check

1. [ ] Prompt changes tested with at least 1 slide generation
2. [ ] Quality gate changes backward compatible
3. [ ] New contracts documented in `DESIGN_BLUEPRINT` format
4. [ ] No raw slide content in prompt templates (use parameterized contracts)
