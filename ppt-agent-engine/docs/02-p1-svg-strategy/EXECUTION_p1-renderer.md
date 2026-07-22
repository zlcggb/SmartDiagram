# 执行文档：P1 ppt-renderer SVG 编译增强（2026-07-17）

## 需求

在保持 P0 按页降级策略不变的前提下，增强 SVG→PPTX：

1. 轻量 XML 解析优先于纯正则
2. 稳定支持 `<text>` + 内联 `<tspan>`（多 run 同框）
3. 尽力支持基础 `linearGradient`、`line`/`path` 简单箭头
4. 保留硬门禁与失败降级，不让 standard 导出变脆
5. 可选：从大文件抽出 `svgCompile.ts`

## 方案与权重

| 方案 | 权重 | 说明 |
|------|------|------|
| A：继续堆正则增强 tspan/渐变/箭头 | **40** | 嵌套与混合内容易静默丢 run；defs 与 marker 难维护 |
| B：XML DOM + 关键增强（渐变/箭头最小可用） | **85** | 结构正确、可增量；失败仍返回 false 降级 |

选用 **B**。

依赖取舍：原计划可选 `fast-xml-parser`；安装链路慢且目标要求「尽量少加依赖」，故采用 **包内栈式 XML 解析**（零新依赖），能力覆盖可编译 SVG 子集即可。

## 本轮改动

| 文件 | 变更 |
|------|------|
| `packages/ppt-renderer/src/svgCompile.ts` | **新建**：XML 解析、defs 收集、walk 渲染、`tryRenderSvgSlide` |
| `packages/ppt-renderer/src/index.ts` | 删除旧正则 SVG 路径；改为 `import { tryRenderSvgSlide } from "./svgCompile.js"`；P0 降级/`pageResults` 逻辑不变 |
| `package.json` | 未新增依赖 |

### `svgCompile` 能力清单

| 能力 | 行为 |
|------|------|
| XML 解析 | 栈式 DOM；非法/未闭合 → `false`（降级） |
| 硬门禁 | 仍用 `getBannedSvgFeatures`；viewBox；对象数预检 ≥4 |
| `<g transform="translate">` | 树遍历累加 tx/ty（不再字符串改写） |
| `<text>` + `<tspan>` | 同框多 run（颜色/字重）；带 `x`/`y`/`dy` 的 tspan → `breakLine` |
| `linearGradient` | 读 stops，**近似为 solid**（取中点附近 stop；pptxgenjs 无 gradFill） |
| `marker-start` / `marker-end` | 映射 `beginArrowType` / `endArrowType`（triangle/diamond/oval） |
| `ellipse` | 一并支持（预检计数含 ellipse） |

### 未改（有意保留）

- P0 `effectiveRenderStrategy` / 按页降级 / `pageResults`
- 主题模板与 IR 渲染大块（未做 P1-3 全包拆分）

## 已知限制

1. **渐变**：pptxgenjs `ShapeFillProps` 仅 `solid`，无法真·DrawingML 渐变；仅主色近似。
2. **path**：仍按数字点序列折线近似，非完整 path 语义（曲线/弧会失真）。
3. **marker**：不校验 marker 几何与 stroke 填色一致性；缺 defs 时仍给 triangle 启发。
4. **分组**：`<g>` 只做 translate 传递，不产出 PPT 组合对象。
5. **XML 解析器**：非完整 XML 1.0；命名空间仅剥前缀；复杂实体/DTD 不支持。
6. **半成品 slide**：预检通过后若 walk 中途异常会 catch→false，但可能已写入部分形状；调用方仍会在同 slide 上叠 IR（与 P0 相同风险面，未扩大）。

## Typecheck

```text
cd packages/ppt-renderer
corepack pnpm typecheck
# exit 0
```

## 验收对照（P1 计划）

| 项 | 状态 |
|----|------|
| P1-1 XML DOM 解析 + tspan | 已完成（同包模块，非独立 npm 包） |
| P1-2 linearGradient / marker 最小可用 | 已完成（近似/映射） |
| P1-3 全包拆分 themes/ir | **未做**（按「改动面过大则优先 XML+tspan」） |
| P1-4 examples 对照回归 | **未做**（可选后续） |
