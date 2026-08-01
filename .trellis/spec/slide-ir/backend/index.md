# @ppt-agent/slide-ir — Backend Development Guidelines

> SmartSlide 页面语言模块：`.slide` YAML/JSON 解析、Schema 校验、SVG 预览、PPTX 编译

---

## Pre-Development Checklist

1. [ ] Read `schema.ts` for the `SlideIrDocument` type definition
2. [ ] Understand Zod schema validation: `SlideIrSchema`
3. [ ] Check test coverage: `index.test.ts`
4. [ ] Barrel exports from `src/index.ts`

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Code standards | Filled |

---

## Architecture

```
packages/slide-ir/src/
├── index.ts          # Barrel exports (所有公共 API)
├── schema.ts         # Zod schema: SlideIrSchema + all element types
├── language.ts       # parseSmartSlide / stringifySmartSlide
├── validate.ts       # validateSlideIr — 版面校验 + 文字高度估计
├── renderSvg.ts      # renderSlideIrToSvg — IR → SVG 预览
├── compilePptx.ts    # compileSlideIrToPptx — IR → PowerPoint 原生对象
├── tokens.ts         # 颜色令牌解析: resolveColor, collectColorReferences
├── jsonSchema.ts     # JSON Schema 生成
└── index.test.ts     # 单元测试
```

### Core Types

| Type | Purpose |
|------|---------|
| `SlideIrDocument` | 完整页面文档，包含元素列表 + 主题令牌 |
| `SlideIrElement` | 联合类型：Text / Shape / Image / Line / Table / Chart |
| `Bounds` | 元素定位：`{ x, y, width, height }` |
| `SlideIrIssue` | 校验问题：severity + message |

### Conventions

- **Canvas 尺寸**: `SMARTSLIDE_WIDTH` × `SMARTSLIDE_HEIGHT` (常量)
- **所有 Schema 都是 Zod**: `z.object({...})` 格式，运行时可校验
- **Pure functions**: 无副作用，不访问 DOM、不做网络请求
- **Dual output**: 每个 IR 文档既可渲染为 SVG 预览，也可编译为 PPTX

### Forbidden

- ❌ 在此包中引入 DOM API（纯 Node.js 包）
- ❌ 直接 import `@ppt-agent/agents`（依赖方向反了）
- ❌ 修改 Schema 不更新 `SMARTSLIDE_SCHEMA_VERSION`

---

## Quality Check

1. [ ] Schema 变更有对应 Zod 类型更新
2. [ ] `index.ts` 导出列表包含新增的公共 API
3. [ ] `renderSvg.ts` 和 `compilePptx.ts` 对新元素类型都有处理
4. [ ] 测试覆盖新增的解析 / 校验逻辑
